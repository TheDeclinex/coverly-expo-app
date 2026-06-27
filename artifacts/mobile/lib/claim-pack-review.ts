import {
  itemClaimPackValue,
  itemHasClaimPackPhoto,
  itemHasClaimPackValue,
  type ClaimPackSelection,
} from "./claim-pack-selection-model.ts";

export type ClaimPackReviewIssueSeverity = "high" | "medium" | "low";

export type ClaimPackReviewIssueType =
  | "missing_value"
  | "missing_evidence"
  | "missing_brand_model"
  | "empty_room"
  | "missing_property_metadata";

export interface ClaimPackReviewPropertyLike {
  id: string;
  name: string;
  insurer_name?: string | null;
  policy_number?: string | null;
  contents_sum_insured?: number | null;
}

export interface ClaimPackReviewRoomLike {
  id: string;
  name: string;
}

export interface ClaimPackReviewItemLike {
  id: string;
  room_id: string | null;
  name: string;
  estimated_price: number | null;
  unit_estimated_price?: number | null;
  quantity?: number | null;
  image_url?: string | null;
  photo_url?: string | null;
  attachments?: { url?: string | null }[] | null;
  brand_maker?: string | null;
  model_series?: string | null;
  valuation_basis?: string | null;
  price_source_type?: string | null;
}

export interface ClaimPackReviewIssue {
  id: string;
  type: ClaimPackReviewIssueType;
  severity: ClaimPackReviewIssueSeverity;
  title: string;
  subjectName: string;
  explanation: string;
  suggestedAction: string;
  itemId?: string;
  roomId?: string;
}

export interface ClaimPackReviewSummary {
  totalIssues: number;
  unresolvedIssues: number;
  unresolvedHighOrMediumIssues: number;
  readyForExport: boolean;
  hasSelectedItems: boolean;
}

export interface ClaimPackReviewPanelState {
  shouldShowFullIssueList: boolean;
  compactMessage: string;
  actionLabel: string | null;
}

export interface BuildClaimPackReviewInput {
  property: ClaimPackReviewPropertyLike;
  rooms: ClaimPackReviewRoomLike[];
  items: ClaimPackReviewItemLike[];
  selection: ClaimPackSelection;
  evidenceCountsByItemId: Record<string, number>;
  approvedIssueIds?: Set<string>;
  draftInsurerName?: string | null;
  draftPolicyNumber?: string | null;
}

const MATERIAL_ITEM_THRESHOLD_NZD = 500;

function hasUsefulText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function reviewIssue(type: ClaimPackReviewIssueType, subjectId: string): string {
  return `${type}:${subjectId}`;
}

export function buildClaimPackReview({
  property,
  rooms,
  items,
  selection,
  evidenceCountsByItemId,
  approvedIssueIds = new Set<string>(),
  draftInsurerName,
  draftPolicyNumber,
}: BuildClaimPackReviewInput): {
  issues: ClaimPackReviewIssue[];
  unresolvedIssues: ClaimPackReviewIssue[];
  summary: ClaimPackReviewSummary;
} {
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const selectedItems = items.filter((item) => selection.selectedItemIds.has(item.id));
  const issues: ClaimPackReviewIssue[] = [];

  if (selectedItems.length === 0) {
    return {
      issues,
      unresolvedIssues: [],
      summary: {
        totalIssues: 0,
        unresolvedIssues: 0,
        unresolvedHighOrMediumIssues: 0,
        readyForExport: false,
        hasSelectedItems: false,
      },
    };
  }

  const effectiveInsurerName = draftInsurerName ?? property.insurer_name;
  const effectivePolicyNumber = draftPolicyNumber ?? property.policy_number;
  const missingPropertyFields = [
    hasUsefulText(effectiveInsurerName) ? null : "insurer name",
    hasUsefulText(effectivePolicyNumber) ? null : "policy number",
    property.contents_sum_insured && property.contents_sum_insured > 0 ? null : "contents sum insured",
  ].filter((field): field is string => Boolean(field));

  if (missingPropertyFields.length > 0) {
    issues.push({
      id: reviewIssue("missing_property_metadata", property.id),
      type: "missing_property_metadata",
      severity: "medium",
      title: "Property insurance details incomplete",
      subjectName: property.name,
      explanation: `Missing ${missingPropertyFields.join(", ")}.`,
      suggestedAction: "Add policy details before export, or continue if they are not available yet.",
    });
  }

  for (const room of rooms) {
    const selectedRoomItems = selectedItems.filter((item) => item.room_id === room.id);
    if (selection.selectedRoomIds.has(room.id) && selectedRoomItems.length === 0) {
      issues.push({
        id: reviewIssue("empty_room", room.id),
        type: "empty_room",
        severity: "medium",
        title: "Room has no selected items",
        subjectName: room.name,
        explanation: "This room is included, but no items from it are selected.",
        suggestedAction: "Select items for this room or exclude the room from the draft.",
        roomId: room.id,
      });
    }
  }

  for (const item of selectedItems) {
    const value = itemClaimPackValue(item);
    const itemName = item.name || "Unnamed item";
    const roomName = item.room_id ? roomById.get(item.room_id)?.name : null;
    const subjectName = roomName ? `${itemName} · ${roomName}` : itemName;

    if (!itemHasClaimPackValue(item) || value <= 0) {
      issues.push({
        id: reviewIssue("missing_value", item.id),
        type: "missing_value",
        severity: "high",
        title: "Missing replacement value",
        subjectName,
        explanation: "This selected item does not have a usable replacement value yet.",
        suggestedAction: "Run replacement price search or enter a value.",
        itemId: item.id,
        roomId: item.room_id ?? undefined,
      });
    }

    const evidenceCount = evidenceCountsByItemId[item.id] ?? 0;
    if (!itemHasClaimPackPhoto(item) && evidenceCount === 0) {
      issues.push({
        id: reviewIssue("missing_evidence", item.id),
        type: "missing_evidence",
        severity: "medium",
        title: "No evidence attached",
        subjectName,
        explanation: "This selected item has no photo or supporting evidence attached.",
        suggestedAction: "Add evidence or approve without evidence.",
        itemId: item.id,
        roomId: item.room_id ?? undefined,
      });
    }

    if (value > MATERIAL_ITEM_THRESHOLD_NZD && !hasUsefulText(item.brand_maker) && !hasUsefulText(item.model_series)) {
      issues.push({
        id: reviewIssue("missing_brand_model", item.id),
        type: "missing_brand_model",
        severity: "medium",
        title: "Brand or model not recorded",
        subjectName,
        explanation: "This is a higher-value item, but no brand or model is recorded.",
        suggestedAction: "Edit item details or approve as-is.",
        itemId: item.id,
        roomId: item.room_id ?? undefined,
      });
    }
  }

  const unresolvedIssues = issues.filter((issue) => !approvedIssueIds.has(issue.id));
  const unresolvedHighOrMediumIssues = unresolvedIssues.filter((issue) => issue.severity !== "low").length;

  return {
    issues,
    unresolvedIssues,
    summary: {
      totalIssues: issues.length,
      unresolvedIssues: unresolvedIssues.length,
      unresolvedHighOrMediumIssues,
      readyForExport: unresolvedHighOrMediumIssues === 0,
      hasSelectedItems: true,
    },
  };
}

export function claimPackReviewPanelState(
  summary: ClaimPackReviewSummary,
  expanded = false,
): ClaimPackReviewPanelState {
  if (!summary.hasSelectedItems) {
    return {
      shouldShowFullIssueList: false,
      compactMessage: "No review issues yet. Select items to build your claim pack.",
      actionLabel: null,
    };
  }

  if (summary.unresolvedIssues === 0) {
    return {
      shouldShowFullIssueList: false,
      compactMessage: "Review selected items before export.",
      actionLabel: null,
    };
  }

  return {
    shouldShowFullIssueList: expanded,
    compactMessage: `${summary.unresolvedIssues} ${summary.unresolvedIssues === 1 ? "issue" : "issues"} to check before export.`,
    actionLabel: expanded ? "Hide issues" : "Review issues",
  };
}
