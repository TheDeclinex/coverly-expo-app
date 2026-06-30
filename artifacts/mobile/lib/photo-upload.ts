/** Shared Supabase Storage upload helpers for inventory photos. */
import { File } from "expo-file-system";
import { Platform } from "react-native";

import { friendlyNetworkErrorMessage } from "@/lib/network-errors";
import {
  INVENTORY_PHOTOS_BUCKET,
  SIGNED_URL_EXPIRY_SECS,
} from "@/lib/storage-helpers";
import { supabase } from "@/lib/supabase";

export interface UploadSuccess {
  ok: true;
  /** Durable Supabase Storage path. Store this value in the database. */
  path: string;
  /** Short-lived signed URL for immediate display only. */
  displayUrl: string | null;
}

export type UploadSource =
  | "scan_photo"
  | "property_cover"
  | "room_cover"
  | "item_photo";

export interface UploadFailure {
  ok: false;
  error: string;
  statusCode?: string | number;
  details?: string;
  bucket: string;
  uploadPath: string;
  authenticatedUserIdPresent: boolean;
  userId?: string;
  fileId?: string;
  contentType?: string;
  fileSize?: number;
  source: UploadSource;
}

export type UploadResult = UploadSuccess | UploadFailure;

interface UploadContext {
  source: UploadSource;
  fileId?: string;
}

interface UploadBody {
  data: Blob | ArrayBuffer;
  contentType: string;
  fileSize: number;
  extension: string;
}

/** Per-session cache of successful scan-photo uploads only. */
const uploadCache = new Map<string, UploadSuccess>();

function imageMetadata(localUri: string, reportedType?: string | null) {
  const uriExtension = localUri
    .split("?")[0]
    .match(/\.([a-zA-Z0-9]+)$/)?.[1]
    ?.toLowerCase();
  const extension = uriExtension === "jpeg" ? "jpg" : (uriExtension || "jpg");
  const contentType = reportedType || (extension === "jpg" ? "image/jpeg" : `image/${extension}`);
  const typeExtension = contentType.split("/")[1]?.toLowerCase().replace("jpeg", "jpg");
  return { contentType, extension: typeExtension || extension };
}

/**
 * Web blob URLs are read with fetch. Native camera/image-picker file URIs are
 * read directly by Expo FileSystem because React Native's fetch(...).blob()
 * can produce a Blob that Supabase Storage cannot upload reliably.
 */
async function readUploadBody(localUri: string): Promise<UploadBody> {
  if (Platform.OS === "web") {
    const response = await fetch(localUri);
    if (!response.ok) {
      throw Object.assign(
        new Error(`Source image fetch failed with HTTP ${response.status}`),
        { statusCode: response.status, details: response.statusText },
      );
    }
    const blob = await response.blob();
    const metadata = imageMetadata(localUri, blob.type);
    return {
      data: blob,
      contentType: metadata.contentType,
      fileSize: blob.size,
      extension: metadata.extension,
    };
  }

  const file = new File(localUri);
  const data = await file.arrayBuffer();
  const metadata = imageMetadata(localUri, file.type);
  return {
    data,
    contentType: metadata.contentType,
    fileSize: file.size,
    extension: metadata.extension,
  };
}

function uploadPrefix(source: UploadSource): "scan" | "cover" | "item" {
  if (source === "scan_photo") return "scan";
  if (source === "item_photo") return "item";
  return "cover";
}

async function uploadInventoryPhoto(
  localUri: string,
  userId: string,
  context: UploadContext,
): Promise<UploadResult> {
  if (!context.fileId) {
    return createUploadFailure(
      context,
      userId,
      "not generated (missing property/file id)",
      { message: "Required property/file id is missing", code: "MISSING_FILE_ID" },
    );
  }

  let uploadPath = "not generated";
  try {
    const file = await readUploadBody(localUri);
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);
    uploadPath = `${userId}/${context.fileId}/${uploadPrefix(context.source)}-${timestamp}-${rand}.${file.extension}`;

    if (__DEV__) console.info("[storageUpload] prepared", {
      bucket: INVENTORY_PHOTOS_BUCKET,
      uploadPath,
      source: context.source,
      platform: Platform.OS,
      contentType: file.contentType,
      fileSize: file.fileSize,
    });

    const uploadStartedAt = Date.now();
    if (__DEV__) console.info("[storageUpload] upload started", {
      bucket: INVENTORY_PHOTOS_BUCKET,
      uploadPath,
      source: context.source,
      fileSize: file.fileSize,
    });

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(INVENTORY_PHOTOS_BUCKET)
      .upload(uploadPath, file.data, { contentType: file.contentType, upsert: false });

    if (uploadError) {
      return createUploadFailure(context, userId, uploadPath, uploadError, file);
    }

    if (__DEV__) console.info("[storageUpload] upload completed", {
      bucket: INVENTORY_PHOTOS_BUCKET,
      uploadPath: uploadData.path,
      source: context.source,
      elapsedMs: Date.now() - uploadStartedAt,
    });

    const { data: signedData, error: signedError } = await supabase.storage
      .from(INVENTORY_PHOTOS_BUCKET)
      .createSignedUrl(uploadData.path, SIGNED_URL_EXPIRY_SECS);
    if (signedError) {
      if (__DEV__) console.warn("[photoUpload] signed URL error:", signedError.message);
    }

    if (__DEV__) console.info("[storageUpload] signed URL step completed", {
      bucket: INVENTORY_PHOTOS_BUCKET,
      uploadPath: uploadData.path,
      source: context.source,
      hasDisplayUrl: !!signedData?.signedUrl,
      signedUrlError: signedError?.message ?? null,
    });

    return {
      ok: true,
      path: uploadData.path,
      displayUrl: signedData?.signedUrl ?? null,
    };
  } catch (error) {
    return createUploadFailure(context, userId, uploadPath, error);
  }
}

function errorMetadata(error: unknown): {
  error: string;
  statusCode?: string | number;
  details?: string;
} {
  if (error instanceof Error) {
    const record = error as Error & {
      statusCode?: string | number;
      status?: string | number;
      code?: string | number;
      details?: string;
    };
    return {
      error: error.message,
      statusCode: record.statusCode ?? record.status ?? record.code,
      details: record.details ?? error.name,
    };
  }

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    return {
      error: typeof record.message === "string" ? record.message : "Unknown upload error",
      statusCode:
        typeof record.statusCode === "string" || typeof record.statusCode === "number"
          ? record.statusCode
          : typeof record.status === "string" || typeof record.status === "number"
            ? record.status
            : typeof record.code === "string" || typeof record.code === "number"
              ? record.code
              : undefined,
      details: typeof record.details === "string" ? record.details : undefined,
    };
  }

  return { error: String(error) };
}

function createUploadFailure(
  context: UploadContext,
  userId: string,
  uploadPath: string,
  error: unknown,
  file?: { contentType?: string; fileSize?: number },
): UploadFailure {
  const failure: UploadFailure = {
    ok: false,
    ...errorMetadata(error),
    bucket: INVENTORY_PHOTOS_BUCKET,
    uploadPath,
    authenticatedUserIdPresent: Boolean(userId),
    userId: userId || undefined,
    fileId: context.fileId,
    contentType: file?.contentType,
    fileSize: file?.fileSize,
    source: context.source,
  };
  if (__DEV__) console.error("[storageUpload] failed", failure);
  return failure;
}

export function formatUploadFailure(failure: UploadFailure): string {
  const networkMessage = friendlyNetworkErrorMessage(failure.error);
  if (networkMessage) return networkMessage;

  if (!__DEV__) {
    return "We couldn't upload the photo. Check your connection and try again.";
  }

  const user = failure.authenticatedUserIdPresent
    ? `present (${failure.userId ?? "unknown"})`
    : "missing";
  const size = failure.fileSize != null
    ? `${Math.max(1, Math.round(failure.fileSize / 1024))} KB`
    : "unknown";

  return [
    `${failure.source}: ${failure.error}`,
    `Bucket: ${failure.bucket}`,
    `Path: ${failure.uploadPath}`,
    `Authenticated user: ${user}`,
    `Property/file: ${failure.fileId ?? "not provided"}`,
    `Content: ${failure.contentType ?? "unknown"}, ${size}`,
    `Status/code: ${failure.statusCode ?? "not provided"}`,
    failure.details ? `Details: ${failure.details}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export async function uploadScanPhoto(
  localUri: string,
  userId: string,
  dedupeKey?: string,
  context: Omit<UploadContext, "source"> = {},
): Promise<UploadResult> {
  const uploadContext: UploadContext = { ...context, source: "scan_photo" };
  const cacheKey = dedupeKey ?? localUri;
  const cached = uploadCache.get(cacheKey);
  if (cached) return cached;

  const result = await uploadInventoryPhoto(localUri, userId, uploadContext);
  if (result.ok) {
    uploadCache.set(cacheKey, result);
  }
  return result;
}

export function clearScanPhotoUploadCache(): void {
  uploadCache.clear();
}

export async function uploadCoverPhoto(
  localUri: string,
  userId: string,
  context: UploadContext = { source: "property_cover" },
): Promise<UploadResult> {
  return uploadInventoryPhoto(localUri, userId, context);
}

export async function uploadItemPhoto(
  localUri: string,
  userId: string,
  fileId: string,
): Promise<UploadResult> {
  return uploadInventoryPhoto(localUri, userId, { source: "item_photo", fileId });
}
