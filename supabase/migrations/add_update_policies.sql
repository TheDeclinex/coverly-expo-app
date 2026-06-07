-- Migration: Add UPDATE (and DELETE) policies for inventory_files and inventory_rooms
--
-- inventory_files (properties):
--   Previously only SELECT and INSERT policies existed. Without an UPDATE policy,
--   any UPDATE call (e.g. saving a cover photo) affects 0 rows without an error,
--   causing silent data loss.
--
-- inventory_rooms:
--   Similarly needs an UPDATE policy so cover_photo_url can be persisted.
--
-- Run this in your Supabase dashboard → SQL Editor:

-- ── inventory_files ───────────────────────────────────────────────────────────

CREATE POLICY "users can update their own files"
  ON public.inventory_files
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users can delete their own files"
  ON public.inventory_files
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ── inventory_rooms ───────────────────────────────────────────────────────────

CREATE POLICY "users can update their own rooms"
  ON public.inventory_rooms
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users can delete their own rooms"
  ON public.inventory_rooms
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
