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
  const apiKey = process.env.AT_API_KEY;
  const username = process.env.AT_USERNAME;

  if (!apiKey || !username) {
    throw new Error('Service configuration error: AT credentials missing');
  }

  const africastalking = Africastalking({ apiKey, username });
  const sms = africastalking.SMS;

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

    // Smart Fallback: If AT rejects the custom Sender ID, strip it and retry
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
    const isSuccess = successStatuses.includes(recipient.status);
    
    // Normalize status for consistency
    let finalStatus = 'FAILED';
    if (isSuccess) {
      if (recipient.status.toLowerCase() === 'success') finalStatus = 'Success';
      else if (recipient.status.toLowerCase() === 'sent') finalStatus = 'Sent';
      else if (recipient.status.toLowerCase() === 'queued') finalStatus = 'Queued';
      else if (recipient.status.toLowerCase() === 'buffered') finalStatus = 'Buffered';
      else finalStatus = recipient.status;
    }

    // 2. Perform Deduction & Update Logs in Next.js Route
    if (isSuccess) {
      const adminSupabase = await createAdminClient();
      
      // Perform atomic deduction
      const { data: updatedWallet, error: walletError } = await adminSupabase
        .from('wallets')
        .update({ 
          balance: balance.balance - balance.sms_rate,
          last_updated: new Date().toISOString()
        })
        .eq('tenant_id', churchId)
        .gte('balance', balance.sms_rate) // Ensure sufficient balance at time of update
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
        message_provider_status: recipient.status,
        provider_message_id: recipient.messageId,
        error_message: isSuccess ? null : recipient.status,
        updated_at: new Date().toISOString()
      })
      .eq('id', logId);

    if (updateError) {
      throw new Error(`Failed to finalize SMS log: ${updateError.message}`);
    }

    if (isSuccess) {
      return {
        success: true,
        messageId: recipient.messageId,
        status: recipient.status
      };
    } else {
      return {
        success: false,
        error: `SMS delivery failed: ${recipient.status}`,
        details: recipient
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
