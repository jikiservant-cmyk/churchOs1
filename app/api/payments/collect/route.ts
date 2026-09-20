import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@/lib/supabase/server';

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

    // Verify tenant ownership
    const { data: adminProfile } = await supabase
      .from('admin_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle();

    if (!adminProfile?.tenant_id) {
      return NextResponse.json({ error: 'Forbidden: No tenant profile found' }, { status: 403 });
    }

    if (churchId && adminProfile.tenant_id !== churchId) {
      return NextResponse.json({ error: 'Forbidden: Access denied for this church' }, { status: 403 });
    }

    const tenantId = churchId ?? adminProfile.tenant_id; // always tenant-attributed

    const apiKey = process.env.LIVEPAY_API_KEY;
    const accountNumber = process.env.LIVEPAY_ACCOUNT_NO; // matches .env.example exactly

    if (!apiKey || !accountNumber) {
      console.error('LivePay env vars not set — check LIVEPAY_API_KEY and LIVEPAY_ACCOUNT_NO in .env.local');
      return NextResponse.json(
        { error: 'Payment service not configured' },
        { status: 500 }
      );
    }

    // Generate a unique reference — no spaces, max 30 chars
    const reference = `CH${uuidv4().replace(/-/g, '').slice(0, 24)}`;

    const livepayRes = await fetch('https://livepay.me/api/collect-money', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        accountNumber,              // your LivePay account number e.g. LP2305443309
        phoneNumber,                // e.g. "0777123456" or "+256777123456"
        amount: Number(amount),     // MUST be a number, not a string
        currency: 'UGX',
        reference,                  // unique per transaction
        description,
      }),
    });

    const data = await livepayRes.json();

    if (!livepayRes.ok) {
      console.error('LivePay API error:', data);
      return NextResponse.json(
        { error: data.error || 'Payment request failed' },
        { status: livepayRes.status }
      );
    }

    // Success — STK push sent to the user's phone
    // data = { success: true, message: "...", reference: "...", internal_reference: "...", network: "MTN" }
    return NextResponse.json(data);

  } catch (err) {
    console.error('Payment route server error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
