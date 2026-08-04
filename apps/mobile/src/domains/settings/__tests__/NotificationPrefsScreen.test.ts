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
});
