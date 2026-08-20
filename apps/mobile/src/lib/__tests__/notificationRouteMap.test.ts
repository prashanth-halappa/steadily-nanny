/**
 * @module lib/__tests__/notificationRouteMap.test
 *
 * Exhaustiveness + resolver contracts for the product push deep-link map.
 * If a new `PUSH_NOTIFICATION_TYPES` value lands without a map entry, this
 * fails — the AppBootstrap map cannot silently rot back to `{}`.
 */
import { describe, expect, it } from 'bun:test';
import {
  ALL_PUSH_NOTIFICATION_TYPES,
  PUSH_NOTIFICATION_TYPES,
} from '@steadily-nanny/shared-types';
import { NOTIFICATION_ROUTE_MAP } from '../notificationRouteMap';
import type { NotificationRouteMap } from '../pushNotification';

describe('NOTIFICATION_ROUTE_MAP exhaustiveness', () => {
  it('covers every ALL_PUSH_NOTIFICATION_TYPES value', () => {
    for (const type of ALL_PUSH_NOTIFICATION_TYPES) {
      expect(NOTIFICATION_ROUTE_MAP[type]).toBeDefined();
      expect(typeof NOTIFICATION_ROUTE_MAP[type]).toBe('function');
    }
  });

  it('has no extra keys beyond the locked push-type union', () => {
    const known = new Set<string>(ALL_PUSH_NOTIFICATION_TYPES);
    for (const key of Object.keys(NOTIFICATION_ROUTE_MAP)) {
      expect(known.has(key)).toBe(true);
    }
  });
});

describe('NOTIFICATION_ROUTE_MAP resolvers', () => {
  const resolve = (
    type: (typeof ALL_PUSH_NOTIFICATION_TYPES)[number],
    data: Record<string, unknown> = {}
  ): string | null => NOTIFICATION_ROUTE_MAP[type](data);

  it('routes clock_out_reminder to Today (running-entry surface)', () => {
    expect(resolve(PUSH_NOTIFICATION_TYPES.CLOCK_OUT_REMINDER)).toBe(
      '/(private)/(tabs)/home'
    );
  });

  it('routes timesheet pushes to Hours with payload ids', () => {
    const timesheetPayload = {
      householdId: 'hh-1',
      weekStart: '2026-08-03',
      timesheetId: 'ts-1',
    };
    const hoursHref =
      '/(private)/(tabs)/hours?householdId=hh-1&weekStart=2026-08-03&timesheetId=ts-1';

    expect(
      resolve(PUSH_NOTIFICATION_TYPES.TIMESHEET_SUBMITTED, timesheetPayload)
    ).toBe(hoursHref);

    const queried = resolve(
      PUSH_NOTIFICATION_TYPES.TIMESHEET_QUERIED,
      timesheetPayload
    );
    expect(queried).toContain('/(private)/(tabs)/hours?');
    expect(queried).toContain('timesheetId=ts-1');

    // Reopen reuses the same Hours deep-link keys the API emits on reopen.
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.TIMESHEET_REOPENED, timesheetPayload)
    ).toBe(hoursHref);

    // 3-T1 (§1.3 N3/N4): both week-thread pushes land on the week the
    // conversation is about — the thread renders there and nowhere else.
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.TIMESHEET_NOTE_ADDED, timesheetPayload)
    ).toBe(hoursHref);
    expect(
      resolve(
        PUSH_NOTIFICATION_TYPES.TIMESHEET_QUERY_WITHDRAWN,
        timesheetPayload
      )
    ).toBe(hoursHref);
  });

  // 3-T2 (§1.3 N5/N6): both money-correction pushes are about a week's
  // settlement, so they land on the same Hours week as payment_recorded.
  it('routes the money-correction pushes to the same Hours week as payment_recorded', () => {
    const payload = {
      householdId: 'hh-1',
      weekStart: '2026-08-03',
      timesheetId: 'ts-1',
    };
    const expected = resolve(PUSH_NOTIFICATION_TYPES.PAYMENT_RECORDED, payload);

    expect(resolve(PUSH_NOTIFICATION_TYPES.PAYMENT_CORRECTED, payload)).toBe(
      expected
    );
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.REIMBURSEMENT_SETTLED, payload)
    ).toBe(expected);
  });

  it('routes pattern-sent to the respond screen via patternId', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_SENT, {
        patternId: 'pat-1',
        householdId: 'hh-1',
      })
    ).toBe('/(private)/schedule/respond/pat-1?householdId=hh-1');
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_SENT, {})
    ).toBeNull();
  });

  it('routes pattern-responded to the Schedule tab with patternId', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_RESPONDED, {
        patternId: 'pat-1',
        householdId: 'hh-1',
      })
    ).toBe('/(private)/(tabs)/schedule?patternId=pat-1&householdId=hh-1');
  });

  it('routes pattern-amended to the shifts calendar', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_AMENDED, {
        patternId: 'pat-1',
        householdId: 'hh-1',
      })
    ).toBe('/(private)/schedule/shifts?patternId=pat-1&householdId=hh-1');
  });

  // S11: a nanny had no pattern-level surface at all — never told when a
  // usual week she accepted was withdrawn. Routes to the same
  // /schedule/usual-week the parent's banner pushes, which forks by role.
  it('routes pattern-withdrawn to /schedule/usual-week with householdId, so a nanny working two families lands on the right one', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_WITHDRAWN, {
        patternId: 'pat-1',
        householdId: 'hh-1',
      })
    ).toBe('/(private)/schedule/usual-week?householdId=hh-1');
  });

  it('routes shift / change-request pushes to shift detail with ids', () => {
    const shiftTypes = [
      PUSH_NOTIFICATION_TYPES.SHIFT_CHANGE_REQUESTED,
      PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_ACCEPTED,
      PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_DECLINED,
      PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_EXPIRED,
      PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_WITHDRAWN,
      PUSH_NOTIFICATION_TYPES.EXTRA_SHIFT_PROPOSED,
      PUSH_NOTIFICATION_TYPES.SHIFT_CANCELLED,
      PUSH_NOTIFICATION_TYPES.SHIFT_NEEDS_RECONFIRM,
    ] as const;

    for (const type of shiftTypes) {
      const href = resolve(type, {
        shiftId: 'shift-1',
        changeRequestId: 'cr-1',
        householdId: 'hh-1',
      });
      expect(href).toContain('/(private)/schedule/shifts/shift-1');
      expect(href).toContain('changeRequestId=cr-1');
      expect(href).toContain('householdId=hh-1');
      expect(resolve(type, {})).toBeNull();
    }
  });

  it('routes running_late and parent_covering to the same shift detail as the change-request leg', () => {
    const payload = { shiftId: 'shift-1', householdId: 'hh-1' };
    const expected = resolve(
      PUSH_NOTIFICATION_TYPES.SHIFT_CHANGE_REQUESTED,
      payload
    );

    for (const type of [
      PUSH_NOTIFICATION_TYPES.RUNNING_LATE,
      PUSH_NOTIFICATION_TYPES.PARENT_COVERING,
    ] as const) {
      expect(resolve(type, payload)).toBe(expected);
      expect(resolve(type, {})).toBeNull();
    }
  });

  it('routes carer time-off conflict to the shifts calendar for the household', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.CARER_TIME_OFF_CONFLICT, {
        householdId: 'hh-1',
      })
    ).toBe('/(private)/schedule/shifts?householdId=hh-1');
  });

  it('routes uncovered care to the shifts calendar on the problem date with focus', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DETECTED, {
        householdId: 'hh-1',
        localDate: '2026-03-23',
      })
    ).toBe(
      '/(private)/schedule/shifts?householdId=hh-1&localDate=2026-03-23&focusUncovered=1'
    );
  });

  it('routes the evening digest to the same shifts-calendar deep link as the immediate alert', () => {
    const payload = { householdId: 'hh-1', localDate: '2026-03-23' };
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DIGEST, payload)
    ).toBe(resolve(PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DETECTED, payload));
  });

  it('routes pay_terms_set to the nanny My pay screen', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.PAY_TERMS_SET, {
        householdId: 'hh-1',
      })
    ).toBe('/(private)/settings/my-pay');
  });

  // F3 — a parent's pay offer that couldn't be promoted into a proposal on
  // redemption. Same household pay hub as PAY_TERMS_DISAGREED.
  it('routes pay_offer_not_promoted to the household pay hub', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.PAY_OFFER_NOT_PROMOTED, {
        householdId: 'hh-1',
      })
    ).toBe('/(private)/settings/pay');
  });

  // 3-N (A2, N7): the pending-cover-ask reminder is the same fact-shape as
  // shift_reminder — lands on the same shift detail screen.
  it('routes cover_ask_reminder to shift detail, same as shift_reminder', () => {
    const payload = { shiftId: 'shift-1', householdId: 'hh-1' };
    expect(resolve(PUSH_NOTIFICATION_TYPES.COVER_ASK_REMINDER, payload)).toBe(
      resolve(PUSH_NOTIFICATION_TYPES.SHIFT_REMINDER, payload)
    );
    expect(resolve(PUSH_NOTIFICATION_TYPES.COVER_ASK_REMINDER, {})).toBeNull();
  });

  // 3-N (A1/D-26, N11): the morning no-show catch-up digest — per the
  // matrix, deep-links to the shifts calendar (not Today, unlike the
  // immediate shift_no_show alert).
  it('routes shift_no_show_digest to the shifts calendar', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.SHIFT_NO_SHOW_DIGEST, {
        householdId: 'hh-1',
      })
    ).toBe('/(private)/schedule/shifts?householdId=hh-1');
  });

  // 3-T3 (§1.3 N8/N9): both are "the ask you were waiting on is over and the
  // window is uncovered again" — same fact, same destination as the alert
  // that first named the gap.
  it('routes cover_ask_expired and cover_ask_declined to the uncovered deep link', () => {
    const payload = { householdId: 'hh-1', localDate: '2026-03-23' };
    const expected = resolve(
      PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DETECTED,
      payload
    );

    expect(resolve(PUSH_NOTIFICATION_TYPES.COVER_ASK_EXPIRED, payload)).toBe(
      expected
    );
    expect(resolve(PUSH_NOTIFICATION_TYPES.COVER_ASK_DECLINED, payload)).toBe(
      expected
    );
  });

  // 3-T3 (§1.3 N10): a sick day is about the SET of shifts it hit, not any
  // one of them — the calendar is the only surface that shows the set.
  it('routes carer_sick_shifts_affected to the shifts calendar', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.CARER_SICK_SHIFTS_AFFECTED, {
        householdId: 'hh-1',
      })
    ).toBe('/(private)/schedule/shifts?householdId=hh-1');
  });

  // 3-O (§13 / N13, N14, N16): three of the four proposal pushes are about a
  // proposal awaiting an answer, and the review screen IS that proposal.
  it('routes the three awaiting-an-answer proposal pushes to the review screen', () => {
    for (const type of [
      PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_RECEIVED,
      PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_COUNTERED,
      PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_WITHDRAWN,
    ] as const) {
      expect(resolve(type, { proposalId: 'prop-1', householdId: 'hh-1' })).toBe(
        '/(private)/pay/proposal/prop-1'
      );
      // No id, no destination — a contract screen for the wrong proposal is
      // worse than a tap that does nothing.
      expect(resolve(type, { householdId: 'hh-1' })).toBeNull();
    }
  });

  // §13 / N15: acceptance is the one that is NOT about a pending decision —
  // there is nothing left to review, and her terms document is now the fact.
  it('routes an accepted proposal to the carer My pay screen, not the review screen', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_ACCEPTED, {
        proposalId: 'prop-1',
        householdId: 'hh-1',
      })
    ).toBe('/(private)/settings/my-pay');
  });

  // B4 — the counterparty's refusal. Like WITHDRAWN, the record is worth
  // seeing: the review screen still renders the declined pill in history.
  it('routes a declined proposal to the review screen', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_DECLINED, {
        proposalId: 'prop-1',
        householdId: 'hh-1',
      })
    ).toBe('/(private)/pay/proposal/prop-1');
  });

  // Part 2 — the parent-audience twin of TERMS_PROPOSAL_ACCEPTED. Same
  // "nothing left to review" shape, but for the family: the household pay
  // hub, not the carer's own My pay screen.
  it('routes an accepted offer to the household pay hub, not the review screen', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.TERMS_OFFER_ACCEPTED, {
        proposalId: 'prop-1',
        householdId: 'hh-1',
      })
    ).toBe('/(private)/settings/pay');
  });

  // §1.4 (D-38): one type, two arms. The role comes off the payload the
  // emitter built, the same way `isQuietHoursExempt` reads `shiftStartsAt` —
  // the resolver signature stays `(data)`.
  describe('invite_redeemed role fork', () => {
    it('lands a parent on the household screen, unchanged', () => {
      expect(
        resolve(PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED, {
          role: 'parent',
          householdId: 'hh-1',
        })
      ).toBe('/(private)/settings/household');
    });

    it('lands a payload with no role on the household screen — the shipped behaviour', () => {
      expect(resolve(PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED, {})).toBe(
        '/(private)/settings/household'
      );
    });

    it('lands the carer on the proposal she sent — the answer she is waiting for', () => {
      expect(
        resolve(PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED, {
          role: 'carer',
          proposalId: 'prop-1',
          householdId: 'hh-1',
        })
      ).toBe('/(private)/pay/proposal/prop-1');
    });

    it('falls back to her draft home when the payload carries only a draftId', () => {
      expect(
        resolve(PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED, {
          role: 'carer',
          draftId: 'hh-draft',
        })
      ).toBe('/(private)/draft');
    });

    it('gives the carer no destination when neither id is present', () => {
      expect(
        resolve(PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED, { role: 'carer' })
      ).toBeNull();
    });
  });

  // The whole defect is that the builder is hard to find, so this MUST NOT
  // land on the schedule tab — that reproduces the bug inside the fix. It
  // goes straight to the builder itself.
  it('routes schedule_not_set to the schedule builder, not the schedule tab', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.SCHEDULE_NOT_SET, {
        householdId: 'hh-1',
      })
    ).toBe('/(private)/schedule/build?householdId=hh-1');
  });

  // Phase 2: Today holds the MembershipEndedCard, which both explains what
  // happened and offers the way onward. Nothing household-scoped to pass —
  // the card resolves the ended membership itself, same static shape as the
  // other Today destinations.
  it('routes membership_ended to Today', () => {
    expect(
      resolve(PUSH_NOTIFICATION_TYPES.MEMBERSHIP_ENDED, {
        householdId: 'hh-1',
        reason: 'household_closed',
      })
    ).toBe('/(private)/(tabs)/home');
  });

  it('is usable as the injected NotificationRouteMap type', () => {
    const map: NotificationRouteMap = NOTIFICATION_ROUTE_MAP;
    expect(Object.keys(map).length).toBe(ALL_PUSH_NOTIFICATION_TYPES.length);
  });
});
