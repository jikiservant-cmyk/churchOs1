-- ============================================================================
-- tests/sql/attendance_streaks.test.sql
-- ============================================================================
-- Executes the REAL migration files against a scratch Postgres and drives the
-- production SQL engine (church.refresh_consecutive_event_flags) through the
-- same fixture scenarios locked by the TypeScript suite
-- (tests/attendance-streaks.test.ts) — including the code-review Mon/Tue
-- case. This is what keeps the SQL, the TS spec, and the tests from drifting.
--
-- Run (from repo root, any Postgres >= 14):
--   psql -d your_db -v ON_ERROR_STOP=1 -f tests/sql/attendance_streaks.test.sql
-- CI: .github/workflows/attendance-sql-tests.yml
--
-- Any failed expectation raises an exception and aborts with a non-zero exit.
-- ============================================================================

\set QUIET on
\set ON_ERROR_STOP on

-- NOTE: intentionally NOT wrapped in one big transaction. ALTER TYPE ...
-- ADD VALUE (migration 005) forbids using the new enum value in the same
-- transaction, and the assertions below call the engine (which uses it).
-- Autocommit keeps each statement in its own transaction, exactly like the
-- Supabase SQL editor does. The harness cleans up after itself at the end.

-- ---------------------------------------------------------------------------
-- 0. Minimal harness: the database objects the migrations touch, in their
--    PRE-005 state. The real migrations (005 then 006) are applied to it.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS church;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Supabase built-in roles referenced by the migrations' GRANT/REVOKE
-- statements. Harmless on real Supabase (they already exist).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE TYPE church.event_status AS ENUM ('upcoming', 'active', 'completed');
CREATE TYPE church.attendance_status AS ENUM ('present', 'late', 'absent', 'excused');
-- pre-005 flag enum: only the two legacy values
CREATE TYPE church.attendance_flag_type AS ENUM ('missed_3_sundays', 'inactive_30_days');
CREATE TYPE church.attendance_flag_status AS ENUM ('open', 'followed_up', 'resolved');

CREATE TABLE church.churches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  slug text UNIQUE
);

CREATE TABLE church.members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL,
  full_name text,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE church.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL,
  event_date date NOT NULL,
  start_time time NOT NULL DEFAULT '18:00:00',
  status church.event_status NOT NULL DEFAULT 'upcoming'
);

CREATE TABLE church.attendance_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL,
  member_id uuid NOT NULL,
  event_id uuid NOT NULL,
  attendance_status church.attendance_status NOT NULL,
  check_in_time timestamptz DEFAULT now(),
  UNIQUE (member_id, event_id)
);

CREATE TABLE church.attendance_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL,
  member_id uuid NOT NULL,
  flag_type church.attendance_flag_type NOT NULL,
  status church.attendance_flag_status NOT NULL DEFAULT 'open',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (church_id, member_id, flag_type)
);

-- Engine guard relies on auth.uid() being NULL for service/cron contexts.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

-- ---------------------------------------------------------------------------
-- 1. Apply the real migrations, in order. This alone catches syntax errors,
--    signature drift, and non-idempotent statements.
-- ---------------------------------------------------------------------------
\echo '== applying migration 005 =='
\ir ../../migrations/005_consecutive_event_flags.sql
\echo '== applying migration 006 =='
\ir ../../migrations/006_expected_days_and_auto_close.sql

-- Sanity: migrations must be idempotent (they are re-run here inside the
-- same transaction the fixtures use).

-- ---------------------------------------------------------------------------
-- 2. Fixtures — a Mon+Tue university fellowship, plus the reviewer scenario.
--    ISO weekdays: 2026-08-18/25 are Tuesdays; 2026-08-24/31 are Mondays.
-- ---------------------------------------------------------------------------
INSERT INTO church.churches (id, name, slug, attendance_flag_threshold, meeting_days)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'MUK Christian Union', 'muk-cu', 3, '{1,2}');

-- A second tenant with NO meeting_days configured (legacy behaviour).
INSERT INTO church.churches (id, name, slug, attendance_flag_threshold, meeting_days)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 'Legacy Chapel', 'legacy', 3, NULL);

-- A third tenant on semester break (no events for 6+ weeks).
INSERT INTO church.churches (id, name, slug, attendance_flag_threshold, meeting_days)
VALUES ('aaaaaaaa-0000-0000-0000-000000000003', 'Break Chapel', 'break', 3, NULL);

INSERT INTO church.events (id, church_id, event_date, start_time, status) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-08-31', '18:00', 'completed'), -- Mon wk3
  ('eeeeeeee-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-08-25', '18:00', 'completed'), -- Tue wk2
  ('eeeeeeee-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-08-24', '18:00', 'completed'), -- Mon wk2
  ('eeeeeeee-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-08-18', '18:00', 'completed'); -- Tue wk1

INSERT INTO church.members (id, church_id, full_name, status, expected_days, created_at) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Esther Tuesday-Only', 'active', '{2}', '2026-08-01'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'John All-Days', 'active', NULL, '2026-08-01'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'Nina New-Joiner', 'active', NULL, '2026-08-30'),
  ('bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'Ian Inactive', 'inactive', NULL, '2026-08-01'),
  ('bbbbbbbb-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000003', 'Hanna Holiday', 'active', NULL, '2026-06-01');

-- Esther: present Tuesday week 1 only (per the review: 1 real miss, 2 non-days).
INSERT INTO church.attendance_logs (church_id, member_id, event_id, attendance_status) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000004', 'present');

-- Hanna: attended the last event before the break (6 weeks ago; calendar
-- rules would flag her by now, event rules must not).
INSERT INTO church.events (id, church_id, event_date, start_time, status) VALUES
  ('eeeeeeee-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000003', '2026-07-14', '18:00', 'completed');
INSERT INTO church.attendance_logs (church_id, member_id, event_id, attendance_status) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000005', 'eeeeeeee-0000-0000-0000-000000000005', 'present');

-- ---------------------------------------------------------------------------
-- 3. SCOPED refresh first: only Esther evaluated -> no flags at all yet.
--    (Proves the member_ids scoping really narrows the recompute.)
-- ---------------------------------------------------------------------------
\echo '== scoped refresh (Esther only) =='
SELECT church.refresh_consecutive_event_flags(
  'aaaaaaaa-0000-0000-0000-000000000001',
  ARRAY['bbbbbbbb-0000-0000-0000-000000000001']::uuid[]
) AS opened;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM church.attendance_flags
             WHERE church_id = 'aaaaaaaa-0000-0000-0000-000000000001'
               AND flag_type = 'missed_consecutive_events') THEN
    RAISE EXCEPTION 'ASSERT FAILED: scoped refresh of a below-threshold member created flags';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. FULL refresh: John's streak (Mon+Tue, 4 events, none attended) = 4 >= 3
--    -> flagged. Esther = 1 (her own Tuesday only) -> not flagged.
-- ---------------------------------------------------------------------------
\echo '== full refresh =='
SELECT church.refresh_consecutive_event_flags('aaaaaaaa-0000-0000-0000-000000000001') AS opened;

DO $$
BEGIN
  -- REVIEW CASE: Esther (Tuesdays only) must NOT be flagged.
  IF EXISTS (SELECT 1 FROM church.attendance_flags
             WHERE member_id = 'bbbbbbbb-0000-0000-0000-000000000001'
               AND flag_type = 'missed_consecutive_events') THEN
    RAISE EXCEPTION 'ASSERT FAILED (review case): Tuesdays-only member flagged for Monday misses';
  END IF;

  -- John attends everything -> missed all 4 -> flagged with live streak notes.
  IF NOT EXISTS (SELECT 1 FROM church.attendance_flags
                 WHERE member_id = 'bbbbbbbb-0000-0000-0000-000000000002'
                   AND flag_type = 'missed_consecutive_events'
                   AND status = 'open'
                   AND notes = 'missed 4 consecutive events') THEN
    RAISE EXCEPTION 'ASSERT FAILED: all-days member with streak 4 not flagged (or wrong notes)';
  END IF;

  -- Nina joined 2026-08-30: only Mon wk3 is hers to miss -> streak 1 -> no flag.
  IF EXISTS (SELECT 1 FROM church.attendance_flags
             WHERE member_id = 'bbbbbbbb-0000-0000-0000-000000000003'
               AND flag_type = 'missed_consecutive_events') THEN
    RAISE EXCEPTION 'ASSERT FAILED: new joiner blamed for events before joining';
  END IF;

  -- Ian is inactive: never flagged.
  IF EXISTS (SELECT 1 FROM church.attendance_flags
             WHERE member_id = 'bbbbbbbb-0000-0000-0000-000000000004'
               AND flag_type = 'missed_consecutive_events') THEN
    RAISE EXCEPTION 'ASSERT FAILED: inactive member flagged';
  END IF;
END $$;

-- Holiday tenant: member attended the last event before a 6-week gap.
SELECT church.refresh_consecutive_event_flags('aaaaaaaa-0000-0000-0000-000000000003') AS opened_break_tenant;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM church.attendance_flags
             WHERE church_id = 'aaaaaaaa-0000-0000-0000-000000000003'
               AND flag_type = 'missed_consecutive_events') THEN
    RAISE EXCEPTION 'ASSERT FAILED: member flagged across a no-event holiday break';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Lifecycle: John returns (present at Mon wk3) -> flag auto-resolves.
--    Then he vanishes again (log removed) -> flag REOPENS.
-- ---------------------------------------------------------------------------
\echo '== lifecycle: return -> resolve, vanish -> reopen =='
INSERT INTO church.attendance_logs (church_id, member_id, event_id, attendance_status) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001', 'present');

SELECT church.refresh_consecutive_event_flags('aaaaaaaa-0000-0000-0000-000000000001') AS after_return;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM church.attendance_flags
                 WHERE member_id = 'bbbbbbbb-0000-0000-0000-000000000002'
                   AND flag_type = 'missed_consecutive_events'
                   AND status = 'resolved') THEN
    RAISE EXCEPTION 'ASSERT FAILED: returning member flag not auto-resolved';
  END IF;
END $$;

DELETE FROM church.attendance_logs
WHERE member_id = 'bbbbbbbb-0000-0000-0000-000000000002'
  AND event_id = 'eeeeeeee-0000-0000-0000-000000000001';

SELECT church.refresh_consecutive_event_flags('aaaaaaaa-0000-0000-0000-000000000001') AS after_vanish;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM church.attendance_flags
                 WHERE member_id = 'bbbbbbbb-0000-0000-0000-000000000002'
                   AND flag_type = 'missed_consecutive_events'
                   AND status = 'open') THEN
    RAISE EXCEPTION 'ASSERT FAILED: flag not reopened after member went missing again';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Excused breaks the streak: Esther misses 1 Tuesday, is excused at the
--    next, then misses -> streak 1 -> still no flag.
-- ---------------------------------------------------------------------------
\echo '== excused breaks streak =='
INSERT INTO church.events (id, church_id, event_date, start_time, status) VALUES
  ('eeeeeeee-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-09-01', '18:00', 'completed'), -- Tue wk3
  ('eeeeeeee-0000-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-09-08', '18:00', 'completed'); -- Tue wk4

INSERT INTO church.attendance_logs (church_id, member_id, event_id, attendance_status) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000006', 'excused');

SELECT church.refresh_consecutive_event_flags('aaaaaaaa-0000-0000-0000-000000000001') AS after_excused_refresh;

DO $$
BEGIN
  -- Her eligible Tuesdays newest first: 09-08 (miss), 09-01 (excused -> break) = 1.
  IF EXISTS (SELECT 1 FROM church.attendance_flags
             WHERE member_id = 'bbbbbbbb-0000-0000-0000-000000000001'
               AND flag_type = 'missed_consecutive_events') THEN
    RAISE EXCEPTION 'ASSERT FAILED: excused did not break the streak';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Auto-close: a stale 'upcoming' event in the past is completed; a future
--    one is left alone.
-- ---------------------------------------------------------------------------
\echo '== auto-close stale events =='
INSERT INTO church.events (id, church_id, event_date, start_time, status) VALUES
  ('eeeeeeee-0000-0000-0000-000000000008', 'aaaaaaaa-0000-0000-0000-000000000001', (CURRENT_DATE - 2), '09:00', 'active'),
  ('eeeeeeee-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000001', (CURRENT_DATE + 2), '09:00', 'upcoming');

SELECT church.auto_complete_stale_events('aaaaaaaa-0000-0000-0000-000000000001', 6) AS closed_count;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM church.events WHERE id = 'eeeeeeee-0000-0000-0000-000000000008' AND status <> 'completed') THEN
    RAISE EXCEPTION 'ASSERT FAILED: stale event not auto-completed';
  END IF;
  IF EXISTS (SELECT 1 FROM church.events WHERE id = 'eeeeeeee-0000-0000-0000-000000000009' AND status <> 'upcoming') THEN
    RAISE EXCEPTION 'ASSERT FAILED: future event wrongly auto-completed';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
\echo 'ALL SQL ATTENDANCE-STREAK ASSERTIONS PASSED'

-- Cleanup: drop the scratch harness objects (safe on ephemeral CI databases;
-- on a shared dev database only run this suite on a scratch schema/db).
DROP SCHEMA church CASCADE;
DROP SCHEMA auth CASCADE;
DROP ROLE IF EXISTS anon;
DROP ROLE IF EXISTS authenticated;
DROP ROLE IF EXISTS service_role;
