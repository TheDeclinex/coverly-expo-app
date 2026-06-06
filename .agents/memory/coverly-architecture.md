---
name: Coverly app architecture
description: Supabase tables, field names, navigation structure, and storage config for the Coverly inventory app
---

**Supabase project:** krbrmskfvpjukcbkbegc.supabase.co (hardcoded in lib/supabase.ts — do NOT use env var, it was unreliable)

**Tables:**
- `inventory_files` — properties (file_id FK used in rooms/items)
- `inventory_rooms` — rooms (file_id FK, filter archived_at IS NULL)
- `inventory_items` — items (room_id + file_id FKs)

**Key field names (already normalised in types/index.ts):**
- Item price: `estimated_price` (primary), `unit_estimated_price` (fallback)
- Item photo: `image_url` (primary), `photo_url` (fallback)
- Property cover: `property_cover_image_url`
- Room cover: `cover_photo_url`

**Navigation (expo-router Stack, not Tabs):**
- `/(tabs)` → properties/home dashboard (index.tsx)
- `/(tabs)/property/[id]` → property dashboard + rooms
- `/(tabs)/room/[id]` → items list (passes fileId param for add-item)
- `/(tabs)/item/[id]` → item detail + Edit button
- `/(tabs)/add-item` → add item form (params: fileId, roomId, fileName, roomName)
- `/(tabs)/edit-item/[id]` → edit item + move between rooms

**Storage bucket:** ITEM_PHOTOS_BUCKET = "item-photos" — TODO: confirm in Supabase dashboard → Storage → Buckets

**Shared libs:**
- `lib/inventory-mappers.ts` — getItemPrice, getItemTotalValue, getItemPhoto, hasPhoto, hasValue, formatCurrency
- `lib/dashboard-stats.ts` — calcPropertyStats, calcPortfolioStats, PropertyStats, RoomStat, PortfolioStats

**Reusable components:**
- `components/LoadingState.tsx`, `ErrorState.tsx`, `EmptyState.tsx`
