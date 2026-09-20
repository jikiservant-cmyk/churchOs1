import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { sendSingleSMS } from '@/lib/sms-actions';
import { normalizeUgPhone } from '@/lib/utils';

export async function POST(req: Request) {
  const encoder = new TextEncoder();
  const { message, churchId, recipients, recipientIds } = await req.json();

  if (!message || !churchId || (!Array.isArray(recipients) && !Array.isArray(recipientIds))) {
    return NextResponse.json({ error: 'Missing message, churchId, or recipients' }, { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const sendUpdate = (data: any) => {
        controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
      };

      try {
        const supabase = await createClient();
        
        // 1. Verify Auth & Admin Role Status (MT-04)
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
          sendUpdate({ type: 'fatal', error: 'Unauthorized' });
          controller.close();
          return;
        }

        const { data: adminProfile } = await supabase
          .from('admin_profiles')
          .select('tenant_id, role')
          .eq('id', user.id)
          .eq('tenant_id', churchId)
          .maybeSingle();

        if (!adminProfile || !['pastor', 'admin'].includes(adminProfile.role)) {
          sendUpdate({ type: 'fatal', error: 'Forbidden: Insufficient privileges to broadcast SMS' });
          controller.close();
          return;
        }

        // F-02: Query and verify all recipients server-side strictly scoped to this tenant by ID
        const requestedIds = Array.isArray(recipientIds)
          ? recipientIds.filter(Boolean)
          : Array.isArray(recipients) ? recipients.map((r: any) => r.id).filter(Boolean) : [];

        if (requestedIds.length === 0) {
          sendUpdate({ type: 'fatal', error: 'Recipients must be selected from this church (ids are required).' });
          controller.close();
          return;
        }

        let verifiedRecipients: Array<{ id: string; full_name: string; phone_number: string }> = [];

        const [membersRes, convertsRes] = await Promise.all([
          supabase
            .schema('church')
            .from('members')
            .select('id, full_name, phone_number')
            .eq('church_id', churchId)
            .in('id', requestedIds),
          supabase
            .schema('church')
            .from('new_converts')
            .select('id, full_name, phone_number')
            .eq('church_id', churchId)
            .in('id', requestedIds)
        ]);

        const memberRecipients = (membersRes.data || []).map(m => ({
          id: m.id,
          full_name: m.full_name,
          phone_number: normalizeUgPhone(m.phone_number)
        }));

        const convertRecipients = (convertsRes.data || []).map(c => ({
          id: c.id,
          full_name: c.full_name,
          phone_number: normalizeUgPhone(c.phone_number)
        }));

        verifiedRecipients = [...memberRecipients, ...convertRecipients].filter(
          (r): r is { id: string; full_name: string; phone_number: string } => !!r.phone_number
        );

        if (verifiedRecipients.length === 0) {
          sendUpdate({ type: 'fatal', error: 'No authorized recipients with valid phone numbers found for this church.' });
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

        // F-02: the send loop, the progress total and the idempotency key are all
        // driven by rows that were re-read from the database for THIS tenant.
        sendUpdate({ type: 'start', total: verifiedRecipients.length });

        for (let i = 0; i < verifiedRecipients.length; i++) {
          const recipient = verifiedRecipients[i];
          
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
              idempotencyKey: `broadcast_${churchId.slice(0, 8)}_${recipient.id}_${i}`,
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
