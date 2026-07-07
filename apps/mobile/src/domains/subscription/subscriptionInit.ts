import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import { setOnForbiddenHandler } from '@/src/api/client';
import { env } from '@/src/config/env';
import { useSubscriptionStore } from '@/src/store/subscriptionStore';
import { presentPaywall } from './hooks/usePaywall';

/**
 * Configure the billing SDK once at app start and register the API client's
 * 403-gating handler (seam). Records the configured state so the paywall
 * readiness guard can fail safe (see isPaywallReady). No-ops safely when no
 * RevenueCat key is set (local dev).
 */
export async function configureSubscriptions(): Promise<void> {
  // SEAM: the API client calls this on a 403 PAYWALL_REQUIRED (it has no billing
  // dependency of its own).
  setOnForbiddenHandler(async code => {
    if (code === 'PAYWALL_REQUIRED') {
      await presentPaywall('api-403');
    }
  });

  const apiKey =
    Platform.OS === 'ios' ? env.revenueCatIosKey : env.revenueCatAndroidKey;
  if (!apiKey) {
    useSubscriptionStore
      .getState()
      .setConfigured(false, 'No RevenueCat API key configured');
    return;
  }

  try {
    Purchases.configure({ apiKey });
    useSubscriptionStore.getState().setConfigured(true);

    const info = await Purchases.getCustomerInfo();
    useSubscriptionStore
      .getState()
      .setFromEntitlements(Object.keys(info.entitlements.active));

    Purchases.addCustomerInfoUpdateListener(customerInfo => {
      useSubscriptionStore
        .getState()
        .setFromEntitlements(Object.keys(customerInfo.entitlements.active));
    });
  } catch (error) {
    useSubscriptionStore
      .getState()
      .setConfigured(
        false,
        error instanceof Error ? error.message : 'configure failed'
      );
  }
}
