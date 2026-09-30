# Attendance absence flags — "missed N consecutive events you're expected at"

How churchOs decides that a member "hasn't attended in a while", and why it
works for university fellowships with arbitrary meeting days (e.g. Monday main
fellowship + Tuesday prayer night) — including fellowships where **different
members are expected on different days**.

## The rule

> A member is flagged when they have not attended the last **N consecutive
> completed events they were expected at**, counting back from the most
> recent one. **N defaults to 3** and is configurable per church.

Two knobs define "expected at" (both optional, ISO weekdays `1=Mon … 7=Sun`):

| Setting | Where | Meaning |
| --- | --- | --- |
| `meeting_days` | `church.churches` | Weekdays this tenant normally meets. `NULL` = every completed event counts. |
| `expected_days` | `church.members` | Weekdays this member attends. `NULL` = all of the tenant's `meeting_days`. |

An event only counts toward a member's streak when its weekday is in **both**
sets. Without this filter, a Tuesdays-only member in a Mon+Tue fellowship was
flagged after missing **one** real meeting (her Mondays counted as misses) —
the false positive migration 006 fixes. "Last N events" is now "last N of
**their** events".

Why event-streaks instead of calendar windows ("missed 3 Sundays",
"inactive 30 days"):

- **Any meeting rhythm works.** Events define the cadence; the same rule
  covers Sunday-only churches and Mon+Tue fellowships.
- **Breaks are safe.** Holidays/exam breaks create no events, so nobody
  accrues misses while the fellowship is paused.
- **Right-sized.** A twice-weekly fellowship flags after exactly 3 missed
  meetings (~1.5 weeks), not after ~8 (30 days).
- **Fair.** `present`/`late` count as attending; `excused` breaks the streak;
  events before the join date never count; inactive members are skipped;
  only `completed` (finalised) events count.
- **Same-day doubles.** Two events on one day are two meetings — but the
  streak counts back from the newest event, so attending the latest one
  clears the day.

## Where it runs

| Trigger | Code |
| --- | --- |
| Event is marked **completed** (instant, **scoped to the members expected at that event** so big tenants stay cheap) | `updateEventStatus` in `lib/attendance-actions.ts` |
| "Scan Inactivity" button in Admin → Attendance (full tenant) | `runInactivityDetection` |
| "Send Missed You SMS" flow (full tenant) | `sendMissedYouMessages` |
| Nightly 02:20 (pg_cron, all tenants) | `refresh-consecutive-event-flags-daily` |
| Hourly :55 — auto-closes stale events so forgotten closes can't hide misses | `auto-complete-stale-events-hourly` → `church.auto_complete_stale_events()` |

All of these call the same engine:
`church.refresh_consecutive_event_flags(church_id, member_ids[] | NULL)`,
which recomputes streaks and maintains flag rows:

- streak ≥ N, no flag → **open** a `missed_consecutive_events` flag
- streak ≥ N, resolved flag → **reopen** (they went missing again)
- streak < N, open/followed_up flag → **resolve** (they returned)
- `followed_up` flags are never touched while the streak is high (a leader is
  handling that conversation)

Flag notes keep the live streak count, e.g. `missed 4 consecutive events`.

## Configuration

Per-fellowship threshold (each fellowship is its own tenant/slug, so this is
per-fellowship in practice):

```sql
UPDATE church.churches
SET attendance_flag_threshold = 2   -- flag after 2 consecutive misses
WHERE slug = 'muk-christian-union';
```

Meeting days and member expectations:

```sql
-- Fellowship meets Monday + Tuesday
UPDATE church.churches SET meeting_days = '{1,2}' WHERE slug = 'muk-cu';

-- Esther only ever comes on Tuesdays
UPDATE church.members SET expected_days = '{2}' WHERE id = '…';
```

Defaults keep everything backwards compatible: with both columns `NULL`,
every completed event counts for every member (the pre-006 behaviour, minus
the false-positive once you configure days). A member whose `expected_days`
never match any event can never be flagged.

## Setup / migration

- **Existing databases:** run `migrations/005_consecutive_event_flags.sql`
  then `migrations/006_expected_days_and_auto_close.sql` in the Supabase SQL
  Editor, in that order. They are idempotent.
- **Fresh installs:** `supabase-schema.sql` already contains everything.

## Testing / spec

Three artefacts, one behaviour, no silent drift:

- `lib/attendance-streaks.ts` — pure TS specification, runs anywhere
  (`tests/attendance-streaks.test.ts`, no database needed; `npm test`).
- `migrations/005…` + `migrations/006…` — the production SQL engine.
- `tests/sql/attendance_streaks.test.sql` — applies the real migrations to a
  scratch Postgres and drives them through the same scenarios (Mon+Tue
  reviewer case, holiday break, new joiner, inactive member, excused, scoped
  refresh, resolve/reopen lifecycle, auto-close). Runs in CI against
  postgres:16 via `.github/workflows/attendance-sql-tests.yml`.

The old `missed_3_sundays` flag input (a `sync_missed_3_sundays_flags` Edge
Function referenced in code) is gone from the codebase. Heads-up: the
function may still be **deployed** in your Supabase project even though it was
never in git — check Dashboard → Edge Functions and delete it there if you no
longer want Sunday-based flags touched. Existing legacy flag rows are still
honoured by the SMS flow and rendered by the UI; the SMS flow does not create
new ones.

`inactive_30_days` still runs for backward compatibility, but
`missed_consecutive_events` is the recommended signal for follow-up.
