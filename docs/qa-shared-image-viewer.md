# Shared image viewer manual QA

Run on iOS and Android, including one lower-end Android device where possible.

## Viewer presentation

- Open a room cover, room item photo, Item Detail photo, scan-review/source photo, add-item preview, claim-evidence image, and admin feedback screenshot.
- Confirm the current screen remains visible behind a blurred and dimmed overlay.
- Confirm portrait, landscape, very tall, and very wide images remain contained inside a rounded floating card.
- Close using the close control, backdrop tap, and Android Back.
- With Reduce Motion enabled, confirm the viewer opens without the scale animation.
- For multiple Item Detail images, swipe horizontally and confirm the count and active image stay synchronized.

## Pin editing

- Open an owned item photo with a pin and confirm **Move pin** appears.
- Confirm normal viewing does not move the pin.
- Enter pin edit mode, drag the pin to image edges, and confirm it remains clamped to the displayed image.
- Tap **Cancel** and confirm the original pin returns.
- Tap **Done**, reopen the viewer, and confirm the saved position remains.
- Confirm backdrop tap, paging, close, and Android Back cannot discard an active edit; Back should cancel edit first.
- Confirm evidence and admin screenshots never show pin-edit controls.
- On Item Detail, confirm the inline header pin is view-only and vertical scrolling over the image is uninterrupted.
- Expand the Item Detail image and confirm **Move pin** is visible only on the pin's source photo.
- Expand item thumbnails from both detailed and compact Room modes and confirm **Move pin** uses the same item and save path.
- Save from a thumbnail viewer, then open Item Detail and confirm the header marker and focal crop already show the committed position.

## Pin-aware Item Detail crop

- Test a portrait photo with pins near the top and bottom; confirm the header crop shifts toward the item without letterboxing.
- Test a landscape photo with pins near the left and right; confirm horizontal crop overflow shifts toward the item.
- Confirm the header marker stays aligned with the same focal crop transform.
- Confirm an image without a valid pin retains the original centred cover crop.
- Confirm the expanded viewer still shows the full image using `contain`.

## New badges

- Open one newly scanned item and return; only that item's badge should be cleared.
- Confirm sibling badges survive the detail round-trip.
- Leave the Room and return; all remaining badges should be cleared.
- Complete another scan; only the latest batch should be marked New.

## Room scroll restoration

- In a long Room, scroll near the bottom, open an item, and use Back; confirm the exact list position is retained.
- Repeat in compact grid mode and with search/filter/sort active.
- Edit an item before returning and confirm restoration remains stable.
- Delete or move the opened item and confirm restoration falls back safely without a crash.
- Open another Room and confirm offsets and view/filter state do not leak between rooms.
- Leave intentionally for the Property screen, re-enter the Room, and confirm the old offset is not forced.
