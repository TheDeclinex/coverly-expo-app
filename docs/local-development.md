# Local Development

## Basic Expo preview

Install dependencies:

```bash
npm install
```

Start Expo:

```bash
npx expo start
```

Use Expo Go on a phone to scan the QR code.

## Web preview

```bash
npx expo start --web
```

Web preview is useful for:
- Layout.
- Text.
- Basic navigation.
- Non-native UI logic.

It is less reliable for:
- Camera/photo picker.
- Native billing.
- Native storage.
- Device permissions.
- App-store-like behaviour.

## Development build

Use a development build when the app needs native modules not available in Expo Go.

Common trigger points:
- RevenueCat/native billing.
- Custom native modules.
- Certain storage/camera libraries.
- App-store-style testing.

Typical commands may include:

```bash
npx expo install expo-dev-client
npx expo run:android
```

For iOS local builds, a Mac/Xcode setup is usually required.

## GitHub/Replit workflow

Recommended flow:

```text
Local machine + Codex
  ↓ commit/push
GitHub
  ↓ pull/sync
Replit
```

Avoid making overlapping edits in both local and Replit at the same time.

## Suggested branches

```text
main
dev
feature/*
```

## Pre-change checklist

Before asking Codex to modify app code:
1. Pull latest branch.
2. Confirm `.env` is present locally.
3. Run app once.
4. Keep task small.
5. Ask for a diff before finalising large changes.

## Post-change checklist

After a change:
1. Run TypeScript/lint/test commands if available.
2. Run Expo preview.
3. Verify affected screens.
4. Check `git diff`.
5. Commit with a focused message.
