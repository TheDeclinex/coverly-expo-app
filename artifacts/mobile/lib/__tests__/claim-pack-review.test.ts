import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClaimPackReview,
  claimPackReviewPanelState,
  type ClaimPackReviewItemLike,
  type ClaimPackReviewPropertyLike,
  type ClaimPackReviewRoomLike,
} from "../claim-pack-review.ts";
import type { ClaimPackSelection } from "../claim-pack-selection-model.ts";

const property: ClaimPackReviewPropertyLike = {
  id: "file-1",
  name: "Main home",
  insurer_name: "CoverSure",
  policy_number: "POL-123",
  contents_sum_insured: 100000,
};

const rooms: ClaimPackReviewRoomLike[] = [
  { id: "room-kitchen", name: "Kitchen" },
  { id: "room-lounge", name: "Lounge" },
  { id: "room-laundry", name: "Laundry" },
];

const baseSelection: ClaimPackSelection = {
  selectedRoomIds: new Set(["room-kitchen", "room-lounge", "room-laundry"]),
  selectedItemIds: new Set(["item-missing-value", "item-material", "item-estimate"]),
};

const items: ClaimPackReviewItemLike[] = [
  {
    id: "item-missing-value",
    room_id: "room-kitchen",
    name: "Kettle",
    estimated_price: null,
    unit_estimated_price: null,
    image_url: null,
    photo_url: null,
    attachments: null,
    brand_maker: null,
    model_series: null,
    valuation_basis: null,
    price_source_type: null,
  },
  {
    id: "item-material",
    room_id: "room-lounge",
    name: "Television",
    estimated_price: 1200,
    unit_estimated_price: null,
    quantity: 1,
    image_url: "user/file/tv.jpg",
    photo_url: null,
    attachments: null,
    brand_maker: null,
    model_series: null,
    valuation_basis: "replacement listing",
    price_source_type: null,
  },
  {
    id: "item-estimate",
    room_id: "room-lounge",
    name: "Wool rug",
    estimated_price: 700,
    unit_estimated_price: null,
    quantity: 1,
    image_url: "user/file/rug.jpg",
    photo_url: null,
    attachments: null,
    brand_maker: "Unknown",
    model_series: null,
    valuation_basis: "policyholder estimate",
    price_source_type: null,
  },
];

test("builds review issues for selected draft data", () => {
  const review = buildClaimPackReview({
    property,
    rooms,
    items,
    selection: baseSelection,
    evidenceCountsByItemId: {
      "item-material": 1,
      "item-estimate": 1,
    },
  });

  assert.deepEqual(
    review.issues.map((issue) => issue.id).sort(),
    [
      "empty_room:room-laundry",
      "missing_brand_model:item-material",
      "missing_evidence:item-missing-value",
      "missing_value:item-missing-value",
    ].sort(),
  );
  assert.equal(review.summary.unresolvedHighOrMediumIssues, 4);
  assert.equal(review.summary.readyForExport, false);
});

test("approved issues are excluded from unresolved readiness", () => {
  const review = buildClaimPackReview({
    property,
    rooms,
    items,
    selection: baseSelection,
    evidenceCountsByItemId: {
      "item-material": 1,
      "item-estimate": 1,
    },
    approvedIssueIds: new Set([
      "missing_value:item-missing-value",
      "missing_evidence:item-missing-value",
      "missing_brand_model:item-material",
      "empty_room:room-laundry",
    ]),
  });

  assert.equal(review.summary.totalIssues, 4);
  assert.equal(review.summary.unresolvedHighOrMediumIssues, 0);
  assert.equal(review.summary.readyForExport, true);
});

test("kept AI-estimated values are accepted by default", () => {
  const review = buildClaimPackReview({
    property,
    rooms,
    items: [
      {
        id: "item-ai-estimate",
        room_id: "room-lounge",
        name: "Side table",
        estimated_price: 180,
        unit_estimated_price: null,
        quantity: 1,
        image_url: "user/file/side-table.jpg",
        photo_url: null,
        attachments: null,
        brand_maker: "Nood",
        model_series: "Oak bedside",
        valuation_basis: "AI scan estimate",
        price_source_type: "estimatedPrice",
      },
    ],
    selection: {
      selectedRoomIds: new Set(["room-lounge"]),
      selectedItemIds: new Set(["item-ai-estimate"]),
    },
    evidenceCountsByItemId: { "item-ai-estimate": 1 },
  });

  assert.equal(review.issues.length, 0);
  assert.equal(review.summary.readyForExport, true);
});

test("valid unit estimated price is review-clean for value purposes", () => {
  const review = buildClaimPackReview({
    property,
    rooms,
    items: [
      {
        id: "item-unit-estimate",
        room_id: "room-kitchen",
        name: "Coffee grinder",
        estimated_price: null,
        unit_estimated_price: 95,
        quantity: 2,
        image_url: "user/file/grinder.jpg",
        photo_url: null,
        attachments: null,
        brand_maker: "Breville",
        model_series: "Smart Grinder",
        valuation_basis: "estimate",
        price_source_type: "unit_estimated_price",
      },
    ],
    selection: {
      selectedRoomIds: new Set(["room-kitchen"]),
      selectedItemIds: new Set(["item-unit-estimate"]),
    },
    evidenceCountsByItemId: { "item-unit-estimate": 1 },
  });

  assert.equal(review.issues.some((issue) => issue.type === "missing_value"), false);
  assert.equal(review.issues.length, 0);
});

test("zero value still creates a high missing replacement value issue", () => {
  const review = buildClaimPackReview({
    property,
    rooms,
    items: [
      {
        id: "item-zero-value",
        room_id: "room-kitchen",
        name: "Hand mixer",
        estimated_price: 0,
        unit_estimated_price: null,
        image_url: "user/file/mixer.jpg",
        photo_url: null,
        attachments: null,
        brand_maker: "Kenwood",
        model_series: "Chefette",
        valuation_basis: "AI scan estimate",
        price_source_type: "estimatedPrice",
      },
    ],
    selection: {
      selectedRoomIds: new Set(["room-kitchen"]),
      selectedItemIds: new Set(["item-zero-value"]),
    },
    evidenceCountsByItemId: { "item-zero-value": 1 },
  });

  assert.deepEqual(
    review.issues.map((issue) => [issue.type, issue.severity, issue.title]),
    [["missing_value", "high", "Missing replacement value"]],
  );
});

test("missing property insurance metadata creates a medium issue", () => {
  const review = buildClaimPackReview({
    property: {
      id: "file-2",
      name: "Holiday house",
      insurer_name: null,
      policy_number: null,
      contents_sum_insured: null,
    },
    rooms,
    items: [
      {
        id: "item-clean",
        room_id: "room-kitchen",
        name: "Toaster",
        estimated_price: 120,
        unit_estimated_price: null,
        image_url: "user/file/toaster.jpg",
        photo_url: null,
        attachments: null,
        brand_maker: "Breville",
        model_series: "Toast Select",
        valuation_basis: "receipt supplied",
        price_source_type: null,
      },
    ],
    selection: {
      selectedRoomIds: new Set(["room-kitchen"]),
      selectedItemIds: new Set(["item-clean"]),
    },
    evidenceCountsByItemId: { "item-clean": 1 },
  });

  assert.equal(review.issues.length, 1);
  assert.equal(review.issues[0].id, "missing_property_metadata:file-2");
  assert.equal(review.issues[0].severity, "medium");
});

test("no selected items does not create review issues", () => {
  const review = buildClaimPackReview({
    property: {
      id: "file-empty",
      name: "Empty draft",
      insurer_name: null,
      policy_number: null,
      contents_sum_insured: null,
    },
    rooms,
    items,
    selection: {
      selectedRoomIds: new Set(["room-kitchen"]),
      selectedItemIds: new Set(),
    },
    evidenceCountsByItemId: {},
  });

  assert.equal(review.issues.length, 0);
  assert.equal(review.summary.hasSelectedItems, false);
  assert.equal(review.summary.readyForExport, false);
});

test("review panel is collapsed by default and expands only when requested", () => {
  const review = buildClaimPackReview({
    property,
    rooms,
    items,
    selection: baseSelection,
    evidenceCountsByItemId: {
      "item-material": 1,
      "item-estimate": 1,
    },
  });

  const collapsed = claimPackReviewPanelState(review.summary);
  const expanded = claimPackReviewPanelState(review.summary, true);

  assert.equal(collapsed.shouldShowFullIssueList, false);
  assert.equal(collapsed.actionLabel, "Review issues");
  assert.equal(expanded.shouldShowFullIssueList, true);
  assert.equal(expanded.actionLabel, "Hide issues");
});

test("review panel guides item selection before validation starts", () => {
  const state = claimPackReviewPanelState({
    totalIssues: 0,
    unresolvedIssues: 0,
    unresolvedHighOrMediumIssues: 0,
    readyForExport: false,
    hasSelectedItems: false,
  });

  assert.equal(state.shouldShowFullIssueList, false);
  assert.equal(state.actionLabel, null);
  assert.match(state.compactMessage, /Select items/);
});

test("draft insurer and policy values satisfy editable metadata fields", () => {
  const review = buildClaimPackReview({
    property: {
      id: "file-3",
      name: "Rental",
      insurer_name: null,
      policy_number: null,
      contents_sum_insured: 50000,
    },
    rooms,
    items: [
      {
        id: "item-clean",
        room_id: "room-kitchen",
        name: "Toaster",
        estimated_price: 120,
        unit_estimated_price: null,
        image_url: "user/file/toaster.jpg",
        photo_url: null,
        attachments: null,
        brand_maker: "Breville",
        model_series: "Toast Select",
        valuation_basis: "receipt supplied",
        price_source_type: null,
      },
    ],
    selection: {
      selectedRoomIds: new Set(["room-kitchen"]),
      selectedItemIds: new Set(["item-clean"]),
    },
    evidenceCountsByItemId: { "item-clean": 1 },
    draftInsurerName: "CoverSure",
    draftPolicyNumber: "POL-999",
  });

  assert.equal(review.issues.length, 0);
  assert.equal(review.summary.readyForExport, true);
});
