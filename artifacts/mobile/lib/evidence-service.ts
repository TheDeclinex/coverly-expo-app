import { File } from "expo-file-system";
import { Platform } from "react-native";

import {
  CLAIM_EVIDENCE_BUCKET,
  getSignedDisplayUrl,
  isStoragePath,
} from "@/lib/storage-helpers";
import { supabase } from "@/lib/supabase";
import type {
  ClaimEvidence,
  EvidenceFileInput,
  EvidenceType,
} from "@/types/evidence";

interface AddEvidenceInput {
  itemId: string;
  fileId: string;
  userId: string;
  userEmail?: string | null;
  evidenceType: EvidenceType;
  file: EvidenceFileInput;
  caption?: string | null;
  documentDate?: string | null;
}

type EvidenceOperation =
  | "claim-evidence storage upload"
  | "claim_evidence insert"
  | "claim_evidence_items insert";

interface EvidenceDiagnosticContext {
  userId: string;
  fileId: string;
  itemId: string;
  evidenceId: string;
  uploadPath?: string;
}

function errorMetadata(error: unknown) {
  const record = (typeof error === "object" && error !== null ? error : {}) as Record<string, unknown>;
  return {
    message: typeof record.message === "string" ? record.message : String(error),
    code: record.code ?? null,
    status: record.statusCode ?? record.status ?? null,
    details: record.details ?? null,
    hint: record.hint ?? null,
  };
}

function logEvidenceAttempt(
  operation: EvidenceOperation,
  target: string,
  context: EvidenceDiagnosticContext,
  payload: Record<string, unknown>,
) {
  console.info("[evidence] operation attempt", {
    operation,
    target,
    ...context,
    payload,
  });
}

function evidenceOperationError(
  operation: EvidenceOperation,
  target: string,
  context: EvidenceDiagnosticContext,
  payload: Record<string, unknown>,
  error: unknown,
): Error {
  const metadata = errorMetadata(error);
  const diagnostic = {
    operation,
    target,
    ...context,
    payload,
    error: metadata,
  };
  console.error("[evidence] operation failed", diagnostic);
  const extras = [
    metadata.code ? `code=${metadata.code}` : null,
    metadata.status ? `status=${metadata.status}` : null,
    metadata.details ? `details=${metadata.details}` : null,
    metadata.hint ? `hint=${metadata.hint}` : null,
  ].filter(Boolean).join("; ");
  return new Error(`${operation} failed: ${metadata.message}${extras ? ` (${extras})` : ""}`);
}

function createEvidenceId(): string {
  return `ev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function safeExtension(file: EvidenceFileInput): string {
  const fromName = file.filename.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{1,8}$/.test(fromName)) {
    return fromName === "jpeg" ? "jpg" : fromName;
  }
  if (file.mimeType === "application/pdf") return "pdf";
  const fromMime = file.mimeType.split("/")[1]?.toLowerCase();
  return fromMime === "jpeg" ? "jpg" : (fromMime || "bin");
}

function validateEvidenceFile(file: EvidenceFileInput): void {
  if (file.mimeType === "application/pdf" || file.mimeType.startsWith("image/")) return;
  throw new Error("Only images and PDF documents are supported.");
}

async function readEvidenceBody(file: EvidenceFileInput): Promise<Blob | ArrayBuffer> {
  if (Platform.OS === "web") {
    const response = await fetch(file.uri);
    if (!response.ok) throw new Error(`Could not read selected file (${response.status}).`);
    return response.blob();
  }
  return new File(file.uri).arrayBuffer();
}

export async function loadItemEvidence(itemId: string): Promise<ClaimEvidence[]> {
  const { data: links, error: linkError } = await supabase
    .from("claim_evidence_items")
    .select("evidence_id")
    .eq("item_id", itemId);
  if (linkError) throw linkError;

  const evidenceIds = (links ?? []).map((link) => link.evidence_id).filter(Boolean);
  if (evidenceIds.length === 0) return [];

  const { data, error } = await supabase
    .from("claim_evidence")
    .select("*")
    .in("id", evidenceIds)
    .order("upload_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ClaimEvidence[];
}

export async function addItemEvidence(input: AddEvidenceInput): Promise<ClaimEvidence> {
  validateEvidenceFile(input.file);
  const evidenceId = createEvidenceId();
  const extension = safeExtension(input.file);
  const storagePath = `${input.userId}/${input.fileId}/${evidenceId}.${extension}`;
  const uploadBody = await readEvidenceBody(input.file);
  const context: EvidenceDiagnosticContext = {
    userId: input.userId,
    fileId: input.fileId,
    itemId: input.itemId,
    evidenceId,
    uploadPath: storagePath,
  };
  const uploadDiagnostic = {
    bucket: CLAIM_EVIDENCE_BUCKET,
    contentType: input.file.mimeType,
    fileSize: input.file.fileSize ?? null,
    upsert: false,
  };
  logEvidenceAttempt("claim-evidence storage upload", CLAIM_EVIDENCE_BUCKET, context, uploadDiagnostic);

  const { error: uploadError } = await supabase.storage
    .from(CLAIM_EVIDENCE_BUCKET)
    .upload(storagePath, uploadBody, {
      contentType: input.file.mimeType,
      upsert: false,
    });
  if (uploadError) {
    throw evidenceOperationError(
      "claim-evidence storage upload",
      CLAIM_EVIDENCE_BUCKET,
      context,
      uploadDiagnostic,
      uploadError,
    );
  }

  const payload = {
    id: evidenceId,
    file_id: input.fileId,
    user_id: input.userId,
    created_by_email: input.userEmail ?? null,
    evidence_type: input.evidenceType,
    filename: input.file.filename,
    file_url: storagePath,
    upload_date: new Date().toISOString(),
    document_date: input.documentDate || null,
    caption: input.caption?.trim() || null,
    is_primary: false,
    include_in_pack: true,
  };
  const evidenceDiagnostic = {
    id: payload.id,
    file_id: payload.file_id,
    user_id: payload.user_id,
    created_by_email_present: Boolean(payload.created_by_email),
    evidence_type: payload.evidence_type,
    filename: "[redacted]",
    file_url: payload.file_url,
    upload_date: payload.upload_date,
    document_date: payload.document_date,
    caption_present: Boolean(payload.caption),
    is_primary: payload.is_primary,
    include_in_pack: payload.include_in_pack,
  };
  logEvidenceAttempt("claim_evidence insert", "public.claim_evidence", context, evidenceDiagnostic);

  const { data: evidence, error: evidenceError } = await supabase
    .from("claim_evidence")
    .insert(payload)
    .select("*")
    .single();

  if (evidenceError) {
    await supabase.storage.from(CLAIM_EVIDENCE_BUCKET).remove([storagePath]);
    throw evidenceOperationError(
      "claim_evidence insert",
      "public.claim_evidence",
      context,
      evidenceDiagnostic,
      evidenceError,
    );
  }

  const linkPayload = { evidence_id: evidenceId, item_id: input.itemId };
  logEvidenceAttempt("claim_evidence_items insert", "public.claim_evidence_items", context, linkPayload);
  const { error: linkError } = await supabase
    .from("claim_evidence_items")
    .insert(linkPayload);

  if (linkError) {
    await supabase.from("claim_evidence").delete().eq("id", evidenceId);
    await supabase.storage.from(CLAIM_EVIDENCE_BUCKET).remove([storagePath]);
    throw evidenceOperationError(
      "claim_evidence_items insert",
      "public.claim_evidence_items",
      context,
      linkPayload,
      linkError,
    );
  }

  return evidence as ClaimEvidence;
}

export async function getEvidenceSignedUrl(path: string): Promise<string> {
  const url = await getSignedDisplayUrl(CLAIM_EVIDENCE_BUCKET, path);
  if (!url) throw new Error("Could not open this evidence file.");
  return url;
}

export async function deleteItemEvidence(
  itemId: string,
  evidence: ClaimEvidence,
): Promise<{ evidenceDeleted: boolean }> {
  const { count, error: countError } = await supabase
    .from("claim_evidence_items")
    .select("id", { count: "exact", head: true })
    .eq("evidence_id", evidence.id);
  if (countError) throw new Error(`Could not check evidence links: ${countError.message}`);

  if ((count ?? 0) > 1) {
    const { error: unlinkError } = await supabase
      .from("claim_evidence_items")
      .delete()
      .eq("evidence_id", evidence.id)
      .eq("item_id", itemId);
    if (unlinkError) throw new Error(`Could not unlink evidence: ${unlinkError.message}`);
    return { evidenceDeleted: false };
  }

  if (isStoragePath(evidence.file_url)) {
    const { error: storageError } = await supabase.storage
      .from(CLAIM_EVIDENCE_BUCKET)
      .remove([evidence.file_url]);
    if (storageError) throw new Error(`Could not delete evidence file: ${storageError.message}`);
  }

  const { error: evidenceError } = await supabase
    .from("claim_evidence")
    .delete()
    .eq("id", evidence.id);
  if (evidenceError) throw new Error(`Could not delete evidence record: ${evidenceError.message}`);

  return { evidenceDeleted: true };
}
