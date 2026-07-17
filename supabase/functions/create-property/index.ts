/**
 * Supabase Edge Function: create-property
 *
 * Legacy HTTP wrapper that delegates persistence and plan enforcement to the
 * authoritative create_my_property RPC.
 *
 * Deploy:
 *   npx supabase functions deploy create-property --no-verify-jwt
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    // Extract user JWT from the Authorization header
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!jwt) {
      return jsonResponse({ error: 'Missing Authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Forward the caller's JWT so auth.uid() is available inside the RPC.
    const callerClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    // Verify the caller's JWT and resolve their user_id
    const { data: { user }, error: authError } = await callerClient.auth.getUser(jwt);
    if (authError || !user) {
      return jsonResponse({ error: 'Invalid or expired token' }, 401);
    }

    // Parse request body
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const name = typeof body.name === 'string' ? body.name.trim() : null;
    if (!name) {
      return jsonResponse({ error: 'name is required' }, 400);
    }
    const countryCode = typeof body.country_code === 'string' ? body.country_code.trim().toUpperCase() : 'NZ';
    if (!/^[A-Z]{2}$/.test(countryCode)) {
      return jsonResponse({ error: 'INVALID_PROPERTY_COUNTRY', code: 'INVALID_PROPERTY_COUNTRY' }, 400);
    }

    // The RPC owns allowance checks, locking, file-number allocation and insert.
    const { data, error: insertError } = await callerClient
      .rpc('create_my_property', {
        p_name: name,
        p_country_code: countryCode,
        p_property_type: typeof body.property_type === 'string' ? body.property_type : null,
        p_contents_sum_insured: typeof body.contents_sum_insured === 'number' ? body.contents_sum_insured : null,
        p_insurer_name: typeof body.insurer_name === 'string' ? body.insurer_name : null,
        p_policy_number: typeof body.policy_number === 'string' ? body.policy_number : null,
        p_property_cover_image_url: typeof body.property_cover_image_url === 'string' ? body.property_cover_image_url : null,
      })
      .single();

    if (insertError) {
      const propertyLimit = insertError.message.includes('PROPERTY_LIMIT_REACHED');
      const invalidCountry = insertError.message.includes('INVALID_PROPERTY_COUNTRY');
      return jsonResponse({
        error: propertyLimit ? 'PROPERTY_LIMIT_REACHED' : invalidCountry ? 'INVALID_PROPERTY_COUNTRY' : 'Could not create property',
        code: propertyLimit ? 'PROPERTY_LIMIT_REACHED' : invalidCountry ? 'INVALID_PROPERTY_COUNTRY' : insertError.code,
        details: propertyLimit ? insertError.details : undefined,
      }, propertyLimit ? 409 : invalidCountry ? 400 : 500);
    }

    return jsonResponse({ data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: msg }, 500);
  }
});
