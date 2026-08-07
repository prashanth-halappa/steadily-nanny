/**
 * @module lib/__tests__/expoWidgets.test
 *
 * The guarantee: nothing on the widget path can throw at the caller. Both
 * real failure modes are exercised against a `expo-widgets` that behaves the
 * way the broken simulator build did — module absent, then module present but
 * throwing out of the native call.
 *
 * `bun.setup.ts` mocks `expo-widgets` with a working stub globally, so each
 * case re-mocks it *before* the dynamic import (see `docs/09-TESTING.md`).
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const captured: string[] = [];

mock.module('@sentry/react-native', () => ({
  captureException: mock(
    (_error: unknown, ctx: { tags: { widgetSite: string } }) => {
      captured.push(ctx.tags.widgetSite);
    }
  ),
}));

beforeEach(() => {
  captured.length = 0;
});

describe('expoWidgets with no native module', () => {
  it('degrades to undefined targets instead of throwing', async () => {
    mock.module('expo-widgets', () => {
      throw new Error("Cannot find native module 'ExpoWidgets'");
    });
    const mod = await import('../expoWidgets');
    mod.resetWidgetsForTests();

    expect(
      mod.createWidgetSafe('NextShift', () => null as never)
    ).toBeUndefined();
    expect(
      mod.createLiveActivitySafe('OnTheClock', (() => null) as never)
    ).toBeUndefined();
    expect(captured).toEqual(['expo-widgets']);
  });
});

describe('expoWidgets when a native call throws', () => {
  it('reports the reason once per site and returns undefined', async () => {
    mock.module('expo-widgets', () => ({
      createWidget: () => {
        throw new Error('Cannot update widget timeline without a layout');
      },
      createLiveActivity: () => {
        throw new Error('Live Activities are not supported on this device');
      },
    }));
    // The previous case left `null` cached; drop it so the require picks up
    // the stub mocked above.
    const mod = await import('../expoWidgets');
    mod.resetWidgetsForTests();

    expect(
      mod.createWidgetSafe('NannyWeek', () => null as never)
    ).toBeUndefined();
    expect(
      mod.createWidgetSafe('NannyWeek', () => null as never)
    ).toBeUndefined();
    expect(
      mod.createLiveActivitySafe('OnTheClock', (() => null) as never)
    ).toBeUndefined();

    expect(captured).toEqual([
      'createWidget:NannyWeek',
      'createLiveActivity:OnTheClock',
    ]);
  });
});
