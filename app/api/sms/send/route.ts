import { NextResponse } from 'next/server';
import { createClient as createSupabaseServerClient } from '@/lib/supabase/server';
import { normalizeUgPhone } from '@/lib/utils';
import { sendSingleSMS } from '@/lib/sms-actions';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { phoneNumber, message, churchId } = body;

    console.log(`[SMS API] Request received for phone: ${phoneNumber}, churchId: ${churchId}`);

    // 1. Authenticate User & Enforce Multi-Tenancy
    const supabaseUserClient = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabaseUserClient.auth.getUser();

    if (authError || !user) {
      console.warn('[SMS API] Unauthorized attempt to send SMS.');
      return NextResponse.json({ error: 'Unauthorized access' }, { status: 401 });
    }

    // 2. Verify Tenant (Church) Ownership Explicitly via Admin Profile
    const { data: adminProfile } = await supabaseUserClient
      .from('admin_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .eq('tenant_id', churchId)
      .maybeSingle();

    if (!adminProfile) {
      console.error(`[SMS API] Explicit multi-tenancy check failed. User ${user.id} attempted to send for church ${churchId}`);
      return NextResponse.json({ error: 'Access denied: You are not authorized as an admin for this church.' }, { status: 403 });
    }
    
    const { data: authorizedChurch, error: tenantError } = await supabaseUserClient
      .schema('church')
      .from('churches')
      .select('id, sender_id')
      .eq('id', churchId)
      .maybeSingle();

    if (tenantError || !authorizedChurch) {
      console.error(`[SMS API] Church lookup failed for ${churchId}`);
      return NextResponse.json({ error: 'Church configuration not found.' }, { status: 404 });
    }

    // 3. Prepaid Balance Guard
    let { data: balance, error: balanceError } = await supabaseUserClient
      .schema('public')
      .from('wallets')
      .select('balance, sms_rate')
      .eq('tenant_id', churchId)
      .maybeSingle();

    if (balanceError) {
      return NextResponse.json({ error: 'Billing lookup error. Please try again later.' }, { status: 500 });
    }

    // Auto-provision tenant & wallet for backward compatibility if missing
    if (!balance) {
      const { error: tenantInsertError } = await supabaseUserClient
        .schema('public')
        .from('tenants')
        .upsert({ id: churchId, app_type: 'church', name: authorizedChurch.sender_id || 'Church' })
        .select()
        .single();
      
      if (!tenantInsertError) {
        const { data: newBalance, error: initError } = await supabaseUserClient
          .schema('public')
          .from('wallets')
          .upsert({ tenant_id: churchId, balance: 0, sms_rate: 70, app_type: 'church' })
          .select('balance, sms_rate')
          .single();
          
        if (!initError && newBalance) {
          balance = newBalance;
        }
      }
    }

    if (!balance) {
      return NextResponse.json({ error: 'Billing account not found.' }, { status: 400 });
    }

    if (balance.balance < balance.sms_rate) {
      return NextResponse.json({ 
        error: 'Insufficient SMS balance.', 
        balance: balance.balance, 
        rate: balance.sms_rate,
        remaining: Math.floor(balance.balance / balance.sms_rate)
      }, { status: 402 });
    }

    // 4. Validate Input
    if (!phoneNumber || !message) {
      return NextResponse.json(
        { error: 'Missing required fields: phoneNumber or message' },
        { status: 400 }
      );
    }

    // 5. Determine Sender ID
    const isSandbox = process.env.AT_USERNAME?.toLowerCase() === 'sandbox';
    let senderId = '';
    if (!isSandbox && authorizedChurch.sender_id && authorizedChurch.sender_id.trim() !== '') {
       senderId = authorizedChurch.sender_id.trim();
    }

    // 6. Use the shared sending logic
    try {
      const result = await sendSingleSMS({
        supabase: supabaseUserClient,
        phoneNumber,
        message,
        churchId,
        idempotencyKey: body.idempotencyKey,
        senderId,
        balance
      });

      return NextResponse.json(result);
    } catch (sendError: any) {
      console.error('[SMS API] Send error:', sendError);
      const isBalanceError = sendError.message === 'Insufficient SMS balance';
      return NextResponse.json(
        { error: sendError.message || 'Failed to send SMS' },
        { status: isBalanceError ? 402 : 502 }
      );
    }

  } catch (error: any) {
    console.error('[SMS API] Unexpected error in SMS route:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error while sending SMS' },
      { status: 500 }
    );
  }
}
