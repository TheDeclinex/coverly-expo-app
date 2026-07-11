# Scan completion manual QA

For Single Photo, Multi Photo, Video room, and Single Item scans:

1. Complete a successful scan with available credits.
2. Confirm the visible sequence is processing, saving items, then Room.
3. Confirm the review/results screen never flashes during successful auto-save.
4. Confirm the Room route appears only once in the navigation stack.
5. Confirm Back/Cancel remains available during processing and saving.
6. Confirm there is no stuck spinner.

Recovery checks:

- Force a complete save failure and confirm the review/recovery screen appears.
- Force a partial save failure and confirm only unsaved items appear for recovery.
- Retry a failed save and confirm successful completion returns directly to Room.
