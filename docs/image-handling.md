# Image Handling

## Goal

Photos should be reliable across:
- Property cover images.
- Room cover images.
- Item images.
- AI scan review thumbnails.
- Item detail screens.
- Expandable image modals.

## Principle

Store permanent Supabase Storage paths in the database.
Generate signed URLs at display time.

## Expected upload flow

```text
User selects image
  ↓
Image becomes local file URI
  ↓
Upload to Supabase Storage bucket `inventory-photos`
  ↓
Upload returns storage path
  ↓
Save storage path into DB
  ↓
Generate signed URL for UI display
```

## Expected display flow

```text
Fetch property/room/item rows
  ↓
Collect image paths
  ↓
Resolve signed URLs in a hook/helper
  ↓
Pass resolved URL to image components
  ↓
Show fallback/placeholder if missing or failed
```

## Do not

- Do not store expiring signed URLs as canonical DB values.
- Do not assume a signed URL is valid forever.
- Do not use unauthenticated public URLs unless a deliberate storage policy decision has been made.
- Do not duplicate image handling logic in every screen if a shared helper/hook exists.

## UX requirements

Image display should include:
- Loading state.
- Empty state.
- Error/fallback state.
- Tap-to-expand where useful.
- Pins visible on thumbnails and expanded images.
- Pin alignment preserved across image resize/crop modes.

## Known current requirements

- Item thumbnails should be expandable on all relevant screens.
- Pins should show on scan review and saved item screens.
- Pin style should be clean, centered, and not visually wonky.
- Property/room default images should feel more polished than a dull placeholder.
- Adding a property photo should persist correctly.

## Pin requirements

Pin rendering must account for:
- Image aspect ratio.
- Display container size.
- `resizeMode`.
- Original AI coordinate scale.
- Stored coordinate format.

Before changing pin positioning, inspect:
- How pins are stored.
- Whether coordinates are normalized or pixel-based.
- How the image is cropped/scaled in each screen.
