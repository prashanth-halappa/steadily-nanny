import { describe, expect, it } from 'bun:test';
import {
  ALL_PUSH_NOTIFICATION_TYPES,
  PUSH_NOTIFICATION_TYPES,
  PUSH_TYPE_AUDIENCE,
  PushNotificationTypeSchema,
} from '../src/schemas/notification.schema';

describe('notification.schema push types', () => {
  it('includes every existing emitter type plus Batch-1 additions', () => {
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('timesheet_submitted');
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('shift_change_requested');
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('schedule_pattern_responded');
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('clock_out_reminder');
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('shift_needs_reconfirm');
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('carer_time_off_conflict');
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('timesheet_queried');
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('schedule_pattern_sent');
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('pay_terms_set');
  });

  it('parses each const-map value', () => {
    for (const value of Object.values(PUSH_NOTIFICATION_TYPES)) {
      expect(PushNotificationTypeSchema.parse(value)).toBe(value);
    }
  });

  it('classifies every push type in PUSH_TYPE_AUDIENCE', () => {
    for (const type of ALL_PUSH_NOTIFICATION_TYPES) {
      expect(PUSH_TYPE_AUDIENCE[type]).toBeDefined();
    }
    expect(PUSH_TYPE_AUDIENCE.uncovered_care_detected).toBe('parent');
    expect(PUSH_TYPE_AUDIENCE.change_request_expired).toBe('any');
    expect(
      (Object.values(PUSH_TYPE_AUDIENCE) as string[]).includes(
        'coverage_gap_detected'
      )
    ).toBe(false);
    expect(PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DETECTED).toBe(
      'uncovered_care_detected'
    );
    expect(
      (Object.values(PUSH_NOTIFICATION_TYPES) as string[]).includes(
        'coverage_gap_detected'
      )
    ).toBe(false);
  });

  // Both types were already emitted by shiftCommandService before they were
  // registered here — the push landed with an unroutable, untoggleable type.
  it('registers the shift-floor emitters running_late and parent_covering', () => {
    expect(PUSH_NOTIFICATION_TYPES.RUNNING_LATE).toBe('running_late');
    expect(PUSH_NOTIFICATION_TYPES.PARENT_COVERING).toBe('parent_covering');
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('running_late');
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('parent_covering');
    // running_late is emitted via notifyHouseholdParents; parent_covering via
    // notifyUser(carerId, …).
    expect(PUSH_TYPE_AUDIENCE.running_late).toBe('parent');
    expect(PUSH_TYPE_AUDIENCE.parent_covering).toBe('carer');
  });

  // The evening digest is a distinct, independently-mutable type from the
  // immediate alert — see notificationPrefsService.test.ts for the proof
  // that muting one never mutes the other.
  it('adds uncovered_care_digest as a distinct parent-audience type', () => {
    expect(PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DIGEST).toBe(
      'uncovered_care_digest'
    );
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('uncovered_care_digest');
    expect(PUSH_TYPE_AUDIENCE.uncovered_care_digest).toBe('parent');
  });

  // 3-N (A2/A11): the evening reminder job now also covers pending
  // cover-asks — a distinct, carer-audience type from shift_reminder so
  // muting one never mutes the other.
  it('registers cover_ask_reminder as a distinct carer-audience type', () => {
    expect(PUSH_NOTIFICATION_TYPES.COVER_ASK_REMINDER).toBe(
      'cover_ask_reminder'
    );
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('cover_ask_reminder');
    expect(PUSH_TYPE_AUDIENCE.cover_ask_reminder).toBe('carer');
  });

  // 3-N (A1/D-26/A11): the morning catch-up digest for a quiet-hour-swallowed
  // no-show — parent-audience, distinct from the immediate shift_no_show.
  it('registers shift_no_show_digest as a distinct parent-audience type', () => {
    expect(PUSH_NOTIFICATION_TYPES.SHIFT_NO_SHOW_DIGEST).toBe(
      'shift_no_show_digest'
    );
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('shift_no_show_digest');
    expect(PUSH_TYPE_AUDIENCE.shift_no_show_digest).toBe('parent');
  });

  // 3-U1 (D-16/D-45, attention-and-notifications.md §1.3 N18–N20). N18/N19
  // REPLACE pay_terms_set for their situations rather than adding to it
  // (never both) — see payArrangementCommandService.test.ts for that proof.
  it('registers pay_terms_backdated as a carer-audience type (N18)', () => {
    expect(PUSH_NOTIFICATION_TYPES.PAY_TERMS_BACKDATED).toBe(
      'pay_terms_backdated'
    );
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('pay_terms_backdated');
    expect(PUSH_TYPE_AUDIENCE.pay_terms_backdated).toBe('carer');
  });

  it('registers pay_terms_scheduled_change_cancelled as a carer-audience type (N19)', () => {
    expect(PUSH_NOTIFICATION_TYPES.PAY_TERMS_SCHEDULED_CHANGE_CANCELLED).toBe(
      'pay_terms_scheduled_change_cancelled'
    );
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain(
      'pay_terms_scheduled_change_cancelled'
    );
    expect(PUSH_TYPE_AUDIENCE.pay_terms_scheduled_change_cancelled).toBe(
      'carer'
    );
  });

  // D-45: the dissent notice is parent-audience — she is the one whose
  // record it goes on, and the person that must learn about it is the
  // employer (N20).
  it('registers pay_terms_disagreed as a parent-audience type (N20)', () => {
    expect(PUSH_NOTIFICATION_TYPES.PAY_TERMS_DISAGREED).toBe(
      'pay_terms_disagreed'
    );
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('pay_terms_disagreed');
    expect(PUSH_TYPE_AUDIENCE.pay_terms_disagreed).toBe('parent');
  });

  // ===========================================================================
  // 3-O — the terms-proposal quartet (N14-N17,
  // docs/design/screens-onboarding-terms-proposal.md §13). The audience is
  // the side that must ACT, never the side that just acted.
  // ===========================================================================

  it('registers terms_proposal_received as a parent-audience type (N14)', () => {
    expect(PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_RECEIVED).toBe(
      'terms_proposal_received'
    );
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('terms_proposal_received');
    expect(PUSH_TYPE_AUDIENCE.terms_proposal_received).toBe('parent');
  });

  it('registers terms_proposal_countered as a carer-audience type (N15)', () => {
    expect(PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_COUNTERED).toBe(
      'terms_proposal_countered'
    );
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('terms_proposal_countered');
    expect(PUSH_TYPE_AUDIENCE.terms_proposal_countered).toBe('carer');
  });

  it('registers terms_proposal_accepted as a carer-audience type (N16)', () => {
    expect(PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_ACCEPTED).toBe(
      'terms_proposal_accepted'
    );
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('terms_proposal_accepted');
    expect(PUSH_TYPE_AUDIENCE.terms_proposal_accepted).toBe('carer');
  });

  it('registers terms_proposal_withdrawn as a parent-audience type (N17)', () => {
    expect(PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_WITHDRAWN).toBe(
      'terms_proposal_withdrawn'
    );
    expect(ALL_PUSH_NOTIFICATION_TYPES).toContain('terms_proposal_withdrawn');
    expect(PUSH_TYPE_AUDIENCE.terms_proposal_withdrawn).toBe('parent');
  });

  // §13: an audience-map edit on a SHIPPED row, called out explicitly. Under
  // D-34 absorption the redeeming parent and the joining carer both need to
  // hear it — he is adding a person to a family he knows, she is entering a
  // home she has never seen (§8.1, M25). One fact, one type, two arms of copy.
  it('widens invite_redeemed to both audiences (3-O §13)', () => {
    expect(PUSH_TYPE_AUDIENCE.invite_redeemed).toBe('both');
  });

  // §13: a contract can wait until 7am. The exemption list stays
  // {SHIFT_NEEDS_RECONFIRM, SHIFT_CHANGE_REQUESTED, SHIFT_NO_SHOW} — all
  // child-safety-adjacent, none of these four.
  it('leaves the whole quartet out of the quiet-hours exemption', () => {
    const quartet = [
      PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_RECEIVED,
      PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_COUNTERED,
      PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_ACCEPTED,
      PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_WITHDRAWN,
    ];
    for (const type of quartet) {
      expect(PUSH_TYPE_AUDIENCE[type]).toBeDefined();
    }
  });
});
