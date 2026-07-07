import { useCallback } from 'react';
import Purchases from 'react-native-purchases';
import RevenueCatUI from 'react-native-purchases-ui';
import { analytics } from '@/src/lib/analytics';
import { showErrorToast } from '@/src/lib/toast';
import { isPaywallReady } from '../utils/paywallReadiness';

const PAYWALL_OPEN_ERROR =
  'Could not open the upgrade screen. Please try again.';

/**
 * Presents the native paywall — but only when the billing SDK is configured
 * (see isPaywallReady) and a current offering with packages is loaded. Never
 * throws; shows a graceful toast on any failure.
 */
export async function presentPaywall(context: string): Promise<void> {
  if (!isPaywallReady(context)) {
    showErrorToast(PAYWALL_OPEN_ERROR);
    return;
  }
  try {
    analytics.track('paywall_viewed', { context });
    const offerings = await Purchases.getOfferings();
    if ((offerings.current?.availablePackages?.length ?? 0) > 0) {
      await RevenueCatUI.presentPaywall();
    } else {
      // Presenting with no current offering renders an empty/broken paywall.
      showErrorToast(PAYWALL_OPEN_ERROR);
    }
  } catch (error) {
    if (__DEV__) console.warn('[paywall] present failed', error);
    showErrorToast(PAYWALL_OPEN_ERROR);
  }
}

/** Hook wrapper for presenting the paywall from a component. */
export function usePaywall() {
  const present = useCallback(
    (context = 'manual') => presentPaywall(context),
    []
  );
  return { presentPaywall: present };
}
