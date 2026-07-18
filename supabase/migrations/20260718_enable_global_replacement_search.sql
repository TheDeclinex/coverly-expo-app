-- Enable best-effort retailer replacement-price search for every configured
-- ISO property country without broadening AI-generated estimate support.

BEGIN;

UPDATE public.pricing_markets
SET replacement_search_enabled = true,
    serper_gl = lower(country_code);

UPDATE public.pricing_markets
SET locale = 'bg-BG',
    search_language = 'bg',
    serper_hl = 'bg'
WHERE country_code = 'BG';

NOTIFY pgrst, 'reload schema';

COMMIT;
