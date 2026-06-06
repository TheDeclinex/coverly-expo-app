---
name: Coverly scan-room-photo contract
description: Production Edge Function payload shape, mode name mapping, and image transport approach for the scan-room-photo function.
---

## Request payload
```ts
{
  mode: "single_photo" | "multi_photo" | "video_frames",
  images: Array<{ id: string; imageBase64: string; mimeType?: string; sourceName?: string }>,
  context?: { propertyId?: string; fileId?: string; roomName?: string },
  model?: string
}
```

## Mobile mode → production mode mapping
| Mobile | Production |
|---|---|
| single_photo_room | single_photo |
| single_item | single_photo |
| multi_photo_room | multi_photo |
| video_room | video_frames |

## Image transport
Production expects base64 inline in the request body — no storage upload, no signed URLs.
Mobile uses `ImagePicker` with `base64: true` to encode at pick time. No `expo-file-system` needed.

## Response shape (success)
```ts
{ success: true, items: [{ name, description, category, quantity, unitEstimatedPrice, estimatedPrice, confidence: number 0-1, brand_guess?, pin?, sourcePhotoIndex?, seenInPhotos?, mergeConfidence? }], diagnostics }
```

## Response shape (error)
```ts
{ success: false, errorCode: string, message: string, diagnostics }
```

## Field mappings (production → mobile ScanDetectedItem)
- `brand_guess` → `brandMaker`
- `confidence` (float 0–1) → label string: ≥0.75→"high", ≥0.45→"medium", else "low"
- `modelSeries`, `conditionLabel` not returned by production → null

**Why:** Production function was built before mobile and uses different conventions. Mobile must map to production, not the other way around.
