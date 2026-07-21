import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';

// Prevent Next.js from caching this route
export const dynamic = 'force-dynamic';

/** Service-role client — webhook has no user session/cookies, needs to bypass RLS */
function getServiceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  // ── 1. Read raw body before parsing (required for HMAC check) ────────────
  const rawBody = await request.text();

  // ── 2. Verify webhook signature ───────────────────────────────────────────
  const secret = process.env.LIVEPAY_WEBHOOK_SECRET ?? process.env.WEBHOOK_SECRET;

  const incomingSig =
    request.headers.get('x-livepay-signature') ??
    request.headers.get('x-webhook-signature') ??
    '';

  if (secret) {
    // Missing signature header = immediate reject
    if (!incomingSig) {
      console.error('[topup webhook] Missing signature header — rejected');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    // Strip "sha256=" prefix that some providers include
    const normalizedSig = incomingSig.replace(/^sha256=/, '');

    if (
      expected.length !== normalizedSig.length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(normalizedSig))
    ) {
      console.error('[topup webhook] Invalid signature — rejected');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // ── 3. Parse payload ──────────────────────────────────────────────────────
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Supports LivePay and Relworx reference field names
  const reference = (
    payload.reference ??
    payload.ref ??
    payload.internal_reference ??
    payload.transaction_ref ??
    payload.customer_reference // Relworx
  ) as string;

  const rawStatus = (
    payload.status ??
    payload.payment_status ??
    payload.transaction_status ??
    ''
  ) as string;

  if (!reference) {
    return NextResponse.json({ error: 'Missing reference field' }, { status: 400 });
  }

  const db = getServiceDb();
  const isSuccess = ['success', 'successful', 'completed', 'approved'].includes(
    rawStatus.toLowerCase()
  );

  // ── 4. Handle failed / cancelled payments ────────────────────────────────
  if (!isSuccess) {
    await db
      .from('wallet_transactions')
      .update({ status: 'failed', provider_payload: payload })
      .eq('reference_code', reference)
      .eq('status', 'pending');

    console.log(`[topup webhook] Payment ${reference} failed. Status: "${rawStatus}"`);
    return NextResponse.json({ received: true });
  }

  // ── 5. Look up the pending transaction ───────────────────────────────────
  const { data: tx, error: txError } = await db
    .from('wallet_transactions')
    .select('*')
    .eq('reference_code', reference)
    .eq('status', 'pending')
    .maybeSingle();

  if (txError) {
    console.error('[topup webhook] DB lookup error:', txError);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  if (!tx) {
    console.log(`[topup webhook] Reference ${reference} not found or already processed.`);
    return NextResponse.json({ received: true });
  }

  // ── 6. Process atomically via single DB transaction ───────────────────────
  //
  // process_topup_webhook does all three steps inside one Postgres transaction:
  //   a) INSERT billing_events (idempotency guard via unique constraint)
  //   b) increment_wallet_balance (p_app_type: 'church')
  //   c) UPDATE wallet_transactions.status = 'success'
  //
  // Either all three succeed or all three roll back. No zombie state is possible.
  // If the server crashes after this RPC returns successfully but before we send
  // the HTTP response, LivePay retries → the RPC sees the duplicate billing_events
  // row → returns 'duplicate' → we respond 200. Safe.
  const { data: result, error: rpcError } = await db.rpc('process_topup_webhook', {
    p_reference:  reference,
    p_tenant_id:  tx.tenant_id,
    p_amount:     tx.amount,
    p_payload:    payload,
  });

  if (rpcError) {
    console.error('[topup webhook] process_topup_webhook RPC failed:', rpcError);
    return NextResponse.json({ error: 'Payment processing failed, please retry' }, { status: 500 });
  }

  switch (result?.result) {
    case 'credited':
      revalidatePath('/', 'layout');
      console.log(
        `[topup webhook] ✅ Wallet credited — tenant: ${tx.tenant_id}, amount: UGX ${tx.amount}, ref: ${reference}`
      );
      return NextResponse.json({ received: true });

    case 'duplicate':
      console.log(`[topup webhook] Duplicate for ${reference}, skipping.`);
      return NextResponse.json({ received: true });

    case 'not_found':
      console.log(`[topup webhook] Reference ${reference} not found inside RPC.`);
      return NextResponse.json({ received: true });

    default:
      console.error('[topup webhook] Unexpected RPC result:', result);
      return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
