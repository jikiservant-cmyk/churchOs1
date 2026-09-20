import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { normalizeUgPhone } from '@/lib/utils';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { phoneNumber, amount, description, churchId } = await req.json();

    // Validate required fields
    if (!phoneNumber || !amount || !description) {
      return NextResponse.json(
        { error: 'Missing required fields: phoneNumber, amount, description' },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizeUgPhone(phoneNumber);
    if (!normalizedPhone) {
      return NextResponse.json(
        { error: 'Invalid Ugandan phone number.' },
        { status: 400 }
      );
    }

    const numAmount = parseInt(String(amount), 10);
    const MIN_AMOUNT = 500;
    const MAX_AMOUNT = 5_000_000;
    if (!Number.isFinite(numAmount) || numAmount < MIN_AMOUNT || numAmount > MAX_AMOUNT) {
      return NextResponse.json(
        { error: `Amount must be between ${MIN_AMOUNT.toLocaleString()} and ${MAX_AMOUNT.toLocaleString()} UGX.` },
        { status: 400 }
      );
    }

    // Verify tenant ownership and role (Pastor or Admin required)
    const { data: adminProfile } = await supabase
      .from('admin_profiles')
      .select('tenant_id, role')
      .eq('id', user.id)
      .maybeSingle();

    if (!adminProfile?.tenant_id || !['pastor', 'admin'].includes(adminProfile.role)) {
      return NextResponse.json({ error: 'Forbidden: Pastor or Admin privileges required' }, { status: 403 });
    }

    if (churchId && adminProfile.tenant_id !== churchId) {
      return NextResponse.json({ error: 'Forbidden: Access denied for this church' }, { status: 403 });
    }

    const tenantId = adminProfile.tenant_id;

    const apiKey = process.env.LIVEPAY_API_KEY;
    const accountNumber = process.env.LIVEPAY_ACCOUNT_NO;

    if (!apiKey || !accountNumber) {
      console.error('LivePay env vars not set — check LIVEPAY_API_KEY and LIVEPAY_ACCOUNT_NO');
      return NextResponse.json(
        { error: 'Payment service not configured' },
        { status: 500 }
      );
    }

    const adminClient = await createAdminClient();

    // Ensure wallet exists for this tenant
    let { data: wallet } = await adminClient
      .from('wallets')
      .select('id')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (!wallet) {
      const { data: newWallet } = await adminClient
        .from('wallets')
        .insert({ tenant_id: tenantId, balance: 0, sms_rate: 70, app_type: 'church' })
        .select('id')
        .single();
      wallet = newWallet;
    }

    // Generate a unique reference and idempotency key
    const reference = `LP-${uuidv4().replace(/-/g, '').slice(0, 22)}`;
    const idempotencyKey = `ik_livepay_${uuidv4()}`;

    // Record pending transaction in wallet_transactions ledger for audit & webhook reconciliation
    if (wallet?.id) {
      await adminClient.from('wallet_transactions').insert({
        tenant_id: tenantId,
        wallet_id: wallet.id,
        amount: numAmount,
        direction: 'credit',
        currency: 'UGX',
        type: 'COLLECTION',
        description: `Collection from ${normalizedPhone}: ${description}`,
        reference_code: reference,
        idempotency_key: idempotencyKey,
        status: 'pending',
        note: 'LivePay collect pending'
      });
    }

    const livepayRes = await fetch('https://livepay.me/api/collect-money', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        accountNumber,
        phoneNumber: normalizedPhone,
        amount: numAmount,
        currency: 'UGX',
        reference,
        description: `Church collection: ${description.slice(0, 50)}`,
      }),
    });

    const data = await livepayRes.json();

    if (!livepayRes.ok) {
      console.error('LivePay API error:', data);
      await adminClient
        .from('wallet_transactions')
        .update({ status: 'failed', raw_provider_response: data })
        .eq('reference_code', reference);

      return NextResponse.json(
        { error: data.error || 'Payment request failed' },
        { status: livepayRes.status }
      );
    }

    return NextResponse.json({ ...data, reference });

  } catch (err) {
    console.error('Payment route server error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
