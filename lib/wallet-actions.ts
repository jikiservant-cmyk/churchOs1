'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { normalizeUgPhone } from './utils';

// Helper to format phone for LivePay (expects 0... e.g. 0777123456)
function formatPhoneForLivePay(phone: string): string {
  const normalized = normalizeUgPhone(phone);
  if (!normalized) return phone;
  // Convert +256777123456 to 0777123456 as requested by common LivePay implementations
  if (normalized.startsWith('+256')) {
    return '0' + normalized.slice(4);
  }
  return normalized.replace('+', ''); 
}

// Helper to format phone for Najiki (accepts 07... or 256...)
function formatPhoneForNajiki(phone: string): string {
  // Najiki accepts both formats, let's just pass it through
  // But ensure no special chars
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) return cleaned;
  if (cleaned.startsWith('256')) return `0${cleaned.slice(3)}`;
  return phone;
}

// Najiki Payment Initiation
export async function initiateNajikiPayment(formData: FormData) {
  try {
    const churchId = formData.get('churchId') as string;
    const amountStr = formData.get('amount') as string;
    const amount = parseInt(amountStr, 10);
    const phoneNumber = formData.get('phoneNumber') as string;

    console.log('[Najiki] Initiation started:', { churchId, amount, phoneNumber });

    if (!churchId || !phoneNumber || isNaN(amount)) {
      console.error('[Najiki] Missing or invalid fields:', { churchId, phoneNumber, amount });
      return { error: 'Missing or invalid required fields' };
    }

    const apiKey = process.env.NAJIKI_API_KEY;
    const applicationCode = process.env.NAJIKI_APPLICATION_CODE;
    const tenantCode = process.env.NAJIKI_TENANT_CODE;

    if (!apiKey || !applicationCode) {
      console.error('[Najiki] API credentials missing from environment. API_KEY:', !!apiKey, 'APPLICATION_CODE:', !!applicationCode);
      return { error: 'Payment service not configured' };
    }

    // 1. Create a pending transaction in our DB first
    const supabase = await createAdminClient();
    const idempotencyKey = `IDEMP-${Date.now().toString().slice(-8)}-${Math.random().toString(36).substring(7).toUpperCase()}`;

    const { error: txError } = await supabase.from('wallet_transactions').insert({
      tenant_id: churchId,
      amount: amount,
      type: 'TOPUP',
      description: `Najiki Top-up for ${phoneNumber}`,
      reference_code: idempotencyKey,
      status: 'pending',
      product: 'sms',
      revenue_ugx: 0,
      created_by: 'system',
    });

    if (txError) {
      console.error('[Najiki] Failed to create pending transaction:', txError);
      return {
        error: `Database error: ${txError.message}`
      }
    }

    // 2. Call Najiki API
    const formattedPhone = formatPhoneForNajiki(phoneNumber);
    const requestBody = {
      applicationCode,
      ...(tenantCode ? { tenantCode } : {}),
      paymentTypeCode: 'sms_credits',
      externalEntityId: churchId,
      amount: amount,
      currency: 'UGX',
      phoneNumber: formattedPhone,
      idempotencyKey: idempotencyKey,
      metadata: { churchId, source: 'admin-dashboard' }
    };

    console.log('[Najiki] Sending request to /api/payments:', JSON.stringify({ ...requestBody, phoneNumber: 'REDACTED' }));

    const response = await fetch('https://najiki.netlify.app/api/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    let result;
    const responseText = await response.text();
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      console.error('[Najiki] Failed to parse JSON response. Raw response:', responseText);
      result = { message: 'Invalid response from payment provider' };
    }

    console.log('[Najiki] API Response:', JSON.stringify(result));

    if (!response.ok) {
      console.error('[Najiki] API Error Response:', result);
      // Mark as failed in DB
      await supabase
        .from('wallet_transactions')
        .update({ 
          status: 'failed', 
          provider_payload: { ...result, raw_response: responseText.slice(0, 500) } 
        })
        .eq('reference_code', idempotencyKey);

      return { error: result.error || result.message || 'Payment request failed' };
    }

    // 3. Update transaction with Najiki paymentId
    if (result.paymentId) {
      await supabase
        .from('wallet_transactions')
        .update({ 
          idempotency_key: result.paymentId,
          reference_id: result.reference,
          provider_payload: result 
        })
        .eq('reference_code', idempotencyKey);
    }

    return { success: true, message: 'Payment prompt sent to your phone!', paymentId: result.paymentId, reference: result.reference };
  } catch (err: any) {
    console.error('[Najiki] Unexpected error during initiation:', err);
    return { error: 'An unexpected error occurred: ' + (err.message || 'Unknown error') };
  }
}

export async function initiateLivePayPayment(formData: FormData) {
  try {
    const churchId = formData.get('churchId') as string;
    const amountStr = formData.get('amount') as string;
    const amount = parseInt(amountStr, 10);
    const phoneNumber = formData.get('phoneNumber') as string;

    console.log('[LivePay] Initiation started:', { churchId, amount, phoneNumber });

    if (!churchId || !phoneNumber || isNaN(amount)) {
      console.error('[LivePay] Missing or invalid fields:', { churchId, phoneNumber, amount });
      return { error: 'Missing or invalid required fields' };
    }

    const apiKey = process.env.LIVEPAY_API_KEY;
    const accountNo = process.env.LIVEPAY_ACCOUNT_NO;

    if (!apiKey || !accountNo) {
      console.error('[LivePay] API credentials missing from environment. API_KEY:', !!apiKey, 'ACCOUNT_NO:', !!accountNo);
      return { error: 'Payment service not configured' };
    }

    // 1. Create a pending transaction in our DB first
    const supabase = await createAdminClient();
    // Reference should be unique, no spaces, max 30 chars. Using a cleaner format.
    const referenceCode = `CH${Date.now().toString().slice(-8)}${Math.random().toString(36).substring(7).toUpperCase()}`;

    console.log('[LivePay] Creating transaction record with ref:', referenceCode);

    const { error: txError } = await supabase.from('wallet_transactions').insert({
      tenant_id: churchId,
      amount: amount,
      type: 'TOPUP',
      description: `LivePay Top-up for ${phoneNumber}`,
      reference_code: referenceCode,
      status: 'pending',
      product: 'sms',
      revenue_ugx: 0,
      created_by: 'system',
    });

    if (txError) {
      console.error('[LivePay] Failed to create pending transaction:', txError);
      return {
        error: `Database error: ${txError.message}`,
      };
    }

    // 2. Call LivePay API
    const formattedPhone = formatPhoneForLivePay(phoneNumber);
    const requestBody = {
      accountNumber: accountNo,
      phoneNumber: formattedPhone,
      amount: amount,
      currency: 'UGX',
      reference: referenceCode,
      description: 'ChurchOS Wallet Top-up',
    };

    console.log('[LivePay] Sending request to collect-money:', JSON.stringify({ ...requestBody, accountNumber: 'REDACTED' }));

    const response = await fetch('https://livepay.me/api/collect-money', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    let result;
    const responseText = await response.text();
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      console.error('[LivePay] Failed to parse JSON response. Raw response:', responseText);
      result = { message: 'Invalid response from payment provider' };
    }
    
    console.log('[LivePay] API Response:', JSON.stringify(result));

    if (!response.ok) {
      console.error('[LivePay] API Error Response:', result);
      // Mark as failed in DB
      await supabase
        .from('wallet_transactions')
        .update({ 
          status: 'failed', 
          provider_payload: { ...result, raw_response: responseText.slice(0, 500) } 
        })
        .eq('reference_code', referenceCode);

      return { error: result.error || result.message || 'Payment request failed' };
    }

    // 3. Update transaction with LivePay internal reference if available
    if (result.internal_reference || result.reference) {
      await supabase
        .from('wallet_transactions')
        .update({ 
          idempotency_key: result.internal_reference || result.reference,
          reference_id: result.internal_reference || result.reference,
          provider_payload: result 
        })
        .eq('reference_code', referenceCode);
    }

    return { success: true, message: 'Payment prompt sent to your phone!' };
  } catch (err: any) {
    console.error('[LivePay] Unexpected error during initiation:', err);
    return { error: 'An unexpected error occurred: ' + (err.message || 'Unknown error') };
  }
}

export async function initiateDonationPayment(params: { 
  churchId: string; 
  amount: number; 
  phoneNumber: string; 
  category: string;
}) {
  try {
    const { churchId, amount, phoneNumber, category } = params;

    if (!churchId || !phoneNumber || !amount) {
      return { error: 'Missing required fields' };
    }

    const apiKey = process.env.LIVEPAY_API_KEY;
    const accountNo = process.env.LIVEPAY_ACCOUNT_NO;

    if (!apiKey || !accountNo) {
      console.error('[LivePay Donation] API credentials missing');
      return { error: 'Payment service not configured' };
    }

    // 1. Create a pending transaction in our DB first
    const supabase = await createAdminClient();
    const referenceCode = `DON_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const { error: txError } = await supabase.from('wallet_transactions').insert({
      tenant_id: churchId,
      amount: amount,
      type: 'credit',
      description: `${category} Donation via Giving Portal`,
      reference_code: referenceCode,
      status: 'pending',
      product: 'donation',
      revenue_ugx: 0,
      created_by: 'public',
      provider_payload: { category }
    });

    if (txError) {
      console.error('[LivePay Donation] Failed to create pending transaction:', txError);
      return { error: 'Database error' };
    }

    // 2. Call LivePay API
    const requestBody = {
      accountNumber: accountNo,
      phoneNumber: formatPhoneForLivePay(phoneNumber),
      amount: amount,
      currency: 'UGX',
      reference: referenceCode,
      description: `${category} Donation to ${churchId}`,
    };

    console.log('[LivePay Donation] Sending request to collect-money:', JSON.stringify({ ...requestBody, accountNumber: 'LP***' }));

    const response = await fetch('https://livepay.me/api/collect-money', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    const result = await response.json();
    console.log('[LivePay Donation] API Response:', JSON.stringify(result));

    if (!response.ok) {
      console.error('[LivePay Donation] API Error:', result);
      await supabase
        .from('wallet_transactions')
        .update({ status: 'failed' })
        .eq('reference_code', referenceCode);

      return { error: result.error || result.message || 'Payment request failed' };
    }

    // 3. Update transaction with LivePay internal reference
    if (result.internal_reference) {
      await supabase
        .from('wallet_transactions')
        .update({ reference_id: result.internal_reference })
        .eq('reference_code', referenceCode);
    }

    return { success: true, message: 'Payment prompt sent to your phone!' };
  } catch (err: any) {
    console.error('[LivePay Donation] Unexpected error:', err);
    return { error: 'An unexpected error occurred' };
  }
}

export async function initiateRelworxPayment(formData: FormData) {
  try {
    const churchId = formData.get('churchId') as string;
    const amount = parseInt(formData.get('amount') as string, 10) || 5000;
    const phoneNumber = formData.get('phoneNumber') as string;

    if (!churchId || !phoneNumber) {
      return { error: 'Missing required fields' };
    }

    const apiKey = process.env.RELWORX_API_KEY;
    const relworxAccountNo = process.env.RELWORX_ACCOUNT_NO;

    if (!apiKey || !relworxAccountNo) {
      console.error('[Relworx] API credentials missing');
      return { error: 'Payment service not configured' };
    }

    // 1. Create a pending transaction in our DB first
    const supabase = await createAdminClient();
    const referenceCode = `REL_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const { error: txError } = await supabase.from('wallet_transactions').insert({
      tenant_id: churchId,
      amount: amount,
      type: 'TOPUP',
      description: `Relworx Top-up for ${phoneNumber}`,
      reference_code: referenceCode,
      status: 'pending',
      product: 'sms',
      revenue_ugx: 0,
      created_by: 'system',
    });

    if (txError) {
      console.error('[Relworx] Failed to create pending transaction:', txError);
      return {
        error: `Database error: ${txError.message} (${txError.code})`,
        details: txError,
      };
    }

    // 2. Call Relworx API
    const response = await fetch('https://payments.relworx.com/api/mobile_money/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.relworx.v2',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        account_no: relworxAccountNo,
        msisdn: phoneNumber,
        amount: amount,
        currency: 'UGX',
        customer_reference: referenceCode,
        description: 'ChurchOS Wallet Top-up',
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[Relworx] API Error:', result);
      await supabase
        .from('wallet_transactions')
        .update({ status: 'failed' })
        .eq('reference_code', referenceCode);

      return { error: result.message || 'Payment request failed' };
    }

    // 3. Update transaction with Relworx internal reference
    await supabase
      .from('wallet_transactions')
      .update({ reference_id: result.internal_reference })
      .eq('reference_code', referenceCode);

    return { success: true, message: 'Payment prompt sent to your phone!' };
  } catch (err: any) {
    console.error('[Relworx] Unexpected error:', err);
    return { error: 'An unexpected error occurred' };
  }
}

export async function topUpWallet(formData: FormData): Promise<{ error?: string; success?: boolean; newBalance?: number }> {
  try {
    const churchId = formData.get('churchId') as string;
    const amount = parseInt(formData.get('amount') as string, 10) || 10000;

    if (!churchId) {
      console.error('TopUp Error: Missing churchId in top up action.');
      return { error: 'Missing churchId' };
    }

    const supabase = await createClient();
    const adminSupabase = await createAdminClient();

    // Atomic increment via RPC — avoids read-then-write race condition.
    const { data: newBalance, error } = await adminSupabase.rpc('increment_wallet_balance', {
      p_tenant_id: churchId,
      p_amount: amount,
      p_app_type: 'church',
    });

    if (error) {
      console.error('Failed to top up wallet:', error);
      return { error: error.message };
    }

    console.log(`[Wallet] Top-up successful. New balance: ${newBalance}`);

    // Record a transaction to maintain history
    const { data: { user } } = await supabase.auth.getUser();

    const { error: txError } = await adminSupabase.from('wallet_transactions').insert({
      tenant_id: churchId,
      amount: amount,
      type: 'TOPUP',
      description: 'Test Top-up via Admin Dashboard',
      reference_code: 'TOPUP_TEST_' + Date.now(),
      status: 'success',
      product: 'sms',
      revenue_ugx: 0,
      created_by: user?.id || 'system',
    });

    if (txError) {
      console.error('Failed to record top up transaction:', JSON.stringify(txError, null, 2));
    }
  } catch (err: any) {
    console.error('Unhandled exception in topUpWallet:', err);
    return { error: err.message || 'An unexpected error occurred' };
  }

  revalidatePath('/', 'layout');
  return { success: true };
}

export async function emptyWallet(formData: FormData) {
  const churchId = formData.get('churchId') as string;

  if (!churchId) {
    return;
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from('wallets')
    .update({
      balance: 0,
      last_updated: new Date().toISOString(),
    })
    .eq('tenant_id', churchId);

  if (error) {
    console.error('Failed to empty wallet:', error);
    return;
  }

  revalidatePath('/', 'layout');
}
