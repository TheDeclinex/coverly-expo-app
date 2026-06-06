---
name: Coverly Supabase insert rules
description: RLS policy gaps and id-generation rules for inventory_files and inventory_items
---

## inventory_files

Required columns for INSERT (all confirmed from live DB errors):
- `id`: generate UUID client-side (no server default). Use inline Math.random() UUID v4 generator.
- `user_id`: `session.user.id`
- `file_number`: **bigint NOT NULL**, per-user sequential integer. Query `MAX(file_number)` for the current user (RLS auto-scopes to their rows) and use `max + 1` (default to 1 if user has no properties).
- `name`, `status`: required non-null strings

**INSERT RLS policy was missing** — add via SQL Editor:
  ```sql
  CREATE POLICY "authenticated users can insert their own files"
    ON public.inventory_files FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());
  ```
- Migration file: `supabase/migrations/add_inventory_files_insert_policy.sql`
- Edge function alternative: `supabase/functions/create-property/index.ts`

**Why:** Table was originally populated via Supabase dashboard (service role bypasses RLS). `file_number` and `id` have no server defaults — must be supplied client-side.

## inventory_items

- `id` column: `text NOT NULL` with **no server default** — must generate client-side via `generateItemId()` in `lib/item-insert-helpers.ts`.
- **No `user_id` column** in the items table — ownership enforced via `file_id` → `inventory_files` join.
- Original memory note ("must include user_id") was incorrect — `inventory_items` has no user_id column.

## item-photos storage bucket

- The `item-photos` Supabase storage bucket does NOT yet exist. Upload fails with "Bucket not found". Items save correctly without a photo — graceful degradation. User must create the bucket in Supabase dashboard → Storage → Buckets → New bucket named `item-photos`.
