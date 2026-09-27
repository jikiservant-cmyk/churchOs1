/**
 * POST /api/najiki/webhook   (also mounted at /api/webhooks/najiki)
 *
 * Receives Na'jiki Finance's outbound notifications:
 *
 *   1. Payment settlement — `{ paymentIntentId, reference, status, amount,
 *      currency, providerPaymentId, failureReason, externalEntityId, metadata }`
 *      for status ∈ success | failed | expired | cancelled.
 *   2. SMS delivery — `{ eventType: 'SMS_DELIVERY_UPDATE', smsId, reference,
 *      status, providerId, recipient, applicationCode }`.
 *
 * Both are signed identically (src/lib/notification-signature.ts in
 * najiki-finance2):
 *
 *   X-Najiki-Timestamp: <unix ms>
 *   X-Najiki-Signature: t=<unix ms>,v=<hmac>
 *   v = HMAC-SHA256(secret, "<timestamp>.<raw request body>")
 *
 * The previous implementation looked for `x-najiki-signature: sha256=<hmac of
 * the raw body>` with no timestamp — a scheme Na'jiki does not implement — so
 * every notification was rejected with 403 and no wallet was ever credited by
 * Na'jiki. Verification now lives in lib/najiki/webhook.ts and is unit-tested
 * against Na'jiki's own signer.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import {
  verifyNajikiWebhook,
  classifyNajikiWebhook,
  parsePaymentNotification,
  parseSmsDeliveryNotification,
  transactionLookupCandidates,
  notificationTenantCode,
  notificationChurchId,
  planPaymentReceiptSms,
} from '@/lib/najiki/webhook';
import { sendSingleSMS } from '@/lib/sms-actions';

export const dynamic = 'force-dynamic';

function getServiceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Statuses Na'jiki reports as a terminal failure. */
const TERMINAL_FAILURE_STATUSES = ['failed', 'expired', 'cancelled'];

export async function POST(request: Request) {
  try {
    return await handlePost(request)
  } catch (err: any) {
    // A 500 tells Na'jiki to retry, which is what we want for a transient
    // failure — and every handler below is idempotent (the wallet credit is
    // guarded by billing_events, the receipt SMS by its own key). It must never
    // be an unhandled rejection.
    console.error('[Najiki Webhook] Unhandled error:', err?.message ?? err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

async function handlePost(request: Request) {
  // 1. Read the raw body first — the HMAC covers the exact bytes received.
  const rawBody = await request.text();

  // 2. Verify the signature (fail closed, replay-protected).
  const secret = process.env.NAJIKI_WEBHOOK_SECRET || process.env.NAJIKI_API_KEY;

  if (!secret) {
    console.error('[Najiki Webhook] NAJIKI_WEBHOOK_SECRET / NAJIKI_API_KEY not set — rejecting webhook');
    return NextResponse.json({ error: 'Webhook secret unconfigured' }, { status: 500 });
  }

  const verification = verifyNajikiWebhook({ rawBody, headers: request.headers, secret });
  if (!verification.ok) {
    console.error(`[Najiki Webhook] Rejected: ${verification.reason}`);
    return NextResponse.json({ error: 'Forbidden', reason: verification.reason }, { status: 403 });
  }

  // 3. Parse the payload (only after authentication).
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (parseErr) {
    console.error('[Najiki Webhook] Failed to parse JSON:', parseErr);
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const kind = classifyNajikiWebhook(payload);

  if (kind === 'sms_delivery') {
    return handleSmsDelivery(payload);
  }

  if (kind === 'payment') {
    return handlePaymentNotification(payload);
  }

  // Unknown shape: acknowledge so Na'jiki does not retry forever, but make the
  // noise visible — a silently dropped event is how a payment goes missing.
  console.warn('[Najiki Webhook] Unrecognised payload shape, acknowledging without processing:', JSON.stringify(payload).slice(0, 500));
  return NextResponse.json({ received: true, ignored: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// SMS delivery reports
// ─────────────────────────────────────────────────────────────────────────────

async function handleSmsDelivery(payload: any) {
  const notification = parseSmsDeliveryNotification(payload)!;
  const { smsId, reference: smsRef, status: smsStatus, providerId } = notification;

  console.log(`[Najiki Webhook] SMS Delivery Update for ${smsRef || smsId}: ${smsStatus}`);

  // Validate before use — these values arrive in the request body.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const KEY_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
  const safeId = typeof smsId === 'string' && UUID_RE.test(smsId) ? smsId : null;
  const safeRef = typeof smsRef === 'string' && KEY_RE.test(smsRef) ? smsRef : null;

  if (!safeId && !safeRef) {
    console.warn('[Najiki Webhook] SMS delivery update without a usable id/reference');
    return NextResponse.json({ received: true });
  }

  const db = getServiceDb();

  const normalisedStatus =
    smsStatus?.toUpperCase() === 'DELIVERED'
      ? 'DELIVERED'
      : smsStatus?.toUpperCase() === 'FAILED'
        ? 'FAILED'
        : smsStatus;

  const updateObj = {
    status: normalisedStatus,
    message_provider_status: smsStatus,
    // Na'jiki's provider message id is the Africa's Talking id.
    provider_message_id: providerId || smsId,
    updated_at: new Date().toISOString()
  };

  // Resolve the owning tenant from the row itself, then update with an
  // explicit predicate on each candidate column — no string-built filters.
  const orConditions = [
    safeId ? `provider_message_id.eq.${safeId}` : null,
    safeRef ? `idempotency_key.eq.${safeRef}` : null,
  ].filter(Boolean).join(',');

  const { data: owners } = await db
    .schema('church')
    .from('sms_logs')
    .select('tenant_id, provider_message_id, idempotency_key')
    .or(orConditions)
    .limit(1);

  for (const owner of owners ?? []) {
    let q = db.schema('church').from('sms_logs').update(updateObj)
      .eq('tenant_id', owner.tenant_id); // tenant scope, always
    q = safeId ? q.eq('provider_message_id', safeId) : q.eq('idempotency_key', safeRef!);
    await q;
  }

  return NextResponse.json({ received: true, eventType: 'SMS_DELIVERY_UPDATE' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Payment settlement
// ─────────────────────────────────────────────────────────────────────────────

async function handlePaymentNotification(payload: any) {
  const notification = parsePaymentNotification(payload);
  if (!notification || !notification.paymentIntentId) {
    console.warn('[Najiki Webhook] Payment notification without a paymentIntentId');
    return NextResponse.json({ received: true });
  }

  const { reference, status, amount } = notification;
  const db = getServiceDb();

  // Na'jiki never echoes our own reference back at the top level, so the
  // lookup order matters: our reference (carried in metadata.churchReference),
  // then Na'jiki's reference (persisted on the row when it was created), then
  // the idempotency key.
  let tx: any = null;
  for (const candidate of transactionLookupCandidates(notification)) {
    const { data } = await db
      .from('wallet_transactions')
      .select('*')
      .eq(candidate.column, candidate.value)
      .maybeSingle();
    if (data) {
      tx = data;
      break;
    }
  }

  if (!tx) {
    console.warn(
      '[Najiki Webhook] Transaction not found for reference:', reference,
      'or paymentIntentId:', notification.paymentIntentId
    );
    return NextResponse.json({ received: true });
  }

  // Keep Na'jiki's reference on the row so a later manual reconciliation (or a
  // GET /api/payments/:reference status check) can find it.
  if (reference && tx.reference !== reference) {
    await db.from('wallet_transactions').update({ reference }).eq('id', tx.id);
  }

  // Tenant guard. Na'jiki puts tenantCode in the *metadata* we sent, not at the
  // top level of the notification.
  const tenantCode = notificationTenantCode(notification);
  if (tenantCode) {
    const { data: tenant } = await db
      .from('tenants')
      .select('id')
      .eq('code', tenantCode.trim())
      .maybeSingle();

    if (tenant && tenant.id !== tx.tenant_id) {
      console.error(`[Najiki Webhook] Tenant mismatch! Payload tenant ${tenant.id} != tx tenant ${tx.tenant_id}`);
      return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
    }
  }

  // Cross-check the church id we sent as `externalEntityId` / metadata.churchId
  // against the row we are about to credit.
  const churchId = notificationChurchId(notification);
  if (churchId && churchId !== tx.tenant_id) {
    console.error(`[Najiki Webhook] Church mismatch! Payload church ${churchId} != tx tenant ${tx.tenant_id}`);
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  // Underpayment guard: never credit more than the member actually paid.
  if (amount !== null && amount !== undefined) {
    const incomingAmount = Number(amount);
    if (!isNaN(incomingAmount) && incomingAmount < tx.amount) {
      console.error(`[Najiki Webhook] Underpayment detected! Expected ${tx.amount}, got ${incomingAmount}`);
      return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 });
    }
  }

  // ── Terminal failure ───────────────────────────────────────────────────────
  if (TERMINAL_FAILURE_STATUSES.includes(String(status).toLowerCase())) {
    await db
      .from('wallet_transactions')
      .update({
        status: 'failed',
        raw_provider_response: payload,
        note: `Na'jiki ${status}: ${notification.failureReason ?? 'no reason given'}`,
        updated_at: new Date().toISOString()
      })
      .eq('id', tx.id)
      .eq('status', 'pending');

    console.log(`[Najiki Webhook] Payment ${status}: ${notification.failureReason}, ref: ${reference}`);
    return NextResponse.json({ received: true });
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (String(status).toLowerCase() === 'success') {
    try {
      // Credit the wallet first. The receipt SMS is only ever sent after this
      // has succeeded — see planPaymentReceiptSms() and the sequencing note in
      // NAJIKI_INTEGRATION.md.
      const { data: rpcResult, error: rpcErr } = await db.rpc('process_topup_webhook', {
        p_reference: tx.reference_code || reference,
        p_tenant_id: tx.tenant_id,
        p_amount: tx.amount,
        p_payload: payload
      });

      if (rpcErr) {
        console.warn('[Najiki Webhook] process_topup_webhook RPC failed, falling back to manual:', rpcErr);
        await handleSuccessManually(db, tx, payload);
      } else {
        console.log('[Najiki Webhook] RPC succeeded:', rpcResult);
      }

      revalidatePath('/', 'layout');
      console.log('[Najiki Webhook] Success! Wallet credited. Amount:', tx.amount);

      await sendPaymentReceipt(db, notification, tx);

      return NextResponse.json({ received: true });
    } catch (fallbackErr) {
      await handleSuccessManually(db, tx, payload);
      revalidatePath('/', 'layout');
      await sendPaymentReceipt(db, notification, tx).catch(() => undefined);
      return NextResponse.json({ received: true });
    }
  }

  // Na'jiki only notifies on terminal statuses; anything else is unexpected.
  console.warn('[Najiki Webhook] Non-terminal payment status received:', status);
  return NextResponse.json({ received: true });
}

/**
 * Send the donor an SMS receipt — strictly after the payment has been confirmed
 * and the wallet credited.
 *
 * Never throws: the payment is already recorded, and a failed receipt must not
 * make Na'jiki retry the whole notification (which would re-run the credit).
 */
async function sendPaymentReceipt(db: any, notification: any, tx: any) {
  try {
    const { data: church } = await db
      .schema('church')
      .from('churches')
      .select('name, sender_id')
      .eq('id', tx.tenant_id)
      .maybeSingle();

    const plan = planPaymentReceiptSms({
      notification,
      transactionType: tx.type,
      churchName: church?.name ?? null
    });

    if (!plan) return;

    const { data: wallet } = await db
      .from('wallets')
      .select('balance, sms_rate')
      .eq('tenant_id', tx.tenant_id)
      .maybeSingle();

    if (!wallet || wallet.balance < wallet.sms_rate) {
      console.warn('[Najiki Webhook] Skipping receipt SMS: insufficient wallet balance');
      return;
    }

    const isSandbox = process.env.AT_USERNAME?.toLowerCase() === 'sandbox';
    const senderId = !isSandbox && church?.sender_id ? church.sender_id.trim() : '';

    const result = await sendSingleSMS({
      supabase: db,
      phoneNumber: plan.to,
      message: plan.message,
      churchId: tx.tenant_id,
      idempotencyKey: plan.idempotencyKey,
      senderId,
      balance: wallet
    });

    if (!result.success) {
      console.warn('[Najiki Webhook] Receipt SMS was not delivered:', result.error);
    } else {
      console.log(`[Najiki Webhook] Receipt SMS queued for ${plan.to} (${plan.idempotencyKey})`);
    }
  } catch (err: any) {
    console.error('[Najiki Webhook] Receipt SMS failed (payment is unaffected):', err?.message ?? err);
  }
}

async function handleSuccessManually(db: any, tx: any, payload: any) {
  // Idempotency guard: update status from 'pending' to 'success' atomically
  const { data: updatedTx, error: updateErr } = await db
    .from('wallet_transactions')
    .update({
      status: 'success',
      raw_provider_response: payload,
      updated_at: new Date().toISOString()
    })
    .eq('id', tx.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (updateErr || !updatedTx) {
    console.warn('[Najiki Webhook] Transaction already processed or cannot transition from pending:', tx.id);
    return;
  }

  // Increment wallet balance ONLY for the transaction's verified tenant
  await db.rpc('increment_wallet_balance', {
    p_tenant_id: tx.tenant_id,
    p_amount: tx.amount
  });

  console.log('[Najiki Webhook] Manual processing successful for tenant:', tx.tenant_id);
}
