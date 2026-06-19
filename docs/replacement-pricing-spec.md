# Replacement Pricing Specification

## Purpose

Replacement pricing helps users estimate what it would cost to replace an item today.

This is one of Coverly’s key differentiators because users often do not know whether their contents insurance value is enough.

## User goal

For each item, the user should be able to:
1. See an estimated item value.
2. Search for replacement options.
3. Compare results by price/value fit.
4. Select a listing to use as the replacement value.
5. Store the selected listing/value on the item.

## Expected behaviour

Replacement price search should:
- Use item name, description, brand, model, category, and estimated value where available.
- Return candidate listings.
- Show listing image, title, retailer, price, and link/source.
- Provide filter pills based on estimated value bands.
- Let the user select “Use this listing”.

## Filter pill direction

Example price bands around estimated value:

```text
Below estimate
Good match
Premium
All
```

Or more precise bands:

```text
< 75%
75%–125%
125%–175%
175%+
```

The UI Bakery version had useful pill-style filtering and image-forward cards. The Expo implementation should closely replicate the successful parts of that experience.

## Result card requirements

Each result should show:
- Product image if available.
- Listing title.
- Retailer/source.
- Price.
- Match context if available.
- “Use this listing” action.

## Item update

When a user selects a listing:
- Update the item replacement value.
- Store selected listing metadata if supported.
- Make it clear whether value is AI-estimated, user-entered, or listing-derived.

## Entitlements

Replacement price lookups are metered/limited on the Free plan and included/fair-use on paid plans.

Do not expose confusing token mechanics to the user.

## Backend

Known Edge Function:

```text
replacement-price-search
```

Use the existing function unless there is an explicit decision to replace it.

## Done looks like

- A user can open an item.
- Tap replacement pricing.
- See meaningful listing cards.
- Filter by sensible value bands.
- Select one listing.
- Item value updates visibly.
- Entitlement handling is respected.
- Failure states are clear.
