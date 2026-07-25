# Global market foundation

Coverly stores market context on each property. `inventory_files.country_code` is the selected ISO 3166-1 alpha-2 country and `currency_code` is the server-derived ISO 4217 snapshot. Profile country is only a default for future properties.

## Configuration

The Edge Function registry is `supabase/functions/_shared/market-config.ts`. The mobile representation is `artifacts/mobile/constants/market-config.ts`; parity tests prevent silent divergence. The database lookup `public.pricing_markets` is seeded by the forward migration and is authoritative for property writes.

- Verified: NZ, AU, US, CA, GB.
- Preview: AT, BE, BR, CH, DE, DK, ES, FI, FR, IE, IN, IT, JP, KR, MX, NL, NO, PT, SE, SG, ZA.
- Limited: every other listed ISO country/territory. Manual inventory, object recognition, and best-effort local retailer search work, while AI-generated replacement estimates stay disabled.

Unusual or multi-currency territories use a documented default in the committed dataset and remain limited unless explicitly promoted. Retailer search and AI-generated estimates are separate capabilities: every configured country receives its lower-case ISO code as the provider `gl`, while limited-tier markets keep AI estimates disabled. Configured search languages are used where available (including Bulgarian for BG), with English as the safe fallback. A future property currency override can be added without changing the property/item/claim schema.

## Monetary invariants and compatibility

New and edited values follow:

```text
unit_estimated_price = value for one unit
estimated_price = unit_estimated_price × quantity
```

New replacement values also store `estimated_currency`, `valuation_market`, and `estimated_at`. Purchase and selected-listing amounts have explicit currency fields. Historic properties and historic monetary values are backfilled as NZ/NZD because all old pricing paths were explicitly New Zealand based. Unknown historic valuation timestamps remain null.

Legacy rows that only have `estimated_price` use the previously shipped per-unit interpretation. The forward migration copies that value to `unit_estimated_price` and recalculates `estimated_price` as unit value times quantity without changing quantity. Compatibility helpers apply the same rule before migration. Mixed currencies are grouped and displayed without conversion; property coverage comparisons use only the property currency.

The current Supabase inventory is test data, so this normalization is the final migration behaviour and does not require a later production-data interpretation decision.

## Claims

New claim packs store property country, property currency, and summary currency. The primary summary includes only values in the property currency and the PDF lists currency subtotals for all included values. No exchange-rate conversion is performed. Historic PDFs and claim records are not rewritten.

## Manual deployment

Do not use `supabase db push` while remote migration history is unreconciled.

Before running the migration, use these read-only checks in the target project's SQL Editor. Every row should report `true`:

```sql
select
  to_regprocedure('public.create_my_property(text,text,numeric,text,text,text)') is not null as has_six_argument_create,
  to_regprocedure('public.coverly_property_allowance_for_user(uuid)') is not null as has_property_allowance,
  to_regprocedure('public.raise_property_limit_reached(integer,integer)') is not null as has_limit_error_helper,
  to_regprocedure('public.assert_current_user_admin()') is not null as has_admin_assertion,
  to_regclass('public.inventory_items') is not null as has_inventory_items,
  to_regclass('public.claim_packs') is not null as has_claim_packs;
```

Deployment order:

1. Review these fixes and the final diff.
2. Commit and push only after review approval.
3. Open the target Supabase project's SQL Editor and apply the pending forward migrations in order. Existing global-market deployments need `supabase/migrations/20260718000000_enable_global_replacement_search.sql`; fresh environments should also retain the updated `20260717000000_global_market_foundation.sql` seed. Each file contains its own transaction and schema reload notification.
4. If a manual reload is needed after the transaction, run:

```sql
notify pgrst, 'reload schema';
```

5. Verify the database and both property-creation overloads:

```sql
select count(*) as pricing_market_count from public.pricing_markets; -- 249

select
  to_regprocedure('public.create_my_property(text,text,numeric,text,text,text)') is not null as has_legacy_create,
  to_regprocedure('public.create_my_property(text,text,text,numeric,text,text,text)') is not null as has_country_aware_create;

select count(*) as properties_missing_market
from public.inventory_files
where country_code is null or currency_code is null; -- 0
```

6. Deploy the changed functions from the repository root:

```text
npx supabase functions deploy scan-room-photo --no-verify-jwt
npx supabase functions deploy replacement-price-search
npx supabase functions deploy generate-claim-pack
npx supabase functions deploy create-property --no-verify-jwt
```

7. Smoke-test property creation for an old-client NZ request and new NZ, AU, preview, and limited-market requests; then test scan, replacement search, mixed-currency totals, Admin file values, and claim-pack generation.
8. Create iOS and Android builds only after the database and Edge smoke tests pass.

The old six-argument RPC remains available. Its insert uses the NZ/NZD column defaults and the server derivation trigger. The new seven-argument RPC requires the named `p_country_code` argument and derives currency server-side, so named PostgREST calls resolve unambiguously and cannot force a mismatched currency.

`admin_list_user_files` retains its existing named fields and adds `currency_code` and `inventory_totals`. Current mobile callers read named fields. Older Admin builds should continue to read the preserved fields, but the new app build is required to display grouped mixed-currency totals accurately. The RPC continues to call `assert_current_user_admin()`.

Review existing function secrets before deployment: `OPENAI_API_KEY`, optional `OPENAI_SCAN_MODEL` (default remains `gpt-5.6-luna`), `SERPER_API_KEY`, and the existing claim-pack email/storage configuration. No new secret is introduced.

The deployed `barcode-verify` source is not present in this repository. The mobile response contract now permits explicit offer currency/market context, but the backend must later derive that context from `itemId` before barcode-derived pricing can be treated as market-safe.
