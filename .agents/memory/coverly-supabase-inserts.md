---
name: Coverly Supabase insert rules
description: Row-level security constraints for inventory_items inserts
---

All inserts into `inventory_items` must include `user_id: session.user.id`.
The Supabase RLS policy rejects inserts that omit it (silent save failure in UI).

**Why:** `inventory_files` and `inventory_rooms` both have `user_id` columns; items follows the same pattern. Without it the INSERT silently fails due to the `auth.uid() = user_id` check policy.

**How to apply:** Always use `buildItemInsertPayload` in `lib/item-insert-helpers.ts` — it enforces user_id at the type level. Manual inserts bypass this safety net.

Also: the `item-photos` Supabase storage bucket does NOT yet exist. Upload fails with "Bucket not found". Items save correctly without a photo — this is intentional graceful degradation. User must create the bucket in Supabase dashboard → Storage → Buckets → New bucket named `item-photos`.
