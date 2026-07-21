/**
 * GET /api/sms/broadcast-status/[broadcastId]
 *
 * Returns real-time progress for a queued broadcast.
 * Poll this endpoint (e.g. every 2 s) from BroadcastComposer after
 * receiving a broadcastId from /api/sms/enqueue.
 *
 * Response shape:
 * {
 *   broadcastId:    string
 *   status:         'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED'
 *   total:          number   — total recipients enqueued
 *   sent:           number   — successfully delivered
 *   failed:         number   — permanently failed (max retries exhausted)
 *   pending:        number   — still waiting or being retried
 *   percentComplete: number  — 0-100
 *   createdAt:      string   — ISO timestamp
 *   completedAt:    string | null
 * }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getBroadcastStatus } from '@/lib/queue-actions';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ broadcastId: string }> },
) {
  // Auth
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get the admin's tenant (multi-tenancy check)
  const { data: profile } = await supabase
    .from('admin_profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile?.tenant_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { broadcastId } = await params;
  const status = await getBroadcastStatus(broadcastId, profile.tenant_id);

  if (!status) {
    return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 });
  }

  return NextResponse.json(status);
}
