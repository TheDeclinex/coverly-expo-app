# Billing and access

Batch 4 adds remaining provider controls and authoritative claim export enforcement.
See [provider and claim controls](provider-and-claim-controls.md) for the complete
source-only Batches 1–4 rollout and current provider inventory.

## Ownership foundation (code only)

Coverly is moving to a free download with a one-time unlock represented by the
RevenueCat entitlement `coverly_owned`. Ownership is durable; it is not a
subscription period and does not expire merely because verification is old.
Verified refunds/revocations remove owner capabilities. Tester/admin grants
are separate access overrides, never proof of a store purchase.

The forward migration `20260927190405_durable_ownership_access_foundation.sql`
adds this foundation without rewriting historical migrations or backfilling
ownership from subscription/plan strings. No remote migration is applied by
this batch. Existing purchases and RevenueCat mappings remain unchanged.

### Server-controlled projection

`public.user_ownership` has one row per Auth user:

- `ownership_status`: `none`, `owned`, or `revoked`; an absent row means `none`.
- `revenuecat_entitlement_id`, `revenuecat_product_id`, `revenuecat_customer_id`.
- `ownership_source` (`revenuecat`) and `ownership_environment` (`production` or `sandbox`).
- `acquired_at`, `last_verified_at`, `revoked_at`, `last_event_id`, `updated_at`.

RLS is enabled, with no client policies or client table grants. Only the service
role receives select/insert/update privileges. Normal profile mutation RPCs
cannot write this separate table. No public ownership setter is introduced.
Projection/customer/event metadata is not returned to ordinary clients.

An `owned` row grants access only with entitlement `coverly_owned`, RevenueCat
source, environment, nonblank product/customer attribution, acquisition and
verification timestamps in chronological order, verification not in the future,
and no revocation timestamp. Incomplete rows resolve as `unverified`, without
paid fallback. A `revoked` row requires a revocation timestamp.

Batch 2 adds the verification writer described below, in source only. The resolver
trusts a complete server-written projection; it does not call RevenueCat itself.
Sandbox attribution is retained for a separate QA environment. The writer rejects
sandbox data when configured for production. Do not seed production ownership
from legacy plans or expose projection writes to the app.

### Canonical access contract

`private.resolve_coverly_access(user_id)` is the single decision implementation.
It is a fixed-search-path security-definer function, inaccessible to ordinary
clients. Trusted backend code can call it as service role. Clients call the
no-argument `public.get_my_access_capabilities()` RPC, which uses `auth.uid()`
and rejects unauthenticated requests.

Precedence is: explicit admin/tester override, active support override, verified
ownership, eligible legacy subscription, then Free. Existing support grants
(including an explicit Free override) remain deliberate operational overrides.
`owns_coverly` reports the actual verified purchase independently of the override.
Revoked or incomplete owned projections never fall back to stale subscription
fields; an explicit admin/tester/support override remains separate.

The version-1 JSON response is mirrored by `AccessCapabilities` in the mobile
model and contains:

| Field                                                        | Meaning                                                                                       |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `contract_version`                                           | `1`                                                                                           |
| `access_class`                                               | `free`, `owner`, `legacy_plus`, `legacy_family`, `tester`, `admin`, `override`                |
| `effective_plan`                                             | Transitional string: `free`, `coverly_owned`, `coverly_plus`, `coverly_family`, `admin`       |
| `owns_coverly`, `ownership_status`, `ownership_verification` | Verified purchase boolean; stored status; `not_owned` / `verified` / `unverified` / `revoked` |
| `legacy_plan`                                                | Recognized underlying legacy plan, if present; not itself an access grant                     |
| `override_type`                                              | `none`, `tester`, `admin`, `support`                                                          |
| `property_limit`, `property_count`, `can_create_property`    | Authoritative numeric limit (`null` means unlimited), current count and eligibility           |
| `can_export_claim_pack`                                      | Deterministic PDF capability, independent of AI usage                                         |
| `can_manage_inventory`, `can_access_evidence`                | Always true as product capabilities; existing ownership/RLS checks still apply                |
| `ai_policy_class`, `ai_requires_metering`                    | Independent AI policy, described below                                                        |
| `legacy_compatibility`                                       | Whether the legacy subscription fallback supplies access                                      |

### Property, claim and AI policies

| Access               | Property limit                  | Claim PDF capability | AI policy                            |
| -------------------- | ------------------------------- | -------------------- | ------------------------------------ |
| Free / revoked owner | 1                               | No                   | `free`, metered                      |
| Verified owner       | 5                               | Yes                  | `owned`, metered                     |
| Legacy Plus          | 1                               | Yes                  | `legacy_plus`                        |
| Legacy Family        | Unlimited during transition     | Yes                  | `legacy_family`                      |
| Tester / admin       | Unlimited                       | Yes                  | Explicit `tester` / `admin` override |
| Support override     | Existing Free/Plus/Family grant | According to grant   | Explicit `override`                  |

Every existing property row counts. Over-limit properties are never removed,
hidden or made read-only by this migration. Only additional creation is denied.
The existing six-argument and country-aware seven-argument `create_my_property`
RPCs and direct-insert trigger keep their shared per-user advisory lock and
delegate to the adapted allowance function. Country validation, server-derived
currency, inventory RLS and update paths are unchanged. The resolver and count
adapters remain VOLATILE so counts refresh after locking and during multi-row
inserts. The mobile allowance parser reads actual server limits and denials;
malformed or contradictory responses fail closed for creation only.

Ownership never means unlimited AI. Batch 3 now consumes the canonical policy
class in the trusted usage ledger, counts owner usage and enforces configurable
owner allowances. Transitional Plus/Family and explicit overrides retain their
documented bypass but are also counted. Provisional owner safety defaults are
not commercial commitments. See [fair-use accounting](fair-use-accounting.md)
for the settings, execution protocol, provider coverage and rollout requirements.

Claim export is a capability only in this batch. Enforcement in
`generate-claim-pack` and claim purchase UI is deferred. Existing claim-token
tables remain untouched; Free-user one-off claim-pack purchasing is deferred.
Exhausting AI does not alter inventory, evidence or the owner's PDF capability.

### Transitional adapters and compatibility

- `get_my_effective_plan`, `coverly_effective_plan_from_profile` and
  `admin_effective_plan_from_profile` delegate to the canonical decision.
  `admin_tester_status_from_profile` uses its explicit tester override result.
  Profile helpers resolve the stored user by ID rather than trust supplied
  JSON roles/plans. `load_my_profile` and existing admin RPC shapes stay intact.
- `coverly_property_allowance_for_user` retains its six output columns;
  `get_my_property_allowance` remains unchanged. Label adapters retain
  `plus`, `family`, `full_access`, `free` and add `owner`.
- Legacy `required_plan` / limit-error hints still say `coverly_family` for
  released-app compatibility. Paywall and property-limit marketing copy remain
  unchanged. Their owner-specific presentation belongs to the later UI batch.
- Explicit inactive/expired provider state beats stale legacy plan strings;
  RevenueCat state takes priority when present. Stripe's existing seven-day
  `past_due` grace is retained. Status-less legacy plan grants remain transitional.
- Existing subscription fields, RevenueCat mappings and purchase flows remain.
  No one-time products/offering are configured, and existing subscribers are
  not converted to owners. Do not enable owner sales before reconciliation,
  usage policy and mobile ownership state are ready.

### Local tests and deployment boundary

The SQL suite runs the actual new migration plus relevant historical table,
property, profile and usage definitions against a fresh in-memory PGlite database
with minimal Auth fixtures and representative inventory RLS. It has no remote
connection path. From the repository root, using the optional isolated PGlite
installation documented in `admin-signup-notifications.md`:

```powershell
$env:COVERLY_PGLITE_MODULE = Join-Path $env:TEMP 'coverly-pg-validation-20260927/node_modules/@electric-sql/pglite/dist/index.js'
node --experimental-strip-types --test supabase/tests/ownership-access.local.test.ts
```

Run mobile tests from `artifacts/mobile` and run its TypeScript check. The SQL
suite covers access classes, forged/client writes, adapters, metering, country
validation, direct/multi-row inserts and retained over-limit inventory. PGlite
serializes submitted queries on one backend: simultaneous-request tests plus
inspection of retained lock ordering are not a multi-connection PostgreSQL race
test. That and full-chain Supabase/RLS integration testing remain QA prerequisites.

Local CLI metadata currently points to PROD. Verify the intended target before
any future Supabase operation; no deployment is authorized by this batch. Start
with a separately approved QA rollout and validate released clients. Git rollback
does not undo a deployed schema. After deployment, prefer a forward corrective
migration; preserve ownership/revocation records rather than dropping them.

Done looks like now: tested durable storage and a canonical access contract,
compatible property enforcement and server-limit parsing, with no remote changes.
Do not change paywall, onboarding, sign-in, store products or pricing in this batch.
Later batches handle deployment validation, remaining provider metering,
mobile ownership state, claim enforcement, one-time paywall and store setup.

## Existing purchase integration (transitional reference)

Coverly has separate billing paths:

```text
Web app
  Stripe Checkout

Native mobile app
  RevenueCat + App Store / Google Play
```

Do not use web Stripe Checkout as the main native app billing path unless explicitly requested.

## Plans

Likely plans:

```text
Free
Plus
Family
```

Property allowance is plan-specific:

- Free: one property.
- Plus: one property.
- Family: multiple properties.
- Explicit tester/admin full access: multiple properties.

Property creation must use the server-backed property allowance and
`create_my_property`; a broad paid/unpaid boolean is not sufficient because
Plus and Family have different property capabilities.

## Free plan direction

Free users should be able to experience the product, not hit a wall immediately.

Current free direction:

- One property.
- Manual entry.
- Rooms.
- Photo uploads.
- Limited AI scan credits per month.
- Limited replacement price lookups per month.
- Claim pack available as a one-off purchase.

## Paid plan direction

Paid users should get:

- More / unlimited properties depending on plan.
- AI scans included under fair-use language.
- Replacement pricing included under fair-use language.
- Claim pack access included or heavily incentivised.
- Family/multi-property support where applicable.

Avoid user-facing token/count language for paid plans where possible.

Use wording like:

- “AI features included”
- “Fair use applies”
- “Includes claim-ready exports”

## Claim-pack monetisation decision

Claim packs should likely be:

- Included for subscribers.
- Available as a one-off purchase for free users.

Risk to consider:

- User subscribes, scans house, cancels, later resubscribes briefly only to export claim pack.

Potential mitigations:

- Claim pack included after minimum active subscription period.
- Claim pack included while subscription active, but export history/watermark rules apply.
- One-off export price remains available.
- Keep first version simple and validate behaviour before overengineering.

## RevenueCat

Native app billing should use RevenueCat.

Known direction:

- RevenueCat manages app-store subscriptions.
- Entitlements should sync to Supabase.
- App should use entitlement state for gating.
- Billing state should survive app reloads and auth changes.

Backend webhook requirements:

- `revenuecat-webhook` validates webhook authorization/signature before processing events.
- Set Supabase Edge Function secret `REVENUECAT_SECRET_API_KEY` to a RevenueCat server-side Secret API key. This key is used only by the Edge Function to call `GET /v1/subscribers/{app_user_id}` and sync canonical Customer Info after lifecycle webhook events.
- Do not expose `REVENUECAT_SECRET_API_KEY` in Expo `EXPO_PUBLIC_` variables or client code.
- Canonical entitlement mapping is configured by entitlement IDs: `Coverly Plus` -> Plus and `Coverly Family` -> Family. Configure these through `REVENUECAT_PLUS_ENTITLEMENT_IDS` / `REVENUECAT_FAMILY_ENTITLEMENT_IDS` for the webhook and `EXPO_PUBLIC_REVENUECAT_PLUS_ENTITLEMENT_ID` / `EXPO_PUBLIC_REVENUECAT_FAMILY_ENTITLEMENT_ID` for mobile.

## Supabase entitlement sync

Supabase should store enough subscription state for:

- UI gating.
- Admin reporting.
- Web/native consistency.
- Future support workflows.

Avoid using only client-side state for paid access.

## Store/platform fees

Financial model should account for:

- App Store / Google Play fees.
- GST where applicable.
- RevenueCat costs.
- Refunds/churn.

## Done looks like

- Free users see clear upgrade paths.
- Paid users receive correct access.
- Native purchase flow uses RevenueCat.
- Web purchase flow uses Stripe.
- Supabase reflects entitlement state.
- Gating is enforced before paid features run expensive backend/AI calls.

## Batch 2: canonical RevenueCat reconciliation (source only)

`20260927232224_revenuecat_ownership_reconciliation.sql` is an additive forward
migration after the ownership foundation. No historical migrations are changed.
It adds event leases/attempt counts, projection expiry and attribution, private
per-user sync leases, and an append-only verification history. Service-only RPCs
claim, reconcile and finalize work. Client grants remain absent. The existing
access resolver also checks a known finite expiry; null expiry remains durable.
The migration and both functions are deliberately **not deployed**.

### Audit and shared model

The starting implementation matched the audit: canonical API errors could fall
back to webhook assertions for positive events, transfers targeted only the first
destination, a missing profile was terminally ignored, processing had no lease,
and an environment flag could disable webhook authentication. Those processing
paths are replaced; the existing parser, authorization/signature utility and
canonical Plus/Family selection logic are retained. Old processing tests have
been replaced by handler and real SQL tests for the new failure semantics.
The mobile layer still configures/logs in RevenueCat with the Supabase user UUID.

RevenueCat is the store-purchase source of truth. Both functions use
`_shared/revenuecat-reconciliation.ts` and the server-only v1 subscriber lookup.
Webhooks only trigger that lookup; their entitlement and product assertions never
write access. The canonical model carries the requested UUID, original customer
identity, owned/product/acquisition/expiry state, environment, project/app
attribution where available, request timestamp, reason, and validated legacy
state. It accepts `coverly_owned` with explicit null expiry, independently of
renewals, activeSubscriptions or package type. Unknown entitlements cannot grant
ownership. Recognized but malformed/unmapped purchases fail closed.

Entitlement purchase timestamps are matched to canonical subscription or
non-subscription transactions. The matching transaction must explicitly have the
configured `is_sandbox` value. Ambiguous receipts fail rather than borrowing an
old production receipt. Refund timestamps and expired ownership revoke access;
canonical absence revokes a previous owner but leaves a never-owner at `none`.
Acquisition/product attribution is retained on removal. Private verification
history preserves previous snapshots. Nothing removes inventory or evidence.

### Authenticated recovery and identity

`POST /functions/v1/reconcile-revenuecat-purchases` accepts an empty body or `{}`
and a Supabase bearer access token. The function validates the token with
`auth.getUser`, derives the UUID server-side, and looks up that exact UUID.
Any body fields (including user ID, CustomerInfo and owns_coverly) are rejected.
Success returns `{ok: true, access: <version-1 access capabilities>}`. Native
purchase/Restore Purchases, reinstall recovery and support refresh will call it
in a later mobile batch. No mobile integration or purchase UX changes are made.

V1 does not enumerate aliases. An exact requested UUID response may have an
anonymous RevenueCat original identity; that association is trusted only from
the authenticated server lookup, never from webhook aliases or subscriber
attributes. A different UUID/custom original identity is rejected conservatively.
Historical cross-UUID aliases require support investigation and future verified
alias handling; this batch does not merge identities. Store restore/transfer
behavior and anonymous-to-UUID linking must be exercised in isolated QA before
owner sales. The API key must belong to Coverly's RevenueCat project.

### Transfers, ordering and recovery

An authenticated, app/environment-validated TRANSFER reconciles the union of all
valid source and destination UUIDs (maximum 20). Anonymous/malformed identifiers
are never used as database targets. Every UUID must have a profile and pass its
own canonical lookup; the event arrays are triggers, not purchase proof. All
participants are leased before lookups, and all projections/history plus the
processed event status commit atomically. A failed lookup or missing profile
leaves both sides unchanged and retryable, preventing a partially applied transfer.

Event claims last 120 seconds. Failed events can be retried immediately; expired
processing claims can be reclaimed with a new token, including old rows without
lease metadata. Terminal duplicates do no work. Duplicates still processing
return 503 so a concurrent delivery cannot acknowledge away a crashed worker.
Per-user leases also last 120 seconds and are acquired in sorted UUID order.
Only the current event and user lease tokens can apply state. Late workers cannot
finalize/release newer work. Canonical request timestamps must strictly increase;
older/equal snapshots fail retryably. Webhook timestamps never determine access.

Lookups time out after five seconds per identity; canonical snapshots older than
120 seconds or more than 30 seconds in the future are rejected. API failures,
including 404, do not grant or revoke. Existing verified lifetime ownership has
no outage TTL. Known finite expiry still applies. Error responses are 503 with
`retryable: true` and `Retry-After: 120`; missing/invalid auth is 401, malformed or
misattributed requests are 400, absent required settings are 500. Missing profiles
fail with `profile_not_found` and can recover after profile creation. No background
retry scheduler is added: recovery uses RevenueCat redelivery or authenticated
reconciliation. Operations must monitor failed/stale ledger rows and replay after
fixing configuration; transient failures are never marked processed.

### Required future configuration and environment isolation

Set these server-only values independently in the future QA and production
projects. Empty placeholders in `.env.example` are intentional, not live values:

| Setting | Requirement |
| --- | --- |
| `REVENUECAT_SECRET_API_KEY` | Secret v1 API credential scoped to the intended Coverly RevenueCat project; never expose to Expo. |
| `REVENUECAT_PROJECT_ID` | Expected project, recorded and compared whenever the payload returns a project ID. |
| `REVENUECAT_ALLOWED_APP_IDS` | Comma-separated allowlist of actual Coverly RevenueCat app IDs. Webhook app ID is required. |
| `REVENUECAT_EXPECTED_ENVIRONMENT` | Exactly `production` or `sandbox`; use sandbox only in an isolated QA Supabase project. |
| `REVENUECAT_OWNED_PRODUCT_IDS` | Allowlisted future one-time products attached to `coverly_owned`; no products configured by this batch. |
| `REVENUECAT_PLUS_ENTITLEMENT_IDS`, `REVENUECAT_FAMILY_ENTITLEMENT_IDS` | Preserve actual transitional mappings; cannot overlap each other or `coverly_owned`. |
| `REVENUECAT_PLUS_PRODUCT_IDS`, `REVENUECAT_FAMILY_PRODUCT_IDS` | Required allowlists for the existing subscriptions, including platform variants. |
| `REVENUECAT_WEBHOOK_AUTHORIZATION` | Strong shared secret used as `Authorization: Bearer <secret>`. Required unless using the existing signing mechanism. |
| `REVENUECAT_WEBHOOK_SIGNING_SECRET` | Optional existing HMAC integration. If set, a valid timestamped signature is also required; do not assume RevenueCat emits it without that integration. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Matching backend environment only. |

There is no insecure webhook escape hatch. Every required mapping must be
configured before either function runs. Canonical app/project fields are checked
where returned; v1 generally omits them, so key scope and product allowlists are
mandatory operational prerequisites, not proof supplied by a webhook.
A wrong webhook app/project/environment is rejected before claiming an event.
Canonical transaction environment is checked again, including on reconciliation.
A projection cannot switch environments. Do not mix sandbox and production users
in the same backend; the foundation resolver intentionally supports either for QA.

Reference contracts: [RevenueCat v1 Customer Info](https://www.revenuecat.com/docs/api-v1/customer-info-model)
and [webhook examples](https://www.revenuecat.com/docs/integrations/webhooks/sample-events).

### Transitional compatibility and boundaries

Canonical Plus/Family state still updates the released clients' native profile
fields and shared subscription fields. Cancellation/billing-issue status is taken
from canonical subscription data; access stays active until expiry/grace ends.
A Stripe-only profile is not newly marked native-expired just because reconciliation
finds no native entitlement. Existing native profiles still receive removal.
Stripe and native subscription projections remain coupled through shared profile
fields and can overwrite one another's legacy display/plan fields; full provider
separation is deferred. Neither can erase the separate durable ownership row.
An owner remains owner after Stripe changes, subject to explicit overrides and
verified RevenueCat revocation. Legacy subscriptions are never backfilled as owners.

Do not change: mobile purchase/paywall/restore/account UI, store pricing/products,
AI quota values or accounting, authentication/onboarding, inventory/evidence RLS,
app version, deployments, builds or release settings. Done looks like: canonical
webhook and authenticated refresh agree on ownership, duplicate/failed/stale work
is recoverable, both transfer sides change atomically, and all local checks pass.

### Local verification and later QA

No tests call real RevenueCat or remote Supabase. Handler tests inject mock fetch;
the database suite uses in-memory PGlite with actual relevant migrations and
service/auth roles, including handler-to-SQL integration. Run from repository root:

```powershell
node --experimental-strip-types --test supabase/functions/revenuecat-webhook/model.test.ts supabase/functions/_shared/revenuecat-reconciliation.test.ts
$env:COVERLY_PGLITE_MODULE = '<absolute local PGlite dist/index.js>'
node --experimental-strip-types --test supabase/tests/ownership-access.local.test.ts
node node_modules/typescript/bin/tsc -p artifacts/mobile/tsconfig.json --noEmit --incremental false
npx deno check --no-lock supabase/functions/revenuecat-webhook/index.ts supabase/functions/reconcile-revenuecat-purchases/index.ts
```

Run the full existing mobile `lib/__tests__/*.test.ts` suite from `artifacts/mobile`
with Node's strip-types runner. No app runtime dependency was added. PGlite/Deno
are isolated developer validation tools. PGlite serializes queries on one backend:
lease token/expiry/rollback interleavings are tested, but true multi-connection
contention and real store receipts still require isolated PostgreSQL/store QA.
Before any separate deployment, validate native product/entitlement mappings,
project credential scope, missing-profile retry, sandbox rejection, transfer and
refund receipts on both stores. Preview existing Account/Upgrade/Restore flows in
a development build for regression only; Expo Go cannot execute native purchases.
No new reconciliation button exists yet. Review migration before deploying to QA,
then test webhook retry behavior before any separately approved production rollout.
The local CLI remains linked to **PROD `jqijavrugjidqzbbgpag`**: this batch authorizes
no remote mutation, linking, secret configuration, Edge deployment or store action.
