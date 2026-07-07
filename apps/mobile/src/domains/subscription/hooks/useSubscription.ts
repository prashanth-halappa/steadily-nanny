import { useSubscriptionStore } from '@/src/store/subscriptionStore';

/**
 * Read the resolved subscription state. `isPro` already reflects the `betaAllPro`
 * override (applied to the store when the app status is fetched).
 */
export function useSubscription() {
  const tier = useSubscriptionStore(s => s.tier);
  const isPro = useSubscriptionStore(s => s.isPro);
  const isConfigured = useSubscriptionStore(s => s.isConfigured);
  return { tier, isPro, isConfigured };
}
