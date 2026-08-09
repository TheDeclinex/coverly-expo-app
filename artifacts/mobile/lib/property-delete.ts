import {
  CLAIM_EVIDENCE_BUCKET,
  INVENTORY_PHOTOS_BUCKET,
  isStoragePath,
} from "@/lib/storage-helpers";
import { supabase } from "@/lib/supabase";

const STORAGE_DELETE_BATCH_SIZE = 100;

type DeleteError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

type StorageCleanupPlan = {
  inventoryPhotoPaths: string[];
  evidencePaths: string[];
};

function safeErrorMetadata(error: unknown) {
  const record = (typeof error === "object" && error !== null ? error : {}) as DeleteError;
  return {
    code: record.code ?? null,
    message: record.message ?? String(error),
    details: record.details ?? null,
    hint: record.hint ?? null,
  };
}

export function isMissingPropertyDeleteRpcError(error: unknown): boolean {
  const metadata = safeErrorMetadata(error);
  return metadata.code === "PGRST202"
    || /delete_my_inventory_file/i.test(metadata.message)
      && /could not find|schema cache|does not exist/i.test(metadata.message);
}

function uniqueStoragePaths(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => isStoragePath(value)))];
}

function attachmentPaths(value: unknown): Array<string | null> {
  if (!Array.isArray(value)) return [];
  return value.map((attachment) => {
    if (typeof attachment !== "object" || attachment === null) return null;
    const url = (attachment as { url?: unknown }).url;
    return typeof url === "string" ? url : null;
  });
}

async function loadStorageCleanupPlan(propertyId: string): Promise<StorageCleanupPlan> {
  const [propertyResult, roomsResult, itemsResult, evidenceResult] = await Promise.all([
    supabase
      .from("inventory_files")
      .select("property_cover_image_url")
      .eq("id", propertyId)
      .maybeSingle(),
    supabase
      .from("inventory_rooms")
      .select("cover_photo_url")
      .eq("file_id", propertyId),
    supabase
      .from("inventory_items")
      .select("image_url, photo_url, attachments")
      .eq("file_id", propertyId),
    supabase
      .from("claim_evidence")
      .select("file_url")
      .eq("file_id", propertyId),
  ]);

  const queryFailures = [propertyResult.error, roomsResult.error, itemsResult.error, evidenceResult.error]
    .filter(Boolean)
    .map(safeErrorMetadata);
  if (queryFailures.length > 0) {
    console.warn("[propertyDelete] Storage cleanup inventory was incomplete", {
      failedQueryCount: queryFailures.length,
      errors: queryFailures,
    });
  }

  return {
    inventoryPhotoPaths: uniqueStoragePaths([
      propertyResult.data?.property_cover_image_url,
      ...(roomsResult.data ?? []).map((room) => room.cover_photo_url),
      ...(itemsResult.data ?? []).flatMap((item) => [
        item.image_url,
        item.photo_url,
        ...attachmentPaths(item.attachments),
      ]),
    ]),
    evidencePaths: uniqueStoragePaths((evidenceResult.data ?? []).map((evidence) => evidence.file_url)),
  };
}

async function removeStoragePaths(bucket: string, paths: string[]): Promise<void> {
  for (let offset = 0; offset < paths.length; offset += STORAGE_DELETE_BATCH_SIZE) {
    const batch = paths.slice(offset, offset + STORAGE_DELETE_BATCH_SIZE);
    const { error } = await supabase.storage.from(bucket).remove(batch);
    if (error) {
      console.warn("[propertyDelete] Storage cleanup failed after database deletion", {
        bucket,
        batchSize: batch.length,
        error: safeErrorMetadata(error),
      });
    }
  }
}

/**
 * Deletes the authenticated user's property and database-owned descendants.
 *
 * The RPC remains the preferred atomic path. Production briefly lacked that
 * migration, so only PostgREST's missing-function error falls back to deleting
 * the owned parent row; production foreign keys cascade its rooms, items, and
 * evidence records in the same database transaction. Generated claim packs are
 * intentionally retained as historical user-owned records.
 */
export async function deletePropertyOwnedData(propertyId: string): Promise<void> {
  const cleanupPlan = await loadStorageCleanupPlan(propertyId);
  const { error: rpcError } = await supabase.rpc("delete_my_inventory_file", {
    p_file_id: propertyId,
  });

  if (rpcError && !isMissingPropertyDeleteRpcError(rpcError)) {
    console.error("[propertyDelete] Transactional RPC failed", {
      error: safeErrorMetadata(rpcError),
    });
    throw rpcError;
  }

  if (rpcError) {
    console.warn("[propertyDelete] Transactional RPC unavailable; using owned parent delete", {
      error: safeErrorMetadata(rpcError),
    });
    const { data: deletedFile, error: fallbackError } = await supabase
      .from("inventory_files")
      .delete()
      .eq("id", propertyId)
      .select("id")
      .maybeSingle();

    if (fallbackError || !deletedFile) {
      const failure = fallbackError ?? new Error("Property was not found or could not be deleted");
      console.error("[propertyDelete] Owned parent delete failed", {
        error: safeErrorMetadata(failure),
      });
      throw failure;
    }
  }

  await Promise.all([
    removeStoragePaths(INVENTORY_PHOTOS_BUCKET, cleanupPlan.inventoryPhotoPaths),
    removeStoragePaths(CLAIM_EVIDENCE_BUCKET, cleanupPlan.evidencePaths),
  ]);
}
