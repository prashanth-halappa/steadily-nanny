/**
 * RevenueCat client — fetches customer data from the REST API v2 and resolves
 * subscription tier from active entitlements (via ENTITLEMENT_TIER_MAP).
 *
 * `fetchOk` distinguishes "RC says this customer is free" from "we could not
 * reach RC" — callers MUST NOT treat a failed fetch as a downgrade signal.
 *
 * @see https://www.revenuecat.com/docs/api-v2
 * @module domains/subscription/utils/revenuecatClient
 */
import type { SubscriptionTier } from '@yourapp/shared-types';
import { ENTITLEMENT_TIER_MAP } from '@yourapp/shared-types';
import { env } from '../../../config/env';
import { logger } from '../../../middlewares/logger';
import type { SubscriptionInfo } from '../types';

const RC_API_TIMEOUT_MS = 5_000;

interface RCActiveEntitlement {
  entitlement_id?: string;
  expires_at?: number | string | null;
}

interface RCEntitlementDefinition {
  id: string;
  lookup_key: string;
}

export interface RevenueCatFetchResult extends SubscriptionInfo {
  fetchOk: boolean;
}

let entitlementIdToLookupKey: Map<string, string> | null = null;
let entitlementCacheExpiresAt = 0;
const ENTITLEMENT_CACHE_TTL_MS = 60 * 60 * 1000;

async function getEntitlementLookupMap(
  signal: AbortSignal
): Promise<Map<string, string> | null> {
  const now = Date.now();
  if (entitlementIdToLookupKey && now < entitlementCacheExpiresAt) {
    return entitlementIdToLookupKey;
  }

  const response = await fetch(
    `https://api.revenuecat.com/v2/projects/${env.REVENUECAT_PROJECT_ID}/entitlements`,
    {
      headers: {
        Authorization: `Bearer ${env.REVENUECAT_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      signal,
    }
  );

  if (!response.ok) {
    logger.warn('Failed to fetch RC entitlement definitions', {
      status: response.status,
    });
    return null;
  }

  const data = (await response.json()) as { items?: RCEntitlementDefinition[] };
  const map = new Map<string, string>();
  for (const item of data.items ?? []) {
    map.set(item.id, item.lookup_key);
  }

  entitlementIdToLookupKey = map;
  entitlementCacheExpiresAt = Date.now() + ENTITLEMENT_CACHE_TTL_MS;
  return map;
}

/**
 * Fetch a customer's subscription info from RC. Returns free/fetchOk=true when
 * no active entitlement matches; free/fetchOk=false on any API error.
 */
export async function fetchRevenueCatCustomer(
  rcAppUserId: string
): Promise<RevenueCatFetchResult> {
  const freeTier: SubscriptionInfo = {
    tier: 'free',
    expiresAt: null,
    productId: null,
    platform: null,
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RC_API_TIMEOUT_MS);

    const response = await fetch(
      `https://api.revenuecat.com/v2/projects/${env.REVENUECAT_PROJECT_ID}/customers/${encodeURIComponent(rcAppUserId)}/active_entitlements`,
      {
        headers: {
          Authorization: `Bearer ${env.REVENUECAT_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn('RevenueCat V2 API returned non-OK status', {
        status: response.status,
        rcAppUserId,
      });
      return { ...freeTier, fetchOk: false };
    }

    const data = (await response.json()) as { items?: RCActiveEntitlement[] };
    const activeEntitlements = data.items ?? [];

    if (activeEntitlements.length === 0) {
      return { ...freeTier, fetchOk: true };
    }

    const lookupMap = await getEntitlementLookupMap(controller.signal);
    if (lookupMap === null) {
      return { ...freeTier, fetchOk: false };
    }

    for (const entitlement of activeEntitlements) {
      const entId = entitlement.entitlement_id;
      if (!entId) continue;

      const lookupKey = lookupMap.get(entId);
      if (!lookupKey) continue;

      const tier =
        ENTITLEMENT_TIER_MAP[lookupKey as keyof typeof ENTITLEMENT_TIER_MAP];
      if (tier) {
        const rawExpiry = entitlement.expires_at;
        let expiresAt: string | null = null;
        if (typeof rawExpiry === 'number') {
          expiresAt = new Date(rawExpiry).toISOString();
        } else if (typeof rawExpiry === 'string') {
          expiresAt = rawExpiry;
        }

        return {
          tier: tier as SubscriptionTier,
          expiresAt,
          productId: null,
          platform: null,
          fetchOk: true,
        };
      }
    }

    return { ...freeTier, fetchOk: true };
  } catch (error) {
    logger.warn('RevenueCat V2 API call failed', {
      rcAppUserId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { ...freeTier, fetchOk: false };
  }
}

/** Reset the entitlement definition cache (test only). @internal */
export function _resetEntitlementCache(): void {
  entitlementIdToLookupKey = null;
  entitlementCacheExpiresAt = 0;
}
