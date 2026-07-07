/**
 * resolveNotificationHref — pure routing over an INJECTED route map.
 *
 * mock.module runs in beforeAll before the dynamic import so the module's
 * top-level native/peer imports resolve (see TESTING.md). The peer store is
 * mocked here because the pure function under test only needs the module to
 * load — it never touches these deps.
 */

import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { NotificationRouteMap } from '../pushNotification';

let resolveNotificationHref: typeof import('../pushNotification').resolveNotificationHref;

beforeAll(async () => {
  mock.module('@/src/store/pendingDeepLinkStore', () => ({
    usePendingDeepLinkStore: {
      getState: () => ({ setPendingLink: mock(() => {}) }),
    },
  }));
  ({ resolveNotificationHref } = await import('../pushNotification'));
});

const routeMap: NotificationRouteMap = {
  widget_ready: data =>
    typeof data.widgetId === 'string' ? `/widget/${data.widgetId}` : null,
  announcement: () => '/(tabs)/home',
};

describe('resolveNotificationHref', () => {
  it('resolves via routeMap keyed on data.type', () => {
    const href = resolveNotificationHref(
      { type: 'widget_ready', widgetId: 'w-1' },
      routeMap
    );
    expect(href).toBe('/widget/w-1');
  });

  it('reads data.triggerType when data.type is absent', () => {
    const href = resolveNotificationHref(
      { triggerType: 'announcement' },
      routeMap
    );
    expect(href).toBe('/(tabs)/home');
  });

  it('returns null when the resolver returns null (missing required param)', () => {
    const href = resolveNotificationHref({ type: 'widget_ready' }, routeMap);
    expect(href).toBeNull();
  });

  it('falls back to a ready-made data.url for unmapped types', () => {
    const href = resolveNotificationHref(
      { type: 'unmapped', url: '/somewhere' },
      routeMap
    );
    expect(href).toBe('/somewhere');
  });

  it('returns null when there is no type and no url', () => {
    expect(resolveNotificationHref({}, routeMap)).toBeNull();
    expect(resolveNotificationHref(undefined, routeMap)).toBeNull();
  });

  it('prefers the routeMap over a ready-made url when the type matches', () => {
    const href = resolveNotificationHref(
      { type: 'announcement', url: '/ignored' },
      routeMap
    );
    expect(href).toBe('/(tabs)/home');
  });
});
