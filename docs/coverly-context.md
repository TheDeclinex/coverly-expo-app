# Coverly Context

Last updated: 2026-06-18

## Product summary

Coverly is an AI-assisted home contents inventory app. It helps households document what they own, estimate replacement value, compare contents value against their insurance cover, and eventually produce claim-ready evidence packs.

The app is inspired by a real house fire experience where the user had no complete household contents record and the chosen contents sum insured was effectively a made-up number.

## Core user problem

Most households do not know:
- What they own.
- What it would cost to replace.
- Whether their contents insurance cover is enough.
- How they would prove ownership/value after a loss event.

After a fire, flood, theft, or other loss, users may have to recreate evidence under stress with incomplete information.

## Core value proposition

Coverly gives households a simple way to know and document what they own before they need to make a claim.

## High-level concept

> An AI-assisted home contents inventory and insurance evidence app.

Short tagline:

> Know what you own.

## Initial market

- New Zealand first.
- Household users first.
- Later potential expansion to other countries and professional/assessor workflows.

## Current app direction

The mobile app is being built in Expo / React Native after earlier UI Bakery web and wrapped-app experiments.

UI Bakery remains useful for the browser/web app, but Expo is the preferred direction for a native mobile experience.

## Product hierarchy

```text
Property / File
  Room
    Item
```

Example:
- Main home
  - Lounge
    - Samsung TV
    - Sofa
    - Soundbar

## Core features

Current / planned features include:

- Property creation.
- Room creation.
- Manual item entry.
- Photo upload.
- AI room/photo scan.
- AI-detected item review.
- Pin/thumbnail display.
- Replacement price search.
- Value-vs-insured-cover comparison.
- Claim-pack PDF export.
- Billing via Stripe on web and RevenueCat/native IAP on mobile.
- Admin console later.

## Important product decisions

- Free plan should let users experience the product.
- Paid plans should include AI features under fair-use language rather than exposing token-like allowances.
- Claim packs should not be subscription-only forever; free users may buy a one-off claim pack.
- Voice describe can remain ungated initially.
- Multiple properties matter: main home, rental, beach house, etc.
- The app needs strong onboarding and empty-state guidance.
- Replacement pricing is a major differentiator and should closely mirror the stronger UI Bakery experience.

## Development context

Current priorities include:

1. Stabilise Expo mobile app.
2. Finish image reliability and pin/thumbnail behaviour.
3. Improve onboarding and empty states.
4. Build replacement pricing module.
5. Add native billing.
6. Add claim-pack generation/export.
7. Set up dev/prod environment and promotion workflow.
8. Keep production migration in mind from the start.
