-- Migration: Add INSERT policy for inventory_files
--
-- The inventory_files table has RLS enabled with a SELECT/USING policy
-- (user_id = auth.uid()) but no INSERT/WITH CHECK policy was defined.
-- Without it every INSERT from the mobile client is rejected with:
--   "new row violates row-level security policy for table inventory_files"
--
-- Additional schema notes discovered:
--   file_number  bigint  NOT NULL  (per-user sequential integer, e.g. 1, 2, 3…)
--   id           uuid or text, client-generated (no server default)
--
-- The mobile app resolves file_number by querying MAX(file_number) for the
-- current user and incrementing by 1 before each insert.
--
-- Run this in your Supabase dashboard → SQL Editor:

CREATE POLICY "authenticated users can insert their own files"
  ON public.inventory_files
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- If you also want to allow UPDATE and DELETE for owners:
-- CREATE POLICY "users can update their own files"
--   ON public.inventory_files FOR UPDATE TO authenticated
--   USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
--
-- CREATE POLICY "users can delete their own files"
--   ON public.inventory_files FOR DELETE TO authenticated
--   USING (user_id = auth.uid());
