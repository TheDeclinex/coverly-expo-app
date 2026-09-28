# Claim Pack Specification

## Purpose

The claim pack is an insurance-ready export that helps users provide structured evidence after a loss.

It should turn Coverly inventory data into a clear document that can be shared with an insurer, assessor, or broker.

## User goal

The user should be able to:

1. Select a property.
2. Select rooms/items to include.
3. Generate a claim-ready PDF.
4. Include item values, photos, and evidence.
5. Export/share/download the pack.

## Suggested content

Claim pack should include:

- Cover page.
- Property summary.
- Insured contents value.
- Total estimated value of included items.
- Room-by-room item schedule.
- Item details:
  - Name.
  - Category.
  - Description.
  - Estimated/replacement value.
  - Quantity.
  - Brand/model if known.
  - Notes.
  - Photos.
  - Evidence/receipts if available.
- Evidence appendix.
- Export timestamp.
- Disclaimer that values are estimates unless verified.

## Selection flow

User should be able to select:

- Entire property.
- Specific rooms.
- Specific items.

Default should probably include all documented items, with simple room-level deselection.

## Monetisation

Approved ownership direction:

- Included with verified Coverly ownership, independently of AI fair-use balance.
- Legacy paid subscribers and explicit tester/admin access remain compatible.
- Free users have no default export capability; one-off purchasing is deferred.
- Batch 4 enforces canonical export capability in the PDF function. Claim tokens
  remain dormant history and cannot grant access; Free one-off purchase is deferred.

See [provider and claim controls](provider-and-claim-controls.md) for trusted
admission, duplicate/retry behavior, owned-storage restrictions and QA prerequisites.

See `billing-and-entitlements.md` for the canonical access contract and rollout boundaries.

## UX copy direction

Avoid overpromising claim outcomes.

Good wording:

- “Claim-ready evidence pack”
- “Organised inventory export”
- “Helpful for insurer conversations”

Avoid:

- “Guaranteed claim approval”
- “Insurer-approved” unless validated.

## Done looks like

- User can generate a readable PDF.
- PDF has room/item structure.
- Photos and values are included.
- User can export/share it.
- Access respects canonical ownership, compatible legacy paid or explicit overrides.
