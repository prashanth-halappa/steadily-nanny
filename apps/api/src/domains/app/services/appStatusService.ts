/**
 * App status service — reads remote config (`app_config`) and computes the
 * force-update / announcements / betaAllPro response for the client. Fail-open:
 * returns safe defaults on any error.
 *
 * The `betaAllPro` per-user override is a standalone beta-cohort flag (backed
 * by `user_beta_overrides`, migration 005) — it does not depend on the
 * subscription/entitlement domain, so this service reads it directly rather
 * than importing a gating service.
 *
 * @module domains/app/services/appStatusService
 */
import type {
  Announcement,
  AppStatusResponse,
  AppStatusValue,
} from '@steadily-nanny/shared-types';
import { eq, or, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { appConfig, user, userBetaOverrides } from '../../../db/schema';
import { logger } from '../../../middlewares/logger';
import { cache, TTL } from '../../../utils/cache';

const betaOverrideCacheKey = (userId: string): string =>
  `appStatus:beta_override:${userId}`;

// NodeCache returns undefined for a miss, so "no override row" is stored as this
// sentinel to distinguish it from an un-cached key.
const NO_OVERRIDE = 'none';

/**
 * Per-user beta override, matched on user_id OR email (so an override added by
 * either identifier — even before the account existed — is honored). Cached
 * 5 minutes.
 */
async function getUserBetaOverride(
  userId: string,
  email?: string
): Promise<boolean | null> {
  const cacheKey = betaOverrideCacheKey(userId);
  const cached = cache.get<boolean | typeof NO_OVERRIDE>(cacheKey);
  if (cached !== undefined) {
    return cached === NO_OVERRIDE ? null : cached;
  }

  try {
    let resolvedEmail = email;
    if (!resolvedEmail) {
      const [row] = await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      resolvedEmail = row?.email;
    }

    // `ilike` without wildcards = case-insensitive equality, which is also
    // what `user_beta_overrides_email_uidx` (on lower(email)) indexes.
    const [data] = await db
      .select({ beta_all_pro: userBetaOverrides.beta_all_pro })
      .from(userBetaOverrides)
      .where(
        resolvedEmail
          ? or(
              eq(userBetaOverrides.user_id, userId),
              sql`lower(${userBetaOverrides.email}) = lower(${resolvedEmail})`
            )
          : eq(userBetaOverrides.user_id, userId)
      )
      .limit(1);

    const value =
      typeof data?.beta_all_pro === 'boolean' ? data.beta_all_pro : null;
    cache.set(cacheKey, value === null ? NO_OVERRIDE : value, TTL.SHORT);
    return value;
  } catch (error) {
    logger.warn('Failed to read user beta override, ignoring', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    cache.set(cacheKey, NO_OVERRIDE, TTL.SHORT);
    return null;
  }
}

/** Compare semver strings: <0 if current<target, 0 if equal, >0 if greater. */
export function compareVersions(current: string, target: string): number {
  const parse = (v: string): number[] =>
    v.split('.').map(p => Number.parseInt(p, 10) || 0);

  const c = parse(current);
  const t = parse(target);
  const len = Math.max(c.length, t.length);

  for (let i = 0; i < len; i++) {
    const diff = (c[i] ?? 0) - (t[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const SAFE_DEFAULTS: AppStatusResponse = {
  status: 'ok',
  update: {
    required: false,
    available: false,
    currentVersion: '0.0.0',
    latestVersion: '0.0.0',
    minimumVersion: '0.0.0',
    storeUrl: '',
  },
  announcements: [],
  betaAllPro: false,
};

interface AppConfigRow {
  min_supported_version: string | null;
  latest_version: string | null;
  ios_store_url: string | null;
  android_store_url: string | null;
  status: AppStatusValue | null;
  maintenance_message: {
    title?: string;
    body?: string;
    ctaLabel?: string;
  } | null;
  announcements: Announcement[] | null;
  beta_all_pro: boolean | null;
}

/**
 * Fetch remote config and compute the app status. Layers a per-user beta
 * override on top of the global flag.
 */
export async function getAppStatus(
  version: string,
  platform: string,
  userId?: string,
  email?: string
): Promise<AppStatusResponse> {
  try {
    const [data] = await db.select().from(appConfig).limit(1);

    if (!data) {
      logger.warn('[AppStatus] No config row found, returning defaults');
      return {
        ...SAFE_DEFAULTS,
        update: { ...SAFE_DEFAULTS.update, currentVersion: version },
      };
    }

    const config = data as unknown as AppConfigRow;
    const minimumVersion = config.min_supported_version ?? '0.0.0';
    const latestVersion = config.latest_version ?? '0.0.0';
    const storeUrl =
      (platform === 'android'
        ? config.android_store_url
        : config.ios_store_url) ?? '';

    const updateRequired = compareVersions(version, minimumVersion) < 0;
    const updateAvailable =
      !updateRequired && compareVersions(version, latestVersion) < 0;

    const status = config.status ?? 'ok';
    const message =
      status !== 'ok' && config.maintenance_message?.title
        ? {
            title: config.maintenance_message.title,
            body: config.maintenance_message.body ?? '',
            ...(config.maintenance_message.ctaLabel
              ? { ctaLabel: config.maintenance_message.ctaLabel }
              : {}),
          }
        : undefined;

    const announcements = Array.isArray(config.announcements)
      ? config.announcements
      : [];

    // Fail-CLOSED global flag + per-user override on top (`??` not `||`).
    const globalBeta = config.beta_all_pro === true;
    const override = userId ? await getUserBetaOverride(userId, email) : null;

    return {
      status,
      ...(message ? { message } : {}),
      update: {
        required: updateRequired,
        available: updateAvailable || updateRequired,
        currentVersion: version,
        latestVersion,
        minimumVersion,
        storeUrl,
      },
      announcements,
      betaAllPro: override ?? globalBeta,
    };
  } catch (err) {
    logger.error('[AppStatus] Error fetching config:', err);
    return {
      ...SAFE_DEFAULTS,
      update: { ...SAFE_DEFAULTS.update, currentVersion: version },
    };
  }
}
