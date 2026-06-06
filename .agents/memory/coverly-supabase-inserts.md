---
name: Coverly Supabase insert rules
description: RLS policy gaps and id-generation rules for inventory_files and inventory_items
---

## inventory_files

- `id` column: generate UUID client-side before insert (may have no server default). Use inline Math.random() UUID v4 generator — expo-crypto not needed.
- `user_id` column: must set to `session.user.id`.
- **INSERT RLS policy is missing** from the live Supabase project. All authenticated INSERTs fail with "new row violates row-level security policy" until this SQL is run in the Supabase SQL Editor:
  ```sql
  CREATE POLICY "authenticated users can insert their own files"
    ON public.inventory_files FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());
  ```
- Migration file: `supabase/migrations/add_inventory_files_insert_policy.sql`
- Edge function alternative also at: `supabase/functions/create-property/index.ts`

**Why:** The table was originally populated via Supabase dashboard (service role bypasses RLS). No INSERT policy was ever created for client-side mobile inserts.

## inventory_items

- `id` column: `text NOT NULL` with **no server default** — must generate client-side via `generateItemId()` in `lib/item-insert-helpers.ts`.
- **No `user_id` column** in the items table — ownership enforced via `file_id` → `inventory_files` join.
- Original memory note ("must include user_id") was incorrect — `inventory_items` has no user_id column.

## item-photos storage bucket

- The `item-photos` Supabase storage bucket does NOT yet exist. Upload fails with "Bucket not found". Items save correctly without a photo — graceful degradation. User must create the bucket in Supabase dashboard → Storage → Buckets → New bucket named `item-photos`.
