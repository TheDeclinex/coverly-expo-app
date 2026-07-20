# Coverly mobile auth links

## Scope and current root causes

The Expo app is in `artifacts/mobile`. Its authoritative config is `artifacts/mobile/app.json`; the root `app.json` is empty. The iOS bundle identifier and Android package are both `nz.coverly.app`.

Before this change, sign-up redirected to `https://www.coverly.nz/auth/verified`, but the native app had no associated domains, Android intent filters, or matching Expo Router route. The website's “Open Coverly” action therefore could not use a verified HTTPS handoff to the app.

Password reset called `resetPasswordForEmail(email)` without `redirectTo`. Supabase used the project's Site URL, which currently lands on the marketing site. The app had no recovery callback parser and no password-update screen.

No coverly.nz website source is present in this workspace. The browser confirmation page, browser reset form, hosting rules, and live response headers must be changed and tested in the website repository.

## Live redirect routes

- `https://www.coverly.nz/open`
- `https://www.coverly.nz/auth/verified`
- `https://www.coverly.nz/reset-password`

The live Coverly website currently serves the verification page on `www.coverly.nz`; mobile email requests and native association configuration therefore use that hostname only. Do not add the apex hostname until it resolves and serves the required paths and association files without redirects.

Expo Go cannot validate Universal Links, Associated Domains, Android App Links, or native intent filters. Use an EAS development/preview build or production-signed build on a real device.

## Website work required

Deploy the two files in `docs/auth-association-files` to `www.coverly.nz`:

- `/.well-known/apple-app-site-association` with no extension, no redirect, and `Content-Type: application/json`
- `/.well-known/assetlinks.json` with no redirect and `Content-Type: application/json`

The Apple Developer Team ID is `T55J3TTVC2`; the deployed AASA application identifier is `T55J3TTVC2.nz.coverly.app`.

The current Android EAS signing SHA-256 fingerprint is `B7:77:A1:AD:57:48:67:6F:C4:4B:4D:50:B1:B0:EC:30:B3:92:0B:98:6C:4B:42:69:69:D1:94:24:40:0C:E9:2B`. Google Play App Signing may use a different certificate fingerprint for Play-installed builds. If it differs, add it as an additional entry in `sha256_cert_fingerprints`; do not replace the EAS fingerprint while direct EAS-distributed builds still need App Links support.

The verification page at `/auth/verified` must render:

- Title: “Email verified”
- Body: “Your email address has been confirmed. Return to Coverly and sign in.”
- Primary button: “Open Coverly”, linked to `https://www.coverly.nz/auth/verified` (without copying auth query parameters or fragments into rendered text or logs)
- Secondary action: “Back to website”, clearly linked to the marketing website

Do not point “Open Coverly” at the web-app login. Do not automatically redirect this page to itself. When the page is the Supabase callback and contains auth credentials, its implementation must either securely complete/clean the callback before presenting the button or preserve the callback for the installed app; the website repository needs to choose one owner for token exchange to avoid consuming a one-time code twice.

The page at `/reset-password` must remain on that route when no app is installed and provide a functional Supabase recovery form. It must accept PKCE query codes and implicit-grant fragments as configured by the project, exchange them once, remove secrets from browser history with `history.replaceState`, require matching passwords of at least eight characters, call `supabase.auth.updateUser({ password })`, show recovery-specific invalid/expired states, and sign out the temporary recovery session after success. It must not redirect to the marketing homepage or repeatedly bounce to itself. Automatic attempts to open an installed app should happen at most once per user navigation.

Store download links were not present in this repository. Add them to the browser fallbacks only after the real App Store and Google Play listing URLs are known.

## Supabase Auth dashboard

In Supabase Dashboard, open Authentication → URL Configuration and add these exact Redirect URLs:

- `https://www.coverly.nz/auth/verified`
- `https://www.coverly.nz/reset-password`

No Expo development redirect is required by this implementation because development builds use the same allowlisted HTTPS callbacks. Do not add an Expo wildcard for this flow. Add localhost URLs only when implementing and testing the separate website fallback locally, using that website project's actual port rather than a guessed value.

Review Authentication → Email Templates without hard-coding tokens:

- Confirmation templates should continue using Supabase's confirmation URL/template variable. `signUp` supplies the verified HTTPS redirect target.
- Recovery templates should continue using Supabase's recovery URL/template variable. `resetPasswordForEmail` supplies the verified HTTPS redirect target.
- If a customized template constructs its own `SiteURL` link and ignores the confirmation URL, change it to the supported Supabase template variable so the per-request redirect is retained.

Do not change the project Site URL merely to repair password recovery. The explicit redirect paths are the relevant settings.

## Real-device validation

After deploying both association files and creating a freshly signed EAS build:

1. Confirm `curl -i https://www.coverly.nz/.well-known/apple-app-site-association` returns 200 directly, JSON content, and no redirect.
2. Confirm `curl -i https://www.coverly.nz/.well-known/assetlinks.json` returns 200 directly, JSON content, and no redirect.
3. Test fresh verification and recovery emails in iOS Gmail and Mail/Safari, and Android Gmail/Chrome.
4. Test cold-start and warm-app links. Confirm recovery always opens “Set a new password”, never the normal signed-in tabs.
5. Test with the app removed. Confirm verification fallback copy is useful and `/reset-password` retains a working browser form.
6. Test expired and already-used links, password mismatch, successful reset, normal logout, and a second tap on the same link.

Association files are commonly cached by iOS and Android. Reinstall a fresh build after the live files and signing values are correct.
