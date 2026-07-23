import { normalizeUgPhone } from '@/lib/utils';
// @ts-ignore
import Africastalking from 'africastalking';
import { createAdminClient } from '@/lib/supabase/server';

interface SendSMSParams {
  supabase: any;
  phoneNumber: string;
  message: string;
  churchId: string;
  idempotencyKey?: string;
  senderId?: string;
  balance: {
    balance: number;
    sms_rate: number;
  };
}

// Najiki SMS Sending Function
async function sendNajikiSMS({
  phoneNumber,
  message,
}: {
  phoneNumber: string;
  message: string;
}) {
  const najikiApiUrl = process.env.NAJIKI_API_URL;
  const najikiApiKey = process.env.NAJIKI_API_KEY;
  const najikiAppCode = process.env.NAJIKI_APPLICATION_CODE;

  if (!najikiApiUrl || !najikiApiKey || !najikiAppCode) {
    throw new Error('Najiki configuration missing from environment variables');
  }

  const response = await fetch(`${najikiApiUrl}/api/messaging/send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${najikiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: phoneNumber,
      message,
      applicationCode: najikiAppCode,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Najiki API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  return result; // Should have { smsId, reference, status: "queued" }
}

export async function sendSingleSMS({
  supabase,
  phoneNumber,
  message,
  churchId,
  idempotencyKey,
  senderId,
  balance
}: SendSMSParams) {
  const finalPhone = normalizeUgPhone(phoneNumber);
  if (!finalPhone) {
    throw new Error(`Invalid phone number format: "${phoneNumber}"`);
  }

  const actualIdempotencyKey = idempotencyKey || `sms_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`;
  
  // 1. Create Initial "PENDING" Log
  const { data: initialLog, error: initialLogError } = await supabase
    .schema('church')
    .from('sms_logs')
    .insert({
      tenant_id: churchId,
      recipient_phone: finalPhone,
      body: message,
      status: 'PENDING',
      idempotency_key: actualIdempotencyKey
    })
    .select('id')
    .single();

  if (initialLogError) {
    throw new Error(`Database Insert Error: ${initialLogError.message}`);
  }

  const logId = initialLog.id;

  try {
    // Try Najiki first, fall back to Africa's Talking if Najiki config missing or fails
    let najikiResult;
    let providerUsed = 'najiki';
    try {
      najikiResult = await sendNajikiSMS({ phoneNumber: finalPhone, message });
    } catch (najikiError) {
      console.warn('[SMS Actions] Najiki failed, falling back to Africa\'s Talking:', najikiError);
      providerUsed = 'africastalking';
    }

    let isSuccess = false;
    let finalStatus = 'FAILED';
    let providerMessageId = null;
    let providerStatus = null;

    if (providerUsed === 'najiki' && najikiResult) {
      // Handle Najiki response
      isSuccess = true;
      finalStatus = 'Queued';
      providerMessageId = najikiResult.smsId;
      providerStatus = najikiResult.status;

      // 2. Perform Deduction
      const adminSupabase = await createAdminClient();
      
      const { data: updatedWallet, error: walletError } = await adminSupabase
        .from('wallets')
        .update({ 
          balance: balance.balance - balance.sms_rate,
          last_updated: new Date().toISOString()
        })
        .eq('tenant_id', churchId)
        .gte('balance', balance.sms_rate)
        .select()
        .single();

      if (walletError || !updatedWallet) {
        console.error('[SMS Actions] Wallet deduction failed:', walletError);
        throw new Error('Insufficient SMS balance or wallet update failed');
      }

      // Record transaction history
      await adminSupabase.from('wallet_transactions').insert({
        tenant_id: churchId,
        amount: -balance.sms_rate,
        type: 'SMS_SENT',
        description: `Sent 1 SMS to ${finalPhone} via Najiki`,
        reference_code: `SMS_${logId}_${Date.now()}`,
        status: 'success',
        idempotency_key: logId,
        product: 'sms',
        reference_id: logId
      });
    } else {
      // Fallback to Africa's Talking
      const apiKey = process.env.AT_API_KEY;
      const username = process.env.AT_USERNAME;

      if (!apiKey || !username) {
        throw new Error('Service configuration error: AT credentials missing');
      }

      const africastalking = Africastalking({ apiKey, username });
      const sms = africastalking.SMS;

      const payload: any = {
        to: finalPhone,
        message: message,
      };

      if (senderId) {
        payload.from = senderId;
      }

      let response = await sms.send(payload);
      let messageData = response.SMSMessageData;
      let recipients = messageData?.Recipients || [];

      if (recipients.length === 0) {
        const errorMessage = messageData?.Message || response.Message || '';
        if (errorMessage.includes('InvalidSenderId') && payload.from) {
          delete payload.from;
          response = await sms.send(payload);
          messageData = response.SMSMessageData;
          recipients = messageData?.Recipients || [];
        }
      }

      if (recipients.length === 0) {
        const errorMessage = messageData?.Message || response.Message || 'Zero recipients returned from provider';
        throw new Error(`Africa's Talking API rejection: ${errorMessage}`);
      }

      const recipient = recipients[0];
      const successStatuses = ['Success', 'Sent', 'Queued', 'Buffered'];
      isSuccess = successStatuses.includes(recipient.status);

      if (isSuccess) {
        if (recipient.status.toLowerCase() === 'success') finalStatus = 'Success';
        else if (recipient.status.toLowerCase() === 'sent') finalStatus = 'Sent';
        else if (recipient.status.toLowerCase() === 'queued') finalStatus = 'Queued';
        else if (recipient.status.toLowerCase() === 'buffered') finalStatus = 'Buffered';
        else finalStatus = recipient.status;
      }

      providerMessageId = recipient.messageId;
      providerStatus = recipient.status;

      // 2. Perform Deduction
      const adminSupabase = await createAdminClient();
      
      const { data: updatedWallet, error: walletError } = await adminSupabase
        .from('wallets')
        .update({ 
          balance: balance.balance - balance.sms_rate,
          last_updated: new Date().toISOString()
        })
        .eq('tenant_id', churchId)
        .gte('balance', balance.sms_rate)
        .select()
        .single();

      if (walletError || !updatedWallet) {
        console.error('[SMS Actions] Wallet deduction failed:', walletError);
        throw new Error('Insufficient SMS balance or wallet update failed');
      }

      // Record transaction history
      await adminSupabase.from('wallet_transactions').insert({
        tenant_id: churchId,
        amount: -balance.sms_rate,
        type: 'SMS_SENT',
        description: `Sent 1 SMS to ${finalPhone}`,
        reference_code: `SMS_${logId}_${Date.now()}`,
        status: 'success',
        idempotency_key: logId,
        product: 'sms',
        reference_id: logId
      });
    }

    // 3. Update Log to Final Status
    const { error: updateError } = await supabase
      .schema('church')
      .from('sms_logs')
      .update({
        status: finalStatus,
        message_provider_status: providerStatus,
        provider_message_id: providerMessageId,
        error_message: isSuccess ? null : providerStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', logId);

    if (updateError) {
      throw new Error(`Failed to finalize SMS log: ${updateError.message}`);
    }

    if (isSuccess) {
      return {
        success: true,
        messageId: providerMessageId,
        status: providerStatus
      };
    } else {
      return {
        success: false,
        error: `SMS delivery failed: ${providerStatus}`,
        details: null
      };
    }

  } catch (error: any) {
    // Update log to FAILED on exception
    await supabase
      .schema('church')
      .from('sms_logs')
      .update({ 
        status: 'FAILED', 
        error_message: error.message || String(error),
        updated_at: new Date().toISOString()
      })
      .eq('id', logId);

    throw error;
  }
}
