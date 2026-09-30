-- ============================================================================
-- Migration 005 — Consecutive-event absence flags
-- ============================================================================
-- Replaces the Sunday/calendar-based absence detection with an event-streak
-- engine that works for ANY meeting schedule (Sundays-only churches,
-- Monday+Tuesday university fellowships, weekday prayer meetings, ...).
--
-- Rule: a member is flagged when they have not attended (present/late) the
-- last N consecutive *completed* events of their fellowship, counting back
-- from the most recent event. 'excused' breaks the streak just like
-- attending. Only events on/after the member's join date count.
--
-- Why event-streaks instead of calendar windows:
--   * "3 missed Sundays" is meaningless for a Mon+Tue fellowship.
--   * inactive_30_days flags *everyone* during holiday/exam breaks (no
--     meetings held => everyone "inactive"), which is exactly wrong.
--   * inactive_30_days needs ~8 misses before a twice-weekly fellowship
--     flags anyone. The event rule flags at exactly 3 missed meetings.
--
-- The algorithm spec is mirrored in lib/attendance-streaks.ts and locked by
-- tests/attendance-streaks.test.ts. Keep all three in sync.
--
-- Safe to run repeatedly. Run in the Supabase SQL Editor (or psql).
-- ============================================================================

-- 1) New flag type. Legacy values are kept so existing rows/UI stay valid.
ALTER TYPE church.attendance_flag_type ADD VALUE IF NOT EXISTS 'missed_consecutive_events';

-- 2) Per-fellowship threshold: how many consecutive missed events trigger a
--    flag. Default 3 ("missed three consecutive events"). Tunable per tenant,
--    e.g. UPDATE church.churches SET attendance_flag_threshold = 2 ... ;
ALTER TABLE church.churches
  ADD COLUMN IF NOT EXISTS attendance_flag_threshold integer NOT NULL DEFAULT 3;

COMMENT ON COLUMN church.churches.attendance_flag_threshold IS
  'Number of consecutive completed events a member must miss before a missed_consecutive_events flag is raised. Default 3.';

-- 3) The streak engine.
CREATE OR REPLACE FUNCTION church.refresh_consecutive_event_flags(p_church_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = church, public, auth
AS $func$
DECLARE
  v_now       timestamptz := now();
  v_threshold integer;
  v_inserted  integer := 0;
  v_reopened  integer := 0;
BEGIN
  IF p_church_id IS NULL THEN
    RAISE EXCEPTION 'Church ID is required';
  END IF;

  -- Same tenant guard pattern as church.refresh_inactive_30_days: service
  -- role / pg_cron calls have auth.uid() NULL and pass; end users may only
  -- refresh their own tenant.
  IF auth.uid() IS NOT NULL AND p_church_id IS DISTINCT FROM church.my_tenant_id() THEN
    RAISE EXCEPTION 'Unauthorized: cross-tenant access denied';
  END IF;

  -- Clamp to a sane range so a bad column value can never flag a member for
  -- missing 0 events or quietly disable flagging with a huge number.
  SELECT LEAST(GREATEST(COALESCE(c.attendance_flag_threshold, 3), 1), 52)
    INTO v_threshold
    FROM church.churches c
   WHERE c.id = p_church_id;

  IF v_threshold IS NULL THEN
    RAISE EXCEPTION 'Church % not found', p_church_id;
  END IF;

  ---------------------------------------------------------------------------
  -- Streak computation.
  -- For every active member, walk the church's completed events newest ->
  -- oldest (only events on/after the member joined) and count the run of
  -- events without a present/late log that starts at the most recent event.
  -- A missing log counts as a miss; 'excused' breaks the run exactly like
  -- attending. Purely event-driven, never calendar-driven.
  --
  -- Materialised once per call into a session temp table: the streaks feed
  -- four separate DML statements, and a WITH clause only lives for the single
  -- statement it prefixes.
  ---------------------------------------------------------------------------
  DROP TABLE IF EXISTS tmp_cef_streaks;

  CREATE TEMP TABLE tmp_cef_streaks ON COMMIT DROP AS
  WITH ranked AS (
    SELECT
      m.id AS member_id,
      al.attendance_status,
      ROW_NUMBER() OVER (
        PARTITION BY m.id
        ORDER BY e.event_date DESC, e.start_time DESC, e.id DESC
      ) AS rn
    FROM church.members m
    JOIN church.events e
      ON e.church_id = m.church_id
     AND e.status = 'completed'
     AND e.event_date >= (m.created_at AT TIME ZONE 'utc')::date
    LEFT JOIN church.attendance_logs al
      ON al.event_id = e.id
     AND al.member_id = m.id
    WHERE m.church_id = p_church_id
      AND m.status = 'active'
  ),
  marked AS (
    SELECT
      member_id,
      rn,
      MIN(CASE WHEN attendance_status IN ('present', 'late', 'excused') THEN rn END)
        OVER (PARTITION BY member_id) AS first_non_miss_rn
    FROM ranked
  )
  -- Rows ranked before the first attended/excused event are the current run
  -- of consecutive misses. Members with no non-miss at all keep every row.
  SELECT member_id, COUNT(*)::integer AS consecutive_misses
  FROM marked
  WHERE rn < COALESCE(first_non_miss_rn, 2147483647)
  GROUP BY member_id;

  ---------------------------------------------------------------------------
  -- Lifecycle step 1: auto-resolve open / followed_up flags whose streak fell
  -- below threshold (member returned, was excused, or became inactive).
  -- Keeps an audit trail instead of deleting.
  ---------------------------------------------------------------------------
  UPDATE church.attendance_flags f
     SET status = 'resolved'::church.attendance_flag_status
   WHERE f.church_id = p_church_id
     AND f.flag_type = 'missed_consecutive_events'::church.attendance_flag_type
     AND f.status IN ('open'::church.attendance_flag_status, 'followed_up'::church.attendance_flag_status)
     AND COALESCE((SELECT s.consecutive_misses FROM tmp_cef_streaks s WHERE s.member_id = f.member_id), 0) < v_threshold;

  ---------------------------------------------------------------------------
  -- Lifecycle step 2: reopen resolved flags when the member is back at/above
  -- threshold (came back once, then went missing again).
  ---------------------------------------------------------------------------
  UPDATE church.attendance_flags f
     SET status = 'open'::church.attendance_flag_status,
         created_at = v_now,
         notes = 'missed ' || s.consecutive_misses || ' consecutive events'
    FROM tmp_cef_streaks s
   WHERE f.church_id = p_church_id
     AND f.flag_type = 'missed_consecutive_events'::church.attendance_flag_type
     AND f.status = 'resolved'::church.attendance_flag_status
     AND s.member_id = f.member_id
     AND s.consecutive_misses >= v_threshold;

  GET DIAGNOSTICS v_reopened = ROW_COUNT;

  ---------------------------------------------------------------------------
  -- Lifecycle step 3: keep the streak count fresh on already-open flags.
  -- followed_up flags are left alone (a pastor is handling that conversation).
  ---------------------------------------------------------------------------
  UPDATE church.attendance_flags f
     SET notes = 'missed ' || s.consecutive_misses || ' consecutive events'
    FROM tmp_cef_streaks s
   WHERE f.church_id = p_church_id
     AND f.flag_type = 'missed_consecutive_events'::church.attendance_flag_type
     AND f.status = 'open'::church.attendance_flag_status
     AND s.member_id = f.member_id
     AND s.consecutive_misses >= v_threshold;

  ---------------------------------------------------------------------------
  -- Lifecycle step 4: open new flags for members whose streak just reached
  -- the threshold. The UNIQUE (church_id, member_id, flag_type) constraint
  -- plus the reopen UPDATE above makes this race-safe.
  ---------------------------------------------------------------------------
  INSERT INTO church.attendance_flags (id, church_id, member_id, flag_type, status, notes, created_at)
  SELECT
    gen_random_uuid(),
    p_church_id,
    s.member_id,
    'missed_consecutive_events'::church.attendance_flag_type,
    'open'::church.attendance_flag_status,
    'missed ' || s.consecutive_misses || ' consecutive events',
    v_now
  FROM tmp_cef_streaks s
  WHERE s.consecutive_misses >= v_threshold
    AND NOT EXISTS (
      SELECT 1
      FROM church.attendance_flags f
      WHERE f.church_id = p_church_id
        AND f.member_id = s.member_id
        AND f.flag_type = 'missed_consecutive_events'::church.attendance_flag_type
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  DROP TABLE IF EXISTS tmp_cef_streaks;

  RETURN v_inserted + v_reopened;
END;
$func$;

REVOKE EXECUTE ON FUNCTION church.refresh_consecutive_event_flags(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION church.refresh_consecutive_event_flags(uuid) TO authenticated, service_role;

-- 4) Fix the nightly schedules. The old jobs called the functions WITHOUT the
--    required p_church_id and raised 'Church ID is required' every night.
--    The new jobs loop over every tenant. Guarded so the migration still runs
--    cleanly where pg_cron is unavailable (plain PostgreSQL).
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('refresh-inactive-30-days-daily');
    PERFORM cron.unschedule('process-inactive-30-days-followups-daily');
    PERFORM cron.unschedule('refresh-consecutive-event-flags-daily');

    PERFORM cron.schedule(
      'refresh-inactive-30-days-daily',
      '0 2 * * *',
      $cmd$SELECT church.refresh_inactive_30_days(id) FROM church.churches$cmd$
    );
    PERFORM cron.schedule(
      'process-inactive-30-days-followups-daily',
      '10 2 * * *',
      $cmd$SELECT church.process_inactive_30_days_followups(id) FROM church.churches$cmd$
    );
    PERFORM cron.schedule(
      'refresh-consecutive-event-flags-daily',
      '20 2 * * *',
      $cmd$SELECT church.refresh_consecutive_event_flags(id) FROM church.churches$cmd$
    );
  ELSE
    RAISE NOTICE 'pg_cron not available; schedules skipped (server action + event-completion triggers still refresh flags).';
  END IF;
END;
$do$;
