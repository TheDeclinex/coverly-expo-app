# Scan usage-denial manual QA

Use a Free account with no remaining AI scan credits and repeat this check for
Single Photo, Multi Photo, Video room, and Single Item:

1. Capture or select the required media and submit the scan.
2. Confirm the usage-limit prompt appears without a stuck spinner or blank screen.
3. Dismiss the prompt with **Not now**, Android Back, and the upgrade screen's back action.
4. Confirm Coverly returns to scan type selection for the same property and room.
5. Confirm Back works and another scan type can be selected.
6. Confirm denied scans do not deduct credits.

Also confirm:

- Cancel exits video frame preparation and AI processing to scan type selection.
- Cancel exits the multi-photo confirmation state.
- **Choose another scan type** exits recoverable scan errors.
- Successful scans still reach review/save for users with available credits.
