export type EvidenceType =
  | "photo"
  | "receipt"
  | "warranty"
  | "manual"
  | "valuation"
  | "other";

export const EVIDENCE_TYPE_LABEL: Record<EvidenceType, string> = {
  photo: "Photo",
  receipt: "Receipt",
  warranty: "Warranty",
  manual: "Manual",
  valuation: "Valuation",
  other: "Other",
};

export interface ClaimEvidence {
  id: string;
  file_id: string;
  user_id: string;
  created_by_email: string | null;
  evidence_type: EvidenceType;
  filename: string;
  file_url: string;
  upload_date: string;
  document_date: string | null;
  caption: string | null;
  is_primary: boolean;
  include_in_pack: boolean;
  created_at: string;
}

export interface EvidenceFileInput {
  uri: string;
  filename: string;
  mimeType: string;
  fileSize?: number | null;
}
