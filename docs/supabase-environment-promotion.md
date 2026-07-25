# Supabase environment promotion

Coverly uses two hosted Supabase projects:

| Environment | Project ref |
| --- | --- |
| QA / development / preview | `vcddtypptyktdcfnkkia` |
| Production | `jqijavrugjidqzbbgpag` |

Production is never a development target. Confirm the project name and ref
before every remote write.

## Reconstruct a clean project

The executable migration history is in `supabase/migrations`. It starts with
an architecture-only baseline reconstructed from Production and contains no
Production user, inventory, Auth-user, or Storage-object data.

```powershell
supabase link --project-ref vcddtypptyktdcfnkkia
Get-Content supabase/.temp/project-ref
supabase db push --linked --dry-run
supabase db push --linked
supabase functions deploy --project-ref vcddtypptyktdcfnkkia
```

The two SQL files in `supabase/legacy` are historical manual snippets. They are
not executable migrations; their policy intent is represented by the baseline.

## Function authentication

`supabase/config.toml` is the source of truth for each Function's `verify_jwt`
setting. User-facing Functions also validate the caller in their handler where
implemented. Webhooks intentionally have platform JWT verification disabled
and must validate their provider-specific secrets.

## Required server configuration

Configure values through `supabase secrets set` or the Dashboard. Never commit
values.

- `OPENAI_API_KEY`
- `SERPER_API_KEY`
- `REVENUECAT_WEBHOOK_AUTHORIZATION`
- `REVENUECAT_SECRET_API_KEY`
- `REVENUECAT_PLUS_ENTITLEMENT_IDS`
- `REVENUECAT_FAMILY_ENTITLEMENT_IDS`
- `REVENUECAT_PLUS_PRODUCT_IDS`
- `REVENUECAT_FAMILY_PRODUCT_IDS`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- One claim-pack email provider: `RESEND_API_KEY` or `POSTMARK_SERVER_TOKEN`
- Optional: `COVERLY_EMAIL_FROM`, `UPCITEMDB_KEY`, and model override variables

Supabase automatically supplies its URL, anon key, service-role key, and
database connection variables to hosted Edge Functions.

Auth SMTP credentials are configured in Supabase Auth, not Edge Function
secrets. The branded confirmation and reset templates are in
`docs/auth-email-templates`.

## Application environments

- Development and preview use `vcddtypptyktdcfnkkia`.
- Production uses `jqijavrugjidqzbbgpag`.
- Preview uses `EXPO_PUBLIC_REVENUECAT_ENV=sandbox`.
- Production uses `EXPO_PUBLIC_REVENUECAT_ENV=production`.
- RevenueCat public SDK keys may use the same RevenueCat app/project where
  Apple/Google sandbox transactions are selected by the store account/build.

Run `pnpm run verify:env` from `artifacts/mobile` with the intended EAS
environment loaded before a build. A preview or production build must fail if
the Supabase URL does not match `EXPO_PUBLIC_EXPECTED_SUPABASE_PROJECT_REF`.

## Done looks like

- A clean project accepts the complete migration chain in order.
- The four private buckets and Storage policies exist without copied files.
- All source-controlled Functions are active with the configured JWT mode.
- Development/preview resolve to QA and Production remains unchanged.
- Cross-user database and Storage isolation tests pass.

## Do not change

- Do not run linked writes until `supabase/.temp/project-ref` has been checked.
- Do not copy Production user data or Storage objects into QA.
- Do not expose service-role keys to Expo.
- Do not place Stripe Checkout in native purchase flows.
