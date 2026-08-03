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
let getExpoPushToken: typeof import('../pushNotification').getExpoPushToken;
let getUserNotificationPermissions: typeof import('../pushNotification').getUserNotificationPermissions;
let registerForPushNotificationsAsync: typeof import('../pushNotification').registerForPushNotificationsAsync;

beforeAll(async () => {
  mock.module('@/src/store/pendingDeepLinkStore', () => ({
    usePendingDeepLinkStore: {
      getState: () => ({ setPendingLink: mock(() => {}) }),
    },
  }));
  ({
    resolveNotificationHref,
    getExpoPushToken,
    getUserNotificationPermissions,
    registerForPushNotificationsAsync,
  } = await import('../pushNotification'));
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

describe('getExpoPushToken', () => {
  it('returns null when Device.isDevice is false (simulator)', async () => {
    mock.module('expo-device', () => ({
      isDevice: false,
    }));
    const { getExpoPushToken: getToken } = await import('../pushNotification');

    const token = await getToken();
    expect(token).toBeNull();
  });

  it('fetches push token when Device.isDevice is true', async () => {
    mock.module('expo-device', () => ({
      isDevice: true,
    }));
    mock.module('expo-notifications', () => ({
      getExpoPushTokenAsync: mock(() =>
        Promise.resolve({ data: 'ExponentPushToken[test]' })
      ),
      getPermissionsAsync: mock(() => Promise.resolve({ status: 'granted' })),
    }));
    const { getExpoPushToken: getToken } = await import('../pushNotification');

    const token = await getToken();
    expect(token).toBe('ExponentPushToken[test]');
  });

  it('returns null gracefully when getExpoPushTokenAsync throws Keychain/entitlement error', async () => {
    mock.module('expo-device', () => ({
      isDevice: true,
    }));
    mock.module('expo-notifications', () => ({
      getExpoPushTokenAsync: mock(() =>
        Promise.reject(
          new Error(
            "Keychain access failed: A required entitlement isn't present."
          )
        )
      ),
      getPermissionsAsync: mock(() => Promise.resolve({ status: 'granted' })),
    }));
    const { getExpoPushToken: getToken } = await import('../pushNotification');

    const token = await getToken();
    expect(token).toBeNull();
  });
});

describe('getUserNotificationPermissions', () => {
  it('returns null gracefully when getPermissionsAsync throws a Keychain/entitlement error', async () => {
    mock.module('expo-notifications', () => ({
      getPermissionsAsync: mock(() =>
        Promise.reject(
          new Error(
            "Keychain access failed: A required entitlement isn't present."
          )
        )
      ),
    }));
    const { getUserNotificationPermissions: getPerms } = await import(
      '../pushNotification'
    );

    const perms = await getPerms();
    expect(perms).toBeNull();
  });
});
