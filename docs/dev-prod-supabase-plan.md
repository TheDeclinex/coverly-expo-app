# Coverly Dev/Prod Supabase Plan

## Current decision

Coverly will not immediately invest in a full dev/prod Supabase split while the app is still pre-customer and not publicly live.

The current Supabase project should be treated as a **production-candidate / pre-live environment**:

* It is not yet serving public customers.
* It does contain real app structure, test users, security settings, migrations, Edge Functions, storage policies, and live-like data.
* Changes should still be handled carefully.

Full dev/prod separation is a **pre-launch requirement**, not an immediate requirement.

## Current operating model

For now, Coverly uses one Supabase environment with manual production-style discipline.

Before any future Supabase SQL change:

1. Codex must produce reviewed SQL first.
2. The migration file must be committed before applying SQL.
3. SQL is applied manually in Supabase SQL Editor.
4. Verification SQL is run immediately after applying.
5. Mobile app smoke tests are performed.
6. UI Bakery smoke tests are performed where relevant.
7. Any production SQL patch must be reflected back into the repo migration file.
8. Corrections must be committed and pushed.
9. Broad table grants must not be restored casually.
10. Billing, admin, entitlement, security, or RLS changes require explicit review.

This manual process was successfully used for:

* Admin/security hotfix.
* Profile/Settings V1.
* RPC-only profile edits.
* Protection against direct `user_profiles` role/plan mutation.

## Locked security/profile constraints

The following constraints remain active:

* No broad `user_profiles` `INSERT` or `UPDATE` grants for `anon` or `authenticated`.
* Expo must not write directly to `user_profiles`.
* Profile edits must use validated RPCs only.
* Profile settings use:

  * `load_my_settings()`
  * `update_my_profile(...)`
  * `mark_my_onboarding_complete()`
* `load_my_profile()` return shape must remain compatible.
* UI Bakery remains the primary admin surface.
* Admin V1 remains read-only in mobile.
* Existing admin write RPCs may exist in production but must remain secured and out of mobile scope.

## When full dev/prod separation becomes mandatory

Create a separate Supabase development project before any of the following:

* Public beta beyond close friends/family.
* App Store / Play Store production release.
* Real paid subscriptions.
* RevenueCat or Stripe live billing rollout.
* Claim-pack generation for real users.
* Insurer, assessor, partner, or professional access.
* Any marketing push where unknown users may sign up.
* Any material increase in real customer data.

## Future target setup

The future setup should include:

### Supabase projects

* `coverly-dev`
* `coverly-prod`

Production should remain stable and only receive reviewed/promoted changes.

Development should be used for:

* Codex/Replit development.
* New migrations.
* Edge Function changes.
* Test users.
* Dummy claims/items/files.
* Billing sandbox testing.

### Expo environment strategy

Expo should clearly distinguish:

* local/dev environment
* production environment

Required environment variables should include:

* Supabase URL
* Supabase anon key
* app environment name
* privacy URL
* terms URL
* any public metadata needed by the app

Service-role keys must never be placed in Expo env files.

### Migration workflow

Future workflow:

1. Write migration in repo.
2. Apply to dev Supabase first.
3. Run verification SQL in dev.
4. Run mobile smoke tests against dev.
5. Run UI Bakery/dev-admin checks if relevant.
6. Commit migration.
7. Promote same SQL to prod.
8. Run prod verification SQL.
9. Smoke-test production app/admin.
10. Record result in release notes or project log.

### Edge Function workflow

Edge Functions should be tested in dev before prod.

Promotion checklist:

* Function deployed to dev.
* Secrets configured in dev.
* Function smoke-tested.
* Logs reviewed.
* Same function deployed to prod.
* Prod secrets verified.
* Prod smoke test completed.

### Storage and RLS mirroring

Dev and prod should have matching:

* storage buckets
* storage RLS policies
* database RLS policies
* required functions/RPCs
* auth redirect URLs
* email templates where relevant
* test storage paths

Current known buckets include:

* `inventory-photos`
* `claim-evidence`
* `claim-packs`

### Test user strategy

Development should include known test users:

* normal free customer
* Plus customer
* Family customer
* admin user
* profile-less/new-signup test user
* entitlement override test user

Production test users should be minimal and clearly identifiable.

### Production promotion checklist

Before applying any prod SQL:

* Confirm correct Supabase project.
* Confirm latest repo commit is pushed.
* Confirm migration file exists in repo.
* Confirm SQL reviewed.
* Confirm rollback/containment plan.
* Apply SQL manually or via approved migration flow.
* Run verification SQL.
* Smoke-test mobile.
* Smoke-test UI Bakery where relevant.
* Confirm no unexpected auth/profile/billing breakage.
* Commit any patch if production SQL differed from repo.

## Current status

As of the latest checkpoint:

* Branch: `main`
* Working tree: clean.
* Local and origin main are aligned.
* Security migration is present.
* Profile/settings migration is present.
* Profile/settings migration includes:

  * `ON CONFLICT ON CONSTRAINT user_profiles_pkey`
  * boolean `coalesce(..., false)` hardening
* Expo contains no direct `user_profiles` writes.
* Profile changes use RPCs only.
* Tests passed:

  * TypeScript
  * Profile/settings tests
  * Existing voice/update tests
* Known remaining risks:

  * Generated Supabase database types are not yet present.
  * Admin write RPCs still exist in production, although secured.
  * Full dev/prod separation is not yet implemented.
  * Migrations still rely on careful manual promotion.

## Recommended future task

Before further database, billing, entitlement, or public-release work, revisit:

**Dev/prod Supabase separation and migration promotion workflow**

This should become a required launch-readiness task before public beta or production store release.
