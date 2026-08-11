/**
 * Uncovered-care evening digest.
 *
 * `uncoveredCareService.raiseUncoveredOnce` only pushes immediately for
 * windows starting within 72h (`UNCOVERED_PUSH_WITHIN_MS`); everything
 * further out is persisted silently with `payload.push_gate: 'digest'`. This
 * job is where those windows are finally told to a parent — once, in the
 * evening, not scattered across the day (or the night) as they're detected.
 *
 * TWO CLAUSES, unioned by `uncoveredKey` — see `uncoveredCareService.ts`'s
 * module header and the plan doc for the full "why two, not one" reasoning:
 *
 *  (a) NEW SINCE YESTERDAY — `shift_events` rows tagged `push_gate: 'digest'`
 *      whose `created_at` falls in the household-local PREVIOUS calendar day.
 *      A fixed local-day partition, not a rolling 24h lookback, so a send
 *      that lands late one evening and early the next never double-reports.
 *  (b) CLOSING IN — today through today+3, recomputed fresh. The dedupe key
 *      on a window first detected far out is burned the moment its
 *      `shift_events` row is written, so clause (a) alone would report it
 *      once, on the day it was detected, and never again as it approaches.
 *      Clause (b) is what still catches it three evenings running.
 *
 * DECISION, not oversight: clause (b) does NOT exclude `push_gate: 'immediate'`
 * rows. A window first detected today, inside 72h, both pushes immediately
 * ("No one booked", naming the carer/cause) AND appears in that same evening's
 * digest ("No one booked yet") if still uncovered — a same-day pair, not a
 * bug. Considered and accepted by the owner (2026-08-10): different title,
 * different framing, reads as "still not fixed" rather than a duplicate.
 *
 * VERIFY BY RECOMPUTE, ALWAYS. A `shift_events` row proves a window WAS
 * uncovered when written, never that it still is — a parent may have booked
 * cover since. Every candidate, from either clause, is checked against a
 * fresh `computeUncovered` run (`loadUncoveredInputsForDate` +
 * `computeUncovered`, the same pair `detectUncoveredCareForDate` uses) and
 * dropped if its key is no longer in the live set. Skipping this would tell a
 * parent "no one's booked" about a shift that now exists — the worst failure
 * this feature can have.
 *
 * WINDOW: `[18:00, 21:00)` household-local, gated via `getLocalClock` (same
 * primitive `reminderJob` uses) — never the recipient's, so two parents in
 * different zones don't partition one household's rows two different ways.
 * Three ticks of insurance against a missed cron run, not a quiet-hours
 * substitute (no UI-reachable quiet-hours setting reaches this range — see
 * `NotificationPrefsScreen.tsx`'s `QUIET_START_OPTIONS`).
 *
 * CLAIM: `push_reminder_log`, key `uncovered_digest:<householdId>:
 * <householdLocalDate>` — date-segmented. The key STRING is invariant across
 * every hour of one local day, so the first successful send's claim collides
 * with every later hourly tick: one push per household per day, not one per
 * tick (`reminderJob.ts`'s header has the full "date-segmented key, sends
 * once a day" analysis this relies on). `claimAndSend` — the claim/confirm/
 * release ordering — is imported from `reminderJob`, not copied.
 *
 * COPY (A10): unlike every other push emitter in this repo (hardcoded
 * English by deliberate, documented convention — push i18n is a deferred,
 * repo-wide concern), this ONE digest is wired to a real catalog
 * (`domains/notification/i18n/{en,es}.json`) because its Spanish strings
 * already existed — dead, in a module comment — and shipping them for real
 * costs one lookup. Locale is resolved PER RECIPIENT via
 * `listUserLocales(parentIds)` (a household can have parents on different
 * `user_profiles.preferred_locale` values), defaulting to English when
 * unset or unsupported. "yet" (vs the immediate push's "No one booked") is
 * the whole distinction a parent needs on a lock screen between "something
 * just broke" and "here's the week's tail" — see the plan doc's §4 for the
 * full copy rationale.
 *
 * SETUP: scheduled hourly via pg_cron in migration
 * `073_uncovered_digest_cron.sql` (POST `/api/jobs/uncovered-digest`) — Unit
 * D. Requires Vault secrets `cron_api_base_url` and `cron_job_api_key`.
 *
 * @module jobs/uncoveredDigestJob
 */

import {
  DEFAULT_LOCALE,
  isValidLocale,
} from '@steadily-nanny/shared-types/locale';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import {
  computeUncovered,
  type UncoveredWindow,
  uncoveredKey,
} from '@steadily-nanny/shared-types/uncoveredCare';
import { supabaseService } from '../config/supabase';
import { ChildCommitmentRepository } from '../domains/child/repositories/childCommitmentRepository';
import { ChildRepository } from '../domains/child/repositories/childRepository';
import { loadUncoveredInputsForDate } from '../domains/child/services/detectUncoveredCareForDate';
import {
  formatPushShortDate,
  formatPushTime12h,
} from '../domains/child/services/uncoveredCareService';
import { HouseholdRepository } from '../domains/household';
import { createNotificationI18n } from '../domains/notification/i18n';
import { ReminderLogRepository } from '../domains/notification/repositories/reminderLogRepository';
import type { PushPayload } from '../domains/notification/types';
import { addDays } from '../domains/pay/utils/localDateSpan';
import { localDateOf } from '../domains/timesheet/utils/weekStart';
import { DatabaseError } from '../errors';
import { logger } from '../middlewares/logger';
import {
  claimAndSend,
  DefaultReminderParentLister,
  defaultPushService,
  emptyRuleStats,
  getLocalClock,
  type ReminderJobClock,
  type ReminderLogClaim,
  type ReminderParentLister,
  type ReminderPushService,
  type ReminderRuleStats,
} from './reminderJob';

/** Household-local hour window the digest is allowed to fire in. */
const DIGEST_HOUR = 18;
const DIGEST_WINDOW_END = 21;
/** Clause (b) recomputes `[today, today + CLOSING_IN_DAYS]` inclusive. */
const CLOSING_IN_DAYS = 3;
/** Coarse pre-filter for the DB query — wide enough to cover any timezone's "yesterday". */
const CANDIDATE_LOOKBACK_MS = 60 * 60 * 60 * 1000;

export interface UncoveredDigestHouseholdCandidate {
  householdId: string;
  timezone: string;
}

/** One digest-gated `shift_events` row, mapped from its `payload`. */
export interface UncoveredDigestCandidateRow {
  childId: string;
  commitmentId: string;
  startsAt: string;
  endsAt: string;
  /** `shift_events.local_date` — the date the WINDOW falls on, not when it was detected. */
  localDate: string;
  /** `shift_events.created_at` — when the row was written; re-filtered in-process (see below). */
  createdAt: string;
}

export interface UncoveredDigestCandidateSource {
  listHouseholds(): Promise<UncoveredDigestHouseholdCandidate[]>;
  /**
   * Rows tagged `push_gate: 'digest'`, created roughly within the last two
   * days. Intentionally coarse — same defence-in-depth as
   * `noShowJob.isInNoShowWindow`: the job re-applies the EXACT
   * household-local previous-day bounds itself, so the rule holds whatever
   * candidate source is injected.
   */
  listRecentDigestRows(
    householdId: string,
    now: Date
  ): Promise<UncoveredDigestCandidateRow[]>;
  /** `childId -> display name`, for the single-window copy. */
  listChildNames(householdId: string): Promise<Map<string, string>>;
  /**
   * A10: `userId -> preferred_locale` for the given ids, omitting any user
   * with none set or an unsupported value — the caller defaults those to
   * English. Batched per household's resolved parent ids, mirroring
   * `listChildNames`.
   */
  listUserLocales(userIds: string[]): Promise<Map<string, string>>;
}

export interface UncoveredDigestVerifier {
  /**
   * Recompute what's genuinely uncovered for this household/date RIGHT NOW.
   * `null` means the household is gone.
   */
  liveWindows(
    householdId: string,
    localDate: string
  ): Promise<UncoveredWindow[] | null>;
}

export interface UncoveredDigestJobResult {
  digest: ReminderRuleStats;
  errorCount: number;
  message: string;
}

export function buildUncoveredDigestKey(
  householdId: string,
  localDate: string
): string {
  return `uncovered_digest:${householdId}:${localDate}`;
}

/** The real verifier: the same `loadUncoveredInputsForDate` + `computeUncovered` pair every other caller shares. */
export const defaultVerifier: UncoveredDigestVerifier = {
  async liveWindows(householdId, localDate) {
    const inputs = await loadUncoveredInputsForDate(householdId, localDate);
    if (!inputs) {
      return null;
    }
    return computeUncovered({
      localDate,
      timezone: inputs.timezone,
      needWindows: inputs.needWindows,
      shifts: inputs.shifts,
      closures: inputs.closures,
    });
  },
};

class DefaultUncoveredDigestCandidateSource
  implements UncoveredDigestCandidateSource
{
  constructor(
    private readonly commitmentRepo: ChildCommitmentRepository = new ChildCommitmentRepository(),
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository(),
    private readonly childRepo: ChildRepository = new ChildRepository()
  ) {}

  async listHouseholds(): Promise<UncoveredDigestHouseholdCandidate[]> {
    const ids = await this.commitmentRepo.listHouseholdIdsWithCommitments();
    if (ids.length === 0) {
      return [];
    }
    const households = await this.householdRepo.findByIds(ids);
    return households.map(h => ({ householdId: h.id, timezone: h.timezone }));
  }

  async listRecentDigestRows(
    householdId: string,
    now: Date
  ): Promise<UncoveredDigestCandidateRow[]> {
    const since = new Date(now.getTime() - CANDIDATE_LOOKBACK_MS).toISOString();

    const { data, error } = await supabaseService
      .from('shift_events')
      .select('payload, local_date, created_at')
      .eq('household_id', householdId)
      .eq('event_type', 'uncovered_care')
      .eq('payload->>push_gate', 'digest')
      .gte('created_at', since);

    if (error) {
      throw new DatabaseError(
        'Failed to list uncovered-care digest candidates',
        'DATABASE_ERROR',
        { details: error.message, householdId }
      );
    }

    const rows = (data ?? []) as Array<{
      payload: Record<string, unknown>;
      local_date: string;
      created_at: string;
    }>;
    return rows
      .map(toDigestRow)
      .filter((row): row is UncoveredDigestCandidateRow => row !== null);
  }

  async listChildNames(householdId: string): Promise<Map<string, string>> {
    const children = await this.childRepo.findActiveByHousehold(householdId);
    return new Map(children.map(child => [child.id, child.name]));
  }

  async listUserLocales(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const { data, error } = await supabaseService
      .from('user_profiles')
      .select('user_id, preferred_locale')
      .in('user_id', userIds);

    if (error) {
      throw new DatabaseError(
        'Failed to load preferred locales for the uncovered-care digest',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }

    const rows = (data ?? []) as Array<{
      user_id: string;
      preferred_locale: string | null;
    }>;
    const locales = new Map<string, string>();
    for (const row of rows) {
      if (row.preferred_locale && isValidLocale(row.preferred_locale)) {
        locales.set(row.user_id, row.preferred_locale);
      }
    }
    return locales;
  }
}

function toDigestRow(row: {
  payload: Record<string, unknown>;
  local_date: string;
  created_at: string;
}): UncoveredDigestCandidateRow | null {
  const { payload } = row;
  const childId = payload.child_id;
  const commitmentId = payload.commitment_id;
  const startsAt = payload.starts_at;
  const endsAt = payload.ends_at;
  if (
    typeof childId !== 'string' ||
    typeof commitmentId !== 'string' ||
    typeof startsAt !== 'string' ||
    typeof endsAt !== 'string'
  ) {
    return null;
  }
  return {
    childId,
    commitmentId,
    startsAt,
    endsAt,
    localDate: row.local_date,
    createdAt: row.created_at,
  };
}

function toWindow(row: UncoveredDigestCandidateRow): UncoveredWindow {
  return {
    childId: row.childId,
    commitmentId: row.commitmentId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
  };
}

/**
 * `[start, end)` UTC millis of `localDate`'s calendar day in `timeZone`.
 * Dependency-free double-conversion, duplicated on purpose — same technique
 * (and the same "why duplicated" note) as `uncoveredCare.ts`'s
 * `zonedWallTimeToUtcMillis` and its three other API-side copies.
 */
function localDayUtcBounds(
  localDate: string,
  timeZone: string
): { start: number; end: number } {
  return {
    start: zonedWallTimeToUtcMillis(localDate, '00:00:00', timeZone),
    end: zonedWallTimeToUtcMillis(addDays(localDate, 1), '00:00:00', timeZone),
  };
}

function zonedWallTimeToUtcMillis(
  dateStr: string,
  timeStr: string,
  timeZone: string
): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh = 0, mi = 0, ss = 0] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hh, mi, ss);
  const offset1 = offsetMinutesAt(guess, timeZone);
  let utc = guess - offset1 * 60_000;
  const offset2 = offsetMinutesAt(utc, timeZone);
  if (offset2 !== offset1) {
    utc = guess - offset2 * 60_000;
  }
  return utc;
}

function offsetMinutesAt(utcMillis: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(utcMillis));
  const get = (type: string): number =>
    Number(parts.find(p => p.type === type)?.value ?? '0');
  const localAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return (localAsUtc - utcMillis) / 60_000;
}

/** Nearest-first, so the earliest day both leads the copy and drives the tap target. */
function sortByStart(windows: readonly UncoveredWindow[]): UncoveredWindow[] {
  return [...windows].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)
  );
}

/** A10: `t('uncoveredDigest.and')` is `'and'`/`'y'` — the locale's join word. */
function joinWithAnd(items: readonly string[], and: string): string {
  if (items.length <= 1) {
    return items[0] ?? '';
  }
  if (items.length === 2) {
    return `${items[0]} ${and} ${items[1]}`;
  }
  return `${items.slice(0, -1).join(', ')} ${and} ${items.at(-1)}`;
}

/**
 * i18n templates carry no trailing full stop (§ below) so this is the one
 * place that adds one — and only when the sentence doesn't already end with
 * one. Some locales' 12h time format ends in its own period (Spanish
 * "p. m."), so a fixed `${body}.` would double it up ("p. m..") whenever the
 * last interpolated token is the offender; a locale-specific punctuation
 * hack would be far more fragile than checking the actual output.
 */
function finishSentence(body: string): string {
  return /[.!?]$/.test(body) ? body : `${body}.`;
}

/**
 * `SupportedLocale` ('en'/'es') is the i18n catalog key; these map it to the
 * Intl BCP-47 tag `formatPushShortDate`/`formatPushTime12h` already default
 * to for every OTHER (English-only) caller — `en-GB` for dates (day-before-
 * month), `en-US` for 12h time (existing lowercase am/pm). Spanish uses the
 * same tag for both; extend this if a future locale needs to diverge.
 */
const INTL_DATE_LOCALE: Record<string, string> = { en: 'en-GB', es: 'es' };
const INTL_TIME_LOCALE: Record<string, string> = { en: 'en-US', es: 'es' };

function buildSingleWindowBody(
  window: UncoveredWindow,
  timezone: string,
  childNames: Map<string, string>,
  i18n: ReturnType<typeof createNotificationI18n>,
  locale: string
): string {
  const childName = childNames.get(window.childId) ?? 'your child';
  const day = formatPushShortDate(
    localDateOf(new Date(window.startsAt), timezone),
    timezone,
    INTL_DATE_LOCALE[locale]
  );
  const start = formatPushTime12h(
    window.startsAt,
    timezone,
    INTL_TIME_LOCALE[locale]
  );
  const end = formatPushTime12h(
    window.endsAt,
    timezone,
    INTL_TIME_LOCALE[locale]
  );
  return finishSentence(
    i18n.t('uncoveredDigest.single', { child: childName, day, start, end })
  );
}

function buildMultiDayBody(
  sorted: readonly UncoveredWindow[],
  timezone: string,
  i18n: ReturnType<typeof createNotificationI18n>,
  locale: string
): string {
  const days: string[] = [];
  const seen = new Set<string>();
  for (const window of sorted) {
    const localDate = localDateOf(new Date(window.startsAt), timezone);
    if (!seen.has(localDate)) {
      seen.add(localDate);
      days.push(localDate);
    }
  }
  const labels = days.map(date =>
    formatPushShortDate(date, timezone, INTL_DATE_LOCALE[locale])
  );

  if (labels.length <= 3) {
    return finishSentence(
      i18n.t('uncoveredDigest.listPrefix', {
        days: joinWithAnd(labels, i18n.t('uncoveredDigest.and')),
      })
    );
  }
  const remaining = labels.length - 1;
  return finishSentence(
    i18n.t('uncoveredDigest.moreDays', {
      day: labels[0],
      count: remaining,
    })
  );
}

function buildDigestPayload(
  windows: readonly UncoveredWindow[],
  householdId: string,
  timezone: string,
  childNames: Map<string, string>,
  preferredLocale: string
): PushPayload {
  const sorted = sortByStart(windows);
  const earliest = sorted[0];
  if (!earliest) {
    throw new Error('buildDigestPayload called with no windows');
  }
  const earliestLocalDate = localDateOf(new Date(earliest.startsAt), timezone);
  const resolvedLocale = isValidLocale(preferredLocale)
    ? preferredLocale
    : DEFAULT_LOCALE;
  const i18n = createNotificationI18n(resolvedLocale);

  return {
    title: i18n.t('uncoveredDigest.title'),
    body:
      sorted.length === 1
        ? buildSingleWindowBody(
            earliest,
            timezone,
            childNames,
            i18n,
            resolvedLocale
          )
        : buildMultiDayBody(sorted, timezone, i18n, resolvedLocale),
    data: {
      type: PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DIGEST,
      householdId,
      localDate: earliestLocalDate,
    },
  };
}

export async function runUncoveredDigestJob(
  candidates: UncoveredDigestCandidateSource = new DefaultUncoveredDigestCandidateSource(),
  verify: UncoveredDigestVerifier = defaultVerifier,
  log: ReminderLogClaim = new ReminderLogRepository(),
  parents: ReminderParentLister = new DefaultReminderParentLister(),
  push: ReminderPushService = defaultPushService,
  clock: ReminderJobClock = { now: () => new Date() }
): Promise<UncoveredDigestJobResult> {
  const now = clock.now();

  // Same reason as the other two jobs: free the claims a crashed run died
  // holding before anything on this pass tries to claim them.
  await log.sweepStaleClaims();

  const households = await candidates.listHouseholds();
  const stats = emptyRuleStats();
  stats.candidates = households.length;

  for (const household of households) {
    try {
      const primaryClock = getLocalClock(now, household.timezone);
      const localClock = primaryClock ?? getLocalClock(now, 'UTC');
      if (!primaryClock) {
        logger.warn(
          'Uncovered-care digest: bad household timezone, falling back to UTC',
          { householdId: household.householdId, timezone: household.timezone }
        );
      }
      if (!localClock) {
        stats.skipped++;
        continue;
      }
      if (
        localClock.hour < DIGEST_HOUR ||
        localClock.hour >= DIGEST_WINDOW_END
      ) {
        stats.skipped++;
        continue;
      }

      // Once we've decided to fall back, substitute the resolved zone for
      // every downstream use — `collectUncoveredWindows`' date-bounds maths
      // throws on the same bad string `getLocalClock` merely returns null
      // for, so a household with a broken zone must never see its raw value
      // again this pass.
      const effectiveHousehold: UncoveredDigestHouseholdCandidate = primaryClock
        ? household
        : { ...household, timezone: 'UTC' };

      const windows = await collectUncoveredWindows(
        effectiveHousehold,
        localClock.date,
        now,
        candidates,
        verify
      );
      if (windows.length === 0) {
        stats.skipped++;
        continue;
      }

      const parentIds = await parents.listParentUserIds(household.householdId);
      if (parentIds.length === 0) {
        stats.skipped++;
        continue;
      }

      // Only fetched for the single-window case — the multi-day copy never
      // names a child, so the extra query would be wasted there.
      const childNames =
        windows.length === 1
          ? await candidates.listChildNames(household.householdId)
          : new Map<string, string>();

      // A10: locale is per RECIPIENT, not per household — one lookup, then
      // each parent's payload is built in their own language below.
      const parentLocales = await candidates.listUserLocales(parentIds);

      const reminderKey = buildUncoveredDigestKey(
        household.householdId,
        localClock.date
      );

      for (const parentId of parentIds) {
        try {
          const payload = buildDigestPayload(
            windows,
            household.householdId,
            effectiveHousehold.timezone,
            childNames,
            parentLocales.get(parentId) ?? DEFAULT_LOCALE
          );
          await claimAndSend(
            { log, push },
            parentId,
            reminderKey,
            payload,
            stats
          );
        } catch (error) {
          stats.errors++;
          logger.error('Uncovered-care digest failed to send to a parent', {
            householdId: household.householdId,
            parentId,
            error,
          });
        }
      }
    } catch (error) {
      stats.errors++;
      logger.error('Uncovered-care digest failed for a household', {
        householdId: household.householdId,
        error,
      });
    }
  }

  return {
    digest: stats,
    errorCount: stats.errors,
    message: `Uncovered-care digest sent ${stats.sent} push(es)`,
  };
}

/**
 * The union of clause (a) and clause (b), each verified by a fresh recompute
 * before it counts as still-uncovered. See the module header for the full
 * two-clause rationale.
 */
async function collectUncoveredWindows(
  household: UncoveredDigestHouseholdCandidate,
  today: string,
  now: Date,
  candidates: UncoveredDigestCandidateSource,
  verify: UncoveredDigestVerifier
): Promise<UncoveredWindow[]> {
  const seenKeys = new Set<string>();
  const result: UncoveredWindow[] = [];
  const add = (window: UncoveredWindow): void => {
    const key = uncoveredKey(window);
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      result.push(window);
    }
  };

  // Clause (a): rows tagged for the digest whose created_at falls inside
  // yesterday's household-local day — grouped by the WINDOW's own local_date
  // (not the digest's evaluation date) so each distinct date is recomputed
  // exactly once.
  const previousDate = addDays(today, -1);
  const bounds = localDayUtcBounds(previousDate, household.timezone);
  const rawRows = await candidates.listRecentDigestRows(
    household.householdId,
    now
  );
  const clauseARows = rawRows.filter(row => {
    const createdMs = Date.parse(row.createdAt);
    return createdMs >= bounds.start && createdMs < bounds.end;
  });

  const rowsByLocalDate = new Map<string, UncoveredDigestCandidateRow[]>();
  for (const row of clauseARows) {
    const list = rowsByLocalDate.get(row.localDate) ?? [];
    list.push(row);
    rowsByLocalDate.set(row.localDate, list);
  }
  for (const [localDate, rows] of rowsByLocalDate) {
    const live = await verify.liveWindows(household.householdId, localDate);
    if (!live) {
      continue; // household gone
    }
    const liveKeys = new Set(live.map(uncoveredKey));
    for (const row of rows) {
      const window = toWindow(row);
      if (liveKeys.has(uncoveredKey(window))) {
        add(window);
      }
    }
  }

  // Clause (b): recompute [today, today + CLOSING_IN_DAYS] fresh — every
  // window returned here is by definition live, no separate check needed.
  for (let offset = 0; offset <= CLOSING_IN_DAYS; offset++) {
    const date = addDays(today, offset);
    const live = await verify.liveWindows(household.householdId, date);
    if (!live) {
      continue;
    }
    for (const window of live) {
      add(window);
    }
  }

  return result;
}
