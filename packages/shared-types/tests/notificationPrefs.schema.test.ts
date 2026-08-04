import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_NOTIFICATION_PREFS,
  isValidIanaTimeZone,
  NotificationPrefsSchema,
  UpdateNotificationPrefsSchema,
} from '../src/schemas/notificationPrefs.schema';

describe('notificationPrefs.schema', () => {
  it('defaults have all types enabled and quiet hours off', () => {
    expect(DEFAULT_NOTIFICATION_PREFS.disabledTypes).toEqual([]);
    expect(DEFAULT_NOTIFICATION_PREFS.quietHoursEnabled).toBe(false);
    expect(NotificationPrefsSchema.parse(DEFAULT_NOTIFICATION_PREFS)).toEqual(
      DEFAULT_NOTIFICATION_PREFS
    );
  });

  it('accepts a partial update with disabled types', () => {
    const parsed = UpdateNotificationPrefsSchema.parse({
      disabledTypes: ['timesheet_submitted'],
    });
    expect(parsed.disabledTypes).toEqual(['timesheet_submitted']);
  });

  it('rejects an empty update object', () => {
    expect(() => UpdateNotificationPrefsSchema.parse({})).toThrow();
  });

  it('accepts a real IANA timezone on update', () => {
    const parsed = UpdateNotificationPrefsSchema.parse({
      timezone: 'Europe/London',
    });
    expect(parsed.timezone).toBe('Europe/London');
  });

  it('rejects an invalid IANA timezone on update', () => {
    expect(() =>
      UpdateNotificationPrefsSchema.parse({ timezone: 'Not/A_Zone' })
    ).toThrow();
  });

  it('rejects a raw UTC offset as timezone', () => {
    expect(() =>
      UpdateNotificationPrefsSchema.parse({ timezone: '+01:00' })
    ).toThrow();
    expect(isValidIanaTimeZone('+01:00')).toBe(false);
    expect(isValidIanaTimeZone('America/New_York')).toBe(true);
  });
});
