/**
 * lib/attendance-streaks.ts
 *
 * Consecutive-event absence detection — the local (no-database) specification
 * for the production engine in SQL:
 *   church.refresh_consecutive_event_flags(church_id, member_ids[])
 *   migrations/005_consecutive_event_flags.sql
 *   migrations/006_expected_days_and_auto_close.sql
 *
 * tests/attendance-streaks.test.ts locks this file; the SAME scenarios are
 * executed against the real SQL in CI (tests/sql/attendance_streaks.test.sql
 * via .github/workflows/attendance-sql-tests.yml), so the SQL and this spec
 * cannot silently drift.
 *
 * The rule (schedule-agnostic and expectation-aware by design)
 * ------------------------------------------------------------
 * A member is flagged when they have not attended the last N consecutive
 * completed events *they were expected at*, counting back from the most
 * recent one. N defaults to 3 and is configurable per church
 * (church.churches.attendance_flag_threshold).
 *
 * "Expected at" is what makes it fair for fellowships where different people
 * attend different days (e.g. a Mon+Tue fellowship where Esther only ever
 * comes on Tuesdays):
 *   - church.churches.meeting_days (ISO weekdays 1=Mon..7=Sun, NULL = every
 *     completed event counts) scopes which events count at all;
 *   - church.members.expected_days (NULL = every tenant meeting day) scopes
 *     which of those count for this member.
 * An event only counts toward a member's streak when its weekday is in BOTH
 * sets. Without the filter, Esther's Mondays counted as her misses and she
 * was flagged after one real missed meeting (the bug migration 006 fixes).
 *
 * Why event-streaks instead of calendar windows ("missed 3 Sundays",
 * "inactive 30 days"):
 *   - Works for ANY meeting rhythm.
 *   - Holiday/exam breaks create no events, so nobody accrues misses while a
 *     fellowship is paused.
 *   - A twice-weekly fellowship flags after exactly 3 missed meetings
 *     (~1.5 weeks), not after ~8 (30 days).
 *
 * Semantics locked by the tests (both TS and SQL suites):
 *   - Only 'completed' events count (attendance is final).
 *   - 'present' and 'late' count as attending; 'excused' breaks the streak
 *     exactly like attending; a missing log counts as a miss.
 *   - Only events on/after the member's join date count.
 *   - Members whose status is not 'active' are not evaluated.
 *   - Two events on the same day are two meetings; the streak always counts
 *     back from the most recent event, so attending the latest one clears the
 *     day. (This is deliberate: they are separate gatherings that could each
 *     be attended.)
 */

import type { AttendanceStatus } from './attendance-types';

export interface StreakEvent {
  id: string;
  event_date: string;   // 'YYYY-MM-DD'
  start_time: string;   // 'HH:MM:SS'
  status: 'upcoming' | 'active' | 'completed';
}

export interface StreakLogEntry {
  member_id: string;
  event_id: string;
  attendance_status: AttendanceStatus;
}

export interface StreakMember {
  id: string;
  status: string;                     // only 'active' members are evaluated
  created_at: string;                 // ISO timestamptz; date part = join date
  /** ISO weekdays 1=Mon..7=Sun. null/undefined = every tenant meeting day. */
  expected_days?: number[] | null;
}

/** Attendance values that break a consecutive-miss streak. */
export const NON_MISS_STATUSES: ReadonlySet<AttendanceStatus> = new Set(['present', 'late', 'excused']);

/**
 * ISO weekday (1=Monday .. 7=Sunday, matching Postgres `extract(isodow ...)`)
 * for a 'YYYY-MM-DD' date string, computed in UTC so server timezones cannot
 * shift the day.
 */
export function isoDowOf(eventDate: string): number {
  const day = new Date(`${eventDate}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return day === 0 ? 7 : day;
}

/**
 * Is this member expected at an event on `eventDate`?
 * Mirrors the SQL join predicate exactly:
 *   (tenant meeting_days IS NULL OR dow = ANY(meeting_days))
 *   AND (member expected_days IS NULL OR dow = ANY(expected_days))
 */
export function isMemberExpectedOn(
  member: Pick<StreakMember, 'expected_days'>,
  eventDate: string,
  tenantMeetingDays?: number[] | null,
): boolean {
  const dow = isoDowOf(eventDate);
  if (tenantMeetingDays && tenantMeetingDays.length > 0 && !tenantMeetingDays.includes(dow)) return false;
  if (member.expected_days && member.expected_days.length > 0 && !member.expected_days.includes(dow)) return false;
  return true;
}

/**
 * The exact member set whose streaks can change when ONE event is completed —
 * used by updateEventStatus to refresh only affected members in a big tenant
 * instead of recomputing everyone. Mirrors the scoped SQL path
 * (refresh_consecutive_event_flags(church_id, member_ids)).
 */
export function membersExpectedAtEvent(args: {
  members: Pick<StreakMember, 'id' | 'status' | 'expected_days'>[];
  eventDate: string;
  tenantMeetingDays?: number[] | null;
}): string[] {
  const { members, eventDate, tenantMeetingDays } = args;
  return members
    .filter((m) => m.status === 'active')
    .filter((m) => isMemberExpectedOn(m, eventDate, tenantMeetingDays))
    .map((m) => m.id);
}

/**
 * Computes, per active member, the number of consecutive completed events
 * THEY WERE EXPECTED AT (newest first) that they have missed. Members with no
 * eligible events, or whose latest expected event was attended, get 0.
 */
export function computeConsecutiveMissStreaks(args: {
  members: StreakMember[];
  events: StreakEvent[];
  logs: StreakLogEntry[];
  /** church.churches.meeting_days: ISO weekdays 1=Mon..7=Sun; null = all events count. */
  tenantMeetingDays?: number[] | null;
}): Map<string, number> {
  const { members, events, logs, tenantMeetingDays } = args;

  const completed = events
    .filter((e) => e.status === 'completed')
    // Newest first; id as tiebreaker so the order is fully deterministic.
    .sort((a, b) =>
      b.event_date.localeCompare(a.event_date) ||
      b.start_time.localeCompare(a.start_time) ||
      b.id.localeCompare(a.id),
    );

  // member_id -> (event_id -> status)
  const logsByMember = new Map<string, Map<string, AttendanceStatus>>();
  for (const log of logs) {
    let byEvent = logsByMember.get(log.member_id);
    if (!byEvent) {
      byEvent = new Map();
      logsByMember.set(log.member_id, byEvent);
    }
    byEvent.set(log.event_id, log.attendance_status);
  }

  const streaks = new Map<string, number>();
  for (const member of members) {
    if (member.status !== 'active') continue;

    const joinDate = (member.created_at || '').slice(0, 10); // 'YYYY-MM-DD'
    const memberLogs = logsByMember.get(member.id);

    let streak = 0;
    for (const event of completed) {
      // Never blame a member for events that happened before they joined.
      if (joinDate && event.event_date < joinDate) continue;

      // Only events the member was expected at can build (or break) a streak.
      if (!isMemberExpectedOn(member, event.event_date, tenantMeetingDays)) continue;

      const status = memberLogs?.get(event.id);
      if (status && NON_MISS_STATUSES.has(status)) break; // streak ends here
      streak++;
    }
    streaks.set(member.id, streak);
  }

  return streaks;
}

export type StreakFlagStatus = 'open' | 'followed_up' | 'resolved';
export type StreakFlagTransition = 'open_new' | 'reopen' | 'resolve' | 'update_open';

export interface StreakFlag {
  member_id: string;
  status: StreakFlagStatus;
}

/**
 * Flag lifecycle state machine, mirroring the SQL steps:
 *   - streak >= threshold, no flag row              -> open_new
 *   - streak >= threshold, resolved                 -> reopen (fresh open)
 *   - streak >= threshold, open                     -> update_open (refresh streak count in notes)
 *   - streak >= threshold, followed_up              -> no change (pastor is on it)
 *   - streak <  threshold, open | followed_up       -> resolve (member returned / went inactive)
 *   - streak <  threshold, resolved | no row        -> no change
 */
export function planFlagTransitions(args: {
  streaks: Map<string, number>;
  existingFlags: StreakFlag[];
  threshold: number;
}): Map<string, StreakFlagTransition> {
  const { streaks, existingFlags, threshold } = args;
  const flagByMember = new Map(existingFlags.map((f) => [f.member_id, f.status]));
  const transitions = new Map<string, StreakFlagTransition>();

  const memberIds = new Set<string>([...streaks.keys(), ...flagByMember.keys()]);
  for (const memberId of memberIds) {
    const streak = streaks.get(memberId) ?? 0;
    const flag = flagByMember.get(memberId);
    const atRisk = streak >= threshold;

    if (atRisk) {
      if (!flag) transitions.set(memberId, 'open_new');
      else if (flag === 'resolved') transitions.set(memberId, 'reopen');
      else if (flag === 'open') transitions.set(memberId, 'update_open');
      // followed_up: leave untouched
    } else {
      if (flag === 'open' || flag === 'followed_up') transitions.set(memberId, 'resolve');
    }
  }

  return transitions;
}

/** Threshold clamp, mirroring the SQL LEAST/GREATEST guard. */
export function clampThreshold(value: number | null | undefined): number {
  const v = value ?? 3;
  return Math.min(Math.max(v, 1), 52);
}
