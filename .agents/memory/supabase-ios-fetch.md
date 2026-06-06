---
name: Supabase iOS native fetch fix
description: Without this config, supabase.auth.signInWithPassword fails on iOS with "Network request failed"
---

The Supabase JS client bundles whatwg-fetch (XHR-based polyfill) internally. On iOS/React Native, XHR polyfills fail inside Expo Go while native fetch works fine.

**Rule:** Always pass `global: { fetch: fetch.bind(globalThis) }` as a createClient option in React Native apps.

**Why:** The raw `fetch` test can succeed while `supabase.auth.signInWithPassword` fails — they use different fetch implementations unless you override it.

**How to apply:** In `lib/supabase.ts`:
```ts
export const supabase = createClient(url, key, {
  auth: { storage: AsyncStorage, ... },
  global: { fetch: fetch.bind(globalThis) },
});
```
