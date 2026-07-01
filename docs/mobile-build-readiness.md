# Coverly Mobile Build Readiness

Last updated: 2026-06-30

This checklist is for preparing Coverly Expo builds for Android internal testing and iOS TestFlight. It assumes app functionality, Supabase schema, Edge Functions, billing, claim-pack logic, and final branding are handled separately.

## Current app identity

- App name: `Coverly`
- Expo slug: `coverly`
- URL scheme: `coverly`
- Orientation: portrait
- iOS bundle ID: `nz.coverly.app`
- Android package: `nz.coverly.app`
- EAS project ID: `e5e80314-7ccd-4981-97c4-5be844c2967a`
- Current placeholder icon path: `assets/images/icon.png`
- Current placeholder splash path: `assets/images/icon.png`

## Pre-build checks

- Work from `C:\Users\User\Documents\GitHub\coverly-expo-app\artifacts\mobile`.
- Confirm `.env.local` or EAS environment variables are set for the intended backend.
- Confirm `EXPO_PUBLIC_APP_ENV=production` for preview and production EAS profiles.
- Confirm Supabase URL and anon key point at the intended project.
- Confirm no service-role keys or server secrets are present in mobile env files.
- Confirm RevenueCat keys are present before testing paid entitlement behaviour.
- Confirm privacy and terms URLs are set before wider TestFlight or store review.
- Support is currently handled in-app through Account -> Feedback & support; there is no separate support URL env var in the mobile app.
- Run TypeScript and Expo config checks before starting a cloud build.

## EAS environment variables

Both `preview` and `production` build profiles use the EAS `production` environment. Confirm these variable names exist in EAS before standalone Android/iOS builds:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_APP_ENV`
- `EXPO_PUBLIC_PRIVACY_URL`
- `EXPO_PUBLIC_TERMS_URL`
- `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`
- `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`
- `EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID`
- `EXPO_PUBLIC_REVENUECAT_OFFERING_ID`
- `EXPO_PUBLIC_BILLING_GATES_ENABLED`

Do not commit real values to the repo. Keep local values in `.env.local` and cloud build values in EAS.

Expo public variables are bundled into the app binary and are not private secrets. They are fine for Supabase anon keys, public legal links, RevenueCat public SDK keys, and feature flags; never put service-role keys or server-side API secrets in an `EXPO_PUBLIC_` variable.

Value-free verification examples:

```powershell
eas env:list --environment production
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value "<public Supabase URL>"
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<public Supabase anon key>"
```

When checking EAS output, verify names and environments only. Do not paste real values into tickets, docs, commits, or screenshots.

## Local validation commands

From `C:\Users\User\Documents\GitHub\coverly-expo-app\artifacts\mobile`:

```powershell
node_modules\.bin\tsc.CMD -p tsconfig.json --noEmit
node_modules\.bin\expo.CMD config --type public
```

From the repo root, the equivalent TypeScript command used by Codex validation is:

```powershell
node_modules\.bin\tsc.CMD -p artifacts/mobile/tsconfig.json --noEmit
```

## Android internal testing

Use the `preview` profile for tester APKs:

```powershell
eas build --platform android --profile preview
```

Expected behaviour:

- Produces an Android APK for internal installation.
- Uses `EXPO_PUBLIC_APP_ENV=production`.
- Does not submit to Google Play.
- Keeps production auto-increment settings untouched.

Before sharing with testers:

- Install the APK on a physical Android device.
- Sign in with a real tester account.
- Create a property, room, and item.
- Take or select a photo.
- Run an AI scan if the production Edge Functions are ready.
- Verify replacement pricing if the production function and quota path are ready.
- Verify account, feedback, privacy, and terms links.

## Production Android build

Use the `production` profile for Play Console builds:

```powershell
eas build --platform android --profile production
```

This should be used when the build is intended for Play Console upload. The submit profile targets the internal track, but do not submit until explicitly ready:

```powershell
eas submit --platform android --profile production
```

## iOS TestFlight build

Use the `production` profile for App Store Connect/TestFlight builds:

```powershell
eas build --platform ios --profile production
```

Before building for TestFlight:

- Confirm the Apple Developer team and App Store Connect app exist for `nz.coverly.app`.
- Confirm signing credentials are available or let EAS manage them.
- Confirm camera, photo, and microphone permission copy is final enough for review.
- Confirm privacy and terms URLs are live.
- Confirm RevenueCat iOS products and entitlement are configured if billing gates are enabled.

Submit only when explicitly ready:

```powershell
eas submit --platform ios --profile production
```

## Final branding assets still needed

Do not treat the current icon as final branding. Replace or add the final files only when the approved asset set is ready:

- `assets/images/icon.png`: 1024x1024 square PNG, no transparency, no rounded corners baked in.
- `assets/images/adaptive-icon.png`: 1024x1024 transparent Android foreground PNG, centred and padded.
- `assets/images/splash-logo.png`: agreed splash logo asset on transparent or approved background.
- Optional favicon and wordmark assets for web/admin surfaces.

After those files arrive, update `app.json`:

- Keep `expo.icon` pointed at `./assets/images/icon.png`.
- Add `expo.android.adaptiveIcon.foregroundImage` pointing at `./assets/images/adaptive-icon.png`.
- Set `expo.android.adaptiveIcon.backgroundColor` to the approved brand background.
- Point `expo.splash.image` at the agreed splash asset.
- Re-run Expo config inspection and a local device smoke test.

## Supabase and Edge Function assumptions

- Mobile uses public `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- RLS remains the protection boundary for user inventory records.
- Storage paths and policies must continue to match `inventory-photos` expectations.
- Expected Edge Functions include `voice-describe`, `barcode-verify`, and `replacement-price-search`.
- Claim-pack generation/export should be tested only when its production function and storage assumptions are ready.
- Do not add service-role keys to the mobile app.

## Public release reminders

- Replace placeholder branding before public release.
- Add Android adaptive icon config once the transparent foreground exists.
- Confirm app screenshots and store listing copy are consistent with the current product.
- Confirm privacy policy covers account data, photos, AI processing, billing, analytics if added, and claim evidence.
- Confirm support/contact path is visible in the app.
- Confirm billing gates are intentionally on or off for the release being tested.
- Confirm dev/test accounts and sample records are not shipped as production defaults.
