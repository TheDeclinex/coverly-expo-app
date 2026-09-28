# Provider and claim controls — Batch 4, source only

This is the current provider inventory, superseding the deferred-route snapshot
in Batch 3's fair-use document. Nothing in Batches 1–4 is deployed by this work.
The CLI remains linked to **PROD `jqijavrugjidqzbbgpag`**; local validation must
never use that project. No store configuration, pricing, paywall, Account,
authentication or onboarding change is included.

## Provider inventory

Rates below are new execution admissions per authenticated user: per minute, rolling hour, rolling
24 hours, concurrent operations. They are provisional operational safety settings,
not commercial promises. Voice endpoints share the same bucket. Limits apply to
all users, including owners/admins, independently of `open`/`dry_run`/`enforced`.

| Function / operation | External provider | Repository caller / classification | Customer policy / monthly feature | Rate | Workload | Duplicate protection | Telemetry / status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scan-room-photo` | OpenAI | Active `scan-service.ts`; metered AI | Free/owner `ai_scan`, explicit legacy/support bypass counted | Monthly reservation limits; no separate short-window throttle in Batch 3 | 1/5/20 images, 8 MiB each, 24 MiB total, 34 MiB JSON | Immutable key/hash, execution token; terminal replay denied | Usage ledger and provider attempts; protected in Batch 3 |
| `replacement-price-search` | Serper shopping + optional organic | Active `replacement-pricing.ts`; metered search | Free/owner `replacement_pricing`, one unit including fallback | Monthly reservation limits; no separate short-window throttle in Batch 3 | 64 KiB JSON, 1–10 requested results / up to 20 candidates | Immutable key/hash, execution token | Each Serper attempt retained even after refund; protected in Batch 3 |
| `replacement-refinement-v2` | OpenAI Responses | Active `replacement-refinement-ai.ts`; metered AI | `replacement_refinement/refine`, Free 5 / owner 10 monthly **provisional**, one unit | 6 / 30 / 60 / 2 | 64 KiB JSON; draft 120/80/100/500 characters; owned item | New mobile action key; legacy deterministic input key; no repeat provider call | Both usage and route attempt ledgers; protected in Batch 4 |
| `replacement-search-refine` | Former OpenAI Responses | Configured legacy endpoint; no current mobile caller found | Disabled provider execution; manual editing unaffected | No provider permitted | Authenticated POST returns `LEGACY_ROUTE_DISABLED` (410) | No provider work | Compatibility endpoint retained; no deletion/deployment assumption |
| `voice-describe` | OpenAI transcription + extraction | Active `voice-input.ts`, including refinement dictation; broadly available, throttle only | No monthly voice credits | Shared voice 6 / 60 / 120 / 2 | 29 MB JSON; 28,000,000 base64 characters; audio MIME/extension allowlist; 16,000-character context | Explicit optional key, otherwise input hash + minute bucket | Both attempts recorded, including failure/unknown; protected in Batch 4 |
| `voice-command` | OpenAI transcription + command parsing | Configured POC; no current mobile caller found; throttle only | No monthly voice credits | Same shared voice bucket | Same audio limits; up to 100 property/room names, 200 characters each; transcript passed onward capped at 4,000 | Same voice protocol | Both attempts recorded; raw transcript/intent console logs removed; retained and protected |
| `barcode-verify` | UPCitemdb trial or paid key; optional OpenAI label vision | Active `barcode-verify.ts` / `BarcodeScanFlow`; throttle only | No monthly barcode credits; optional item must be owned | 10 / 100 / 200 / 2 | 8/12/13-digit supported barcode formats; JPEG signature, 6,700,000 base64 characters; 8,000-character context | Explicit optional key, otherwise input hash + minute bucket | Separate vision/lookup attempts; protected in Batch 4 |
| `generate-claim-pack` | Deterministic pdf-lib, Supabase Storage, optional Resend/Postmark | Active `claim-pack-export.ts`; capability + throttle | Canonical `can_export_claim_pack`; **no AI units** | 2 / 6 / 20 / 1 | 64 KiB request, <=500 rooms / 1,000 items, 2,000-character note; <=100 asset downloads, <=10 MiB per asset and 50 MiB accepted assets; first 5 pages per PDF evidence | `clientDraftId` + input hash; reusable completed reference; single email attempt | Route/run history and email attempts; protected in Batch 4 |
| `revenuecat-webhook` | RevenueCat canonical subscriber lookup | Provider webhook; operational billing | Verified webhook/canonical reconciliation, no customer AI allowance | Batch 2 event/user lease controls | Validated bounded event; canonical product configuration | Event ID + fenced user reconciliation | Private reconciliation/event history; unchanged |
| `reconcile-revenuecat-purchases` | RevenueCat canonical lookup | Native purchase/restore flow | Auth-derived customer, canonical ownership projection | Batch 2 cooldown/user lease | No client-supplied ownership proof | User lease/cooldown | Reconciliation history; unchanged |
| `stripe-webhook` | Stripe customer lookup | Signed Stripe web-billing events | Operational billing, not native checkout | Existing signed webhook controls; no new generic throttle | Existing signature/payload contract | Existing webhook behavior; not upgraded by this batch | Existing logs; deferred dormant claim tokens may still be recorded, but cannot unlock export |
| `send-admin-notification` | Expo Push | Database signup webhook and admin device/test actions | Shared webhook secret or verified admin role | Existing event processing state; no new generic throttle | Registered admin devices and parsed signup event | Event processing/sent state | Notification delivery history; low-cost operational integration, unchanged |
| `create-property` | Supabase only | Active inventory creation | Canonical property allowance | Existing property locking | Existing validated property input | Existing contract | Not a third-party AI/provider route; unchanged |

No other OpenAI/Serper/paid-provider invocation was found in the Edge Function
source search. Absence of a mobile caller is not evidence of an undeployed endpoint.
The table inventories configured/source routes, not a live deployment audit.

## Policy, authentication and trusted controls

The additive `20260928180830_secure_provider_and_claim_routes.sql` migration adds
`replacement_refinement` to the generic monthly policy JSON and adds
`app_settings.provider_route_limits`. Settings are server controlled; no client
request can select rates, quotas, policy class, user identity or rollout mode.
Refinement inherits Batch 3's canonical Free/owner/legacy/override behavior and
Auckland month boundaries. Its monthly `open` and `dry_run` modes count without
denial; `enforced` denies exhausted requests. Independent abuse limits always apply.

`provider-controls.ts` validates Auth using `getUser`, validates bounded input and
checks any supplied item through the user's RLS client and parent property before
creating a separate server client. The new service-only `begin_provider_route`
also verifies item/property ownership against the explicit Auth-derived user.
`provider_route_step` requires that user, operation and current execution token.
No new service-role route accepts a client user ID as authority.

Private jobs, runs and attempts use RLS and deny ordinary client access/mutation.
Both new RPCs revoke PUBLIC/anon/authenticated execution. Existing monthly mutation
grants remain locked down. Tables retain only hashes, identifiers, counters and
bounded result references; voice transcripts/audio/images are not ledger contents.
Runs record every admitted attempt, including failed retries, so refunds and retries
cannot avoid rolling rate limits. An attempt row is persisted before networking;
HTTP success/failure is recorded separately from usable application output.
Provider requests time out after 45 seconds. Unknown attempts remain observable.

Per-user transaction advisory locks serialize rate checks and admission. A
five-minute lease bounds concurrent jobs. Failed voice/barcode/refinement keys are
terminal; a deliberate new operation needs a new key. Legacy voice/barcode clients
can repeat input in a later minute, still subject to all rate windows. Legacy
refinement requests use a deterministic key, so identical old-client requests do
not execute again; new mobile code supplies one key per deliberate AI action.
Manual search-term/refinement editing never invokes this route or consumes units.

## Claim access, storage and recovery

Admission checks `private.resolve_coverly_access().can_export_claim_pack` even in
open mode and before completed-result replay. Ordinary owners, compatible legacy
paid, admin/tester and eligible paid support overrides pass; Free, revoked owners
and support-Free overrides do not. Checks repeat before storage writes/checkpoint
and email attempt admission, so revocation during rendering prevents those effects.
The renderer keeps its existing selected-item/property/room/evidence checks.
Existing inventory reads and edits are unchanged.

Claim tokens are dormant payment history, **never proof of export access**. All
client mutation grants and the all-operation token RLS policy are removed, replaced
by own-history SELECT. Client token sequence access is revoked. Server Stripe
history writing remains, but no token is consumed to authorize PDF generation.
Client writes to generated `claim_packs` history are also revoked; reads remain.
No Free one-off purchase or token transaction migration is implemented.

The stable `clientDraftId` binds user, property, selections, scope and note. Changed
input with the same key conflicts. Replaying a completed request intentionally
returns the original snapshot, even if inventory has since changed; create a new
draft for a new export. Claim results are bounded to 32 KiB and store a storage
path/summary rather than PDF bytes or a permanent signed URL.

Generation writes the existing history row, then checkpoints a reusable result
**before** signing links or sending email. A completed retry creates only a fresh
10-minute link. A lost checkpoint acknowledgement does not release the operation
or delete the ready artifact. A known pre-checkpoint failure can retry the same key
with a new fenced token and another rate admission. Expired/ambiguous work cannot
reclaim the key; inspect history before starting another draft. Late tokens cannot
settle a newer retry. There is no automatic retry of an email attempt.

Storage and database changes are not one distributed transaction. A crash between
upload/history and checkpoint can leave an orphan or an unreferenced ready record;
the operation remains blocked until expiry/recovery rather than silently generating
duplicates. An email crash after checkpoint may leave delivery unknown or unsent.
This is intentional at-most-one-attempt email behavior, not guaranteed delivery.
Operational cleanup/recovery and retention jobs remain future work.

Evidence/image references now normalize only same-project Storage URLs or owned
paths within the selected user/property, then download through the authenticated
storage client. Arbitrary external URLs, other-user/file paths and traversal are
not fetched by the privileged renderer. Inaccessible/oversized assets are skipped
using the existing evidence-unavailable behavior. Existing generated packs remain
in storage/history and readable under their existing read policies. File size is
checked after download; rejected downloads also consume the 50 MiB budget and
no more than 100 asset downloads are attempted; existing bucket upload limits still matter. Pixel dimensions
and compressed PDF expansion need representative-device/server-memory QA.

## Structured responses

| Code | HTTP / meaning |
| --- | --- |
| `CLAIM_EXPORT_ACCESS_REQUIRED` | 403; export capability denied, inventory retained |
| `RESOURCE_NOT_OWNED` | 403; unavailable/foreign context |
| `UNAUTHORIZED` | 401; invalid/missing Auth |
| `RATE_LIMITED` | 429 plus `retryAfterSeconds: 60`; retry may remain limited by hourly/daily window |
| `FREE_ALLOWANCE_EXHAUSTED` / `OWNER_FAIR_USE_EXHAUSTED` | 402 / 429; inherits Batch 3 owner-safe semantics |
| `OPERATION_IN_PROGRESS`, `OPERATION_COMPLETED`, `OPERATION_REFUNDED`, `OPERATION_EXPIRED` | 409 for provider routes; no additional execution |
| Completed claim | 200, fresh signed URL, `reused: true`; no PDF/email repetition |
| `IDEMPOTENCY_CONFLICT` | 409; input changed under the same key |
| `INVALID_WORKLOAD` | 400 or 413; bounded validation failed |
| `USAGE_SERVICE_UNAVAILABLE`, `USAGE_SETTLEMENT_FAILED` | 503; accounting unavailable/uncertain, not a purchase prompt |
| `EXECUTION_CLAIM_LOST` | 409; expired/stale token cannot execute |
| `LEGACY_ROUTE_DISABLED` | 410; authenticated legacy refinement compatibility response |

Existing provider-specific errors remain for normal provider failures. Accounting
errors cannot be swallowed into a successful legacy-handler response. No new quota
presentation or screen redesign is included.

## Future deployment unit and QA

After all historical prerequisites, apply in order:

1. `20260927190405_durable_ownership_access_foundation.sql`.
2. `20260927232224_revenuecat_ownership_reconciliation.sql`.
3. `20260928073851_hardened_fair_use_accounting.sql`.
4. `20260928180830_secure_provider_and_claim_routes.sql`.

Deploy the source versions of `revenuecat-webhook`,
`reconcile-revenuecat-purchases`, `scan-room-photo`, `replacement-price-search`,
`replacement-refinement-v2`, `replacement-search-refine`, `voice-describe`,
`voice-command`, `barcode-verify` and `generate-claim-pack`, including shared code.
Required existing secrets are Supabase URL/anon/service credentials, OpenAI and
Serper keys, Batch 2 RevenueCat configuration, optional UPCitemdb and optional
Resend/Postmark/email sender. No new external credential is introduced. Review
provisional rates, monthly limits and rollout modes before any deployment.

This is a coordinated backend deployment unit. Pause new provider/export traffic,
drain old workers, apply migrations, deploy all affected functions and verify before
restoring traffic. New functions fail closed without the migration; old Batch 3
scan/search functions lose their old RPCs, and old Batch 4 routes remain unsecured
if left serving after the SQL changes. Migration alone is not a secure rollout.
These steps require separate authorization and a verified non-production QA target.

Old mobile payloads remain accepted for voice/barcode/claim and active refinement.
Old clients may show generic recovery/limit errors. Legacy refinement callers get
410 and must migrate. Any older client that writes token or generated pack history
directly loses that write path intentionally. Existing read access stays available.
The only mobile runtime change is an AI-refinement operation key. No dependencies
or native modules were added; Expo Go/development-build availability is unchanged.

Do not roll back by restoring insecure old function sources or client grants.
Disable provider/export traffic if rollback is needed; preserve ownership, usage,
token history, jobs and ready packs, then forward-fix or use a reviewed coordinated
rollback. Store sales and ownership UI remain a later batch.

Local tests execute real migrations and RPCs in PGlite with real route handlers,
mocked Auth/Storage/provider transport and a mocked PDF renderer. They cover access,
grants, rates, duplicate races, failure/refund, tokens, stale leases, lost checkpoint
acknowledgements and foreign storage paths. The full mobile suite covers existing
manual flows and PDF renderer contracts. TypeScript/Deno checks cover entrypoints.
No live provider, database, store, email or deployment call is part of these tests.

Before deployment, use isolated **multi-connection PostgreSQL** for true lock/race
tests; PGlite serializes its connection and cannot prove those races. Verify the
full hosted-schema grants (including any custom column grants), old-client payloads,
real PDF rendering and signed-link access, typical long voice recordings, large
image/PDF memory behavior, provider timeouts, drain/recovery and monitoring. Audio
is byte-bounded, not duration-decoded. Scan/search short-window throttles, aggregate
cross-feature abuse monitoring and ledger retention are further hardening work;
their existing Batch 3 trusted metering remains in force.

Done looks like: all source routes have an explicit customer/cost policy and tested
trusted admission, deterministic claim export requires canonical capability, and
the future rollout has no silently unprotected legacy AI endpoint. Do not change
paywall, pricing, ownership presentation, sign-in, onboarding or store products here.

Local validation result: 153 backend tests (including 34 new remaining-route tests),
533 mobile tests, mobile TypeScript, six changed Edge Function Deno checks and Git
whitespace checks passed. PDF rendering is mocked in route tests; real rendering
and multi-connection races remain QA prerequisites above.
