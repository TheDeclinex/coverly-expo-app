-- Add PDF/export metadata to the existing public.claim_packs table.
--
-- Production export confirmed public.claim_packs already exists and was used by
-- UI Bakery claim-pack flows. This migration intentionally reuses that table
-- instead of creating claim_pack_exports.
--
-- This migration intentionally does not:
--   - drop, rename, or alter existing columns,
--   - change RLS,
--   - change grants,
--   - create or alter storage buckets/policies,
--   - create Edge Functions,
--   - change billing or entitlement behavior.

ALTER TABLE public.claim_packs
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS filename text,
  ADD COLUMN IF NOT EXISTS file_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS selected_room_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS selected_item_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS generation_error text;

COMMENT ON COLUMN public.claim_packs.storage_path IS
  'Private Supabase Storage path for the generated claim-pack PDF in the claim-packs bucket.';

COMMENT ON COLUMN public.claim_packs.filename IS
  'User-facing filename for the generated claim-pack PDF.';

COMMENT ON COLUMN public.claim_packs.file_size_bytes IS
  'Generated PDF file size in bytes, when available.';

COMMENT ON COLUMN public.claim_packs.generated_at IS
  'Timestamp when the claim-pack PDF was successfully generated.';

COMMENT ON COLUMN public.claim_packs.selected_room_ids IS
  'JSON array snapshot of room ids selected for this claim-pack export.';

COMMENT ON COLUMN public.claim_packs.selected_item_ids IS
  'JSON array snapshot of item ids selected for this claim-pack export.';

COMMENT ON COLUMN public.claim_packs.totals IS
  'JSON object snapshot of export totals, such as selected item count, evidence count, and estimated value.';

COMMENT ON COLUMN public.claim_packs.generation_error IS
  'Last PDF generation error message for this claim-pack, if generation failed.';

-- Useful lookup for opening/downloading an already-generated PDF by storage path.
CREATE INDEX IF NOT EXISTS claim_packs_storage_path_idx
  ON public.claim_packs (storage_path)
  WHERE storage_path IS NOT NULL;

-- Useful for history views if the existing UI Bakery table has user_id.
-- Guarded to avoid assuming the shape of the pre-existing production table.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'claim_packs'
      AND column_name = 'user_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS claim_packs_user_generated_at_idx
      ON public.claim_packs (user_id, generated_at DESC)
      WHERE generated_at IS NOT NULL;
  END IF;
END $$;

-- Verification SQL after applying:
--
-- 1) Confirm new columns exist:
-- SELECT
--   column_name,
--   data_type,
--   is_nullable,
--   column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'claim_packs'
--   AND column_name IN (
--     'storage_path',
--     'filename',
--     'file_size_bytes',
--     'generated_at',
--     'selected_room_ids',
--     'selected_item_ids',
--     'totals',
--     'generation_error'
--   )
-- ORDER BY column_name;
--
-- 2) Confirm existing rows are preserved and defaults are populated:
-- SELECT
--   count(*) AS claim_pack_rows,
--   count(*) FILTER (WHERE selected_room_ids IS NULL) AS null_selected_room_ids,
--   count(*) FILTER (WHERE selected_item_ids IS NULL) AS null_selected_item_ids,
--   count(*) FILTER (WHERE totals IS NULL) AS null_totals
-- FROM public.claim_packs;
--
-- 3) Confirm indexes:
-- SELECT
--   indexname,
--   indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND tablename = 'claim_packs'
--   AND indexname IN (
--     'claim_packs_storage_path_idx',
--     'claim_packs_user_generated_at_idx'
--   )
-- ORDER BY indexname;
--
-- 4) Confirm RLS setting was not changed by this migration:
-- SELECT
--   c.relname AS table_name,
--   c.relrowsecurity AS rls_enabled,
--   c.relforcerowsecurity AS rls_forced
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public'
--   AND c.relname = 'claim_packs';
--
-- 5) Confirm grants for the table, for review only:
-- SELECT
--   grantee,
--   privilege_type,
--   is_grantable
-- FROM information_schema.table_privileges
-- WHERE table_schema = 'public'
--   AND table_name = 'claim_packs'
-- ORDER BY grantee, privilege_type;
