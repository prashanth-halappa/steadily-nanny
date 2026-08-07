/**
 * @module domains/schedule/utils/__tests__/calendarSyncNative.test
 *
 * The one thing this module must never do: throw while the JS bundle is being
 * evaluated. It is reached from `AppBootstrap`, so a native `expo-calendar`
 * that isn't in the running binary used to redbox the app before login.
 * `expo-calendar` genuinely fails to load under bun:test, which is exactly the
 * failure mode being guarded — importing it here is the check.
 */
import { describe, expect, it } from 'bun:test';

describe('calendarSyncNative without the native module', () => {
  it('imports, and degrades instead of throwing', async () => {
    const mod = await import('../calendarSyncNative');

    expect(await mod.getCalendarPermissions()).toEqual({
      granted: false,
      status: 'undetermined',
    });
    expect(await mod.requestCalendarPermissions()).toEqual({
      granted: false,
      status: 'undetermined',
    });
    expect(await mod.listWritableCalendars()).toEqual([]);
    expect(await mod.enableDefaultCalendarSync()).toBe(false);
    await mod.runDefaultCalendarSync();
  });
});
