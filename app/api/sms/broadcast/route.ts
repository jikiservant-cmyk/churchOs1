import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { sendSingleSMS } from '@/lib/sms-actions';

export async function POST(req: Request) {
  const encoder = new TextEncoder();
  const { message, churchId, recipients } = await req.json();

  if (!message || !churchId || !recipients || !Array.isArray(recipients)) {
    return NextResponse.json({ error: 'Missing message, churchId, or recipients' }, { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const sendUpdate = (data: any) => {
        controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
      };

      try {
        const supabase = await createClient();
        
        // 1. Verify Auth & Admin Status
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
          sendUpdate({ type: 'fatal', error: 'Unauthorized' });
          controller.close();
          return;
        }

        const { data: adminProfile } = await supabase
          .from('admin_profiles')
          .select('tenant_id')
          .eq('id', user.id)
          .eq('tenant_id', churchId)
          .maybeSingle();

        if (!adminProfile) {
          sendUpdate({ type: 'fatal', error: 'Forbidden' });
          controller.close();
          return;
        }

        // 2. Get Church Config & Balance
        const { data: church } = await supabase
          .schema('church')
          .from('churches')
          .select('sender_id')
          .eq('id', churchId)
          .maybeSingle();

        let { data: balance } = await supabase
          .schema('public')
          .from('wallets')
          .select('balance, sms_rate')
          .eq('tenant_id', churchId)
          .maybeSingle();

        if (!balance) {
          sendUpdate({ type: 'fatal', error: 'Billing account not found' });
          controller.close();
          return;
        }

        const isSandbox = process.env.AT_USERNAME?.toLowerCase() === 'sandbox';
        const senderId = (!isSandbox && church?.sender_id) ? church.sender_id.trim() : '';

        // Initial progress
        sendUpdate({ type: 'start', total: recipients.length });

        for (let i = 0; i < recipients.length; i++) {
          const recipient = recipients[i];
          
          try {
            // Check balance before each send to be safe
            if (balance.balance < balance.sms_rate) {
              sendUpdate({ type: 'halt', reason: 'Insufficient balance' });
              break;
            }

            const personalizedMessage = message
              .replace(/{name}/gi, recipient.full_name || 'Member')
              .replace(/{first_name}/gi, (recipient.full_name || 'Member').split(' ')[0]);

            const result = await sendSingleSMS({
              supabase,
              phoneNumber: recipient.phone_number,
              message: personalizedMessage,
              churchId,
              idempotencyKey: `broadcast_${churchId.slice(0, 8)}_${recipient.id}_${Date.now()}_${i}`,
              senderId,
              balance
            });

            if (result.success) {
              sendUpdate({ type: 'success', recipient: recipient.full_name, index: i });
              // Optimistically update local balance to stop early if needed
              balance.balance -= balance.sms_rate;
            } else {
              sendUpdate({ type: 'error', recipient: recipient.full_name, error: result.error });
            }
          } catch (err: any) {
            console.error(`Broadcast error for ${recipient.full_name}:`, err);
            sendUpdate({ type: 'error', recipient: recipient.full_name, error: err.message });
            
            if (err.message === 'Insufficient SMS balance') {
              sendUpdate({ type: 'halt', reason: 'Insufficient balance' });
              break;
            }
          }

          // Small delay to prevent hitting AT rate limits too hard
          await new Promise(r => setTimeout(r, 100));
        }

        sendUpdate({ type: 'complete' });
        controller.close();
      } catch (err: any) {
        console.error('Fatal broadcast error:', err);
        sendUpdate({ type: 'fatal', error: err.message });
        controller.error(err);
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
