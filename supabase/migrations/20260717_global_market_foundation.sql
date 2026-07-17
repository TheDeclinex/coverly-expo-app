-- Coverly global country/currency foundation.
-- Forward-only and safe to run manually in the Supabase SQL Editor.
-- Existing data is intentionally treated as NZ/NZD because every historical
-- pricing path was explicitly New Zealand based.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pricing_markets (
  country_code text PRIMARY KEY CHECK (country_code ~ '^[A-Z]{2}$'),
  currency_code text NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  locale text NOT NULL,
  search_language text NOT NULL,
  serper_gl text,
  serper_hl text NOT NULL,
  pricing_support_tier text NOT NULL CHECK (pricing_support_tier IN ('verified', 'preview', 'limited')),
  ai_estimates_enabled boolean NOT NULL,
  replacement_search_enabled boolean NOT NULL,
  material_item_threshold numeric,
  UNIQUE (country_code, currency_code)
);

WITH pairs AS (
  SELECT split_part(pair, ':', 1) AS country_code, split_part(pair, ':', 2) AS currency_code
  FROM unnest(string_to_array(
    'AD:EUR,AE:AED,AF:AFN,AG:XCD,AI:XCD,AL:ALL,AM:AMD,AO:AOA,AQ:USD,AR:ARS,AS:USD,AT:EUR,AU:AUD,AW:AWG,AX:EUR,AZ:AZN,BA:BAM,BB:BBD,BD:BDT,BE:EUR,BF:XOF,BG:BGN,BH:BHD,BI:BIF,BJ:XOF,BL:EUR,BM:BMD,BN:BND,BO:BOB,BQ:USD,BR:BRL,BS:BSD,BT:BTN,BV:NOK,BW:BWP,BY:BYN,BZ:BZD,CA:CAD,CC:AUD,CD:CDF,CF:XAF,CG:XAF,CH:CHF,CI:XOF,CK:NZD,CL:CLP,CM:XAF,CN:CNY,CO:COP,CR:CRC,CU:CUP,CV:CVE,CW:ANG,CX:AUD,CY:EUR,CZ:CZK,DE:EUR,DJ:DJF,DK:DKK,DM:XCD,DO:DOP,DZ:DZD,EC:USD,EE:EUR,EG:EGP,EH:MAD,ER:ERN,ES:EUR,ET:ETB,FI:EUR,FJ:FJD,FK:FKP,FM:USD,FO:DKK,FR:EUR,GA:XAF,GB:GBP,GD:XCD,GE:GEL,GF:EUR,GG:GBP,GH:GHS,GI:GIP,GL:DKK,GM:GMD,GN:GNF,GP:EUR,GQ:XAF,GR:EUR,GS:GBP,GT:GTQ,GU:USD,GW:XOF,GY:GYD,HK:HKD,HM:AUD,HN:HNL,HR:EUR,HT:HTG,HU:HUF,ID:IDR,IE:EUR,IL:ILS,IM:GBP,IN:INR,IO:USD,IQ:IQD,IR:IRR,IS:ISK,IT:EUR,JE:GBP,JM:JMD,JO:JOD,JP:JPY,KE:KES,KG:KGS,KH:KHR,KI:AUD,KM:KMF,KN:XCD,KP:KPW,KR:KRW,KW:KWD,KY:KYD,KZ:KZT,LA:LAK,LB:LBP,LC:XCD,LI:CHF,LK:LKR,LR:LRD,LS:ZAR,LT:EUR,LU:EUR,LV:EUR,LY:LYD,MA:MAD,MC:EUR,MD:MDL,ME:EUR,MF:EUR,MG:MGA,MH:USD,MK:MKD,ML:XOF,MM:MMK,MN:MNT,MO:MOP,MP:USD,MQ:EUR,MR:MRU,MS:XCD,MT:EUR,MU:MUR,MV:MVR,MW:MWK,MX:MXN,MY:MYR,MZ:MZN,NA:NAD,NC:XPF,NE:XOF,NF:AUD,NG:NGN,NI:NIO,NL:EUR,NO:NOK,NP:NPR,NR:AUD,NU:NZD,NZ:NZD,OM:OMR,PA:PAB,PE:PEN,PF:XPF,PG:PGK,PH:PHP,PK:PKR,PL:PLN,PM:EUR,PN:NZD,PR:USD,PS:ILS,PT:EUR,PW:USD,PY:PYG,QA:QAR,RE:EUR,RO:RON,RS:RSD,RU:RUB,RW:RWF,SA:SAR,SB:SBD,SC:SCR,SD:SDG,SE:SEK,SG:SGD,SH:SHP,SI:EUR,SJ:NOK,SK:EUR,SL:SLL,SM:EUR,SN:XOF,SO:SOS,SR:SRD,SS:SSP,ST:STN,SV:USD,SX:ANG,SY:SYP,SZ:SZL,TC:USD,TD:XAF,TF:EUR,TG:XOF,TH:THB,TJ:TJS,TK:NZD,TL:USD,TM:TMT,TN:TND,TO:TOP,TR:TRY,TT:TTD,TV:AUD,TW:TWD,TZ:TZS,UA:UAH,UG:UGX,UM:USD,US:USD,UY:UYU,UZ:UZS,VA:EUR,VC:XCD,VE:VES,VG:USD,VI:USD,VN:VND,VU:VUV,WF:XPF,WS:WST,YE:YER,YT:EUR,ZA:ZAR,ZM:ZMW,ZW:USD',
    ','
  )) AS pair
)
INSERT INTO public.pricing_markets (
  country_code, currency_code, locale, search_language, serper_gl, serper_hl,
  pricing_support_tier, ai_estimates_enabled, replacement_search_enabled, material_item_threshold
)
SELECT country_code, currency_code, 'en-' || country_code, 'en', NULL, 'en',
       'limited', false, false, NULL
FROM pairs
ON CONFLICT (country_code) DO UPDATE SET currency_code = EXCLUDED.currency_code;

UPDATE public.pricing_markets
SET pricing_support_tier = 'preview', ai_estimates_enabled = true,
    replacement_search_enabled = true, serper_gl = lower(country_code)
WHERE country_code = ANY (ARRAY['AT','BE','BR','CH','DE','DK','ES','FI','FR','IE','IN','IT','JP','KR','MX','NL','NO','PT','SE','SG','ZA']);

UPDATE public.pricing_markets SET locale = v.locale, search_language = v.lang, serper_hl = v.lang
FROM (VALUES
  ('AT','de-AT','de'),('BE','nl-BE','nl'),('BR','pt-BR','pt'),('CH','de-CH','de'),
  ('DE','de-DE','de'),('DK','da-DK','da'),('ES','es-ES','es'),('FI','fi-FI','fi'),
  ('FR','fr-FR','fr'),('IE','en-IE','en'),('IN','en-IN','en'),('IT','it-IT','it'),
  ('JP','ja-JP','ja'),('KR','ko-KR','ko'),('MX','es-MX','es'),('NL','nl-NL','nl'),
  ('NO','nb-NO','no'),('PT','pt-PT','pt'),('SE','sv-SE','sv'),('SG','en-SG','en'),('ZA','en-ZA','en')
) AS v(country_code, locale, lang)
WHERE public.pricing_markets.country_code = v.country_code;

UPDATE public.pricing_markets SET
  locale = v.locale, search_language = 'en', serper_gl = lower(pricing_markets.country_code),
  serper_hl = 'en', pricing_support_tier = 'verified', ai_estimates_enabled = true,
  replacement_search_enabled = true, material_item_threshold = v.threshold
FROM (VALUES
  ('NZ','en-NZ',500::numeric),('AU','en-AU',500::numeric),('US','en-US',400::numeric),
  ('CA','en-CA',500::numeric),('GB','en-GB',300::numeric)
) AS v(country_code, locale, threshold)
WHERE public.pricing_markets.country_code = v.country_code;

ALTER TABLE public.pricing_markets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read pricing markets" ON public.pricing_markets;
CREATE POLICY "Authenticated users can read pricing markets" ON public.pricing_markets
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.pricing_markets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pricing_markets TO authenticated, service_role;

ALTER TABLE public.inventory_files
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS currency_code text;

UPDATE public.inventory_files
SET country_code = 'NZ', currency_code = 'NZD'
WHERE country_code IS NULL OR currency_code IS NULL;

ALTER TABLE public.inventory_files
  ALTER COLUMN country_code SET DEFAULT 'NZ',
  ALTER COLUMN currency_code SET DEFAULT 'NZD',
  ALTER COLUMN country_code SET NOT NULL,
  ALTER COLUMN currency_code SET NOT NULL,
  DROP CONSTRAINT IF EXISTS inventory_files_country_code_check,
  DROP CONSTRAINT IF EXISTS inventory_files_currency_code_check,
  DROP CONSTRAINT IF EXISTS inventory_files_market_currency_fkey;

ALTER TABLE public.inventory_files
  ADD CONSTRAINT inventory_files_country_code_check CHECK (country_code ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT inventory_files_currency_code_check CHECK (currency_code ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT inventory_files_market_currency_fkey
    FOREIGN KEY (country_code, currency_code)
    REFERENCES public.pricing_markets (country_code, currency_code);

CREATE OR REPLACE FUNCTION public.derive_inventory_file_market_currency()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_currency text;
BEGIN
  NEW.country_code := upper(btrim(NEW.country_code));
  SELECT pm.currency_code INTO v_currency FROM public.pricing_markets pm WHERE pm.country_code = NEW.country_code;
  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'INVALID_PROPERTY_COUNTRY' USING ERRCODE = '22023';
  END IF;
  NEW.currency_code := v_currency;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS derive_inventory_file_market_currency ON public.inventory_files;
CREATE TRIGGER derive_inventory_file_market_currency
BEFORE INSERT OR UPDATE OF country_code, currency_code ON public.inventory_files
FOR EACH ROW EXECUTE FUNCTION public.derive_inventory_file_market_currency();
ALTER FUNCTION public.derive_inventory_file_market_currency() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.derive_inventory_file_market_currency() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS estimated_currency text,
  ADD COLUMN IF NOT EXISTS valuation_market text,
  ADD COLUMN IF NOT EXISTS estimated_at timestamptz,
  ADD COLUMN IF NOT EXISTS original_purchase_currency text,
  ADD COLUMN IF NOT EXISTS web_listing_currency text,
  ADD COLUMN IF NOT EXISTS web_listing_price_raw text,
  ADD COLUMN IF NOT EXISTS web_listing_fulfilment_type text;

UPDATE public.inventory_items
SET
  unit_estimated_price = estimated_price,
  estimated_price =
    estimated_price * GREATEST(COALESCE(quantity, 1), 1)
WHERE unit_estimated_price IS NULL
  AND estimated_price IS NOT NULL;

UPDATE public.inventory_items
SET unit_estimated_price = NULL,
    estimated_price = NULL
WHERE COALESCE(unit_estimated_price, estimated_price) <= 0;

UPDATE public.inventory_items
SET estimated_currency = COALESCE(estimated_currency, 'NZD'),
    valuation_market = COALESCE(valuation_market, 'NZ')
WHERE estimated_price IS NOT NULL OR unit_estimated_price IS NOT NULL;

UPDATE public.inventory_items
SET original_purchase_currency = COALESCE(original_purchase_currency, 'NZD')
WHERE original_purchase_price IS NOT NULL;

UPDATE public.inventory_items
SET web_listing_currency = COALESCE(web_listing_currency, 'NZD')
WHERE web_listing_price IS NOT NULL;

ALTER TABLE public.inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_estimated_currency_check,
  DROP CONSTRAINT IF EXISTS inventory_items_valuation_market_check,
  DROP CONSTRAINT IF EXISTS inventory_items_original_purchase_currency_check,
  DROP CONSTRAINT IF EXISTS inventory_items_web_listing_currency_check,
  DROP CONSTRAINT IF EXISTS inventory_items_fulfilment_type_check;

ALTER TABLE public.inventory_items
  ADD CONSTRAINT inventory_items_estimated_currency_check CHECK (estimated_currency IS NULL OR estimated_currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT inventory_items_valuation_market_check CHECK (valuation_market IS NULL OR valuation_market ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT inventory_items_original_purchase_currency_check CHECK (original_purchase_currency IS NULL OR original_purchase_currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT inventory_items_web_listing_currency_check CHECK (web_listing_currency IS NULL OR web_listing_currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT inventory_items_fulfilment_type_check CHECK (web_listing_fulfilment_type IS NULL OR web_listing_fulfilment_type IN ('local','overseas','unknown'));

ALTER TABLE public.claim_packs
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS currency_code text,
  ADD COLUMN IF NOT EXISTS summary_currency text;

ALTER TABLE public.claim_packs
  DROP CONSTRAINT IF EXISTS claim_packs_country_code_check,
  DROP CONSTRAINT IF EXISTS claim_packs_currency_code_check,
  DROP CONSTRAINT IF EXISTS claim_packs_summary_currency_check;

ALTER TABLE public.claim_packs
  ADD CONSTRAINT claim_packs_country_code_check CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT claim_packs_currency_code_check CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT claim_packs_summary_currency_check CHECK (summary_currency IS NULL OR summary_currency ~ '^[A-Z]{3}$');

CREATE OR REPLACE FUNCTION public.create_my_property(
  p_name text,
  p_country_code text,
  p_property_type text DEFAULT NULL,
  p_contents_sum_insured numeric DEFAULT NULL,
  p_insurer_name text DEFAULT NULL,
  p_policy_number text DEFAULT NULL,
  p_property_cover_image_url text DEFAULT NULL
)
RETURNS public.inventory_files
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_allowance record;
  v_next_file_number bigint;
  v_now timestamptz := now();
  v_market public.pricing_markets%ROWTYPE;
  v_row public.inventory_files%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'PROPERTY_NAME_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_contents_sum_insured IS NULL OR p_contents_sum_insured <= 0 THEN
    RAISE EXCEPTION 'CONTENTS_COVER_REQUIRED' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_market FROM public.pricing_markets
  WHERE country_code = upper(btrim(p_country_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_PROPERTY_COUNTRY' USING ERRCODE = '22023',
      DETAIL = jsonb_build_object('countryCode', upper(btrim(COALESCE(p_country_code, ''))))::text;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));
  SELECT * INTO v_allowance FROM public.coverly_property_allowance_for_user(v_user_id);
  IF NOT v_allowance.can_create_property THEN
    PERFORM public.raise_property_limit_reached(v_allowance.property_count, v_allowance.property_limit);
  END IF;

  SELECT COALESCE(max(file_number), 0) + 1 INTO v_next_file_number
  FROM public.inventory_files WHERE user_id = v_user_id;

  INSERT INTO public.inventory_files (
    id, user_id, file_number, name, status, property_type, created_by_email,
    created_date, last_modified, contents_sum_insured, insurer_name,
    policy_number, property_cover_image_url, country_code, currency_code
  ) VALUES (
    gen_random_uuid()::text, v_user_id, v_next_file_number, btrim(p_name), 'active',
    NULLIF(btrim(p_property_type), ''), NULLIF(auth.jwt() ->> 'email', ''), v_now, v_now,
    p_contents_sum_insured, NULLIF(btrim(p_insurer_name), ''),
    NULLIF(btrim(p_policy_number), ''), NULLIF(btrim(p_property_cover_image_url), ''),
    v_market.country_code, v_market.currency_code
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_my_property(
  p_property_id text,
  p_name text,
  p_country_code text,
  p_property_type text DEFAULT NULL,
  p_contents_sum_insured numeric DEFAULT NULL,
  p_insurer_name text DEFAULT NULL,
  p_policy_number text DEFAULT NULL,
  p_property_cover_image_url text DEFAULT NULL
)
RETURNS public.inventory_files
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_market public.pricing_markets%ROWTYPE;
  v_row public.inventory_files%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'PROPERTY_NAME_REQUIRED' USING ERRCODE = '22023'; END IF;
  IF p_contents_sum_insured IS NULL OR p_contents_sum_insured <= 0 THEN RAISE EXCEPTION 'CONTENTS_COVER_REQUIRED' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_market FROM public.pricing_markets WHERE country_code = upper(btrim(p_country_code));
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PROPERTY_COUNTRY' USING ERRCODE = '22023'; END IF;

  UPDATE public.inventory_files SET
    name = btrim(p_name), property_type = NULLIF(btrim(p_property_type), ''),
    contents_sum_insured = p_contents_sum_insured, insurer_name = NULLIF(btrim(p_insurer_name), ''),
    policy_number = NULLIF(btrim(p_policy_number), ''),
    property_cover_image_url = NULLIF(btrim(p_property_cover_image_url), ''),
    country_code = v_market.country_code, currency_code = v_market.currency_code,
    last_modified = now()
  WHERE id = p_property_id AND user_id = v_user_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROPERTY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_row;
END;
$$;

ALTER FUNCTION public.create_my_property(text,text,text,numeric,text,text,text) OWNER TO postgres;
ALTER FUNCTION public.update_my_property(text,text,text,text,numeric,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_my_property(text,text,text,numeric,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_my_property(text,text,text,text,numeric,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_my_property(text,text,text,numeric,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_property(text,text,text,text,numeric,text,text,text) TO authenticated;

-- Admin values are returned with explicit currency context. The primary value
-- includes only values in the property's current currency; foreign values are
-- retained in inventory_totals rather than silently added.
DROP FUNCTION IF EXISTS public.admin_list_user_files(uuid);
CREATE FUNCTION public.admin_list_user_files(p_user_id uuid)
RETURNS TABLE (
  id text, name text, property_type text, contents_sum_insured numeric,
  currency_code text, inventory_value numeric, inventory_totals jsonb,
  room_count integer, item_count integer, claim_pack_count integer, updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_current_user_admin();
  RETURN QUERY
  SELECT f.id::text, f.name::text, f.property_type::text, f.contents_sum_insured,
    f.currency_code,
    COALESCE((SELECT sum(COALESCE(i.unit_estimated_price, i.estimated_price, 0) * GREATEST(COALESCE(i.quantity,1),1))
      FROM public.inventory_items i WHERE i.file_id=f.id AND COALESCE(i.estimated_currency,f.currency_code)=f.currency_code),0)::numeric,
    COALESCE((SELECT jsonb_object_agg(grouped.currency_code, grouped.total)
      FROM (SELECT COALESCE(i.estimated_currency,f.currency_code) AS currency_code,
        sum(COALESCE(i.unit_estimated_price, i.estimated_price, 0) * GREATEST(COALESCE(i.quantity,1),1))::numeric AS total
        FROM public.inventory_items i WHERE i.file_id=f.id GROUP BY COALESCE(i.estimated_currency,f.currency_code)) grouped), '{}'::jsonb),
    (SELECT count(*)::integer FROM public.inventory_rooms r WHERE r.file_id=f.id),
    (SELECT count(*)::integer FROM public.inventory_items i WHERE i.file_id=f.id),
    (SELECT count(*)::integer FROM public.claim_packs cp WHERE cp.file_id::text=f.id::text),
    COALESCE(f.last_modified,f.created_date)::timestamptz
  FROM public.inventory_files f WHERE f.user_id=p_user_id
  ORDER BY COALESCE(f.last_modified,f.created_date) DESC NULLS LAST;
END;
$$;
ALTER FUNCTION public.admin_list_user_files(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_list_user_files(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_user_files(uuid) TO authenticated, service_role;

COMMENT ON COLUMN public.inventory_files.currency_code IS 'Server-derived ISO 4217 snapshot for this property market.';
COMMENT ON COLUMN public.inventory_items.estimated_currency IS 'Currency of the stored replacement estimate; may differ from the current property currency.';
COMMENT ON COLUMN public.inventory_items.estimated_at IS 'Genuine valuation timestamp. Historic unknown timestamps remain null.';

NOTIFY pgrst, 'reload schema';

COMMIT;
