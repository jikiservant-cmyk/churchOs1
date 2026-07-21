import { NextRequest, NextResponse } from 'next/server';
import { initiatePayment, PaymentProvider } from '@/lib/payments/payment-service';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { smsAmount, phone, provider } = body;

    if (!smsAmount || !phone || !provider) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Cost calculation on backend to ensure security
    const SMS_PRICE = 15;
    const amountToCharge = smsAmount * SMS_PRICE;

    // Generate a unique reference for the transaction
    const reference = `TX-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

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
