/**
 * Supabase Edge Function: voice-command  (POC / dev-only)
 * v1.0.0
 *
 * Two-step:
 *   1. Transcribe audio via gpt-4o-transcribe (same as voice-describe)
 *   2. Parse transcript into a structured VoiceCommand intent via gpt-4.1-mini
 *
 * Deploy:
 *   npx supabase functions deploy voice-command
 *
 * Requires the same OPENAI_API_KEY secret as voice-describe.
 * Auth: Supabase platform verifies Bearer JWT before handler runs.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const EDGE_VERSION = 'v1.0.0-poc';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

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

const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

interface VoiceCommandRequest {
  audioBase64: string;
  mimeType: string;
  ext?: string;
  /** Property names from useInventory().files — for context injection */
  knownProperties?: string[];
  /** Room names available across all properties */
  knownRooms?: string[];
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const origin = req.headers.get('origin') ?? '';
  const openAiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openAiKey) return jsonResponse({ success: false, error: 'OPENAI_API_KEY not set' }, 500);

  // Auth check
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return jsonResponse({ success: false, error: 'Unauthorized' }, 401);

  try {
    const sbClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: userData, error: authErr } = await sbClient.auth.getUser(jwt);
    if (authErr || !userData?.user) return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
  } catch {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
  }

  let body: VoiceCommandRequest;
  try {
    body = await req.json() as VoiceCommandRequest;
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }

  if (!body.audioBase64?.trim()) return jsonResponse({ success: false, error: 'audioBase64 required' }, 400);
  if (!/^[A-Za-z0-9+/=]+$/.test(body.audioBase64.slice(0, 100))) {
    return jsonResponse({ success: false, error: 'audioBase64 invalid' }, 400);
  }

  const diagnostics: Record<string, unknown> = { edgeVersion: EDGE_VERSION };

  try {
    const ext = body.ext ?? (body.mimeType?.includes('ogg') ? 'ogg' : 'webm');
    const mimeType = body.mimeType ?? 'audio/webm';
    const binaryStr = atob(body.audioBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    const audioBlob = new Blob([bytes], { type: mimeType });
    diagnostics.audioSizeKb = Math.round(audioBlob.size / 1024);

    // ── Step 1: Transcribe ────────────────────────────────────────────────────
    const formData = new FormData();
    formData.append('file', new File([audioBlob], `recording.${ext}`, { type: mimeType }));
    formData.append('model', 'gpt-4o-transcribe');
    formData.append('response_format', 'text');
    formData.append('prompt',
      'This is a spoken navigation or setup command for a home inventory app. ' +
      'The user may say things like: open a property, create a property, add a room, ' +
      'start scanning, prepare a scan. Property and room names may be addresses or casual names.'
    );

    const transcribeRes = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${openAiKey}` },
      body: formData,
    });
    diagnostics.transcribeStatus = transcribeRes.status;
    if (!transcribeRes.ok) {
      const errText = await transcribeRes.text();
      return jsonResponse({ success: false, error: 'Transcription failed', detail: errText.slice(0, 300) }, 502);
    }

    const transcript = (await transcribeRes.text()).trim();
    if (!transcript) return jsonResponse({ success: false, error: 'Empty transcript' }, 502);
    diagnostics.transcriptLength = transcript.length;
    console.log(`[voice-command] transcript: "${transcript}"`);

    // ── Step 2: Intent parse ──────────────────────────────────────────────────
    const knownPropsStr = (body.knownProperties ?? []).join(', ') || 'none';
    const knownRoomsStr = (body.knownRooms ?? []).join(', ') || 'none';

    const systemPrompt = `You are a voice command parser for Coverly, a home contents insurance inventory app.

The user speaks a navigation or setup command. Parse it into structured JSON.

Known properties in the app: ${knownPropsStr}
Known rooms across all properties: ${knownRoomsStr}

Return ONLY valid JSON matching this exact schema (no markdown, no explanation):
{
  "intent": one of: "open_property" | "open_room" | "create_property" | "prepare_scan" | "prepare_room_scan" | "unknown" | "needs_clarification",
  "propertyName": string or null,
  "roomName": string or null,
  "scanMode": one of: "single_photo" | "multi_photo" | "video" | "single_item" | null,
  "confidence": float 0.0–1.0,
  "requiresConfirmation": boolean,
  "needsClarification": boolean,
  "clarificationReason": string or null
}

Intent rules — choose EXACTLY ONE, in this priority order:
1. open_property: user says "open", "go to", "show", "take me to" + a PROPERTY name only (no room mentioned)
2. open_room: user says "open", "go to", "show", "take me to" + a ROOM name (with or without property). No scanning requested. Example: "Open the games room in Waiheke" → open_room.
3. create_property: user wants to create a NEW property ("create", "add", "new property called...")
4. prepare_scan: user explicitly mentions scanning/capturing ("scan", "start scanning", "photo scan", "video scan", "single item scan") in a room — scan intent is CLEAR
5. prepare_room_scan: user wants to add/prepare a NEW room AND scan in it (combined intent — both creating a room AND scanning)
6. needs_clarification: intent is ambiguous or critical info is missing
7. unknown: cannot determine intent at all

KEY DISTINCTION — open_room vs prepare_scan:
- "Open the games room" → open_room (navigation only, no scan)
- "Start a scan in the games room" → prepare_scan (explicit scan request)
- "Go to the kitchen" → open_room
- "Scan the kitchen" → prepare_scan
- "Take me to the lounge" → open_room
- When in doubt between open_room and prepare_scan: if the user says "open", "go to", "show me", "take me to" WITHOUT any scan/photo/camera keyword → open_room

Scan mode mapping (only relevant for prepare_scan and prepare_room_scan):
- "single photo", "one photo", "photo scan" → single_photo
- "multi photo", "multiple photos", "multi-photo" → multi_photo
- "video", "video scan", "walk through" → video
- "single item", "one item", "barcode" → single_item
- not mentioned → null

requiresConfirmation:
- true for: create_property, prepare_room_scan
- false for: open_property, open_room, prepare_scan

needsClarification: true if intent is ambiguous or critical info is missing
Be conservative: if confidence < 0.6, set needsClarification=true.`;

    const chatRes = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        temperature: 0,
        max_tokens: 300,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Spoken command: "${transcript}"` },
        ],
        response_format: { type: 'json_object' },
      }),
    });
    diagnostics.chatStatus = chatRes.status;
    if (!chatRes.ok) {
      const errText = await chatRes.text();
      return jsonResponse({ success: false, error: 'Intent parse failed', detail: errText.slice(0, 300) }, 502);
    }

    const chatJson = await chatRes.json() as { choices?: Array<{ message?: { content?: string } }> };
    const rawContent = chatJson.choices?.[0]?.message?.content ?? '{}';
    console.log(`[voice-command] raw intent JSON: ${rawContent}`);

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      return jsonResponse({ success: false, error: 'Failed to parse intent JSON', rawContent }, 502);
    }

    return jsonResponse({
      success: true,
      transcript,
      parsed,
      diagnostics,
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[voice-command] error:', msg);
    return jsonResponse({ success: false, error: msg, diagnostics }, 500);
  }
});
