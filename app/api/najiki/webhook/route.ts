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

    // 2. Verify Najiki webhook signature
    const apiKey = process.env.NAJIKI_API_KEY;
    const incomingSig = request.headers.get('x-najiki-signature') || '';

    if (apiKey) {
      const expectedSig = crypto
        .createHmac('sha256', apiKey)
        .update(rawBody)
        .digest('hex');

      if (
        expectedSig.length !== incomingSig.length ||
        !crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(incomingSig))
      ) {
        console.error('[Najiki Webhook] Invalid signature — rejected');
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else {
      console.warn('[Najiki Webhook] NAJIKI_API_KEY not set — skipping signature verification (not recommended!)');
    }

    // 3. Parse the payload
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch (parseErr) {
      console.error('[Najiki Webhook] Failed to parse JSON:', parseErr);
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    console.log('[Najiki Webhook] Parsed payload:', JSON.stringify(payload, null, 2));

    // Extract key fields from Najiki payload
    const { paymentIntentId, reference, status, amount, externalEntityId, providerPaymentId, failureReason } = payload;

    const db = getServiceDb();

    // Find transaction by either reference or paymentIntentId (we stored reference = idempotencyKey initially)
    let { data: tx, error: txError } = await db
      .from('wallet_transactions')
      .select('*')
      .or(`reference_code.eq.${reference},reference_id.eq.${reference},idempotency_key.eq.${paymentIntentId}`)
      .maybeSingle();

    if (txError) {
      console.error('[Najiki Webhook] DB lookup error:', txError);
      return NextResponse.json({ error: 'DB Error' }, { status: 500 });
    }

    if (!tx) {
      console.warn('[Najiki Webhook] Transaction not found for reference:', reference, 'or paymentIntentId:', paymentIntentId);
      return NextResponse.json({ received: true }, { status: 200 });
    }

    // Handle success
    if (status === 'success') {
      // Use existing process_topup_webhook RPC if available, otherwise handle manually
      try {
        // Try to use the existing RPC
        const { data: rpcResult, error: rpcErr } = await db.rpc('process_topup_webhook', {
          p_reference: reference,
          p_tenant_id: tx.tenant_id,
          p_amount: amount,
          p_payload: payload
        });

        if (rpcErr) {
          console.warn('[Najiki Webhook] process_topup_webhook RPC failed, falling back to manual:', rpcErr);
          // Fallback to manual processing
          await handleSuccessManually(db, tx, payload);
        } else {
          console.log('[Najiki Webhook] RPC succeeded:', rpcResult);
        }

        revalidatePath('/', 'layout');
        console.log('[Najiki Webhook] ✅ Success! Wallet credited. Tenant:', tx.tenant_id, 'Amount:', amount);
        return NextResponse.json({ received: true });

      } catch (fallbackErr) {
        await handleSuccessManually(db, tx, payload);
        revalidatePath('/', 'layout');
        return NextResponse.json({ received: true });
      }

    } else if (status === 'failed') {
      // Mark as failed
      await db
        .from('wallet_transactions')
        .update({
          status: 'failed',
          provider_payload: payload
        })
        .eq('id', tx.id);

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
  // 1. Increment wallet balance
  await db.rpc('increment_wallet_balance', {
    p_tenant_id: tx.tenant_id,
    p_amount: tx.amount
  });

  // 2. Mark transaction as successful
  await db
    .from('wallet_transactions')
    .update({
      status: 'success',
      provider_payload: payload
    })
    .eq('id', tx.id);

  console.log('[Najiki Webhook] Manual processing successful');
}
