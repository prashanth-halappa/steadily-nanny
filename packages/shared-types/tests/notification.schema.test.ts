import { describe, expect, it } from 'bun:test';
import {
  ALL_PUSH_NOTIFICATION_TYPES,
  PUSH_NOTIFICATION_TYPES,
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
  });

  it('parses each const-map value', () => {
    for (const value of Object.values(PUSH_NOTIFICATION_TYPES)) {
      expect(PushNotificationTypeSchema.parse(value)).toBe(value);
    }
  });
});
