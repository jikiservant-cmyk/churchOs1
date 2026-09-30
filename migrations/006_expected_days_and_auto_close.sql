-- ============================================================================
-- Migration 006 — Expected-day filtering, scoped recompute, auto-close
-- ============================================================================
-- Code-review response for migration 005 (consecutive-event flags).
--
-- THE BUG (verified): the 005 engine counted EVERY completed event in the
-- church for EVERY member. In a Mon+Tue fellowship, a member who only ever
-- attends Tuesdays accumulated "misses" for Monday events too, so they were
-- flagged after 3 consecutive events while having missed only ONE meeting
-- they were actually expected at.
--
-- THE FIX (merging the reviewer's design into this engine):
--   church.churches.meeting_days  — ISO weekdays (1=Mon .. 7=Sun) the tenant
--                                   normally meets on. NULL = every event
--                                   counts (backwards compatible with 005).
--   church.members.expected_days  — the ISO weekdays this member is expected
--                                   at. NULL = all of the tenant's meeting
--                                   days (the default; current behaviour).
-- A completed event only counts toward a member's streak when its weekday is
-- in BOTH sets (tenant meeting_days, if configured, AND the member's
-- expected_days, if set). "Last N events" is now "last N of THEIR events".
--
-- Also in this migration:
--   * Scoped recompute: refresh_consecutive_event_flags(church_id, member_ids)
--     can refresh just the members expected at one event, so completing an
--     event doesn't recompute an entire big tenant.
--   * church.auto_complete_stale_events(): events left open (usher forgot to
--     close) are auto-completed after a grace period, otherwise their misses
--     would never count. Runs hourly via pg_cron.
--
-- Safe to run repeatedly. Run after 005_consecutive_event_flags.sql.
-- ============================================================================

-- 1) Expected-day columns ----------------------------------------------------
ALTER TABLE church.churches
  ADD COLUMN IF NOT EXISTS meeting_days smallint[] DEFAULT NULL;

ALTER TABLE church.members
  ADD COLUMN IF NOT EXISTS expected_days smallint[] DEFAULT NULL;

COMMENT ON COLUMN church.churches.meeting_days IS
  'ISO weekdays (1=Mon..7=Sun) this tenant normally meets on. NULL = every completed event counts toward absence streaks.';
COMMENT ON COLUMN church.members.expected_days IS
  'ISO weekdays (1=Mon..7=Sun) this member is expected to attend. NULL = all of the tenant meeting_days.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'churches_meeting_days_valid') THEN
    ALTER TABLE church.churches
      ADD CONSTRAINT churches_meeting_days_valid
      CHECK (meeting_days IS NULL OR (array_length(meeting_days, 1) BETWEEN 1 AND 7 AND meeting_days <@ '{1,2,3,4,5,6,7}'::smallint[]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_expected_days_valid') THEN
    ALTER TABLE church.members
      ADD CONSTRAINT members_expected_days_valid
      CHECK (expected_days IS NULL OR (array_length(expected_days, 1) BETWEEN 1 AND 7 AND expected_days <@ '{1,2,3,4,5,6,7}'::smallint[]));
  END IF;
END $$;

-- 2) Replace the engine -------------------------------------------------------
-- The 005 single-argument overload is dropped so there is no signature
-- ambiguity on RPC calls.
DROP FUNCTION IF EXISTS church.refresh_consecutive_event_flags(uuid);

CREATE OR REPLACE FUNCTION church.refresh_consecutive_event_flags(
  p_church_id  uuid,
  p_member_ids uuid[] DEFAULT NULL   -- NULL = all active members (nightly/manual).
                                     -- Set = only these members (event-completion path).
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = church, public, auth
AS $func$
DECLARE
  v_now          timestamptz := now();
  v_threshold    integer;
  v_meeting_days smallint[];
  v_inserted     integer := 0;
  v_reopened     integer := 0;
BEGIN
  IF p_church_id IS NULL THEN
    RAISE EXCEPTION 'Church ID is required';
  END IF;

  -- Tenant guard (nested IFs: never evaluate my_tenant_id() when there is no
  -- caller context — service role / pg_cron pass through).
  IF auth.uid() IS NOT NULL THEN
    IF p_church_id IS DISTINCT FROM church.my_tenant_id() THEN
      RAISE EXCEPTION 'Unauthorized: cross-tenant access denied';
    END IF;
  END IF;

  -- Scope filter must be non-empty when given, or every statement below would
  -- silently no-op on an empty array. Treat 'all' as the default instead.
  IF p_member_ids IS NOT NULL AND array_length(p_member_ids, 1) IS NULL THEN
    p_member_ids := NULL;
  END IF;

  SELECT LEAST(GREATEST(COALESCE(c.attendance_flag_threshold, 3), 1), 52),
         c.meeting_days
    INTO v_threshold, v_meeting_days
    FROM church.churches c
   WHERE c.id = p_church_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Church % not found', p_church_id;
  END IF;

  ---------------------------------------------------------------------------
  -- Streak computation.
  -- For every (scoped) active member, walk the church's completed events
  -- newest -> oldest and count the run of misses starting at the most recent
  -- event the member was EXPECTED at:
  --   * event weekday must be in the tenant meeting_days (when configured)
  --   * event weekday must be in the member's expected_days (when set)
  --   * event must be on/after the member joined
  -- A missing log counts as a miss; 'present'/'late'/'excused' break the run.
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
     AND (v_meeting_days IS NULL
          OR extract(isodow FROM e.event_date)::smallint = ANY(v_meeting_days))
     AND (m.expected_days IS NULL
          OR extract(isodow FROM e.event_date)::smallint = ANY(m.expected_days))
    LEFT JOIN church.attendance_logs al
      ON al.event_id = e.id
     AND al.member_id = m.id
    WHERE m.church_id = p_church_id
      AND m.status = 'active'
      AND (p_member_ids IS NULL OR m.id = ANY(p_member_ids))
  ),
  marked AS (
    SELECT
      member_id,
      rn,
      MIN(CASE WHEN attendance_status IN ('present', 'late', 'excused') THEN rn END)
        OVER (PARTITION BY member_id) AS first_non_miss_rn
    FROM ranked
  )
  SELECT member_id, COUNT(*)::integer AS consecutive_misses
  FROM marked
  WHERE rn < COALESCE(first_non_miss_rn, 2147483647)
  GROUP BY member_id;

  -- Lifecycle 1: resolve open/followed_up flags whose streak fell below the
  -- threshold (returned, excused, no longer expected at upcoming events, or
  -- became inactive).
  UPDATE church.attendance_flags f
     SET status = 'resolved'::church.attendance_flag_status
   WHERE f.church_id = p_church_id
     AND f.flag_type = 'missed_consecutive_events'::church.attendance_flag_type
     AND f.status IN ('open'::church.attendance_flag_status, 'followed_up'::church.attendance_flag_status)
     AND (p_member_ids IS NULL OR f.member_id = ANY(p_member_ids))
     AND COALESCE((SELECT s.consecutive_misses FROM tmp_cef_streaks s WHERE s.member_id = f.member_id), 0) < v_threshold;

  -- Lifecycle 2: reopen resolved flags back at/above threshold.
  UPDATE church.attendance_flags f
     SET status = 'open'::church.attendance_flag_status,
         created_at = v_now,
         notes = 'missed ' || s.consecutive_misses || ' consecutive events'
    FROM tmp_cef_streaks s
   WHERE f.church_id = p_church_id
     AND f.flag_type = 'missed_consecutive_events'::church.attendance_flag_type
     AND f.status = 'resolved'::church.attendance_flag_status
     AND s.member_id = f.member_id
     AND (p_member_ids IS NULL OR f.member_id = ANY(p_member_ids))
     AND s.consecutive_misses >= v_threshold;

  GET DIAGNOSTICS v_reopened = ROW_COUNT;

  -- Lifecycle 3: refresh the live streak count on already-open flags.
  UPDATE church.attendance_flags f
     SET notes = 'missed ' || s.consecutive_misses || ' consecutive events'
    FROM tmp_cef_streaks s
   WHERE f.church_id = p_church_id
     AND f.flag_type = 'missed_consecutive_events'::church.attendance_flag_type
     AND f.status = 'open'::church.attendance_flag_status
     AND s.member_id = f.member_id
     AND (p_member_ids IS NULL OR f.member_id = ANY(p_member_ids))
     AND s.consecutive_misses >= v_threshold;

  -- Lifecycle 4: open new flags at/above threshold.
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

REVOKE EXECUTE ON FUNCTION church.refresh_consecutive_event_flags(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION church.refresh_consecutive_event_flags(uuid, uuid[]) TO authenticated, service_role;

-- 3) Auto-close stale events ---------------------------------------------------
-- Events only count toward streaks once they are 'completed' (attendance is
-- final). An usher who never closes an event would hide every miss from it,
-- so events whose start time is more than p_grace_hours in the past are
-- completed automatically. The hourly cron calls this for every tenant;
-- admins could also call it for their own church.
CREATE OR REPLACE FUNCTION church.auto_complete_stale_events(
  p_church_id  uuid DEFAULT NULL,     -- NULL = all tenants (cron path)
  p_grace_hours integer DEFAULT 6
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = church, public, auth
AS $func$
DECLARE
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF p_church_id IS NULL OR p_church_id IS DISTINCT FROM church.my_tenant_id() THEN
      RAISE EXCEPTION 'Unauthorized: cross-tenant access denied';
    END IF;
  END IF;

  UPDATE church.events e
     SET status = 'completed'::church.event_status
   WHERE e.status IN ('upcoming'::church.event_status, 'active'::church.event_status)
     AND (p_church_id IS NULL OR e.church_id = p_church_id)
     AND (e.event_date + e.start_time) < now() - make_interval(hours => GREATEST(p_grace_hours, 1));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$func$;

REVOKE EXECUTE ON FUNCTION church.auto_complete_stale_events(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION church.auto_complete_stale_events(uuid, integer) TO authenticated, service_role;

-- 4) Schedules -------------------------------------------------------------------
-- 005 fixed the broken no-arg nightly jobs; here we add the hourly auto-close.
-- Stale events get closed within an hour, so the 02:20 nightly flag refresh
-- (and the instant refresh on manual completion) always sees them.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('auto-complete-stale-events-hourly');
    PERFORM cron.schedule(
      'auto-complete-stale-events-hourly',
      '55 * * * *',
      $cmd$SELECT church.auto_complete_stale_events()$cmd$
    );
  ELSE
    RAISE NOTICE 'pg_cron not available; auto-complete schedule skipped.';
  END IF;
END;
$do$;
