/**
 * tests/attendance-streaks.test.ts
 *
 * Locks the behaviour of the consecutive-event absence engine
 * (lib/attendance-streaks.ts), which is the tested specification mirrored by
 * church.refresh_consecutive_event_flags in SQL
 * (migrations/005_consecutive_event_flags.sql).
 *
 * The scenarios are built around university fellowships whose meetings fall on
 * arbitrary weekdays (e.g. Monday main fellowship + Tuesday prayer night),
 * which is exactly what the old "missed 3 Sundays" / "inactive 30 days" rules
 * could not express.
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  computeConsecutiveMissStreaks,
  planFlagTransitions,
  clampThreshold,
  isoDowOf,
  isMemberExpectedOn,
  membersExpectedAtEvent,
  type StreakEvent,
  type StreakLogEntry,
  type StreakMember,
} from '../lib/attendance-streaks.ts'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let seq = 0
function ev(date: string, time = '18:00:00', status: StreakEvent['status'] = 'completed'): StreakEvent {
  seq += 1
  return { id: `event-${seq}`, event_date: date, start_time: time, status }
}

function member(id: string, opts: Partial<StreakMember> = {}): StreakMember {
  return { id, status: 'active', created_at: '2026-01-01T00:00:00Z', ...opts }
}

function log(memberId: string, event: StreakEvent, status: StreakLogEntry['attendance_status']): StreakLogEntry {
  return { member_id: memberId, event_id: event.id, attendance_status: status }
}

// A Monday+Tuesday fellowship, four weeks deep, newest last in the array
// (computeConsecutiveMissStreaks sorts internally, so fixture order is random).
const MON_TUE_EVENTS = [
  ev('2026-08-31'), // Mon, week 4  (most recent)
  ev('2026-08-25'), // Tue, week 3
  ev('2026-08-24'), // Mon, week 3
  ev('2026-08-18'), // Tue, week 2
  ev('2026-08-17'), // Mon, week 2
  ev('2026-08-11'), // Tue, week 1
  ev('2026-08-10'), // Mon, week 1  (oldest)
]

// ---------------------------------------------------------------------------

describe('computeConsecutiveMissStreaks', () => {
  test('Mon+Tue fellowship: missing Mon, then Tue, then next Mon = 3 consecutive misses (under one calendar week)', () => {
    // Sarah attended everything two weeks ago, then vanished for the last 3 meetings
    const sarah = member('sarah')
    const logs = [
      log('sarah', MON_TUE_EVENTS[6], 'present'), // Mon wk1
      log('sarah', MON_TUE_EVENTS[5], 'present'), // Tue wk1
      log('sarah', MON_TUE_EVENTS[4], 'present'), // Mon wk2
      log('sarah', MON_TUE_EVENTS[3], 'late'),    // Tue wk2
      // missed Mon wk3, Tue wk3, Mon wk4
    ]

    const streaks = computeConsecutiveMissStreaks({ members: [sarah], events: MON_TUE_EVENTS, logs })
    assert.equal(streaks.get('sarah'), 3, 'three consecutive meetings missed across two different weekdays')
  })

  test('only 2 consecutive misses does NOT reach the default threshold of 3', () => {
    const john = member('john')
    const logs = [
      log('john', MON_TUE_EVENTS[2], 'present'), // Mon wk3 attended
      // missed Tue wk3 + Mon wk4
    ]
    const streaks = computeConsecutiveMissStreaks({ members: [john], events: MON_TUE_EVENTS, logs })
    assert.equal(streaks.get('john'), 2)
    assert.ok((streaks.get('john') ?? 0) < 3)
  })

  test('holiday break: no events held for 6 weeks accrues ZERO misses (fellowship paused, not members)', () => {
    // Semester break: last event 24 Aug, everything before attended. The old
    // inactive_30_days calendar rule would flag everyone here; events don't.
    const lastEventBeforeBreak = ev('2026-08-24')
    const grace = member('grace', { created_at: '2026-08-01T00:00:00Z' })
    const logs = [log('grace', lastEventBeforeBreak, 'present')]

    const streaks = computeConsecutiveMissStreaks({ members: [grace], events: [lastEventBeforeBreak], logs })
    assert.equal(streaks.get('grace'), 0)
  })

  test('a member who attended the most recent meeting has streak 0 even with older misses', () => {
    const peter = member('peter')
    const logs = [
      log('peter', MON_TUE_EVENTS[0], 'present'), // back this Monday
      // missed the 4 meetings before that
    ]
    const streaks = computeConsecutiveMissStreaks({ members: [peter], events: MON_TUE_EVENTS, logs })
    assert.equal(streaks.get('peter'), 0)
  })

  test("'excused' breaks the streak exactly like attending", () => {
    const mary = member('mary')
    const logs = [
      log('mary', MON_TUE_EVENTS[3], 'excused'), // told leaders she'd miss Tue wk2
      // missed Mon wk3 (after excused), and Mon/Tue wk1-2 handled below
      log('mary', MON_TUE_EVENTS[4], 'absent'),
    ]
    const streaks = computeConsecutiveMissStreaks({ members: [mary], events: MON_TUE_EVENTS, logs })
    // Missed Mon wk4, Tue wk3, Mon wk3 -> then excused on Tue wk2 breaks the run
    assert.equal(streaks.get('mary'), 3)
  })

  test('new member who joined 2 days ago is never blamed for earlier meetings', () => {
    const newMember = member('newbie', { created_at: '2026-08-30T09:00:00Z' }) // joined Sun 30 Aug
    // All 7 events exist, 6 happened before she joined, and she missed Mon 31st
    const streaks = computeConsecutiveMissStreaks({ members: [newMember], events: MON_TUE_EVENTS, logs: [] })
    assert.equal(streaks.get('newMember') ?? streaks.get('newbie'), 1, 'only the Monday she could attend counts')
  })

  test('upcoming/active events never count (attendance is not finalised)', () => {
    const future = ev('2026-09-07', '18:00:00', 'upcoming')
    const live = ev('2026-08-31', '18:00:00', 'active')
    const david = member('david')
    // No logs at all, but the only completed events are the 7 past ones;
    // future/in-progress meetings must not inflate the streak.
    const streaks = computeConsecutiveMissStreaks({
      members: [david],
      events: [...MON_TUE_EVENTS, future, live],
      logs: [],
    })
    assert.equal(streaks.get('david'), 7)
  })

  test('same-day double events each count separately, and attending the latest one clears the day', () => {
    // A fellowship with a 9am devotion and a 6pm main gathering on Monday.
    const morning = ev('2026-08-31', '09:00:00')
    const evening = ev('2026-08-31', '18:00:00')

    // Attended the evening gathering -> engaged, streak 0 (the morning miss
    // is behind an attendance, exactly like attending Tuesday clears Monday).
    const streakA = computeConsecutiveMissStreaks({
      members: [member('a')],
      events: [morning, evening],
      logs: [log('a', evening, 'present')],
    })
    assert.equal(streakA.get('a'), 0)

    // Attended only the morning, missed the most recent (evening) -> streak 1.
    const streakB = computeConsecutiveMissStreaks({
      members: [member('b')],
      events: [morning, evening],
      logs: [log('b', morning, 'present')],
    })
    assert.equal(streakB.get('b'), 1)

    // Missed both -> 2 (same-day events are still two separate meetings).
    const streakC = computeConsecutiveMissStreaks({
      members: [member('c')],
      events: [morning, evening],
      logs: [],
    })
    assert.equal(streakC.get('c'), 2)
  })

  test('inactive members are not evaluated (alumni / left the fellowship)', () => {
    const alumni = member('alumni', { status: 'inactive' })
    const streaks = computeConsecutiveMissStreaks({ members: [alumni], events: MON_TUE_EVENTS, logs: [] })
    assert.equal(streaks.has('alumni'), false)
  })
})

// ---------------------------------------------------------------------------

describe('planFlagTransitions (flag lifecycle)', () => {
  const THRESHOLD = 3

  test('streak of exactly 3 opens a new flag ("missed three consecutive events")', () => {
    const t = planFlagTransitions({ streaks: new Map([['a', 3]]), existingFlags: [], threshold: THRESHOLD })
    assert.equal(t.get('a'), 'open_new')
  })

  test('streak of 2 with no flag does nothing', () => {
    const t = planFlagTransitions({ streaks: new Map([['a', 2]]), existingFlags: [], threshold: THRESHOLD })
    assert.equal(t.has('a'), false)
  })

  test('member who returned gets their open flag resolved', () => {
    const t = planFlagTransitions({
      streaks: new Map([['a', 0]]),
      existingFlags: [{ member_id: 'a', status: 'open' }],
      threshold: THRESHOLD,
    })
    assert.equal(t.get('a'), 'resolve')
  })

  test('a followed_up flag is NOT disturbed while the streak is still high, but resolves when they return', () => {
    const stillMissing = planFlagTransitions({
      streaks: new Map([['a', 5]]),
      existingFlags: [{ member_id: 'a', status: 'followed_up' }],
      threshold: THRESHOLD,
    })
    assert.equal(stillMissing.has('a'), false)

    const returned = planFlagTransitions({
      streaks: new Map([['a', 1]]),
      existingFlags: [{ member_id: 'a', status: 'followed_up' }],
      threshold: THRESHOLD,
    })
    assert.equal(returned.get('a'), 'resolve')
  })

  test('resolved flag reopens when the member goes missing again', () => {
    const t = planFlagTransitions({
      streaks: new Map([['a', 4]]),
      existingFlags: [{ member_id: 'a', status: 'resolved' }],
      threshold: THRESHOLD,
    })
    assert.equal(t.get('a'), 'reopen')
  })

  test('already-open flags get their streak count refreshed', () => {
    const t = planFlagTransitions({
      streaks: new Map([['a', 6]]),
      existingFlags: [{ member_id: 'a', status: 'open' }],
      threshold: THRESHOLD,
    })
    assert.equal(t.get('a'), 'update_open')
  })

  test('weekly rhythm independence: the same streak logic covers Sunday-only churches and Mon+Tue fellowships', () => {
    // 3 missed consecutive meetings means 3 weeks away for a Sunday church...
    const sundays = [ev('2026-08-30', '09:00:00'), ev('2026-08-23', '09:00:00'), ev('2026-08-16', '09:00:00')]
    // ...but only ~1.5 weeks away for a Mon+Tue fellowship. Same code path.
    const sundayMember = member('sunday')
    const weekdayMember = member('weekday')

    const s1 = computeConsecutiveMissStreaks({ members: [sundayMember], events: sundays, logs: [] })
    const s2 = computeConsecutiveMissStreaks({ members: [weekdayMember], events: MON_TUE_EVENTS.slice(0, 3), logs: [] })

    assert.equal(s1.get('sunday'), 3)
    assert.equal(s2.get('weekday'), 3)

    const transitions = planFlagTransitions({
      streaks: new Map([['sunday', 3], ['weekday', 3]]),
      existingFlags: [],
      threshold: THRESHOLD,
    })
    assert.equal(transitions.get('sunday'), 'open_new')
    assert.equal(transitions.get('weekday'), 'open_new')
  })
})

// ---------------------------------------------------------------------------

describe('clampThreshold', () => {
  test('defaults to 3 and clamps nonsense values to [1, 52]', () => {
    assert.equal(clampThreshold(null), 3)
    assert.equal(clampThreshold(undefined), 3)
    assert.equal(clampThreshold(0), 1)
    assert.equal(clampThreshold(-4), 1)
    assert.equal(clampThreshold(500), 52)
    assert.equal(clampThreshold(4), 4)
  })
})

// ---------------------------------------------------------------------------

describe('expected-day filtering (the Mon/Tue review case)', () => {
  // ISO weekdays: Mondays are 1, Tuesdays 2. Our fixture dates are real:
  // 2026-08-10/17/24/31 are Mondays; 2026-08-11/18/25 are Tuesdays.
  const TUESDAY = 2

  test('REVIEW SCENARIO: a Tuesdays-only member must NOT be flagged for Monday misses', () => {
    // Esther attends Tuesdays only, in a fellowship that meets Mon AND Tue.
    // Week 1: Tue present. Week 2: Mon (not her day) + Tue (REAL miss).
    // Week 3: Mon (not her day). Without the filter this was a streak of 3
    // and a false flag (proven before migration 006).
    const reviewerEvents = [
      ev('2026-08-31'), // Mon wk3 — not her day
      ev('2026-08-25'), // Tue wk2 — her one real miss
      ev('2026-08-24'), // Mon wk2 — not her day
      ev('2026-08-18'), // Tue wk1 — she was present
    ]
    const esther = member('esther', { expected_days: [TUESDAY] })
    const logs = [log('esther', reviewerEvents[3], 'present')] // Tue wk1

    const streaks = computeConsecutiveMissStreaks({ members: [esther], events: reviewerEvents, logs })
    assert.equal(streaks.get('esther'), 1, 'only her own Tuesday miss counts')
    assert.ok((streaks.get('esther') ?? 0) < 3, 'not flagged after one real missed meeting')
  })

  test('a Tuesdays-only member IS flagged after missing 3 of HER OWN consecutive Tuesdays', () => {
    // Same Esther, but now she has missed three Tuesdays in a row.
    const esther = member('esther', { expected_days: [TUESDAY] })
    // no logs at all: Tue wk3, Tue wk2, Tue wk1 all missed (Mondays ignored)
    const streaks = computeConsecutiveMissStreaks({ members: [esther], events: MON_TUE_EVENTS, logs: [] })
    assert.equal(streaks.get('esther'), 3, 'three consecutive Tuesdays')
  })

  test('tenant meeting_days scopes which events count for everyone (NULL-expected members)', () => {
    // Fellowship officially meets Tuesdays only. A one-off Monday event
    // (conference, outreach) must not count, even for members with no
    // expected_days override.
    const john = member('john') // expected_days null -> all tenant meeting days
    const events = [
      ev('2026-08-31'), // Mon wk4 special event
      ev('2026-08-25'), // Tue wk3
      ev('2026-08-18'), // Tue wk2
    ]
    const streaks = computeConsecutiveMissStreaks({
      members: [john],
      events,
      logs: [],
      tenantMeetingDays: [TUESDAY],
    })
    assert.equal(streaks.get('john'), 2, 'only the two Tuesdays count, Monday special excluded')
  })

  test('member expected_days and tenant meeting_days intersect', () => {
    // Tenant meets Mon+Tue; Esther expected Tue only. Monday fails Esther's
    // filter; an event on Wednesday would fail the tenant filter for everyone,
    // including Esther (she cannot be blamed for a day the fellowship does
    // not officially meet).
    const esther = member('esther', { expected_days: [TUESDAY] })
    assert.equal(isMemberExpectedOn(esther, '2026-08-31', [1, 2]), false, 'Monday: not her day')
    assert.equal(isMemberExpectedOn(esther, '2026-08-25', [1, 2]), true, 'Tuesday: her day')
    assert.equal(isMemberExpectedOn(esther, '2026-08-26', [1, 2]), false, 'Wednesday: not a tenant day either')
    assert.equal(isMemberExpectedOn(esther, '2026-08-25', null), true, 'NULL tenant days: only her filter applies')
  })

  test('membersExpectedAtEvent: the scoped member set for the cheap completion refresh', () => {
    const roster = [
      member('tue-esther', { expected_days: [TUESDAY] }),
      member('mon-isaac', { expected_days: [1] }),
      member('all-john'), // every tenant day
      member('inactive-alum', { status: 'inactive' }),
    ]
    const onTuesday = membersExpectedAtEvent({ members: roster, eventDate: '2026-08-25', tenantMeetingDays: [1, 2] })
    assert.deepEqual(new Set(onTuesday), new Set(['tue-esther', 'all-john']), 'only Tuesday-expected active members')

    const onMonday = membersExpectedAtEvent({ members: roster, eventDate: '2026-08-31', tenantMeetingDays: [1, 2] })
    assert.deepEqual(new Set(onMonday), new Set(['mon-isaac', 'all-john']))
  })

  test('a member whose expected days never match any event can never be flagged', () => {
    // Esther expected only Wednesdays; fellowship meets Mon+Tue: no eligible
    // events -> streak 0 forever, no flag. (Misconfiguration is safe, not dangerous.)
    const esther = member('esther', { expected_days: [3] })
    const streaks = computeConsecutiveMissStreaks({ members: [esther], events: MON_TUE_EVENTS, logs: [] })
    assert.equal(streaks.get('esther'), 0)
  })
})

// ---------------------------------------------------------------------------

describe('isoDowOf (matches Postgres extract(isodow ...))', () => {
  test('known weekdays', () => {
    assert.equal(isoDowOf('2026-08-31'), 1, 'Monday')
    assert.equal(isoDowOf('2026-08-25'), 2, 'Tuesday')
    assert.equal(isoDowOf('2026-08-26'), 3, 'Wednesday')
    assert.equal(isoDowOf('2026-08-30'), 7, 'Sunday is 7, not 0')
    assert.equal(isoDowOf('2026-09-04'), 5, 'Friday')
  })
})
