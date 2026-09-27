# Admin signup push notifications

This internal feature sends registered Coverly admins a push when a row is
inserted into `auth.users`. It does not change signup and never makes an HTTP
request inside the auth transaction.

## Architecture

`auth.users INSERT` → lightweight PostgreSQL trigger →
`public.admin_notifications INSERT` → Supabase Database Webhook →
`send-admin-notification` Edge Function → Expo Push API → registered admin phones.

Signup alerts go to every registered device whose owner is currently an admin,
not exclusively to Jay. Test notifications go only to the calling admin's
registered devices. The event is Auth user creation, not email verification or
completed onboarding.

The tables are in `public` so the Dashboard webhook and Edge Function can use
them normally, but RLS is enabled, all `anon`/`authenticated` grants are
revoked, and no client policies exist. The service role is used only inside the
Edge Function.

## Required target checks before any Supabase command

Treat the linked project as local tooling state, never as authorization to deploy.
The preservation audit found it pointing to **Coverly PROD**. This task neither
relinks nor deploys anything. CLI metadata is ignored by Git and can differ on
each developer's machine.

Before **each** Supabase command, explicitly establish:

1. Which project is currently linked (name and reference).
2. Whether the intended target is QA/staging or production.
3. Whether the command only inspects state or mutates a remote environment.

The following PowerShell checks only read local files and refuse a non-QA link:

```powershell
$expectedQaRef = 'vcddtypptyktdcfnkkia'
$linkedRef = (Get-Content -LiteralPath 'supabase/.temp/project-ref' -Raw).Trim()
$linkedProject = Get-Content -LiteralPath 'supabase/.temp/linked-project.json' -Raw | ConvertFrom-Json
$linkedProject | Select-Object name, ref
if ($linkedRef -ne $expectedQaRef -or $linkedProject.ref -ne $expectedQaRef) {
  throw 'STOP: this checkout is not linked to the intended Coverly QA project.'
}
```

Missing or conflicting metadata also means stop. Confirm the project identity
in the Dashboard; do not blindly trust stale cache files. If the target differs,
resolve that separately before continuing. Do not automatically relink or change
the expected reference to make this check pass.

See [environment promotion](./supabase-environment-promotion.md) for project
identities. Production is a separate release operation: it requires deliberate
confirmation of the production project name/ref, exact migration/function scope,
secrets/webhook changes and rollback plan after QA succeeds. Passing a QA check
does not authorize a later production command. This guide provides no copy/paste
production deployment sequence.

## Required secrets and Expo configuration

Create a high-entropy webhook secret locally (do not commit it):

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

Create an Expo access token in Expo account settings, then enable **Enhanced
Security for Push Notifications** for the intended Expo project. These are
external configuration changes and require a separately authorized setup step.
Configure `EXPO_ACCESS_TOKEN` and `ADMIN_NOTIFICATION_WEBHOOK_SECRET` only on the
explicitly verified target. Secret-setting commands mutate remote configuration;
never run them based solely on the current link, or store real values in this doc,
source control, command examples or mobile configuration.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied automatically by
Supabase Edge Functions. Never add either secret value to an `EXPO_PUBLIC_*`
variable or to the mobile app.

## QA-first deployment plan (separate from repository preservation)

1. Run the local tests below before considering any remote work.
2. Perform the target checks above and explicitly approve QA as the target.
3. Inspect that environment's migration history. The token constraint in the
   previously uncommitted migration was corrected locally. If the original was
   already applied remotely, do not rewrite its history or assume a push reruns
   it: prepare a separately reviewed forward migration for that environment.
4. Review CLI help, then the linked database push dry-run. A dry-run contacts
   the target to inspect pending work; it does not apply migrations. Review
   **every** pending migration, not just the notification migration.
5. Only after reviewing the exact target and pending work, separately authorize
   the database push, named function deployment, secrets and Dashboard webhook.
   Database pushes mutate schema; function deployment changes server code;
   secrets and webhook setup change remote configuration. Use explicit target
   references wherever supported, and recheck the link before linked commands.
6. Verify the feature in QA before planning any production promotion.

No deployment or external configuration is performed by repository preservation.
Git rollback restores source only; it cannot undo a future database deployment,
webhook or secret change. Plan any database rollback separately to avoid losing
queued notifications or registered devices.

## Supabase Dashboard webhook

In the explicitly approved QA project, after its migration and Edge Function
are deployed (Dashboard changes also mutate remote configuration):

1. Open **Database → Webhooks → Create a new hook**.
2. Name it `send-admin-new-user-notification`.
3. Choose schema `public`, table `admin_notifications`, event `INSERT` only.
4. Choose **Supabase Edge Functions** and `send-admin-notification`, method
   `POST`.
5. Add `Content-Type: application/json`.
6. Add custom header `x-coverly-webhook-secret` with the exact value stored as
   `ADMIN_NOTIFICATION_WEBHOOK_SECRET`.
7. Save the webhook. Do not expose the secret in client configuration.

The function has `verify_jwt = false` because the database webhook uses the
custom shared secret. The function still validates that secret, the exact
schema/table/event/type, and the notification's database delivery state.
Admin mobile actions are separately validated using the caller's Supabase JWT
and `user_profiles.app_role = 'admin'`.

## End-to-end QA test (requires separate external-service authorization)

1. Use a native development/preview binary containing `expo-notifications`,
   configured for QA, on a physical phone. Sign in as a QA admin, open **Account →
   Admin → Founder notifications**, and tap **Register this phone**. Permission
   is requested only after this admin-only button is tapped.
2. Tap **Send test notification** and confirm the phone receives it.
3. Create a disposable Coverly account through the unchanged signup screen.
4. In Supabase Dashboard, confirm the account exists in **Authentication →
   Users**.
5. In Table Editor or SQL Editor, confirm a `new_user` row exists in
   `public.admin_notifications` and moves from `pending` to `sent`.
6. Check **Edge Functions → send-admin-notification → Logs** for an accepted
   delivery log. Logs identify the notification, never its token or email.
7. Confirm the registered QA phone receives **New Coverly signup** with the new account's
   email in the body.

If delivery fails, inspect `status`, `attempts`, and `last_error`. A failed row
can be retried by securely invoking the original INSERT webhook payload again with the
shared-secret header; already sent/processing rows are ignored as replays.

## Build note

Adding the notifications config plugin changes native projects, so Jay needs a
new iOS build (and a new Android build if Android is later used). Expo Go is not
the supported test path for this feature; use a native development/QA preview
build on the physical phone. The existing app version remains `1.0.2`; no new
build or release is part of repository preservation. Run EAS from
`artifacts/mobile`, using its existing `eas.json` and environment safeguards.

## Safe local validation

The mobile `test:admin` script includes the notification contract tests. Run the
backend model tests with Node's `--experimental-strip-types --test` flags.

The standalone SQL regression test uses PGlite (PostgreSQL compiled to WASM),
with a fresh in-memory database and minimal Auth/profile fixtures. It never
uses a database URL, Supabase CLI, credentials, webhooks or push services.
PGlite is optional test tooling installed outside the repo, not an application
dependency or an Expo native module. From the repository root:

```powershell
$validationDir = Join-Path $env:TEMP 'coverly-pg-validation-20260927'
npm install --prefix $validationDir --ignore-scripts --no-audit --no-fund --no-package-lock --save-exact @electric-sql/pglite@0.5.8
if ($LASTEXITCODE -ne 0) { throw 'Local validator installation failed.' }
$env:COVERLY_PGLITE_MODULE = Join-Path $validationDir 'node_modules/@electric-sql/pglite/dist/index.js'
node --experimental-strip-types --test supabase/functions/send-admin-notification/migration.local.test.ts
```

The npm installation downloads test tooling; the test itself runs locally. It
checks real SQL token acceptance/rejection, signup queueing, client access denial
and signup survival when queue insertion fails. It does not validate the entire
Supabase migration chain, deployed Edge Function or physical push delivery.

## Known foundation limitations

- A worker interrupted after claiming a row can leave it in `processing`.
  There is no automatic reclaim/timeout or scheduled retry worker.
- Partial Expo success, or failure to save status after sending, can produce
  duplicate pushes when a failed row is retried. Delivery is not exactly once.
- `sent` and `delivered_at` record Expo acceptance, not confirmed phone delivery.
  Delivery receipts are not polled; stale device tokens are not automatically
  removed, and large recipient sets are not batched.
- This local validation does not establish whether an earlier version was ever
  deployed. Check the intended environment's history before future deployment.

Done looks like for this foundation: local tests pass, version `1.0.2` is
preserved and the feature is ready for separately authorized QA verification.
Do not change billing, inventory ownership, live project targeting or store
configuration as part of this preservation work.
