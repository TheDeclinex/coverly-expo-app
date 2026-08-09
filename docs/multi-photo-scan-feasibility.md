# Multi-photo scan feasibility (August 2026)

## Current limits

- Capture and validation are capped at 5 images by `MAX_MULTI_PHOTO_IMAGES`. The library picker, camera flow, copy, and service validator all use that constant.
- The Edge Function does not impose a separate image-count cap. It accepts the request array and builds one OpenAI Chat Completions request containing every image.
- OpenAI currently permits up to 1,500 image inputs and 512 MB total image payload per request, so 10 or 20 images are below the API's count limit. Image inputs are token-metered and billed. See [OpenAI images and vision](https://developers.openai.com/api/docs/guides/images-vision).
- The client uploads images to private Supabase Storage sequentially before invoking the function. The function request therefore normally contains small storage paths, not image bytes. The function creates signed URLs and sends those URLs to OpenAI.
- Production `inventory-photos` objects currently average about 1.12 MB; p95 is about 2.84 MB and the observed maximum is about 7.67 MB. Twenty typical images would therefore represent about 22 MB of upstream image data, although the mobile-to-function JSON remains small.
- Camera capture uses JPEG quality 0.8. Library selections are normalized to JPEG at 0.8. Android compatibility mode resizes the longest edge to 1,600 px and uses JPEG quality 0.72; otherwise library photos are not dimension-resized.
- Coverly's effective time limits are 45 seconds for the OpenAI call and 90 seconds for a non-video mobile invocation. Recent successful production scan invocations ranged from roughly 7.5 to 37 seconds, leaving limited headroom before the current 45-second backend timeout.
- The function allows 8,000 completion tokens. Its own comment sizes that budget for 5-6 photos; larger room sets increase truncation risk as item count grows.
- Hosted Supabase Edge Functions have 256 MB memory, 2 seconds CPU per request, a 150-second request-idle timeout, and 150/400-second free/paid wall-clock limits. Coverly's 45-second upstream timeout is reached first. See [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits).
- No inventory table or scan-result array schema caps the number of source photos. The constraints are capture memory, sequential image normalization/upload time, AI latency/output size, and result quality.

## Credits and economic behavior

A 5-photo multi scan costs 3 Coverly scan credits. The database unit-cost function charges 3 units for `multi_photo_scan` regardless of image count, so merely changing the hard-coded limit to 10 or 20 would still charge 3 credits while OpenAI image-token cost and upload/processing work increased with every image.

Naively processing 10 photos as two existing 5-photo scan operations would charge 6 credits; four operations for 20 photos would charge 12. A batched user experience therefore needs an explicit parent operation/reservation and product-approved pricing, not repeated calls that look like independent scans.

## Quality and reliability

One request with 10-20 overlapping room photos is technically within provider limits, but it raises four practical risks:

- more duplicate detections and harder cross-photo identity merging;
- greater model confusion about which photo owns each pin;
- increased latency, image-token cost, and 8,000-token output truncation risk;
- longer sequential preparation/upload on lower-end Android devices and a larger retry blast radius if the final request fails.

OpenAI also documents that spatial localisation is imperfect and that `detail: "high"` may resize images. Coverly currently uses `high`; `original` should be evaluated separately for pin quality and cost before increasing batch size.

## Recommendation

Keep the production limit at 5 until a batched parent operation exists. For the next iteration:

- user-facing capture maximum: **10 photos**;
- internal model batch size: **5 photos**;
- process the two batches sequentially with visible progress and retry per batch;
- merge/deduplicate results across batches before review, retaining the best source photo/pin per item;
- reserve and commit credits once for the parent scan, with a product decision on a suggested **5-6 credit** price for 10 photos;
- instrument per-batch upload time, model time, token usage, duplicates merged, device class, and failures before considering a 20-photo option.

Twenty photos should be treated as a later background/resumable workflow with queueing and cross-batch merge state, not as one synchronous mobile request.
