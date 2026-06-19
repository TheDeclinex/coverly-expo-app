# Coverly Repo Instructions for Codex / AI Assistants

## Project
Coverly is an Expo / React Native mobile app for household contents inventory, insurance cover awareness, replacement pricing, and future claim-pack generation.

Core proposition: **Know what you own.**

Coverly starts in New Zealand and is designed to later support other countries.

## How to work in this repo
Before making changes:
1. Read this file.
2. Read `docs/coverly-context.md`.
3. If touching data, auth, images, billing, or claim-pack flows, read the relevant doc in `/docs`.
4. Inspect the existing code before proposing new structure.
5. Prefer small, focused changes over broad rewrites.

For larger changes:
- Produce a short implementation plan first.
- Identify affected files.
- Call out risks, migrations, and test steps.
- Do not execute broad refactors unless explicitly asked.

## Source-of-truth conventions

Do **not** invent new production naming conventions without an explicit decision.

Known production-aligned names:

- Supabase tables:
  - `inventory_files`
  - `inventory_rooms`
  - `inventory_items`

- Supabase storage bucket:
  - `inventory-photos`

- Existing Edge Functions / backend services:
  - `replacement-price-search`
  - `voice-describe`
  - `barcode-verify`
  - `stripe-webhook` for web billing only

## Data model assumptions

Inventory structure:

```text
Property / File -> Room -> Item
```

Properties are stored in `inventory_files`.

Rooms are stored in `inventory_rooms`.

Items are stored in `inventory_items`.

Important current assumption:
- `inventory_items` may not have a direct `user_id` column.
- Ownership is generally inferred through the parent property/file.
- Before editing item insert/update logic, inspect existing helpers and current schema usage.

## Supabase / RLS rules

Respect existing RLS assumptions:
- Users should only read/write their own inventory data.
- Storage paths should include the authenticated user id where required by storage policies.
- Do not bypass RLS in client code.
- Do not use service role keys in the mobile app.
- Do not add new tables, columns, policies, or functions unless the task explicitly requires it and a migration plan is included.

## Image handling rules

Images should be stored as storage paths in the database, not long-lived signed URLs.

Expected pattern:
1. Upload image to `inventory-photos`.
2. Store the storage path in DB fields such as `image_url` / `photo_url`, depending on the current schema.
3. Generate signed URLs at display time.
4. Prefer cache/reuse of signed URLs where existing hooks support it.

Do not store short-lived signed URLs as permanent database values.

## Billing rules

Current direction:
- Web app billing uses Stripe.
- Native mobile billing should use RevenueCat / App Store / Google Play.
- Free plan allows limited AI scans and replacement price lookups.
- Paid plans should say AI features are included rather than exposing token-style allowances.
- Claim packs may be included for subscribers and available as a one-off purchase for free users.

Do not mix Stripe Checkout into native purchase flows unless explicitly requested.

## UX and brand rules

Brand feel:
- Modern, calm, trustworthy.
- Teal/slate/soft white.
- Avoid making the app overly green.
- Prefer clean spacing, subtle borders, and soft surfaces.
- Keep insurance language clear and practical.

Known UX preferences:
- “Scan items” should be the primary path.
- “Add manually” should be secondary.
- App should guide new users from empty states into creating a property, adding rooms, scanning, and pricing.
- Completion rings should be subtle, polished, and not visually overpowering.
- Pins/thumbnails need to be accurate, centered, and expandable where appropriate.

## Development and production migration

Code should be written with eventual dev/prod separation in mind.
Avoid hardcoding production secrets or environment-specific values.

Use environment variables and documented configuration.

## Testing expectations

For any meaningful change, include test notes:
- What was changed.
- How to preview in Expo Go or development build.
- Screens to verify.
- Any Supabase records/storage assumptions.
- Any migration or env var requirements.

## Dependency rules

Avoid adding new dependencies unless they are justified.
For new dependencies:
- Explain why it is needed.
- Check whether Expo Go supports it.
- Note whether it requires a development build.
- Include install and test instructions.

## Output style when assisting

When producing prompts, plans, or patches:
- Be specific.
- Keep tasks scoped.
- Preserve existing architecture unless change is intentional.
- Include “Done looks like”.
- Include “Do not change” boundaries.
