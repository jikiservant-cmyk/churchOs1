export type PaymentProvider = 'pesapal' | 'flutterwave' | 'xente';

export interface PaymentData {
  amount: number;
  phone: string;
  reference: string;
}

export interface PaymentResult {
  status: 'success' | 'pending' | 'failed';
  amount: number;
  reference: string;
  providerReference?: string;
  paymentUrl?: string;
}

async function pesapalPay(data: PaymentData): Promise<PaymentResult> {
  console.log('Calling Pesapal API with data:', data);
  // Simulating API response
  return {
    status: 'pending',
    amount: data.amount,
    reference: data.reference,
    paymentUrl: `https://sandbox.pesapal.com/pay/${data.reference}`,
  };
}

async function flutterwavePay(data: PaymentData): Promise<PaymentResult> {
  console.log('Calling Flutterwave API with data:', data);
  return {
    status: 'pending',
    amount: data.amount,
    reference: data.reference,
    paymentUrl: `https://flutterwave.com/pay/${data.reference}`,
  };
}

async function xentePay(data: PaymentData): Promise<PaymentResult> {
  console.log('Calling Xente API with data:', data);
  return {
    status: 'pending',
    amount: data.amount,
    reference: data.reference,
    paymentUrl: `https://xente.co/pay/${data.reference}`,
  };
}

// 🟢 Step 1 — Common function / abstraction
export async function initiatePayment(provider: PaymentProvider, data: PaymentData): Promise<PaymentResult> {
  if (provider === 'pesapal') {
    return pesapalPay(data);
  } else if (provider === 'flutterwave') {
    return flutterwavePay(data);
  } else if (provider === 'xente') {
    return xentePay(data);
  } else {
    throw new Error(`Unsupported payment provider: ${provider}`);
  }
}

// 🟢 Advanced — Standardizing Callbacks
export function handleCallback(provider: PaymentProvider, rawResponse: any): PaymentResult {
  if (provider === 'pesapal') {
    return normalizePesapal(rawResponse);
  } else if (provider === 'flutterwave') {
    return normalizeFlutterwave(rawResponse);
  } else if (provider === 'xente') {
    return normalizeXente(rawResponse);
  } else {
    throw new Error(`Unsupported payment provider for callback: ${provider}`);
  }
}

function normalizePesapal(response: any): PaymentResult {
  return {
    status: response.status_code === 1 ? 'success' : 'failed',
    amount: response.amount,
    reference: response.reference, // Our internal reference
    providerReference: response.tracking_id,
  };
}

function normalizeFlutterwave(response: any): PaymentResult {
  return {
    status: response.data.status === 'successful' ? 'success' : 'failed',
    amount: response.data.amount,
    reference: response.data.tx_ref,
    providerReference: response.data.flw_ref,
  };
}

function normalizeXente(response: any): PaymentResult {
  return {
    status: response.status === 'SUCCESS' ? 'success' : 'failed',
    amount: response.amount,
    reference: response.transactionId,
    providerReference: response.xenteRef,
  };
}
