import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

function getServiceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  try {
    // 1. Read raw body for signature verification
    const rawBody = await request.text();
    console.log('[Najiki Webhook] Raw payload received:', rawBody.substring(0, 200));

    // 2. Verify Najiki webhook signature (Fail-Closed)
    const apiKey = process.env.NAJIKI_WEBHOOK_SECRET || process.env.NAJIKI_API_KEY;
    const incomingSig = request.headers.get('x-najiki-signature') || '';

    if (!apiKey) {
      console.error('[Najiki Webhook] NAJIKI_WEBHOOK_SECRET / NAJIKI_API_KEY not set — rejecting webhook');
      return NextResponse.json({ error: 'Webhook secret unconfigured' }, { status: 500 });
    }

    if (!incomingSig) {
      console.error('[Najiki Webhook] Missing signature header — rejected');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const expectedSig = crypto
      .createHmac('sha256', apiKey)
      .update(rawBody)
      .digest('hex');

    const normalizedSig = incomingSig.replace(/^sha256=/, '');

    if (
      expectedSig.length !== normalizedSig.length ||
      !crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(normalizedSig))
    ) {
      console.error('[Najiki Webhook] Invalid signature — rejected');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 3. Parse the payload
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch (parseErr) {
      console.error('[Najiki Webhook] Failed to parse JSON:', parseErr);
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    console.log('[Najiki Webhook] Parsed payload event:', payload.eventType || payload.status);

    const db = getServiceDb();

    // Handle SMS Delivery Updates from Najiki
    if (payload.eventType === 'SMS_DELIVERY_UPDATE') {
      const { smsId, reference: smsRef, status: smsStatus, providerId } = payload;
      console.log(`[Najiki Webhook] SMS Delivery Update for ${smsRef || smsId}: ${smsStatus}`);

      // F-05: validate before use - these values arrive in the request body.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const KEY_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
      const safeId = typeof smsId === 'string' && UUID_RE.test(smsId) ? smsId : null;
      const safeRef = typeof smsRef === 'string' && KEY_RE.test(smsRef) ? smsRef : null;

      if (safeId || safeRef) {
        const updateObj = {
          status: smsStatus?.toUpperCase() === 'DELIVERED' ? 'DELIVERED' : smsStatus?.toUpperCase() === 'FAILED' ? 'FAILED' : smsStatus,
          message_provider_status: smsStatus,
          provider_message_id: providerId || smsId,
          updated_at: new Date().toISOString()
        };

        // Resolve the owning tenant from the row itself, then update with an
        // explicit predicate on each candidate column - no string-built filters.
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
      }

      return NextResponse.json({ received: true, eventType: 'SMS_DELIVERY_UPDATE' });
    }

    // Extract key fields from Najiki payment payload
    const { paymentIntentId, reference, status, amount, externalEntityId, providerPaymentId, failureReason, tenantCode, idempotencyKey } = payload;

    // Resolve tenant using tenantCode if available
    let resolvedTenantId: string | null = null;
    if (tenantCode && typeof tenantCode === 'string') {
      const { data: tenant, error: tenantError } = await db
        .from('tenants')
        .select('id')
        .eq('code', tenantCode.trim())
        .maybeSingle();

      if (!tenantError && tenant) {
        resolvedTenantId = tenant.id;
        console.log('[Najiki Webhook] Resolved tenant via tenantCode:', tenantCode, '→', tenant.id);
      }
    }

    // MT-08: Safe exact queries in sequence without string interpolation
    let tx: any = null;

    if (reference && typeof reference === 'string') {
      const { data } = await db.from('wallet_transactions').select('*').eq('reference_code', reference.trim()).maybeSingle();
      if (data) tx = data;
    }

    if (!tx && idempotencyKey && typeof idempotencyKey === 'string') {
      const { data } = await db.from('wallet_transactions').select('*').eq('idempotency_key', idempotencyKey.trim()).maybeSingle();
      if (data) tx = data;
    }

    if (!tx && paymentIntentId && typeof paymentIntentId === 'string') {
      const { data } = await db.from('wallet_transactions').select('*').eq('reference_code', paymentIntentId.trim()).maybeSingle();
      if (data) tx = data;
    }

    if (!tx) {
      console.warn('[Najiki Webhook] Transaction not found for reference:', reference, 'or paymentIntentId:', paymentIntentId);
      return NextResponse.json({ received: true }, { status: 200 });
    }

    // MT-08: If tenantCode was provided in payload, require it to match tx.tenant_id
    if (resolvedTenantId && resolvedTenantId !== tx.tenant_id) {
      console.error(`[Najiki Webhook] Tenant mismatch! Payload resolved tenant ${resolvedTenantId} != tx tenant ${tx.tenant_id}`);
      return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
    }

    // Underpayment guard: check webhook amount against expected transaction amount
    if (amount !== undefined && amount !== null) {
      const incomingAmount = Number(amount);
      if (!isNaN(incomingAmount) && incomingAmount < tx.amount) {
        console.error(`[Najiki Webhook] Underpayment detected! Expected ${tx.amount}, got ${incomingAmount}`);
        return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 });
      }
    }

    // Handle success
    if (status === 'success') {
      try {
        // ALWAYS pass tx.amount and tx.tenant_id (the verified database records) into process_topup_webhook
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
        console.log('[Najiki Webhook] ✅ Success! Wallet credited. Amount:', tx.amount);
        return NextResponse.json({ received: true });

      } catch (fallbackErr) {
        await handleSuccessManually(db, tx, payload);
        revalidatePath('/', 'layout');
        return NextResponse.json({ received: true });
      }
    } else if (status === 'failed') {
      // Mark as failed ONLY if currently pending (F-03)
      await db
        .from('wallet_transactions')
        .update({
          status: 'failed',
          raw_provider_response: payload,
          updated_at: new Date().toISOString()
        })
        .eq('id', tx.id)
        .eq('status', 'pending');

      console.log('[Najiki Webhook] ❌ Payment failed:', failureReason, 'Reference:', reference);
      return NextResponse.json({ received: true });

    } else {
      console.log('[Najiki Webhook] ⏳ Payment still pending:', status);
      return NextResponse.json({ received: true });
    }
  } catch (err) {
    console.error('[Najiki Webhook] Unhandled error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
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
