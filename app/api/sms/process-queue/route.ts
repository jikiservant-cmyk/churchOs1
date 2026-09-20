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
import crypto from 'crypto';

const QUEUE_SECRET = process.env.QUEUE_PROCESSOR_SECRET;

function isAuthorised(req: Request): { authorized: boolean; reason?: string } {
  // Fail closed if no secret is configured
  if (!QUEUE_SECRET) {
    return { authorized: false, reason: 'Queue processor secret not configured' };
  }

  // POST: secret in header x-queue-secret
  const headerSecret = req.headers.get('x-queue-secret');
  if (headerSecret) {
    const a = Buffer.from(headerSecret);
    const b = Buffer.from(QUEUE_SECRET);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { authorized: true };
    }
  }

  // GET (Vercel Cron): secret in Authorization: Bearer <secret>
  const bearerSecret = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (bearerSecret) {
    const a = Buffer.from(bearerSecret);
    const b = Buffer.from(QUEUE_SECRET);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { authorized: true };
    }
  }

  return { authorized: false, reason: 'Unauthorized' };
}

// ── POST — called programmatically (fire-and-forget from /api/sms/enqueue) ──
export async function POST(req: Request) {
  const auth = isAuthorised(req);
  if (!auth.authorized) {
    const status = auth.reason === 'Queue processor secret not configured' ? 503 : 401;
    return NextResponse.json({ error: auth.reason }, { status });
  }

  try {
    const body      = await req.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(Number(body?.batchSize ?? 15) || 15, 1), 20);

    // F-11: per-tenant triggers must match tenant secret or global processor secret
    const tenantId = req.headers.get('x-queue-tenant') ?? undefined;
    if (tenantId) {
      const expected = process.env[`QUEUE_SECRET_${tenantId.toUpperCase()}`] || process.env.QUEUE_PROCESSOR_SECRET;
      const provided = req.headers.get('x-queue-secret');
      if (!expected || !provided) {
        return NextResponse.json({ error: 'Unauthorized for tenant' }, { status: 401 });
      }
      const a = Buffer.from(provided);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return NextResponse.json({ error: 'Unauthorized for tenant' }, { status: 401 });
      }
    }

    const result = await processQueueBatch({ tenantId, batchSize });

    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[ProcessQueue] Error:', err);
    return NextResponse.json({ error: err.message ?? 'Processing failed' }, { status: 500 });
  }
}

// ── GET — called by Vercel Cron ─────────────────────────────────────────────
export async function GET(req: Request) {
  const auth = isAuthorised(req);
  if (!auth.authorized) {
    const status = auth.reason === 'Queue processor secret not configured' ? 503 : 401;
    return NextResponse.json({ error: auth.reason }, { status });
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
