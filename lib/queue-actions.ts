/**
 * lib/queue-actions.ts
 *
 * Database-backed SMS queue for churchOs.
 *
 * Public API
 * ──────────
 *   enqueueBroadcast()    — Persists a broadcast + all individual SMS jobs.
 *                           Returns immediately with a broadcastId.
 *   processQueueBatch()   — Claims and delivers a batch of PENDING jobs.
 *                           Safe to call concurrently (SKIP LOCKED).
 *   getBroadcastStatus()  — Returns live progress for a given broadcast.
 *
 * Nothing in this file modifies the existing sms/send or sms/broadcast routes.
 */

import { normalizeUgPhone } from '@/lib/utils';
import { sendSingleSMS } from '@/lib/sms-actions';
import { createAdminClient } from '@/lib/supabase/server';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EnqueueBroadcastParams {
  tenantId: string;
  message: string;           // may contain {name} / {first_name} placeholders
  audience?: string;         // e.g. 'all', 'men', 'women', 'youth', 'new_converts'
  senderId: string;
  recipients: Array<{
    id: string;
    full_name: string;
    phone_number: string;
  }>;
  createdBy?: string;        // auth.users id of the admin who triggered the broadcast
}

export interface EnqueueResult {
  broadcastId: string;
  enqueued: number;          // valid phone numbers queued
  skipped: number;           // recipients with unparseable phone numbers
}

export interface BroadcastStatus {
  broadcastId: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  total: number;
  sent: number;
  failed: number;
  pending: number;
  percentComplete: number;
  createdAt: string;
  completedAt: string | null;
}

export interface ProcessResult {
  processed: number;
  succeeded: number;
  failed: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// enqueueBroadcast
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a broadcast record and queues one sms_queue row per valid recipient.
 * Does NOT send any SMS — call processQueueBatch() (or let the cron do it).
 */
export async function enqueueBroadcast(
  params: EnqueueBroadcastParams,
): Promise<EnqueueResult> {
  const admin = await createAdminClient();

  // 1. Create the parent broadcast record
  const { data: broadcast, error: broadcastErr } = await admin
    .schema('church')
    .from('broadcasts')
    .insert({
      tenant_id:        params.tenantId,
      message_template: params.message,
      audience:         params.audience ?? 'all',
      total_recipients: params.recipients.length,  // refined below after filtering
      status:           'QUEUED',
      created_by:       params.createdBy ?? null,
    })
    .select('id')
    .single();

  if (broadcastErr || !broadcast) {
    throw new Error(`Failed to create broadcast: ${broadcastErr?.message}`);
  }

  // 2. Build queue rows — personalise message, skip bad phone numbers
  const rows: Record<string, unknown>[] = [];
  let skipped = 0;

  for (let i = 0; i < params.recipients.length; i++) {
    const r = params.recipients[i];
    const phone = normalizeUgPhone(r.phone_number);
    if (!phone) { skipped++; continue; }

    const fullName  = r.full_name || 'Member';
    const firstName = fullName.split(' ')[0];
    const personalised = params.message
      .replace(/{name}/gi,       fullName)
      .replace(/{first_name}/gi, firstName);

    rows.push({
      tenant_id:       params.tenantId,
      broadcast_id:    broadcast.id,
      recipient_phone: phone,
      recipient_name:  r.full_name,
      message:         personalised,
      sender_id:       params.senderId,
      status:          'PENDING',
      idempotency_key: `bcast_${broadcast.id.slice(0, 8)}_${r.id}_${i}`,
    });
  }

  // 3. Insert in batches of 100 (PostgREST body-size sweet spot)
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error: insertErr } = await admin
      .schema('church')
      .from('sms_queue')
      .insert(rows.slice(i, i + BATCH));

    if (insertErr) {
      throw new Error(`Queue insert failed at offset ${i}: ${insertErr.message}`);
    }
  }

  // 4. Correct total_recipients to the actual enqueued count
  await admin
    .schema('church')
    .from('broadcasts')
    .update({ total_recipients: rows.length, updated_at: new Date().toISOString() })
    .eq('id', broadcast.id);

  return { broadcastId: broadcast.id, enqueued: rows.length, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// processQueueBatch
// ─��───────────────────────────────────────────────────────────────────────────

export interface ProcessQueueOptions {
  /** Restrict processing to a single church. Omit to process all pending. */
  tenantId?: string;
  /** Max SMS to send per invocation. Keep ≤ 15 to stay within AT rate limits. */
  batchSize?: number;
}

/**
 * Claims a batch of PENDING queue items using SELECT FOR UPDATE SKIP LOCKED
 * (via the claim_sms_queue_batch Postgres function) then sends them.
 *
 * Safe to call concurrently — the DB-level locking prevents double-sending.
 */
export async function processQueueBatch(
  opts: ProcessQueueOptions = {},
): Promise<ProcessResult> {
  const admin = await createAdminClient();
  const batchSize = opts.batchSize ?? 10;

  // ── Claim items atomically ────────────────────────────────────────────────
  const { data: claimed, error: claimErr } = await admin
    .rpc('claim_sms_queue_batch', {
      p_tenant_id:  opts.tenantId ?? null,
      p_batch_size: batchSize,
    });

  if (claimErr) {
    throw new Error(`Queue claim failed: ${claimErr.message}`);
  }

  if (!claimed || claimed.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  // ── Pre-fetch wallet balances (one query per tenant in this batch) ─────────
  // FIX: explicitly type as string[] so TypeScript knows tid is a string index key
  const tenantIds: string[] = [...new Set<string>(claimed.map((r: any) => r.tenant_id as string))];
  const balanceMap: Record<string, { balance: number; sms_rate: number }> = {};

  for (const tid of tenantIds) {
    const { data: wallet } = await admin
      .from('wallets')
      .select('balance, sms_rate')
      .eq('tenant_id', tid)
      .maybeSingle();
    if (wallet) balanceMap[tid] = wallet;
  }

  // ── Send each claimed item ────────────────────────────────────────────────
  let succeeded = 0;
  let failed    = 0;

  for (const item of claimed) {
    const balance     = balanceMap[item.tenant_id];
    const newAttempts = (item.attempts as number ?? 0) + 1;

    try {
      if (!balance || balance.balance < balance.sms_rate) {
        throw new Error('Insufficient balance');
      }

      const result = await sendSingleSMS({
        supabase:       admin,
        phoneNumber:    item.recipient_phone,
        message:        item.message,
        churchId:       item.tenant_id,
        idempotencyKey: item.idempotency_key,
        senderId:       item.sender_id ?? '',
        balance,
      });

      if (!result.success) throw new Error(result.error ?? 'Provider rejected');

      // Mark SENT
      await admin
        .schema('church')
        .from('sms_queue')
        .update({
          status:       'SENT',
          processed_at: new Date().toISOString(),
          attempts:     newAttempts,
          last_error:   null,
          updated_at:   new Date().toISOString(),
        })
        .eq('id', item.id);

      // Keep local balance in sync to detect insufficiency without an extra DB round-trip
      balanceMap[item.tenant_id] = {
        ...balance,
        balance: balance.balance - balance.sms_rate,
      };

      succeeded++;

    } catch (err: any) {
      const shouldRetry = newAttempts < (item.max_attempts as number ?? 3);
      const nextStatus  = shouldRetry ? 'PENDING' : 'FAILED';

      // Exponential back-off: 1st retry in 30 s, 2nd in 60 s, 3rd = permanent fail
      const retryDelay  = shouldRetry
        ? new Date(Date.now() + Math.pow(2, newAttempts) * 30_000).toISOString()
        : undefined;

      await admin
        .schema('church')
        .from('sms_queue')
        .update({
          status:       nextStatus,
          attempts:     newAttempts,
          last_error:   err.message ?? String(err),
          scheduled_at: retryDelay ?? new Date().toISOString(),
          updated_at:   new Date().toISOString(),
        })
        .eq('id', item.id);

      failed++;
    }

    // Small pause between sends to stay comfortably within Africa's Talking rate limits
    await new Promise(r => setTimeout(r, 150));
  }

  // ── Sync broadcast summary counts for every affected broadcast ────────────
  const broadcastIds = [
    ...new Set(
      claimed
        .map((r: any) => r.broadcast_id as string | null)
        .filter(Boolean),
    ),
  ] as string[];

  for (const bid of broadcastIds) {
    await _syncBroadcastCounts(admin, bid);
  }

  return { processed: claimed.length, succeeded, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// getBroadcastStatus
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns real-time progress for a broadcast.
 * tenantId is required to enforce multi-tenancy (admins can only see their own data).
 */
export async function getBroadcastStatus(
  broadcastId: string,
  tenantId: string,
): Promise<BroadcastStatus | null> {
  const admin = await createAdminClient();

  const { data } = await admin
    .schema('church')
    .from('broadcasts')
    .select('id, status, total_recipients, sent_count, failed_count, created_at, completed_at')
    .eq('id', broadcastId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!data) return null;

  const pending = Math.max(0, data.total_recipients - data.sent_count - data.failed_count);

  return {
    broadcastId:    data.id,
    status:         data.status,
    total:          data.total_recipients,
    sent:           data.sent_count,
    failed:         data.failed_count,
    pending,
    percentComplete: data.total_recipients > 0
      ? Math.round(((data.sent_count + data.failed_count) / data.total_recipients) * 100)
      : 0,
    createdAt:   data.created_at,
    completedAt: data.completed_at ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────���──────────────────────

async function _syncBroadcastCounts(admin: any, broadcastId: string) {
  const { data: rows } = await admin
    .schema('church')
    .from('sms_queue')
    .select('status')
    .eq('broadcast_id', broadcastId);

  if (!rows) return;

  const sentCount    = rows.filter((r: any) => r.status === 'SENT').length;
  const failedCount  = rows.filter((r: any) => r.status === 'FAILED').length;
  const pendingCount = rows.filter((r: any) => r.status === 'PENDING' || r.status === 'PROCESSING').length;

  const broadcastStatus: string =
    pendingCount > 0               ? 'PROCESSING'
    : failedCount === rows.length  ? 'FAILED'
    : failedCount > 0              ? 'PARTIAL'
    :                                'COMPLETED';

  await admin
    .schema('church')
    .from('broadcasts')
    .update({
      sent_count:   sentCount,
      failed_count: failedCount,
      status:       broadcastStatus,
      started_at:   broadcastStatus === 'PROCESSING' ? new Date().toISOString() : undefined,
      completed_at: pendingCount === 0 ? new Date().toISOString() : null,
      updated_at:   new Date().toISOString(),
    })
    .eq('id', broadcastId);
}
