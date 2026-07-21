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
import { enqueueBroadcast } from '@/lib/queue-actions';

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

    // ── Multi-tenancy guard ─────────────────────────────────────────────────
    const { data: adminProfile } = await supabase
      .from('admin_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .eq('tenant_id', churchId)
      .maybeSingle();

    if (!adminProfile) {
      return NextResponse.json(
        { error: 'Access denied: you are not an admin for this church.' },
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
      recipients,
      createdBy:  user.id,
    });

    // ── Kick off processing in the background ───────────────────────────────
    // This means delivery starts immediately without waiting for a cron tick.
    // We fire-and-forget — the response is already sent to the client.
    const host    = req.headers.get('host') ?? '';
    const proto   = host.startsWith('localhost') ? 'http' : 'https';
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host}`;

    fetch(`${baseUrl}/api/sms/process-queue`, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-queue-secret':  process.env.QUEUE_PROCESSOR_SECRET ?? '',
      },
      body: JSON.stringify({ churchId }),
    }).catch(err => console.warn('[Enqueue] Background trigger failed (non-fatal):', err));

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
