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
