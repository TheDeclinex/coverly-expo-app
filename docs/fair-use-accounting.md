# Fair-use accounting — Batch 3, source only

Batch 4 now protects the remaining routes. See the current
[provider inventory and claim controls](provider-and-claim-controls.md); the
deferred-route table below records the Batch 3 checkpoint.

Ownership is not unlimited AI. This batch protects the active `scan-room-photo`
and `replacement-price-search` routes while preserving their recognition prompts,
model selection, quantity/pin processing, search queries, result ranking and
refund-on-empty-result behavior. No backend code is deployed by this work.

## Policy and settings

`private.usage_policy` consumes `private.resolve_coverly_access().ai_policy_class`.
It does not infer access from profile plan strings or provider subscription fields.
Free users use existing `app_settings.free_ai_scan_monthly_limit` (10) and
`free_replacement_pricing_monthly_limit` (5). Those existing values are preserved.

`app_settings.usage_feature_policies` contains server-only policy configuration:

```json
{
  "ai_scan": {
    "owner_limit": 10,
    "resource": "property",
    "operations": {
      "single_photo_scan": 1,
      "multi_photo_scan": 3,
      "video_frame_scan": 3
    }
  },
  "replacement_pricing": {
    "owner_limit": 5,
    "resource": "item",
    "operations": {"search": 1}
  }
}
```

**Owner 10/5 values are provisional conservative safety defaults, not final
commercial allowances.** A later approved settings update can change them without
an app release. Owner usage reserves and consumes units; ownership never selects
the bypass. Keep the existing 1/3/3 and search=1 product weights for now; they are
not claims about provider cost. Weights are read from settings on each reservation.

Legacy Plus/Family retain a temporary unlimited customer-allowance bypass. Admin,
tester and paid support overrides explicitly bypass the cap. A support Free
override is limited as Free. All these classes now count reserved/used units and
record provider attempts. Bypass is represented explicitly, not inferred from a
null owner allowance. No paid top-ups or rollover are introduced.

A future feature such as `replacement_refinement` can use the same tables/RPCs
after adding `free_limit`, `owner_limit`, `resource` (`item` or `property`) and
`operations` to this configuration. It is not enabled by this migration. Invalid
or missing configuration fails closed. Ordinary clients cannot update settings;
existing role-checked admin SECURITY DEFINER setters remain available.

## Trusted mutations and immutable operations

Both functions still validate the Supabase bearer token with `auth.getUser` and
load resources using the user's RLS client. Only then do they construct a separate
service client, with no user Authorization header, for usage mutation. The user
UUID always comes from validated Auth, never request JSON. SQL also checks the
resource: inventory file ownership, or item ownership through its parent file.
Inventory resource IDs remain text, matching the production schema.

The new service-only RPCs are `reserve_feature_usage`,
`start_feature_provider_attempt`, `finish_feature_provider_attempt` and
`settle_feature_usage`. PUBLIC, anon and authenticated have no execute privileges.
The old `reserve_my_feature_usage`, `commit_my_feature_usage`,
`refund_my_feature_usage` and expiry helper lose all application-role grants.
Both accounting tables deny direct client mutation. Read access remains through
the authenticated no-argument `load_my_usage_allowances()` RPC.

Each operation binds user, feature, operation, key, resource and a deterministic
SHA-256 input fingerprint. Scan fingerprints include mode, ordered image content
digests/IDs/paths, context, market and selected model. Storage images are downloaded
through the user's RLS client; the exact hashed bytes are sent to OpenAI, avoiding
changes between hashing a storage path and provider retrieval. Search fingerprints
include immutable request/refinement inputs, normalized query, market and result
bounds. Keys/timestamps are excluded where they are transport-only. No raw image,
search text, auth token or provider secret is stored in accounting metadata.

A service role is privileged and trusted. SQL resource checks prevent accidental
cross-user resource charging; they do not claim to defend against a compromised
service credential. Edge Auth/RLS checks and server-only key handling are part of
the security boundary.

## Execution, replay, concurrency and failures

The same key is never reclaimed for a new execution. This deliberately chooses
explicit recovery states over a provider-response cache or a large response blob
store. A caller must check the outcome before starting a genuinely new operation
with a new key; automatic transport retry with the old key cannot repeat work.

| State | Provider permission and customer accounting |
| --- | --- |
| `denied` | No execution; policy denial retained for diagnosis. |
| `reserved` | Fresh five-minute token reserves units; provider cannot run yet. |
| `processing` | A unique provider-attempt claim was recorded before invoking the provider. |
| `committed` | Reserved units become used; same-key replay reports completed. |
| `refunded` | Units are released; same-key replay reports refunded and cannot execute. |
| `expired` | Reserved units are released; old tokens cannot execute or settle. |

All counter-changing paths acquire the same per-user transaction advisory lock,
including expiry and allowance reads. This serializes feature/month bucket updates,
key checking, attempt start and settlement; cross-month settlement always updates
the operation's original month. Unique user/feature/key and reservation/attempt
constraints provide additional duplicate protection. Settlement verifies user,
reservation, token, state and expiry. Repeated same-outcome settlement is idempotent;
an opposite outcome cannot double-adjust counters.

| Failure | Behavior |
| --- | --- |
| Request/process dies before provider start | Reservation expires after five minutes; key remains terminal. |
| Process dies after attempt start | Attempt remains `started` (outcome unknown); expiry releases customer units. |
| Provider error, timeout, invalid response or no usable results | Checked refund; attempt telemetry remains. |
| Provider succeeds but commit fails or response is lost | Explicit service failure; never attempt a compensating refund after uncertain commit. Retry cannot reinvoke provider. Inspect ledger; uncommitted work eventually expires. |
| Concurrent duplicate | Explicit in-progress state, zero additional provider calls. |
| Lease expires during execution | Late counter settlement fails; cost telemetry can record the late response without changing counters. |
| Refund or telemetry settlement fails | Explicit service failure, never silent success. |

Expiry runs lazily during subsequent reservation, settlement, attempt start or
allowance read. No background scheduler is introduced. Old pre-upgrade reserved
rows are expired and released by the migration; committed counters/history remain.
Only current-month capacity is available, with no rollover. The boundary and reset
remain Pacific/Auckland calendar months, including daylight-saving changes.

## Provider-attempt telemetry

`private.feature_provider_attempts` stores reservation linkage, fixed attempt name,
start/end timestamps, HTTP status and started/succeeded/failed state. Scan records
one OpenAI attempt; search separately records shopping and any organic fallback.
An attempt row is written before networking, so every actual provider call has an
audit record. A start is evidence of a possible call, not proof of a billable call
if the process crashed immediately afterward. HTTP success is separate from usable
application results; refund reasons explain empty/invalid responses.

Reservation status/policy snapshots record denials, committed/refunded units and
expired work. Duplicate and fingerprint-conflict counters identify suppressed
replays. These compact rows preserve history without storing AI responses. Retention
and operational cost dashboards remain future work. Repeated new-key failures can
still cost money despite refunds; telemetry enables investigation, but this batch
does not add per-minute anti-abuse throttling to every route.

## Workload and read contracts

The server accepts one image for single photo/item, up to five for multi-photo and
up to twenty for video frames. Mode/count contradictions are rejected before any
provider attempt. Images require exactly one representation (owned storage path or
base64), supported JPEG/PNG/WebP MIME and matching file signature. Paths must belong
to the authenticated user and selected property. Individual decoded files are
limited to 8 MiB, aggregate decoded images to 24 MiB, and request JSON to 34 MiB.
Storage download size is checked after download; the bucket's existing file-size
limit still applies before this check. This is not a full image decoder/dimension
inspection. Device memory and normal large-photo/video batches require QA.

Search request JSON is capped at 64 KiB and result count at 1–10; existing ranged
search can request up to 20 provider candidates. Existing query/range/result
processing stays intact. One bounded search operation consumes one unit, including
its existing organic fallback. Empty results retain the existing refund policy.

Allowance rows preserve prior fields and add `policy_class`, `is_bypassed` and
`blocked`. They include feature, month/start/reset, limit, used, in-flight reserved,
remaining, effective plan and mode. A bounded owner always has numeric remaining
units. Only explicit bypass has null remaining. `would_be_blocked` reports the
policy decision in every mode; `blocked` reports actual enforcement. The mobile
parser accepts old valid rows, exposes new fields and rejects malformed/contradictory
owner data. No Account screen is redesigned.

`open` and `dry_run` both count usage and record would-block decisions without
denying customers; `dry_run` is the policy-observation rollout stage. `enforced`
prevents provider invocation when the configured limit would be exceeded. None
of these modes can be chosen by a mobile request.

| Structured error | HTTP / recovery |
| --- | --- |
| `FREE_ALLOWANCE_EXHAUSTED` | 402, monthly Free cap. |
| `OWNER_FAIR_USE_EXHAUSTED` | 429, included owner fair use; no subscription upsell. Released clients treat generic 402 as a Plus upsell, so owners intentionally do not receive it. |
| `OPERATION_IN_PROGRESS`, `OPERATION_COMPLETED` | 409; wait/check outcome, do not automatically start a new operation. |
| `OPERATION_REFUNDED`, `OPERATION_EXPIRED`, `OPERATION_DENIED` | 409; old key cannot execute; an intentional new operation needs a new key. |
| `IDEMPOTENCY_CONFLICT` | 409; key was reused for different input/context. |
| `INVALID_WORKLOAD` | 400; invalid or oversized input. |
| `USAGE_SERVICE_UNAVAILABLE`, `USAGE_SETTLEMENT_FAILED`, `USAGE_SETTLEMENT_UNCERTAIN`, `USAGE_TELEMETRY_FAILED` | 503; accounting/recovery issue, not a purchase requirement. |
| `EXECUTION_CLAIM_LOST`, `PROVIDER_ATTEMPT_ALREADY_STARTED` | 409; no provider permission. |

Manual entry/value editing, inventory/evidence viewing and existing property access
never call this ledger. AI exhaustion cannot change those capabilities.

## Other provider routes — inspected, unchanged

| Route | Repository evidence and next step |
| --- | --- |
| `replacement-refinement-v2` | Active mobile caller in `replacement-refinement-ai.ts`; OpenAI-backed, currently outside this ledger. Its request protocol has no immutable operation key. Defer metering/recovery integration to Batch 4 rather than change that mobile flow here. Manual refinement remains free. |
| `replacement-search-refine` | Older OpenAI endpoint remains configured; no current mobile invocation found. Apparently legacy, not proof it is undeployed. Inventory external callers and meter/throttle later; do not remove. |
| `voice-describe` | Active through `voice-input.ts`, including refinement dictation. Uses transcription plus extraction. Product context allows initial ungated voice; needs later abuse throttles/cost policy, not removal of manual functionality. |
| `voice-command` | Configured transcription/chat route; no current mobile invocation found. Apparently legacy; verify external callers and protect later. |
| `barcode-verify` | Active `BarcodeScanFlow` / `barcode-verify.ts`; UPC lookup and optional OpenAI visual verification. Separate cheap lookup from expensive vision in a later metering/throttle policy. |
| `generate-claim-pack` | Evidence fetching/PDF work and email providers, not an AI scan/search route. Claim enforcement and delivery abuse controls remain separate future work. |
| `send-admin-notification`, `stripe-webhook`, RevenueCat reconciliation | Authenticated operational/provider integrations with different purposes; not customer AI allowances. Unchanged. |

No endpoint is removed based on absence of a mobile caller. Adding a later metered
feature requires policy configuration and Edge integration, not a ledger rewrite.

## Deployment compatibility and QA prerequisites

Apply historical prerequisite migrations first, then:

1. `20260927190405_durable_ownership_access_foundation.sql` (Batch 1).
2. `20260927232224_revenuecat_ownership_reconciliation.sql` (Batch 2).
3. `20260928073851_hardened_fair_use_accounting.sql` (Batch 3).
4. Eventually deploy updated `revenuecat-webhook`, `reconcile-revenuecat-purchases`,
   `scan-room-photo` and `replacement-price-search`, with their shared modules.

Batches 1–3 form a coherent source-level backend unit for durable access, canonical
native ownership and scan/search accounting. They are not a complete owner product
launch: remaining provider coverage, claim enforcement, mobile ownership UI and
store configuration are still deferred.

Use a coordinated maintenance window in a separately verified QA environment:
pause new AI requests, drain in-flight old functions, apply migrations, deploy
updated functions and smoke-test before restoring traffic. **Batch 3 alone disables
old functions' usage RPCs; old AI requests then fail closed.** New functions also
fail closed without Batch 3 RPCs. Do not leave either intermediate state serving
customers, and do not enable owner sales between incomplete backend batches.

Required settings/secrets: existing Supabase URL/anon/service credentials,
OpenAI/Serper credentials, the Batch 2 RevenueCat configuration, approved allowance
values/weights and a deliberate rollout mode. No new provider secret is introduced.
Existing service-role credentials remain server-only. No live value is configured
by this source change. Recheck admin settings/RLS and existing released clients
against a full local/QA schema before deployment.

Current production mobile request shapes and normal bounded workloads remain
compatible. Additional allowance fields are additive. Old clients cannot replay
results after an ambiguous response: they may show a generic error for 409/429;
later mobile work should use the structured recovery model. The server deliberately
avoids telling owners to buy Plus. No paywall, Account, pricing or onboarding UI
changes are included. Preview normal scans/searches in a development build; verify
manual inventory/value editing and generic retry behavior when limits are exhausted.
Never enable owner sales solely because these backend tests pass.

Local tests use mocked OpenAI/Serper and in-memory PGlite only. They execute actual
migrations, policy/grant checks, expiry/settlement interleavings, month expressions,
and full injectable scan/search handlers. PGlite serializes one connection: its
Promise-based last-slot test is **not proof of multi-connection concurrency**.
No installed local PostgreSQL/Docker runtime was found. Real multi-connection
last-slot, expiry-versus-settlement, settings changes and rollout/drain tests remain
mandatory QA work on an isolated database. Also validate real image memory limits,
store receipts and monitoring of unknown/failed provider attempts.

Run the usage suite with `COVERLY_PGLITE_MODULE` pointing to a local PGlite module:

```powershell
node --experimental-strip-types --test supabase/tests/fair-use.local.test.ts
node --experimental-strip-types --test supabase/functions/_shared/trusted-usage.test.ts
npx deno check --no-lock supabase/functions/scan-room-photo/index.ts supabase/functions/replacement-price-search/index.ts
```

Also run ownership/RevenueCat regressions, scan model tests, the mobile suite from
`artifacts/mobile`, mobile TypeScript and Git whitespace checks. No runtime app
dependency was added. Local tooling is not an app dependency or Expo Go purchase
integration. This work authorizes no Supabase deployment, remote migration,
RevenueCat/store change, build, TestFlight submission or release. The local CLI
remains linked to PROD and must not be used for these QA steps without a separately
authorized and verified target.
