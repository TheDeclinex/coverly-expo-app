# Billing and Entitlements

## Current direction

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
