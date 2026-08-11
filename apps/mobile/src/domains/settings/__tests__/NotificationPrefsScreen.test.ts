/**
 * @module domains/settings/__tests__/NotificationPrefsScreen.test
 *
 * Pattern A source-inspection — avoids RN render flakiness (splash asset /
 * SafeAreaView testID). Asserts the prefs screen wires get/patch prefs,
 * device timezone seeding, and OS settings escape hatch.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

describe('NotificationPrefsScreen', () => {
  let source: string;

  beforeAll(async () => {
    source = await Bun.file(
      join(__dirname, '../components/NotificationPrefsScreen.tsx')
    ).text();
  });

  it('loads and saves prefs via the notification prefs hooks', () => {
    expect(source).toContain('useNotificationPrefs');
    expect(source).toContain('useUpdateNotificationPrefs');
    expect(source).toContain('getDeviceTimeZone');
  });

  it('populates device timezone on save (first write)', () => {
    expect(source).toContain('timezone: getDeviceTimeZone()');
    expect(source).toContain('mutateAsync');
  });

  it('exposes quiet hours, type toggles, and OS settings', () => {
    expect(source).toContain('notification-prefs-quiet-hours');
    expect(source).toContain('ALL_PUSH_NOTIFICATION_TYPES');
    expect(source).toContain('Linking.openSettings');
    expect(source).toContain('notification-prefs-os-settings');
  });

  it('includes device timezone on save', () => {
    expect(source).toContain('mutateAsync');
    expect(source).toContain('quietHoursEnabled');
    expect(source).toContain('disabledTypes');
  });

  it('filters push types by role via PUSH_TYPE_AUDIENCE without dropping hidden disabled_types on save', () => {
    expect(source).toContain('PUSH_TYPE_AUDIENCE');
    expect(source).toContain('useIsOnboarded');
    expect(source).toContain('SETUP_ROLES');
    expect(source).not.toMatch(
      /ALL_PUSH_NOTIFICATION_TYPES\.map\(\s*type\s*=>/
    );
    expect(source).toContain('disabledTypes');
    expect(source).toMatch(/mutateAsync\(\{[\s\S]*disabledTypes/);
  });

  it('groups the newly-registered shift-floor types under Schedule', () => {
    expect(source).toContain("running_late: 'schedule'");
    expect(source).toContain("parent_covering: 'schedule'");
  });

  // 3-N (A11): both new types belong to the same schedule loop
  // shift_reminder / shift_no_show already sit in.
  it('groups the new 3-N reminder/digest types under Schedule', () => {
    expect(source).toContain("cover_ask_reminder: 'schedule'");
    expect(source).toContain("shift_no_show_digest: 'schedule'");
  });

  // 3-T1 / §1.3 N3-N4: the week thread's two pushes are about money, and
  // they belong with the rest of the hours-and-pay leg. §1.5b's five-group
  // split is a later slice's job, not a reason to park these anywhere else.
  it('groups the week-thread types under Hours and pay', () => {
    expect(source).toContain("timesheet_note_added: 'hoursAndPay'");
    expect(source).toContain("timesheet_query_withdrawn: 'hoursAndPay'");
  });

  it('groups visible push types under Schedule, Hours and pay, and Your household headings', () => {
    expect(source).toContain('notificationPrefs.groups.schedule');
    expect(source).toContain('notificationPrefs.groups.hoursAndPay');
    expect(source).toContain('notificationPrefs.groups.household');
    expect(source).toContain('notification-prefs-group-');
  });
});
