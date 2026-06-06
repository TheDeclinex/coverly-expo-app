/**
 * Supabase Edge Function: create-property
 *
 * Creates a new inventory_files (property) record using the service role key,
 * which bypasses RLS. The caller's JWT is verified manually to ensure only
 * authenticated users can create properties under their own user_id.
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
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Service role client — bypasses RLS for the actual insert
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Verify the caller's JWT and resolve their user_id
    const { data: { user }, error: authError } = await adminClient.auth.getUser(jwt);
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

    const now = new Date().toISOString();

    // Resolve next file_number for this user.
    // file_number is a bigint NOT NULL per-user sequential integer.
    // Using the service role client so RLS doesn't filter results — we scope
    // the query manually to the verified user_id.
    const { data: maxRow } = await adminClient
      .from('inventory_files')
      .select('file_number')
      .eq('user_id', user.id)
      .order('file_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextFileNumber = ((maxRow as { file_number?: number } | null)?.file_number ?? 0) + 1;

    const { data, error: insertError } = await adminClient
      .from('inventory_files')
      .insert({
        id: crypto.randomUUID(),
        user_id: user.id,
        file_number: nextFileNumber,
        name,
        status: typeof body.status === 'string' ? body.status : 'active',
        property_type: typeof body.property_type === 'string' ? body.property_type : null,
        created_by_email: typeof body.created_by_email === 'string' ? body.created_by_email : (user.email ?? null),
        created_date: typeof body.created_date === 'string' ? body.created_date : now,
        last_modified: typeof body.last_modified === 'string' ? body.last_modified : now,
        contents_sum_insured: typeof body.contents_sum_insured === 'number' ? body.contents_sum_insured : null,
        property_cover_image_url: null,
      })
      .select()
      .single();

    if (insertError) {
      return jsonResponse({ error: insertError.message, code: insertError.code }, 500);
    }

    return jsonResponse({ data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: msg }, 500);
  }
});
