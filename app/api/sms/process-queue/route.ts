/**
 * POST /api/sms/process-queue  (also handles GET for Vercel Cron)
 *
 * Claims and processes a batch of PENDING sms_queue items.
 * This route is designed to be:
 *   • Called by /api/sms/enqueue immediately after queuing (fire-and-forget)
 *   • Called by Vercel Cron every minute as a safety net for retries
 *
 * Protected by QUEUE_PROCESSOR_SECRET env variable.
 * Add to your .env:
 *   QUEUE_PROCESSOR_SECRET=<a long random string>
 *
 * And to vercel.json for the cron (optional but recommended):
 * {
 *   "crons": [{
 *     "path": "/api/sms/process-queue",
 *     "schedule": "* * * * *"
 *   }]
 * }
 */

import { NextResponse } from 'next/server';
import { processQueueBatch } from '@/lib/queue-actions';

const QUEUE_SECRET = process.env.QUEUE_PROCESSOR_SECRET;

function isAuthorised(req: Request): boolean {
  // No secret configured → open (useful for local dev, not recommended for production)
  if (!QUEUE_SECRET) return true;

  // POST: secret in header x-queue-secret
  const headerSecret = req.headers.get('x-queue-secret');
  if (headerSecret === QUEUE_SECRET) return true;

  // GET (Vercel Cron): secret in Authorization: Bearer <secret>
  const bearerSecret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (bearerSecret === QUEUE_SECRET) return true;

  return false;
}

// ── POST — called programmatically (fire-and-forget from /api/sms/enqueue) ──
export async function POST(req: Request) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body       = await req.json().catch(() => ({}));
    const tenantId   = (body?.churchId as string | undefined) ?? undefined;
    const batchSize  = Math.min(Number(body?.batchSize ?? 15), 20); // cap at 20

    const result = await processQueueBatch({ tenantId, batchSize });

    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[ProcessQueue] Error:', err);
    return NextResponse.json({ error: err.message ?? 'Processing failed' }, { status: 500 });
  }
}

// ── GET — called by Vercel Cron ─────────────────────────────────────────────
export async function GET(req: Request) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Cron invocation processes ALL tenants, no filtering
    const result = await processQueueBatch({ batchSize: 15 });
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[ProcessQueue/Cron] Error:', err);
    return NextResponse.json({ error: err.message ?? 'Processing failed' }, { status: 500 });
  }
}
