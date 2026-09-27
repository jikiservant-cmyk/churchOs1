'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { normalizeUgPhone } from './utils';
import crypto from 'crypto';
import {
  buildChurchDonationPayment,
  buildChurchTopupPayment,
  createNajikiPayment,
  getNajikiConfig,
  isNajikiConfigured,
} from '@/lib/najiki/client';

// Helper to format phone for Najiki (E.164 without plus or 256...)
// Na'jiki's LivePay adapter runs its own normalizePhone() (which strips the
// leading '+') before calling the provider, so the digits-only E.164 form is
// the canonical thing to send: 2567XXXXXXXX.
function formatPhoneForNajiki(phone: string): string {
  const normalized = normalizeUgPhone(phone);
  if (normalized) {
    return normalized.replace('+', '');
  }
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    return `256${cleaned.slice(1)}`;
  }
  return cleaned;
}

// Najiki Payment Initiation
export async function initiateNajikiPayment(formData: FormData) {
  try {
    const churchId = formData.get('churchId') as string;
    // F-06: never trust a client-supplied amount. Price server-side and cap it.
    const rawAmount = parseInt(String(formData.get('amount') ?? ''), 10);
    const TOPUP_MIN = 1_000, TOPUP_MAX = 2_000_000;
    if (!Number.isFinite(rawAmount) || rawAmount < TOPUP_MIN || rawAmount > TOPUP_MAX) {
      return { error: `Top-up must be between ${TOPUP_MIN} and ${TOPUP_MAX} UGX` };
    }
    const amount = rawAmount; // amount now means UGX received, nothing else
    const phoneNumber = formData.get('phoneNumber') as string;

    console.log('[Najiki] Initiation started');

    if (!churchId || !phoneNumber) {
      console.error('[Najiki] Missing or invalid required fields for payment');
      return { error: 'Missing or invalid required fields' };
    }

    // Verify authenticated user owns this church
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { error: 'Unauthorized: authentication required' };
    }

    const { data: profile } = await supabase
      .from('admin_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile || profile.tenant_id !== churchId) {
      return { error: 'Access denied: cannot initiate payment for another church' };
    }

    // Fail fast with the exact variable names that are missing.
    try {
      getNajikiConfig();
    } catch (configError: any) {
      console.error('[Najiki] Payment credentials missing from environment.');
      return { error: configError?.message ?? 'Payment service not configured' };
    }

    // 0. Create admin client
    const supabaseAdmin = await createAdminClient();

    // 1. Fetch tenant code from database
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('code')
      .eq('id', churchId)
      .maybeSingle();

    const { data: churchData } = await supabaseAdmin
      .schema('church')
      .from('churches')
      .select('slug')
      .eq('id', churchId)
      .maybeSingle();

    // Resolve tenantCode: use tenant.code first, then church.slug, then fallback to env var
    let tenantCode = tenant?.code || churchData?.slug || process.env.NAJIKI_TENANT_CODE;

    if (!tenantCode) {
      console.error('[Najiki] No tenant code available (neither in database nor env)');
      return { error: 'Tenant code not configured' };
    }

    // Fetch or create wallet to obtain wallet_id
    let { data: wallet } = await supabaseAdmin
      .from('wallets')
      .select('id')
      .eq('tenant_id', churchId)
      .maybeSingle();

    if (!wallet) {
      await supabaseAdmin
        .from('tenants')
        .upsert({ id: churchId, app_type: 'church', name: churchData?.slug || 'Church' });

      const { data: newWallet } = await supabaseAdmin
        .from('wallets')
        .upsert({ tenant_id: churchId, balance: 0, sms_rate: 70, app_type: 'church' })
        .select('id')
        .single();

      wallet = newWallet;
    }

    if (!wallet?.id) {
      console.error('[Najiki] Wallet record missing for church:', churchId);
      return { error: 'Wallet record missing for church' };
    }

    // 2. Create a pending transaction in our DB with high-entropy cryptographic references
    const reference = `CHURCH-${crypto.randomUUID()}`;
    const idempotencyKey = `ik_church_${crypto.randomUUID()}`;

    const { error: txError } = await supabaseAdmin.from('wallet_transactions').insert({
      tenant_id: churchId,
      wallet_id: wallet.id,
      amount: amount,
      direction: 'credit',
      currency: 'UGX',
      type: 'TOPUP',
      description: `Najiki Top-up for ${phoneNumber}`,
      reference_code: reference,
      idempotency_key: idempotencyKey,
      status: 'pending',
      note: 'pending'
    });

    if (txError) {
      console.error('[Najiki] Failed to create pending transaction:', txError);
      return {
        error: `Database error: ${txError.message}`
      }
    }

    // 3. Format phone number to E.164 or standard international format
    const formattedPhone = formatPhoneForNajiki(phoneNumber);

    // 4. Call Najiki API — POST /api/payments
    //
    // Na'jiki generates its own `reference` and returns it as `reference` (not
    // `paymentIntentId`), so our own reference has to travel inside `metadata`
    // for the settlement webhook to find this row again. See
    // lib/najiki/webhook.ts → transactionLookupCandidates().
    const paymentRequest = buildChurchTopupPayment({
      churchId,
      tenantCode,
      churchSlug: churchData?.slug,
      reference,
      idempotencyKey,
      amount,
      phoneNumber: formattedPhone,
    });

    console.log('[Najiki] Sending request to /api/payments:', JSON.stringify({ ...paymentRequest, phoneNumber: 'REDACTED' }));

    let result;
    try {
      result = await createNajikiPayment(paymentRequest);
    } catch (err: any) {
      // Surface Na'jiki's own error text — a rejected payload must never look
      // like a success to the caller.
      console.error('[Najiki] API Error Response:', err?.message ?? err);
      await supabaseAdmin
        .from('wallet_transactions')
        .update({
          status: 'failed',
          raw_provider_response: { error: err?.message ?? String(err), status: err?.status ?? null }
        })
        .eq('reference_code', reference);

      return { error: err?.message || 'Payment request failed' };
    }

    console.log('[Najiki] API Response:', JSON.stringify(result));

    // 5. Update transaction with Najiki response.
    // `reference` is Na'jiki's own payment reference; `reference_code` stays ours.
    if (result.paymentId) {
      await supabaseAdmin
        .from('wallet_transactions')
        .update({ 
          raw_provider_response: result,
          reference: result.reference ?? null
        })
        .eq('reference_code', reference);
    }

    return {
      success: true,
      message: 'Payment prompt sent to your phone!',
      paymentId: result.paymentId,
      najikiReference: result.reference,
      status: result.status,
      reference: reference
    };
  } catch (err: any) {
    console.error('[Najiki] Unexpected error during initiation:', err);
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

    const DONATION_MIN = 500, DONATION_MAX = 10_000_000;
    if (!Number.isFinite(amount) || amount < DONATION_MIN || amount > DONATION_MAX) {
      return { error: `Donation must be between ${DONATION_MIN.toLocaleString()} and ${DONATION_MAX.toLocaleString()} UGX` };
    }

    const cleanPhone = normalizeUgPhone(phoneNumber);
    if (!cleanPhone) {
      return { error: 'Please enter a valid Ugandan phone number' };
    }

    const supabaseAdmin = await createAdminClient();

    // Verify the church exists
    const { data: church } = await supabaseAdmin
      .schema('church')
      .from('churches')
      .select('id, name, slug')
      .eq('id', churchId)
      .maybeSingle();

    if (!church) {
      return { error: 'Church not found' };
    }

    // Ensure wallet exists for this church
    let { data: wallet } = await supabaseAdmin
      .from('wallets')
      .select('id')
      .eq('tenant_id', churchId)
      .maybeSingle();

    if (!wallet?.id) {
      await supabaseAdmin
        .from('tenants')
        .upsert({ id: churchId, app_type: 'church', name: church?.slug || 'Church' });

      const { data: newWallet } = await supabaseAdmin
        .from('wallets')
        .upsert({ tenant_id: churchId, balance: 0, sms_rate: 70, app_type: 'church' })
        .select('id')
        .single();

      wallet = newWallet;
    }

    const reference = `DON-${crypto.randomUUID()}`;
    const idempotencyKey = `ik_don_${crypto.randomUUID()}`;

    // Record pending transaction in wallet_transactions
    const { error: txError } = await supabaseAdmin.from('wallet_transactions').insert({
      tenant_id: churchId,
      wallet_id: wallet?.id,
      amount: amount,
      direction: 'credit',
      currency: 'UGX',
      type: 'DONATION',
      description: `Public ${category || 'giving'} donation from ${cleanPhone}`,
      reference_code: reference,
      idempotency_key: idempotencyKey,
      status: 'pending',
      note: `Category: ${category || 'general'}`
    });

    if (txError) {
      console.error('[Donation] Failed to create pending transaction:', txError);
      return { error: 'Unable to initiate payment record' };
    }

    // Call payment provider (LivePay or Najiki)
    const apiKey = process.env.LIVEPAY_API_KEY;
    const accountNumber = process.env.LIVEPAY_ACCOUNT_NO;

    if (apiKey && accountNumber) {
      const livepayRes = await fetch('https://livepay.me/api/collect-money', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          accountNumber,
          phoneNumber: cleanPhone,
          amount: amount,
          currency: 'UGX',
          reference: reference.slice(0, 24).replace(/-/g, ''),
          description: `${church.name || 'Church'} ${category || 'giving'}`,
        }),
      });

      const data = await livepayRes.json();
      if (!livepayRes.ok) {
        await supabaseAdmin
          .from('wallet_transactions')
          .update({ status: 'failed', raw_provider_response: data })
          .eq('reference_code', reference);
        return { error: data.error || 'Payment request failed' };
      }

      return { success: true, message: 'Payment prompt sent to your phone!', reference };
    }

    // Fallback: Najiki payment provider if configured.
    //
    // This used to authenticate with `x-api-key: <key>`. Na'jiki's
    // POST /api/payments reads ONLY `Authorization: Bearer <api key>` and
    // answers 401 "Missing or invalid authorization header" for anything else,
    // so every donation routed through this branch was rejected before it
    // reached the provider.
    if (isNajikiConfigured()) {
      const formattedPhone = formatPhoneForNajiki(cleanPhone);
      const paymentRequest = buildChurchDonationPayment({
        churchId,
        // Na'jiki resolves the tenant as (applicationId, code); the church slug
        // is what the tenant row is keyed on.
        tenantCode: church.slug,
        churchName: church.name,
        reference,
        idempotencyKey,
        amount,
        phoneNumber: formattedPhone,
        category,
      });

      let result;
      try {
        result = await createNajikiPayment(paymentRequest);
      } catch (err: any) {
        console.error('[Donation] Najiki rejected the payment:', err?.message ?? err);
        await supabaseAdmin
          .from('wallet_transactions')
          .update({
            status: 'failed',
            raw_provider_response: { error: err?.message ?? String(err), status: err?.status ?? null }
          })
          .eq('reference_code', reference);
        return { error: err?.message || 'Payment request failed' };
      }

      if (result.paymentId) {
        await supabaseAdmin
          .from('wallet_transactions')
          .update({ raw_provider_response: result, reference: result.reference ?? null })
          .eq('reference_code', reference);
      }

      return { success: true, message: 'Payment prompt sent to your phone!', reference };
    }

    return { error: 'Payment gateway is not currently configured.' };
  } catch (err: any) {
    console.error('[Donation] Error:', err);
    return { error: 'Payment processing error: ' + (err.message || 'Unknown error') };
  }
}
