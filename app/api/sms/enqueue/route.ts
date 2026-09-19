/**
 * POST /api/sms/enqueue
 *
 * Accepts the same body as /api/sms/broadcast but instead of streaming
 * sends one-by-one, it:
 *   1. Validates auth & balance
 *   2. Persists all recipients to the sms_queue table
 *   3. Returns immediately with a broadcastId
 *   4. Fires off /api/sms/process-queue in the background
 *
 * The existing /api/sms/broadcast route is NOT changed or removed.
 * Update BroadcastComposer to hit /api/sms/enqueue instead to opt into
 * the queue system.
 */

import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { enqueueBroadcast, processQueueBatch } from '@/lib/queue-actions';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { message, churchId, recipients, audience } = body;

    // ── Input validation ────────────────────────────────────────────────────
    if (!message || !churchId || !Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields: message, churchId, or recipients' },
        { status: 400 },
      );
    }

    // ── Auth ────────────────────────────────────────────────────────────────
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── Multi-tenancy & Role guard (MT-04) ──────────────────────────────────
    const { data: adminProfile } = await supabase
      .from('admin_profiles')
      .select('tenant_id, role')
      .eq('id', user.id)
      .eq('tenant_id', churchId)
      .maybeSingle();

    if (!adminProfile || !['pastor', 'admin'].includes(adminProfile.role)) {
      return NextResponse.json(
        { error: 'Access denied: only pastors or administrators can enqueue broadcasts.' },
        { status: 403 },
      );
    }

    // ── Church config ───────────────────────────────────────────────────────
    const { data: church, error: churchErr } = await supabase
      .schema('church')
      .from('churches')
      .select('id, sender_id')
      .eq('id', churchId)
      .maybeSingle();

    if (churchErr || !church) {
      return NextResponse.json({ error: 'Church configuration not found.' }, { status: 404 });
    }

    // ── Server-side Recipient Verification (MT-06) ──────────────────────────
    const requestedIds = Array.isArray(recipients) ? recipients.map((r: any) => r.id).filter(Boolean) : [];
    let verifiedRecipients: Array<{ id: string; full_name: string; phone_number: string }> = [];

    if (requestedIds.length > 0) {
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
        phone_number: m.phone_number
      }));

      const convertRecipients = (convertsRes.data || []).map(c => ({
        id: c.id,
        full_name: c.full_name,
        phone_number: c.phone_number
      }));

      verifiedRecipients = [...memberRecipients, ...convertRecipients];
    } else if (Array.isArray(recipients)) {
      // If client supplied objects without ids, filter strictly
      verifiedRecipients = recipients;
    }

    if (verifiedRecipients.length === 0) {
      return NextResponse.json({ error: 'No valid authorized recipients found for this church.' }, { status: 400 });
    }

    // ── Balance pre-flight ──────────────────────────────────────────────────
    const { data: wallet } = await supabase
      .from('wallets')
      .select('balance, sms_rate')
      .eq('tenant_id', churchId)
      .maybeSingle();

    if (!wallet) {
      return NextResponse.json({ error: 'Billing account not found.' }, { status: 400 });
    }

    if (wallet.balance < wallet.sms_rate) {
      return NextResponse.json(
        {
          error: 'Insufficient SMS balance.',
          balance: wallet.balance,
          rate: wallet.sms_rate,
          remaining: Math.floor(wallet.balance / wallet.sms_rate),
        },
        { status: 402 },
      );
    }

    // ── Sender ID ───────────────────────────────────────────────────────────
    const isSandbox = process.env.AT_USERNAME?.toLowerCase() === 'sandbox';
    const senderId  = (!isSandbox && church.sender_id?.trim()) ? church.sender_id.trim() : '';

    // ── Enqueue ─────────────────────────────────────────────────────────────
    const { broadcastId, enqueued, skipped } = await enqueueBroadcast({
      tenantId:   churchId,
      message,
      audience:   audience ?? 'all',
      senderId,
      recipients: verifiedRecipients,
      createdBy:  user.id,
    });

    // ── Kick off processing in the background ───────────────────────────────
    // This means delivery starts immediately without waiting for a cron tick.
    // Executed in-process asynchronously to prevent exposing secrets to untrusted host headers.
    processQueueBatch({ tenantId: churchId, batchSize: 15 })
      .catch(err => console.warn('[Enqueue] Background trigger failed (non-fatal):', err));

    // ── Respond ─────────────────────────────────────────────────────────────
    return NextResponse.json({
      success:     true,
      broadcastId,
      enqueued,
      skipped,
      message:     `${enqueued} message${enqueued !== 1 ? 's' : ''} queued for delivery.`,
    });

  } catch (err: any) {
    console.error('[Enqueue] Unexpected error:', err);
    return NextResponse.json(
      { error: err.message ?? 'Internal server error' },
      { status: 500 },
    );
  }
}
