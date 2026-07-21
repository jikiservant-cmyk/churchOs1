# SMS Queue — Integration Guide

## 1. Run the migration

Paste `sql/sms_queue_migration.sql` into your **Supabase SQL Editor** and click
Run. It creates two new tables (`church.broadcasts`, `church.sms_queue`) and a
Postgres function (`public.claim_sms_queue_batch`) used for atomic batch claiming.

---

## 2. Add environment variables

```
# .env.local
QUEUE_PROCESSOR_SECRET=replace_with_a_long_random_string
NEXT_PUBLIC_APP_URL=https://your-deployed-url.com   # needed for fire-and-forget trigger
```

---

## 3. Optional — Vercel Cron (recommended for retries)

Create `vercel.json` in the project root:

```json
{
  "crons": [
    {
      "path": "/api/sms/process-queue",
      "schedule": "* * * * *"
    }
  ]
}
```

The cron fires every minute and picks up any items that weren't processed
by the immediate trigger (network hiccups, retries after back-off, etc.).

---

## 4. Switch BroadcastComposer to the queue

**Only two changes are needed in `components/BroadcastComposer.tsx`:**

### Change A — hit `/api/sms/enqueue` instead of `/api/sms/broadcast`

```diff
- const response = await fetch('/api/sms/broadcast', {
+ const response = await fetch('/api/sms/enqueue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      churchId,
+     audience,               // pass the audience string too (optional but useful for history)
      recipients: finalMembers
        .map(m => ({
+         id: m.id,           // now required for idempotency key generation
          full_name: m.full_name,
          phone_number: normalizeUgPhone(m.phone_number)
        }))
        .filter(m => m.phone_number !== null)
    })
  });
```

### Change B — replace SSE streaming with polling

The new endpoint returns JSON immediately, not an SSE stream.
Replace the reader/decoder block with a simple poll loop:

```typescript
// After fetch('/api/sms/enqueue', ...)
const { broadcastId, enqueued } = await response.json();
setProgress({ active: true, total: enqueued, sent: 0, failed: 0 });

// Poll for progress every 2 seconds
const interval = setInterval(async () => {
  const statusRes  = await fetch(`/api/sms/broadcast-status/${broadcastId}`);
  const statusData = await statusRes.json();

  setProgress({
    active:  statusData.status !== 'COMPLETED' && statusData.status !== 'FAILED' && statusData.status !== 'PARTIAL',
    total:   statusData.total,
    sent:    statusData.sent,
    failed:  statusData.failed,
  });

  if (['COMPLETED', 'PARTIAL', 'FAILED'].includes(statusData.status)) {
    clearInterval(interval);
    setStatus({
      type:    statusData.failed === statusData.total ? 'error' : 'success',
      message: statusData.status === 'COMPLETED'
        ? 'Broadcast Complete! 🚀'
        : `Broadcast finished with ${statusData.failed} failure(s).`,
    });
    setIsSending(false);
    setProgress(p => ({ ...p, active: false }));
    sendingRef.current = false;
    router.refresh();
  }
}, 2000);
```

---

## How it all fits together

```
BroadcastComposer
  │  POST /api/sms/enqueue
  │    ├── auth + balance check
  │    ├── enqueueBroadcast()
  │    │     creates church.broadcasts row
  │    │     inserts N rows into church.sms_queue
  │    ├── fire-and-forget POST /api/sms/process-queue
  │    └── returns { broadcastId, enqueued }
  │
  └── polls GET /api/sms/broadcast-status/:id  every 2 s
        returns { status, sent, failed, pending, percentComplete }

/api/sms/process-queue  (also hit by Vercel Cron every minute)
  ├── claim_sms_queue_batch()   ← atomic SELECT FOR UPDATE SKIP LOCKED
  ├── sendSingleSMS() × batch
  ├── marks items SENT / FAILED (with exponential back-off for retries)
  └── updates church.broadcasts counts
```

---

## Existing routes — unchanged

| Route                        | Status       |
| ---------------------------- | ------------ |
| `POST /api/sms/broadcast`    | Untouched ✅ |
| `POST /api/sms/send`         | Untouched ✅ |
| `lib/sms-actions.ts`         | Untouched ✅ |
| `supabase-schema.sql`        | Untouched ✅ |
