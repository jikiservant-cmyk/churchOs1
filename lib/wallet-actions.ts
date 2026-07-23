'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { normalizeUgPhone } from './utils';

// Helper to format phone for Najiki (accepts E.164 or standard international format)
function formatPhoneForNajiki(phone: string): string {
  // Najiki accepts both formats, let's just pass it through
  // But ensure no special chars
  const cleaned = phone.replace(/\D/g, '');
  // If starts with 256 (Uganda), we can keep as is or convert to 0... either is fine
  if (cleaned.startsWith('256')) return `0${cleaned.slice(3)}`;
  // If starts with 0, keep as is
  if (cleaned.startsWith('0')) return cleaned;
  // Otherwise return original cleaned number
  return cleaned;
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

    if (!apiKey) {
      console.error('[Najiki] API credentials missing from environment.');
      return { error: 'Payment service not configured' };
    }

    // 0. Create admin client
    const supabaseAdmin = await createAdminClient();

    // 1. Fetch tenant code from database
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .select('code')
      .eq('id', churchId)
      .maybeSingle();

    if (tenantError) {
      console.error('[Najiki] Failed to fetch tenant:', tenantError);
      return { error: 'Failed to load tenant data' };
    }

    // Resolve tenantCode: use tenant.code first, then fallback to env var
    let tenantCode = tenant?.code;
    if (!tenantCode) {
      // Fallback to env var if tenant doesn't have a code
      tenantCode = process.env.NAJIKI_TENANT_CODE;
      console.warn('[Najiki] No tenant code found in database, using env var fallback');
    }

    if (!tenantCode) {
      console.error('[Najiki] No tenant code available (neither in database nor env)');
      return { error: 'Tenant code not configured' };
    }

    // 2. Create a pending transaction in our DB
    const reference = `CHURCH-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;

    const { error: txError } = await supabaseAdmin.from('wallet_transactions').insert({
      tenant_id: churchId,
      amount: amount,
      type: 'TOPUP',
      description: `Najiki Top-up for ${phoneNumber}`,
      reference_code: reference,
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

    // 3. Format phone number to E.164 or standard international format
    const formattedPhone = formatPhoneForNajiki(phoneNumber);

    // 4. Call Najiki API
    const requestBody = {
      amount: amount,
      phoneNumber: formattedPhone,
      reference: reference,
      currency: 'UGX',
      description: 'ChurchOS SMS Wallet Top-up',
      externalEntityId: churchId,
      metadata: { churchId, source: 'admin-dashboard' },
      ...(applicationCode ? { applicationCode } : {}),
      tenantCode: tenantCode
    };

    console.log('[Najiki] Sending request to /api/payments:', JSON.stringify({ ...requestBody, phoneNumber: 'REDACTED' }));

    const response = await fetch('https://najiki.netlify.app/api/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey, // Using recommended API key header
        // Alternatively could use: 'Authorization': `Bearer ${apiKey}`
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
      await supabaseAdmin
        .from('wallet_transactions')
        .update({ 
          status: 'failed', 
          provider_payload: { ...result, raw_response: responseText.slice(0, 500) } 
        })
        .eq('reference_code', reference);

      return { error: result.error || result.message || 'Payment request failed' };
    }

    // 5. Update transaction with Najiki paymentIntentId
    if (result.paymentIntentId) {
      await supabaseAdmin
        .from('wallet_transactions')
        .update({ 
          idempotency_key: result.paymentIntentId,
          provider_payload: result 
        })
        .eq('reference_code', reference);
    }

    return { success: true, message: 'Payment prompt sent to your phone!', paymentIntentId: result.paymentIntentId, reference: reference };
  } catch (err: any) {
    console.error('[Najiki] Unexpected error during initiation:', err);
    return { error: 'An unexpected error occurred: ' + (err.message || 'Unknown error') };
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

export async function initiateDonationPayment(params: {
  churchId: string;
  amount: number;
  phoneNumber: string;
  category: string;
}) {
  const formData = new FormData();
  formData.append('churchId', params.churchId);
  formData.append('amount', params.amount.toString());
  formData.append('phoneNumber', params.phoneNumber);
  
  return initiateNajikiPayment(formData);
}
