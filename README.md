# churchOs — 10k Scalability Fixes

This folder contains all the files needed to harden churchOs for 10,000 clients.
Drop each file into the correct path in your repo and follow the steps below.

---

## File map

```
churchOs-fixes/
├── .env.example                              → repo root (replace existing)
├── middleware.ts                             → repo root (replace existing)
├── next.config.ts                            → repo root (replace existing)
├── lib/
│   ├── cache.ts                              → lib/cache.ts (NEW)
│   ├── rate-limit.ts                         → lib/rate-limit.ts (NEW)
│   ├── sms-queue.ts                          → lib/sms-queue.ts (NEW)
│   └── db/
│       └── members.ts                        → lib/db/members.ts (NEW)
├── migrations/
│   ├── 001_performance_indexes.sql           → Run in Supabase SQL Editor
│   ├── 002_passkey_hashing.sql               → Run in Supabase SQL Editor
│   ├── 003_sms_queue_table.sql               → Run in Supabase SQL Editor
│   └── 004_cron_jobs.sql                     → Run in Supabase SQL Editor
└── supabase/
    └── functions/
        └── process-sms-queue/
            └── index.ts                      → Deploy as Supabase Edge Function
```

---

## Step-by-step

### 1 — Install new dependencies
```bash
npm install @upstash/redis @upstash/ratelimit
```

### 2 — Copy the code files into your repo
Drop the files from this zip into the matching paths listed above.
The two root files (`middleware.ts`, `next.config.ts`) replace existing files.
All `lib/` files are new additions.

### 3 — Update environment variables
Add the new variables from `.env.example` to your `.env.local`:
- `SUPABASE_JWT_SECRET`   — from Supabase Dashboard → Settings → API
- `DATABASE_URL`          — Transaction Pooler URL (port 6543) from Supabase Dashboard
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — from upstash.com

### 4 — Run SQL migrations (in order)
Open Supabase Dashboard → SQL Editor and run each file in order:

```
001_performance_indexes.sql   ← Safe to run first, no dependencies
002_passkey_hashing.sql       ← Hashes existing passkeys (run once only)
003_sms_queue_table.sql       ← Creates the async SMS queue table
004_cron_jobs.sql             ← Requires pg_cron extension enabled first
```

**Before running 002:** Check no passkeys are already hashed:
```sql
SELECT id, slug, passkey FROM church.churches LIMIT 10;
```
If any passkeys start with `$2`, they're already hashed — skip 002.

**Before running 004:** Enable pg_cron in Supabase Dashboard → Database → Extensions.

### 5 — Deploy the Edge Function
```bash
supabase functions deploy process-sms-queue
supabase secrets set AFRICASTALKING_API_KEY=your-key
supabase secrets set AFRICASTALKING_USERNAME=your-username
```

### 6 — Replace direct Africa's Talking calls with queueSms()
In any file that currently calls `at.SMS.send()` directly, replace it:

```typescript
// Before (blocks the HTTP response for 500–2000ms):
await at.SMS.send({ to: [phone], message: body });

// After (returns immediately, sends async):
import { queueSms } from '@/lib/sms-queue';
await queueSms(supabase, { tenantId, recipients: [phone], message: body });
```

### 7 — Replace unbounded member queries with paginated ones
```typescript
// Before:
const { data } = await supabase.from('members').select('*').eq('church_id', id);

// After:
import { getMembers } from '@/lib/db/members';
const { data, total, hasMore } = await getMembers(supabase, churchId, page);
```

### 8 — Add rate limiting to sensitive API routes
```typescript
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(request, 'sms', tenantId);
  if (limited) return limited; // 429 response
  // ... rest of handler
}
```

---

## What each fix does

| Fix | Impact |
|-----|--------|
| `middleware.ts` — `getSession()` instead of `getUser()` | Eliminates network call on every page load |
| `001_performance_indexes.sql` | Faster RLS policy evaluation under load |
| `lib/cache.ts` + `lib/db/members.ts` | Absorbs read spikes — DB only hit once per 60s |
| `003_sms_queue_table.sql` + Edge Function | SMS sends no longer block HTTP responses |
| `004_cron_jobs.sql` | `refresh_inactive_30_days` no longer full-table scans |
| `lib/rate-limit.ts` | Prevents one bad client from starving the others |
| `002_passkey_hashing.sql` | Passkeys no longer stored in plaintext |
| `next.config.ts` | ESLint errors caught at build time, not in production |

---

## After applying
Run a load test with k6 to validate:
```bash
npm install -g k6
# Write a k6 script that simulates login → dashboard → member list → check-in
# k6 run --vus 100 --duration 30s your-test-script.js
```
Start at 100 VUs, then 500, then 1000. Watch for p95 > 300ms on admin routes.
