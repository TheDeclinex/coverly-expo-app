import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { protectedRoute } from '../_shared/provider-controls.ts';
serve(protectedRoute('replacement-search-refine',()=>async()=>new Response(null,{status:410}),createClient,key=>Deno.env.get(key)));
