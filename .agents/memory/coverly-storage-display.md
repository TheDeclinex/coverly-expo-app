---
name: Coverly storage-path display rules
description: Rules for safely displaying photos stored as Supabase Storage paths; avoids silent expo-image failures
---

## Rule
Never fall back to the raw `image_url`/`photo_url` DB column value in any display component. Always show placeholder until the signed URL resolves.

**Wrong:**
```tsx
const imageUri = resolvedImageUrl ?? item.image_url ?? item.photo_url ?? null;
```

**Right:**
```tsx
const imageUri = resolvedImageUrl ?? null;
```

**Why:** `image_url`/`photo_url` now store bare storage paths (e.g. `userId/fileId/ts.jpg`), not loadable URLs. `expo-image` silently fails when given a bare path as a URI source — it doesn't throw, doesn't show a placeholder, just renders blank. Even worse, it may cache the failed attempt so the correct signed URL (arriving seconds later) never renders either.

**How to apply:**
- Any component that receives a `resolvedImageUrl` / `resolvedCoverUrl` prop from a parent's `useSignedUrls` call must guard `if (!imageUri) → placeholder` and never chain `?? item.image_url`.
- `useSignedUrl`/`useSignedUrls` already handle legacy `https://` URLs by passing them through unchanged, so the resolved value is always correct once the query settles — no raw fallback is needed for any case.
- `isStoragePath()` must exclude `file://`, `ph://`, `content://` local device URIs — they are valid loadable URIs that must pass through as-is, not be treated as storage paths requiring signed URL generation.
