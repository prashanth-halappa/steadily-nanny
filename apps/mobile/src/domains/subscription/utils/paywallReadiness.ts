import * as Sentry from '@sentry/react-native';
import { useSubscriptionStore } from '@/src/store/subscriptionStore';

/**
 * Guard against calling the native billing SDK before it has been configured.
 *
 * GOLDEN (App Store 2.1a): on iOS, ANY `Purchases.*` call (including
 * `getOfferings()`) made before `Purchases.configure()` triggers a Swift
 * `fatalError` — a native process abort a surrounding JS `try/catch` CANNOT
 * intercept. This was the root cause of a Guideline 2.1(a) paywall crash: a
 * production build shipped without a RevenueCat key (env drift), so
 * `configure()` short-circuited and the first paywall path crashed.
 *
 * Every paywall entry point MUST call this before touching the billing SDK and
 * fall back to its graceful error UI when it returns `false`.
 *
 * @param context short caller id (e.g. `paywall-screen`, `api-403`) — a Sentry
 *   tag so we can tell which entry point hit the guard.
 */
export function isPaywallReady(context: string): boolean {
  const { isConfigured, configError } = useSubscriptionStore.getState();

  if (!isConfigured) {
    Sentry.captureException(
      new Error('Paywall opened before the billing SDK was configured'),
      {
        tags: { flow: 'paywall', reason: 'sdk-not-configured', context },
        extra: { storeError: configError },
      }
    );
    return false;
  }

  return true;
}
