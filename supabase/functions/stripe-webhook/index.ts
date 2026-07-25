/**
 * Supabase Edge Function: stripe-webhook
 * v1.3.0
 *
 * Receives Stripe webhook events, verifies the signature, and syncs
 * user_profiles in Coverly Supabase.
 *
 * Deploy (JWT verification DISABLED — Stripe calls this, not app users):
 *   npx supabase functions deploy stripe-webhook --no-verify-jwt
 *
 * Secrets required:
 *   STRIPE_SECRET_KEY      — used to fetch Stripe customer email as fallback identifier
 *   STRIPE_WEBHOOK_SECRET  — for signature verification
 *   SUPABASE_URL           — auto-provided by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY — for bypassing RLS
 *
 * Register in Stripe Dashboard → Webhooks → Add endpoint:
 *   URL: https://<project-ref>.supabase.co/functions/v1/stripe-webhook
 *   Events: checkout.session.completed, customer.subscription.created,
 *           customer.subscription.updated, customer.subscription.deleted,
 *           invoice.paid, invoice.payment_failed
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const EDGE_VERSION = 'v1.3.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';

// ── Price ID → plan mapping (must match billing-page.tsx) ────────────────────
const PRICE_TO_PLAN: Record<string, string> = {
  'price_1TNsipQgKwfPpyjpCRYTOQXM': 'coverly_plus',   // Plus monthly
  'price_1TNsjlQgKwfPpyjpKmcBqBRs': 'coverly_plus',   // Plus annual
  'price_1TNsl4QgKwfPpyjpgMriXcTR': 'coverly_family', // Family monthly
  'price_1TNsmSQgKwfPpyjpzxEE9t5A': 'coverly_family', // Family annual
};

// Claims Pack one-off price ID — purchasing creates a claim_pack_token, not a subscription
const CLAIMS_PACK_PRICE_ID = 'price_1TNsnkQgKwfPpyjpsaUlUhkz';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Stripe signature verification (manual — no Stripe SDK in Deno) ────────────
async function verifyStripeSignature(body: string, sigHeader: string, secret: string): Promise<boolean> {
  try {
    const parts = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')));
    const timestamp = parts['t'];
    const sig = parts['v1'];
    if (!timestamp || !sig) return false;

    const payload = `${timestamp}.${body}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signatureBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    const computed = Array.from(new Uint8Array(signatureBytes))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return computed === sig;
  } catch (e) {
    console.error('[stripe-webhook] signature verification error:', e);
    return false;
  }
}

// ── Fetch Stripe customer email as last-resort identifier ─────────────────────
async function fetchStripeCustomerEmail(customerId: string): Promise<string | null> {
  if (!STRIPE_SECRET_KEY || !customerId) return null;
  try {
    const resp = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
      headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` },
    });
    if (!resp.ok) {
      console.warn('[stripe-webhook] Stripe customer fetch failed:', resp.status);
      return null;
    }
    const customer = await resp.json() as { email?: string };
    console.log('[stripe-webhook] Stripe customer email:', customer.email ?? 'none');
    return customer.email ?? null;
  } catch (e) {
    console.error('[stripe-webhook] error fetching Stripe customer:', e);
    return null;
  }
}

// ── Map a Stripe subscription object to user_profiles columns ────────────────
function subscriptionToPatch(sub: Record<string, unknown>): {
  patch: Record<string, unknown>;
  priceId: string | null;
  plan: string | null;
} {
  const item = (sub.items as any)?.data?.[0];
  const priceId = (item?.price?.id as string | undefined) ?? null;
  const plan = (priceId && PRICE_TO_PLAN[priceId]) ?? null;
  const periodEnd = sub.current_period_end
    ? new Date((sub.current_period_end as number) * 1000).toISOString()
    : null;
  return {
    priceId,
    plan,
    patch: {
      subscription_plan: plan,
      subscription_status: sub.status as string,
      subscription_period_end: periodEnd,
      stripe_subscription_id: sub.id as string,
    },
  };
}

// ── Update user_profiles — returns number of rows updated ───────────────────
// FIX v1.2.0: In Supabase JS v2, .eq() must chain AFTER .update(), not after .from().
// Correct chain: supabase.from(table).update(data).eq(col, val).select(cols)
// Wrong chain:   supabase.from(table).eq(col, val)  ← TypeError: .eq is not a function
async function updateProfile(
  supabase: ReturnType<typeof createClient>,
  identifiers: { customerId?: string; userId?: string; email?: string },
  patch: Record<string, unknown>,
  context: string,
): Promise<number> {
  const updateData = { ...patch, updated_at: new Date().toISOString() };
  const RETURN_COLS = 'id,email,plan,subscription_plan,subscription_status,stripe_customer_id,stripe_subscription_id';

  async function attempt(label: string, col: string, val: string): Promise<number> {
    // Correct chain: .update().eq().select()
    const result = await supabase
      .from('user_profiles')
      .update(updateData)
      .eq(col, val)
      .select(RETURN_COLS);
    if (result.error) {
      console.error(`[stripe-webhook][${context}] update error (${label}):`, result.error.message, result.error);
      return 0;
    }
    const count = (result.data ?? []).length;
    if (count === 0) {
      console.warn(`[stripe-webhook][${context}] ⚠️  NO ROWS updated by ${label} — "${col}"="${val}" not found in user_profiles`);
    } else {
      console.log(`[stripe-webhook][${context}] ✅ ${count} row(s) updated by ${label}:`, JSON.stringify(result.data));
    }
    return count;
  }

  // Try identifiers in priority order: user_id > stripe_customer_id > email
  if (identifiers.userId) {
    console.log(`[stripe-webhook][${context}] trying user_id:`, identifiers.userId);
    const n = await attempt('user_id', 'id', identifiers.userId);
    if (n > 0) return n;
    console.warn(`[stripe-webhook][${context}] user_id match failed — falling through`);
  }

  if (identifiers.customerId) {
    console.log(`[stripe-webhook][${context}] trying stripe_customer_id:`, identifiers.customerId);
    const n = await attempt('stripe_customer_id', 'stripe_customer_id', identifiers.customerId);
    if (n > 0) return n;
    console.warn(`[stripe-webhook][${context}] stripe_customer_id match failed — falling through`);
  }

  if (identifiers.email) {
    console.log(`[stripe-webhook][${context}] trying email:`, identifiers.email);
    const n = await attempt('email', 'email', identifiers.email);
    if (n > 0) return n;
    console.warn(`[stripe-webhook][${context}] email match failed`);
  }

  console.error(`[stripe-webhook][${context}] ❌ ALL identifiers exhausted — user_profiles NOT updated. identifiers:`, JSON.stringify(identifiers));
  return 0;
}

// ── Main handler ─────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  console.log(`[stripe-webhook] ${EDGE_VERSION} ${req.method}`);

  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const rawBody = await req.text();
  const sigHeader = req.headers.get('stripe-signature') ?? '';

  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET not set');
    return json({ error: 'Webhook secret not configured' }, 500);
  }

  const valid = await verifyStripeSignature(rawBody, sigHeader, STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    console.warn('[stripe-webhook] invalid signature');
    return json({ error: 'Invalid signature' }, 400);
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const eventType = event.type as string;
  const eventObject = event.data as Record<string, unknown>;
  const obj = eventObject?.object as Record<string, unknown>;

  console.log(`[stripe-webhook] ── event: ${eventType} ──`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  switch (eventType) {

    // ── checkout.session.completed ──────────────────────────────────────────
    case 'checkout.session.completed': {
      const session = obj;
      const customerId = session.customer as string | undefined;
      const subscriptionId = session.subscription as string | undefined;
      const sessionId = session.id as string | undefined;
      const paymentIntent = session.payment_intent as string | undefined;
      const userId = (session.metadata as any)?.user_id as string | undefined;
      const email = (session.metadata as any)?.email as string | undefined
        ?? (session.customer_details as any)?.email as string | undefined;
      const productType = (session.metadata as any)?.product_type as string | undefined;
      const mode = session.mode as string | undefined;

      console.log(`[stripe-webhook][checkout.session.completed] customerId=${customerId} subscriptionId=${subscriptionId} sessionId=${sessionId} userId=${userId} email=${email} productType=${productType} mode=${mode}`);

      // ── Claims Pack one-off purchase → create a claim_pack_token ──────────
      // Detected by: mode=payment AND product_type=claims_pack in metadata
      if (mode === 'payment' && productType === 'claims_pack') {
        const tokenEmail = email ?? (customerId ? await fetchStripeCustomerEmail(customerId) ?? '' : '');
        const tokenUserId = userId ?? null;

        console.log(`[stripe-webhook][checkout.session.completed] 🎟️  creating claim_pack_token for user_id=${tokenUserId} email=${tokenEmail} session=${sessionId}`);

        const { data: tokenData, error: tokenError } = await supabase
          .from('claim_pack_tokens')
          .insert({
            user_id: tokenUserId,
            user_email: tokenEmail,
            status: 'available',
            stripe_session_id: sessionId ?? null,
            stripe_payment_intent_id: paymentIntent ?? null,
          })
          .select('id, status, user_email')
          .single();

        if (tokenError) {
          console.error(`[stripe-webhook] ❌ failed to create claim_pack_token:`, tokenError.message, tokenError);
        } else {
          console.log(`[stripe-webhook] ✅ claim_pack_token created:`, JSON.stringify(tokenData));
        }
        break;
      }

      // ── Subscription checkout → update user_profiles ───────────────────────
      const patch: Record<string, unknown> = {
        stripe_customer_id: customerId,
        subscription_status: 'active',
      };
      if (subscriptionId) patch.stripe_subscription_id = subscriptionId;

      let effectiveEmail = email;
      if (!userId && !effectiveEmail && customerId) {
        effectiveEmail = await fetchStripeCustomerEmail(customerId) ?? undefined;
      }

      await updateProfile(supabase, { userId, customerId, email: effectiveEmail }, patch, 'checkout.session.completed');
      break;
    }

    // ── customer.subscription.created / updated ─────────────────────────────
    // This is the authoritative plan-writing event (plan comes from price ID, never metadata)
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = obj;
      const customerId = sub.customer as string;
      const subscriptionId = sub.id as string;
      // subscription.metadata.user_id is set via subscription_data.metadata at checkout creation
      const userId = (sub.metadata as any)?.user_id as string | undefined;
      const { patch, priceId, plan } = subscriptionToPatch(sub);
      // Also write the legacy plan column
      const planPatch: Record<string, unknown> = { ...patch };
      if (plan) planPatch.plan = plan;

      console.log(`[stripe-webhook][${eventType}] customerId=${customerId} subscriptionId=${subscriptionId} userId=${userId} priceId=${priceId} derivedPlan=${plan} status=${sub.status}`);

      if (!plan) {
        console.warn(`[stripe-webhook][${eventType}] ⚠️  priceId "${priceId}" not in PRICE_TO_PLAN allowlist — subscription_plan will be null`);
        console.warn(`[stripe-webhook][${eventType}] Known price IDs: ${Object.keys(PRICE_TO_PLAN).join(', ')}`);
      }

      // Cascade: userId → customerId → Stripe customer email
      let email: string | undefined;
      if (!userId) {
        email = await fetchStripeCustomerEmail(customerId) ?? undefined;
        if (email) console.log(`[stripe-webhook][${eventType}] email fallback via Stripe customer: ${email}`);
      }

      await updateProfile(supabase, { userId, customerId, email }, planPatch, eventType);
      break;
    }

    // ── customer.subscription.deleted ────────────────────────────────────────
    case 'customer.subscription.deleted': {
      const sub = obj;
      const customerId = sub.customer as string;
      const userId = (sub.metadata as any)?.user_id as string | undefined;

      console.log(`[stripe-webhook][customer.subscription.deleted] customerId=${customerId} userId=${userId}`);

      let email: string | undefined;
      if (!userId) {
        email = await fetchStripeCustomerEmail(customerId) ?? undefined;
      }

      await updateProfile(supabase, { userId, customerId, email }, {
        subscription_plan: null,
        subscription_status: 'cancelled',
        plan: 'free',
        stripe_subscription_id: null,
      }, 'customer.subscription.deleted');
      break;
    }

    // ── invoice.paid ─────────────────────────────────────────────────────────
    case 'invoice.paid': {
      const inv = obj;
      const customerId = inv.customer as string;
      const subscriptionId = inv.subscription as string | undefined;
      const periodEnd = (inv.lines as any)?.data?.[0]?.period?.end as number | undefined;

      console.log(`[stripe-webhook][invoice.paid] customerId=${customerId} subscriptionId=${subscriptionId} periodEnd=${periodEnd}`);

      const patch: Record<string, unknown> = { subscription_status: 'active' };
      if (subscriptionId) patch.stripe_subscription_id = subscriptionId;
      if (periodEnd) patch.subscription_period_end = new Date(periodEnd * 1000).toISOString();

      await updateProfile(supabase, { customerId }, patch, 'invoice.paid');
      break;
    }

    // ── invoice.payment_failed ───────────────────────────────────────────────
    case 'invoice.payment_failed': {
      const inv = obj;
      const customerId = inv.customer as string;
      console.log(`[stripe-webhook][invoice.payment_failed] customerId=${customerId}`);
      await updateProfile(supabase, { customerId }, { subscription_status: 'past_due' }, 'invoice.payment_failed');
      break;
    }

    default:
      console.log(`[stripe-webhook] unhandled event type: ${eventType}`);
  }

  return json({ received: true, version: EDGE_VERSION });
});
