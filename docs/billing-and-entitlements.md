# Billing and access

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

**This batch does not implement a verification writer.** The future reconciler
must verify the RevenueCat customer belongs to the Auth user, the product and
entitlement match, and the event environment belongs to the intended project.
The resolver trusts a complete server-written projection; it does not call
RevenueCat or independently prove those attributions. Sandbox attribution is
retained for QA, not permission to accept sandbox purchases in production.
The future writer must also enforce event ordering/idempotency and populate the
verification/update/event fields atomically. Do not seed production ownership
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

Ownership never means unlimited AI. `ai_requires_metering` is true for ordinary
Free, owner and legacy access; override policies are explicit. The existing
ledger still bypasses legacy Plus/Family as before; that transitional behavior
is **not** a new owner grant. Owner string adapters return `coverly_owned`, which
does not enter that legacy bypass. Until the secure ledger batch consumes the
new policy class, owners conservatively use existing configurable Free counters.
No owner quota or new production quota is chosen here. This foundation must not
be presented as the completed owner AI allowance implementation.

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
Later batches handle RevenueCat reconciliation, secure AI usage accounting,
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
