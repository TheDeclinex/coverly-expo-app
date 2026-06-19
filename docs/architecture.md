# Architecture

## Current strategic architecture

Coverly has three broad surfaces:

```text
Website / marketing
  coverly.nz

Web app / admin / legacy user app
  UI Bakery + Supabase

Native mobile app
  Expo / React Native + Supabase
```

The Expo app should be treated as the main mobile direction.

## Recommended ownership model

GitHub should be the source of truth.

```text
Local development + Codex
        ↓
GitHub
        ↓
Replit / preview / deploy environment
```

Avoid treating Replit as the only master copy.

## App stack

Expected stack:

- Expo / React Native.
- Supabase Auth.
- Supabase Postgres.
- Supabase Storage.
- RevenueCat for native billing.
- Stripe for web billing.
- Edge Functions for server-side AI, replacement pricing, and webhooks.

## Known app structure

Approximate current structure:

```text
app/
  _layout.tsx
  login.tsx
  (tabs)/
    _layout.tsx
    index.tsx
  property/[id].tsx
  room/[id].tsx
  item/[id].tsx
  scan.tsx
  add-item.tsx
  edit-item.tsx

context/
  AuthContext.tsx

lib/
  supabase.ts

types/
  index.ts

constants/
  colors.ts
```

Before changing file paths, inspect the actual repo.

## Data flow

Typical item creation flow:

```text
User selects/scans image
  ↓
Image uploaded to Supabase Storage
  ↓
Storage path stored in DB
  ↓
Item row created/updated
  ↓
UI fetches item rows
  ↓
Signed URLs are generated for display
```

## Environment handling

Environment-specific values should come from env vars, not hardcoded strings.

Use `.env.example` to document required values.

Do not commit real secrets.

## Dev/prod direction

Target future split:

```text
development app
  ↓
development Supabase project
  ↓
test builds / Expo Go / dev build

production app
  ↓
production Supabase project
  ↓
internal testing / app store release
```

In the short term, be careful not to accidentally point dev builds at production data unless intended.

## Production migration rules

When adding features, avoid assumptions that block production migration:
- No hardcoded Supabase URLs.
- No hardcoded product IDs in scattered components.
- No client-side service role keys.
- No hidden dependencies on Replit-specific state.
- No schema changes without documenting migrations.
