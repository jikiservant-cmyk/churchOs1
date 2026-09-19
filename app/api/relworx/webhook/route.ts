import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function POST(req: Request) {
  try {
    // 0. Security: Verify the webhook secret
    const authHeader = req.headers.get('Authorization');
    const webhookSecret = process.env.WEBHOOK_SECRET || process.env.RELWORX_WEBHOOK_SECRET;

    if (!webhookSecret || authHeader !== `Bearer ${webhookSecret}`) {
      console.warn('[Relworx Webhook] Unauthorized attempt detected');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    console.log('[Relworx Webhook] Received payload:', JSON.stringify(payload));

    const { status, customer_reference, internal_reference, amount } = payload;

    if (!customer_reference || !internal_reference) {
      return NextResponse.json({ error: 'Missing references' }, { status: 400 });
    }

    // Use service role admin client since webhooks have no user session (MT-07)
    const supabase = await createAdminClient();

    // 1. Find the transaction
    const { data: transaction, error: findError } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('reference_code', customer_reference)
      .maybeSingle();

    if (findError || !transaction) {
      console.error('[Relworx Webhook] Transaction not found:', customer_reference);
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    // 2. Handle Success with atomic idempotency
    if (status === 'success') {
      const incomingAmount = Math.floor(Number(amount));
      if (isNaN(incomingAmount) || incomingAmount < transaction.amount) {
        console.error(`[Relworx Webhook] Underpayment detected! Expected ${transaction.amount}, got ${incomingAmount}`);
        return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 });
      }

      // If already processed, respond 200 without double-crediting
      if (transaction.status === 'success') {
        console.log('[Relworx Webhook] Transaction already processed successfully:', customer_reference);
        return NextResponse.json({ success: true, duplicate: true });
      }

      // Atomic transition via process_topup_webhook RPC or atomic update
      const { data: rpcResult, error: rpcError } = await supabase.rpc('process_topup_webhook', {
        p_reference: customer_reference,
        p_tenant_id: transaction.tenant_id,
        p_amount: transaction.amount,
        p_payload: payload
      });

      if (rpcError) {
        console.warn('[Relworx Webhook] process_topup_webhook RPC failed, trying atomic fallback:', rpcError);
        
        // Atomic fallback: update ONLY if status is still 'pending'
        const { data: updatedTx, error: updateTxError } = await supabase
          .from('wallet_transactions')
          .update({ 
            status: 'success',
            idempotency_key: internal_reference,
            raw_provider_response: payload,
            updated_at: new Date().toISOString()
          })
          .eq('id', transaction.id)
          .eq('status', 'pending')
          .select('id')
          .maybeSingle();

        if (updateTxError || !updatedTx) {
          console.log('[Relworx Webhook] Transaction was already updated or not pending:', transaction.id);
          return NextResponse.json({ success: true, duplicate: true });
        }

        // Increment wallet balance once
        await supabase.rpc('increment_wallet_balance', {
          p_tenant_id: transaction.tenant_id,
          p_amount: transaction.amount
        });
      }

      revalidatePath('/', 'layout');
    } 
    // 3. Handle Failure
    else if (status === 'failed') {
      await supabase
        .from('wallet_transactions')
        .update({
          status: 'failed',
          raw_provider_response: payload,
          updated_at: new Date().toISOString()
        })
        .eq('reference_code', customer_reference)
        .eq('status', 'pending');
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Relworx Webhook] Error processing webhook:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

