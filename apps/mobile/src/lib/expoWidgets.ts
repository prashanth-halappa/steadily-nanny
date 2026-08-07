/**
 * @module lib/expoWidgets
 *
 * The one place that loads `expo-widgets`, and the only reason it exists:
 * home-screen widgets and the Live Activity are decoration, and decoration
 * must never be able to take the app down.
 *
 * Two failure modes, both seen for real on a simulator build:
 *
 * 1. **The native module is absent.** `expo-widgets` resolves `ExpoWidgets`
 *    at *import* time (`widgetsDirectory` is a top-level constant read off
 *    it), so `Cannot find native module 'ExpoWidgets'` fires while the bundle
 *    is being evaluated — a dev client built before the pod was linked, or JS
 *    shipped ahead of the native build by an OTA update. Every widget module
 *    is side-effect-imported by `AppBootstrap`, so that redbox lands before
 *    login and kills the whole private app area. Requiring lazily, once,
 *    keeps the widgets the only casualty. Same shape and same reason as
 *    `domains/schedule/utils/calendarSyncNative`'s `calendar()`.
 * 2. **The module loads but a call throws.** `updateTimeline` throws
 *    `UpdatedTimelineWithoutLayout` when the App Group defaults never took
 *    the layout, and `Widget`/`LiveActivityFactory` construction can throw
 *    for the same reason. That one surfaces as `Exception in HostFunction`,
 *    which said nothing useful until `reportWidgetFailure` started printing
 *    the native reason.
 *
 * So: `undefined` is a legal widget target everywhere downstream
 * (`applyOne` and `liveActivity`'s `getFactory` both already treat a missing
 * target as "do nothing"), and nothing here ever rethrows into React.
 */
import * as Sentry from '@sentry/react-native';
import type * as ExpoWidgets from 'expo-widgets';
import type { LiveActivityComponent, WidgetEnvironment } from 'expo-widgets';

type WidgetsApi = typeof ExpoWidgets;

const reported = new Set<string>();

/**
 * First failure per site is logged loudly; the rest are dropped.
 * `applyWidgetSnapshots` runs on every query settle, so an unthrottled log
 * would bury the dev server in the same line a hundred times a minute.
 */
export function reportWidgetFailure(site: string, error: unknown): void {
  if (reported.has(site)) return;
  reported.add(site);
  console.warn(`[widgets] ${site} unavailable — surface disabled`, error);
  Sentry.captureException(error, { tags: { widgetSite: site } });
}

let cached: WidgetsApi | null | undefined;

/** Test-only: forget the resolved module and the first-failure log. */
export function resetWidgetsForTests(): void {
  reported.clear();
  cached = undefined;
}

function widgets(): WidgetsApi | null {
  if (cached === undefined) {
    try {
      cached = require('expo-widgets') as WidgetsApi;
    } catch (error) {
      cached = null;
      reportWidgetFailure('expo-widgets', error);
    }
  }
  return cached;
}

/** `createWidget`, but a missing or unhappy native module yields no widget. */
export function createWidgetSafe<Props extends object>(
  name: string,
  view: (props: Props, env: WidgetEnvironment) => React.JSX.Element
): ExpoWidgets.Widget<Props> | undefined {
  const api = widgets();
  if (!api) return undefined;
  try {
    return api.createWidget<Props>(name, view);
  } catch (error) {
    reportWidgetFailure(`createWidget:${name}`, error);
    return undefined;
  }
}

/** `createLiveActivity`, same deal. */
export function createLiveActivitySafe<Props extends object>(
  name: string,
  view: LiveActivityComponent<Props>
): ExpoWidgets.LiveActivityFactory<Props> | undefined {
  const api = widgets();
  if (!api) return undefined;
  try {
    return api.createLiveActivity<Props>(name, view);
  } catch (error) {
    reportWidgetFailure(`createLiveActivity:${name}`, error);
    return undefined;
  }
}
