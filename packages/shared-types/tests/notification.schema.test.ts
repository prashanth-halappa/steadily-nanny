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
});
