import { NextRequest, NextResponse } from 'next/server';
import { initiatePayment, PaymentProvider } from '@/lib/payments/payment-service';
import { createClient } from '@/lib/supabase/server';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { smsAmount, phone, provider, churchId } = body;

    if (!smsAmount || !phone || !provider) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Verify tenant authorization
    const { data: adminProfile } = await supabase
      .from('admin_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle();

    if (!adminProfile || (churchId && adminProfile.tenant_id !== churchId)) {
      return NextResponse.json({ error: 'Forbidden: Access denied for this tenant' }, { status: 403 });
    }

    // Cost calculation on backend to ensure security
    const SMS_PRICE = 15;
    const amountToCharge = smsAmount * SMS_PRICE;

    // Generate a high-entropy unique reference for the transaction
    const reference = `TX-${crypto.randomUUID()}`;

    // Call our unified payment layer
    const paymentResult = await initiatePayment(provider as PaymentProvider, {
      amount: amountToCharge,
      phone,
      reference,
    });

    if (paymentResult.status === 'failed') {
       return NextResponse.json({ error: 'Payment initiation failed' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      reference: paymentResult.reference,
      paymentUrl: paymentResult.paymentUrl,
    });

  } catch (error: any) {
    console.error('Top-up API error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
