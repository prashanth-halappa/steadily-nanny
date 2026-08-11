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
});
