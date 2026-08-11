/**
 * No-show morning catch-up digest.
 *
 * A1 / D-26, matrix row N11 (`shift_no_show_digest`,
 * docs/design/attention-and-notifications.md §1.5). D-28 makes the
 * IMMEDIATE no-show alert (`noShowJob.ts`) quiet-hours EXEMPT, which removes
 * the common case A1 named. But `noShowJob`'s `claimAndSend` checks
 * `canDeliver` BEFORE claiming, so an unclaimed no-show is retried on every
 * later tick until the 2h window closes anyway — D-28's exemption is belt,
 * this digest is suspenders: a morning sweep, local `[07:00, 10:00)`, over
 * YESTERDAY's confirmed shifts that had no clock-in and whose immediate
 * `no_show:<shiftId>` claim never actually confirmed (opted out, no device,
 * or the whole 2h window fell inside quiet hours some other way).
 *
 * COPY is deliberately past tense with no verdict about a person: "you may
 * have missed this", never "she didn't show up" — same discipline
 * `noShowJob.ts`'s "ALREADY CLOCKED IN" reasoning documents.
 *
 * REUSES `noShowJob`'s coverage test (`hasClockedIn`,
 * `DefaultNoShowTimeEntryLister`) and `reminderJob`'s claim/confirm/release
 * ordering (`claimAndSend`) — same "kept here, not copied" reasoning as
 * `uncoveredDigestJob.ts`.
 *
 * CLAIM: `push_reminder_log`, key `no_show_digest:<householdId>:
 * <householdLocalDate>` — date-segmented, once per household per local day
 * (same shape as `uncovered_digest`).
 *
 * QUIET HOURS: NOT exempt (D-28's exemption list is closed at
 * `shift_no_show`). By the time this fires the window is long past and
 * nothing is actionable — ordinary morning noise, not an alarm.
 *
 * SETUP: scheduled hourly via pg_cron in migration
 * `090_no_show_digest_cron.sql` (POST `/api/jobs/no-show-digest`) — a repo
 * file only, never applied (Phase 3-N task scope; Phase 6 applies it).
 *
 * @module jobs/noShowDigestJob
 */

import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_STATUSES } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { supabaseService } from '../config/supabase';
import { formatPushTime12h } from '../domains/child/services/uncoveredCareService';
import { ReminderLogRepository } from '../domains/notification/repositories/reminderLogRepository';
import type { PushPayload } from '../domains/notification/types';
import { addDays } from '../domains/pay/utils/localDateSpan';
import { DatabaseError } from '../errors';
import { logger } from '../middlewares/logger';
import {
  buildNoShowKey,
  DefaultNoShowTimeEntryLister,
  hasClockedIn,
  type NoShowShiftCandidate,
  type NoShowTimeEntryLister,
} from './noShowJob';
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
const DIGEST_HOUR = 7;
const DIGEST_WINDOW_END = 10;
/** Coarse pre-filter for the DB query — wide enough to cover any timezone's "yesterday". */
const CANDIDATE_LOOKBACK_MS = 60 * 60 * 60 * 1000;

/** Narrow shift row the job needs, plus the household's own timezone. */
export type NoShowDigestShiftCandidate = Pick<
  Shift,
  'id' | 'household_id' | 'carer_id' | 'starts_at'
> & { timezone: string };

export interface NoShowDigestCandidateSource {
  /**
   * Confirmed shifts with an assigned carer, starting within a coarse
   * lookback window — re-filtered in-process to the exact household-local
   * "yesterday", same defence-in-depth as `noShowJob.isInNoShowWindow`.
   */
  listRecentConfirmedShifts(now: Date): Promise<NoShowDigestShiftCandidate[]>;
}

export interface NoShowDigestConfirmedChecker {
  /**
   * Of `shiftIds`, which already have a CONFIRMED `no_show:<id>` claim — the
   * immediate alert actually delivered for that shift, so the digest must
   * not repeat it.
   */
  listAlreadyAlerted(shiftIds: string[]): Promise<Set<string>>;
}

export interface NoShowDigestJobResult {
  digest: ReminderRuleStats;
  errorCount: number;
  message: string;
}

export function buildNoShowDigestKey(
  householdId: string,
  localDate: string
): string {
  return `no_show_digest:${householdId}:${localDate}`;
}

class DefaultNoShowDigestCandidateSource
  implements NoShowDigestCandidateSource
{
  async listRecentConfirmedShifts(
    now: Date
  ): Promise<NoShowDigestShiftCandidate[]> {
    const since = new Date(now.getTime() - CANDIDATE_LOOKBACK_MS).toISOString();

    const { data, error } = await supabaseService
      .from('shifts')
      .select('id, household_id, carer_id, starts_at')
      .eq('status', SHIFT_STATUSES.CONFIRMED)
      .not('carer_id', 'is', null)
      .gte('starts_at', since)
      .lte('starts_at', now.toISOString());

    if (error) {
      throw new DatabaseError(
        'Failed to list no-show digest candidates',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }

    const shifts = (data ?? []) as Array<
      Pick<Shift, 'id' | 'household_id' | 'carer_id' | 'starts_at'>
    >;
    if (shifts.length === 0) {
      return [];
    }

    const householdIds = [...new Set(shifts.map(s => s.household_id))];
    const { data: households, error: householdError } = await supabaseService
      .from('households')
      .select('id, timezone')
      .in('id', householdIds);

    if (householdError) {
      throw new DatabaseError(
        'Failed to load household timezones for the no-show digest',
        'DATABASE_ERROR',
        { details: householdError.message }
      );
    }

    const timezones = new Map(
      ((households ?? []) as Array<{ id: string; timezone: string }>).map(
        row => [row.id, row.timezone]
      )
    );

    return shifts.map(shift => ({
      ...shift,
      timezone: timezones.get(shift.household_id) ?? 'UTC',
    }));
  }
}

class DefaultNoShowDigestConfirmedChecker
  implements NoShowDigestConfirmedChecker
{
  async listAlreadyAlerted(shiftIds: string[]): Promise<Set<string>> {
    if (shiftIds.length === 0) {
      return new Set();
    }

    const keyToId = new Map(shiftIds.map(id => [buildNoShowKey(id), id]));
    const { data, error } = await supabaseService
      .from('push_reminder_log')
      .select('reminder_key')
      .in('reminder_key', [...keyToId.keys()])
      .not('confirmed_at', 'is', null);

    if (error) {
      throw new DatabaseError(
        'Failed to load already-alerted no-show claims',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }

    const rows = (data ?? []) as Array<{ reminder_key: string }>;
    const ids = new Set<string>();
    for (const row of rows) {
      const id = keyToId.get(row.reminder_key);
      if (id) {
        ids.add(id);
      }
    }
    return ids;
  }
}

function toNoShowShiftCandidate(
  shift: NoShowDigestShiftCandidate,
  timezone: string
): NoShowShiftCandidate {
  return {
    id: shift.id,
    household_id: shift.household_id,
    carer_id: shift.carer_id,
    starts_at: shift.starts_at,
    status: SHIFT_STATUSES.CONFIRMED,
    // Unused by `hasClockedIn` (id/starts_at only) — required by the shape.
    carer_display_name: '',
    timezone,
  };
}

/** Full weekday name in `timeZone`, e.g. "Tuesday". */
function formatWeekday(instantIso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'long',
    }).format(new Date(instantIso));
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'long',
    }).format(new Date(instantIso));
  }
}

function buildDigestPayload(
  missed: readonly NoShowDigestShiftCandidate[],
  householdId: string,
  timezone: string,
  localDate: string
): PushPayload {
  const first = missed[0];
  if (!first) {
    throw new Error('buildDigestPayload called with no missed shifts');
  }

  const body =
    missed.length === 1
      ? `You may have missed this — no one clocked in for ${formatWeekday(first.starts_at, timezone)}'s ${formatPushTime12h(first.starts_at, timezone)} shift.`
      : `You may have missed this — no one clocked in for ${missed.length} shifts yesterday.`;

  return {
    title: 'You may have missed this',
    body,
    data: {
      type: PUSH_NOTIFICATION_TYPES.SHIFT_NO_SHOW_DIGEST,
      householdId,
      localDate,
    },
  };
}

export async function runNoShowDigestJob(
  candidates: NoShowDigestCandidateSource = new DefaultNoShowDigestCandidateSource(),
  entries: NoShowTimeEntryLister = new DefaultNoShowTimeEntryLister(),
  alreadyAlerted: NoShowDigestConfirmedChecker = new DefaultNoShowDigestConfirmedChecker(),
  log: ReminderLogClaim = new ReminderLogRepository(),
  parents: ReminderParentLister = new DefaultReminderParentLister(),
  push: ReminderPushService = defaultPushService,
  clock: ReminderJobClock = { now: () => new Date() }
): Promise<NoShowDigestJobResult> {
  const now = clock.now();

  // Same reason as the other jobs: free the claims a crashed run died
  // holding before anything on this pass tries to claim them.
  await log.sweepStaleClaims();

  const shifts = await candidates.listRecentConfirmedShifts(now);
  const stats = emptyRuleStats();

  const byHousehold = new Map<
    string,
    { timezone: string; shifts: NoShowDigestShiftCandidate[] }
  >();
  for (const shift of shifts) {
    const bucket = byHousehold.get(shift.household_id) ?? {
      timezone: shift.timezone,
      shifts: [],
    };
    bucket.shifts.push(shift);
    byHousehold.set(shift.household_id, bucket);
  }
  stats.candidates = byHousehold.size;

  for (const [
    householdId,
    { timezone, shifts: householdShifts },
  ] of byHousehold) {
    try {
      const primaryClock = getLocalClock(now, timezone);
      const localClock = primaryClock ?? getLocalClock(now, 'UTC');
      if (!primaryClock) {
        logger.warn(
          'No-show digest: bad household timezone, falling back to UTC',
          { householdId, timezone }
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

      const effectiveTimezone = primaryClock ? timezone : 'UTC';
      const yesterday = addDays(localClock.date, -1);

      const yesterdaysShifts = householdShifts.filter(shift => {
        const localDate = getLocalClock(
          new Date(shift.starts_at),
          effectiveTimezone
        )?.date;
        return localDate === yesterday;
      });
      if (yesterdaysShifts.length === 0) {
        stats.skipped++;
        continue;
      }

      const missed: NoShowDigestShiftCandidate[] = [];
      for (const shift of yesterdaysShifts) {
        const carerId = shift.carer_id;
        if (!carerId) {
          continue;
        }
        const candidate = toNoShowShiftCandidate(shift, effectiveTimezone);
        const covering = await entries.listCoveringEntries(carerId, candidate);
        if (hasClockedIn(candidate, covering)) {
          continue;
        }
        missed.push(shift);
      }
      if (missed.length === 0) {
        stats.skipped++;
        continue;
      }

      const alreadyAlertedIds = await alreadyAlerted.listAlreadyAlerted(
        missed.map(s => s.id)
      );
      const stillMissing = missed.filter(s => !alreadyAlertedIds.has(s.id));
      if (stillMissing.length === 0) {
        stats.skipped++;
        continue;
      }

      const parentIds = await parents.listParentUserIds(householdId);
      if (parentIds.length === 0) {
        stats.skipped++;
        continue;
      }

      const payload = buildDigestPayload(
        stillMissing,
        householdId,
        effectiveTimezone,
        yesterday
      );
      const reminderKey = buildNoShowDigestKey(householdId, yesterday);

      for (const parentId of parentIds) {
        try {
          await claimAndSend(
            { log, push },
            parentId,
            reminderKey,
            payload,
            stats
          );
        } catch (error) {
          stats.errors++;
          logger.error('No-show digest failed to send to a parent', {
            householdId,
            parentId,
            error,
          });
        }
      }
    } catch (error) {
      stats.errors++;
      logger.error('No-show digest failed for a household', {
        householdId,
        error,
      });
    }
  }

  return {
    digest: stats,
    errorCount: stats.errors,
    message: `No-show digest sent ${stats.sent} push(es)`,
  };
}
