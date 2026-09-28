import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { createScanHandler } from './handler.ts';

serve(createScanHandler(createClient, (key) => Deno.env.get(key)));
