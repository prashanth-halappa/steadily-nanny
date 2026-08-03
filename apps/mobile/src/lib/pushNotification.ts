/**
 * Push notifications — REGISTRATION (permissions, channels, Expo token, device
 * upsert) and ROUTING (mapping a tapped notification to an in-app destination).
 *
 * Routing is decoupled from the app's route tree via an injected `routeMap`:
 * the template ships no product routes, so YOU pass the mapping. See
 * `resolveNotificationHref` and `useNotificationObserver`.
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import type { Href } from 'expo-router';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import { queryClient } from '@/src/api/queryClient';
import i18n from '@/src/i18n';
import { usePendingDeepLinkStore } from '@/src/store/pendingDeepLinkStore';
import { analytics } from './analytics';

// -----------------------------------------------------------------------------
// Routing (pure + injected route map)
// -----------------------------------------------------------------------------

/** Resolves one notification payload to an in-app href, or null to skip. */
export type NotificationRouteResolver = (
  data: Record<string, unknown>
) => string | null;

/** Maps a semantic notification `type` (or `triggerType`) to a resolver. */
export type NotificationRouteMap = Record<string, NotificationRouteResolver>;

/**
 * Resolve a notification payload to its in-app destination.
 *
 * Reads either `data.type` (direct senders) or `data.triggerType` (pipeline
 * senders), looks up the injected `routeMap`, and returns the resolved href.
 * Falls back to a ready-made `data.url` when present, else null. PURE — unit-test
 * it directly and reuse it for deferred (logged-out) replay.
 *
 * Example routeMap (inject from your app — these routes are illustrative):
 * ```ts
 * const routeMap: NotificationRouteMap = {
 *   // Deep-link to a detail screen when the payload carries an id.
 *   widget_ready: data =>
 *     typeof data.widgetId === 'string' ? `/widget/${data.widgetId}` : null,
 *   // A simple static destination.
 *   announcement: () => '/(tabs)/home',
 * };
 * ```
 */
export function resolveNotificationHref(
  data: Record<string, unknown> | undefined,
  routeMap: NotificationRouteMap
): string | null {
  const type = (data?.type ?? data?.triggerType) as string | undefined;

  if (type) {
    const resolver = routeMap[type];
    if (resolver) {
      return resolver(data ?? {});
    }
  }

  // Contract-A ready-made path (e.g. a server-supplied `url`).
  const url = data?.url;
  return typeof url === 'string' ? url : null;
}

/**
 * Observes notification taps and navigates via the injected `routeMap`.
 *
 * - Live tap (app running): navigates immediately with `router.push`.
 * - Cold start (`getLastNotificationResponseAsync`): the nav/auth tree may not be
 *   ready, so the href is stashed in `usePendingDeepLinkStore` for the app entry
 *   route to replay after initialization.
 *
 * Records an "open" event and invalidates cached queries so the destination
 * renders fresh data.
 */
export function useNotificationObserver(routeMap: NotificationRouteMap): void {
  useEffect(() => {
    let isMounted = true;

    function redirect(
      notification: Notifications.Notification,
      { cold }: { cold: boolean }
    ): void {
      const data = notification.request.content.data as
        | Record<string, unknown>
        | undefined;
      const type = (data?.type ?? data?.triggerType) as string | undefined;

      // Record the open (fire-and-forget, generic event name).
      analytics.track('notification_opened', { type });

      // Refresh server state so the destination screen shows fresh data.
      void queryClient.invalidateQueries();

      const href = resolveNotificationHref(data, routeMap);
      if (!href) return;

      if (cold) {
        usePendingDeepLinkStore.getState().setPendingLink(href);
      } else {
        router.push(href as Href);
      }
    }

    Notifications.getLastNotificationResponseAsync().then(response => {
      if (!isMounted || !response?.notification) return;
      redirect(response.notification, { cold: true });
    });

    const subscription = Notifications.addNotificationResponseReceivedListener(
      response => {
        redirect(response.notification, { cold: false });
      }
    );

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [routeMap]);
}

// -----------------------------------------------------------------------------
// Registration (permissions, channels, token, device upsert)
// -----------------------------------------------------------------------------

/**
 * Reads the real OS notification permission.
 *
 * GOLDEN: iOS provisional authorization reports a top-level status of `granted`
 * but `ios.status === PROVISIONAL`. We surface it as `'provisional'` so the
 * device row can distinguish a silent (quiet) channel from a full, user-approved
 * one. Does NOT gate on `Device.isDevice` — dev clients on real hardware can
 * report `isDevice=false` while still holding push tokens.
 */
export async function getUserNotificationPermissions(): Promise<string | null> {
  const perms = await Notifications.getPermissionsAsync();
  if (perms.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return 'provisional';
  }
  return perms.status;
}

/**
 * Fetches the Expo push token for this install. Returns null when no EAS project
 * id is configured or the request fails. The token is persisted server-side by
 * `registerDeviceWithBackend()` in `userDevice.ts`.
 */
export async function getExpoPushToken(): Promise<string | null> {
  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ??
    Constants?.easConfig?.projectId;

  if (!projectId) {
    return null;
  }

  try {
    const pushTokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    return pushTokenData.data;
  } catch {
    return null;
  }
}

/** Sets up the Android default channel (no-op on iOS). */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'default',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF5B3E5D',
  });
}

/**
 * Registers this device for push — the SILENT path.
 *
 * GOLDEN (iOS provisional): requests provisional authorization only from a clean
 * slate (`undetermined`) — a silent opt-in that delivers notifications quietly to
 * Notification Center with NO permission dialog, guaranteeing a re-engagement
 * channel for ~100% of users. Never downgrades an existing full authorization and
 * never re-asks after a denial. On Android it just ensures the channel exists.
 *
 * Gets the Expo token and upserts the device row via the API. Returns the
 * resolved permission string.
 */
export async function registerForPushNotificationsAsync(): Promise<
  string | undefined
> {
  if (Platform.OS === 'android') {
    await ensureAndroidChannel();
  } else {
    if (!Device.isDevice) {
      return undefined;
    }
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    // Provisional only makes sense from a clean slate. If already granted
    // (full or provisional) or denied, leave it untouched.
    if (existingStatus === 'undetermined') {
      await Notifications.requestPermissionsAsync({
        ios: {
          allowProvisional: true,
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });
    }
  }

  await getExpoPushToken();
  const { registerDeviceWithBackend } = await import('./userDevice');
  await registerDeviceWithBackend();
  return (await getUserNotificationPermissions()) ?? undefined;
}

/**
 * Prompts the user for FULL (loud) notification permission.
 *
 * GOLDEN (Settings deep-link): once the OS won't re-prompt (permission already
 * denied/blocked), `requestPermissionsAsync` is a no-op — so we guide the user to
 * Settings instead of failing silently. We don't nag on a first (`undetermined`)
 * denial. On grant, the device row is upserted via the API.
 */
export async function askForNotificationPermissions(): Promise<
  string | undefined
> {
  let finalStatus: string | undefined;

  await ensureAndroidChannel();

  if (!Device.isDevice) {
    return finalStatus;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
        allowCriticalAlerts: false,
      },
    });
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    if (existingStatus !== 'undetermined') {
      Alert.alert(
        i18n.t('notificationsPermissionDenied.title', { ns: 'settings' }),
        i18n.t('notificationsPermissionDenied.body', { ns: 'settings' }),
        [
          {
            text: i18n.t('notificationsPermissionDenied.notNow', {
              ns: 'settings',
            }),
            style: 'cancel',
          },
          {
            text: i18n.t('notificationsPermissionDenied.openSettings', {
              ns: 'settings',
            }),
            onPress: () => void Linking.openSettings(),
          },
        ]
      );
    }
    return finalStatus;
  }

  await getExpoPushToken();
  const { registerDeviceWithBackend } = await import('./userDevice');
  await registerDeviceWithBackend();
  return finalStatus;
}

/**
 * Configures how notifications behave while the app is in the FOREGROUND.
 * Call once at app startup.
 */
export function configureForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}
