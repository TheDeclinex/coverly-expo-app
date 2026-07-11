# AI scan model manual QA

After deploying `scan-room-photo`, validate:

- Single Photo scan returns detected items.
- Multi Photo scan returns items and does not over-group obviously separate objects.
- Video scan returns items detected from extracted frames.
- Single Item scan returns one primary item.
- Usage credits deduct exactly as before for every scan mode.
- A failed scan still shows the existing failure handling and refunds/reserves usage as before.

The Edge Function logs the selected scan model at OpenAI request start. It must report
`gpt-5.6-luna` unless `OPENAI_SCAN_MODEL` has been deliberately set to another exact model ID.
