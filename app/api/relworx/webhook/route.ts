import { NextResponse } from 'next/server';
import { createClient as createSupabaseServerClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function POST(req: Request) {
  try {
    // 0. Security: Verify the webhook secret
    const authHeader = req.headers.get('Authorization');
    const webhookSecret = process.env.WEBHOOK_SECRET;

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

    const supabase = await createSupabaseServerClient();

    // 1. Find the pending transaction
    const { data: transaction, error: findError } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('reference_code', customer_reference)
      .maybeSingle();

    if (findError || !transaction) {
      console.error('[Relworx Webhook] Transaction not found:', customer_reference);
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    // 2. Handle Success
    if (status === 'success') {
      // Update transaction status
      const { error: updateTxError } = await supabase
        .from('wallet_transactions')
        .update({ 
          status: 'success',
          idempotency_key: internal_reference // Ensure we use the real Relworx ID
        })
        .eq('reference_code', customer_reference);

      if (updateTxError) {
        console.error('[Relworx Webhook] Failed to update transaction status:', updateTxError);
        return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
      }

      // Increment wallet balance
      const { error: rpcError } = await supabase.rpc('increment_wallet_balance', {
        p_tenant_id: transaction.tenant_id,
        p_amount: Math.floor(amount)
      });

      if (rpcError) {
        console.error('[Relworx Webhook] Failed to increment balance:', rpcError);
        // This is critical, might need manual reconciliation
      }

      revalidatePath('/', 'layout');
    } 
    // 3. Handle Failure
    else if (status === 'failed') {
      await supabase
        .from('wallet_transactions')
        .update({ status: 'failed' })
        .eq('reference_code', customer_reference);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Relworx Webhook] Error processing webhook:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
