/**
 * Cover-ask expiry — the scheduled send, not a sweep (S1 · D-22 + D-47).
 *
 * `shifts.cover_ask_expires_at` is written ONCE, at ask time, by
 * `computeCoverAskExpiry` (`domains/shift/utils/coverAskExpiry.ts`). This job
 * does no arithmetic: it reads the deadline the ask was born with, and when
 * that instant passes it closes the ask and hands the alarm back to the parent
 * with a next step. Running every five minutes is what makes it "at the expiry
 * instant" rather than "some time tonight" — near a shift start, sweep latency
 * IS the failure (spec §5.2).
 *
 * `scheduleHorizonJob`'s nightly pass keeps a BACKSTOP arm for asks whose
 * scheduled send was missed entirely. It must never become the primary path.
 *
 * ---------------------------------------------------------------------------
 * WHY AN EXPIRED ASK LANDS ON `cancelled` WITH NO ACTOR
 * ---------------------------------------------------------------------------
 * `shifts.status` has no `expired` value and this slice deliberately does not
 * add one. The three candidate landings, and why this is the honest one:
 *
 *   `declined`  — LIES. It says the carer answered. She did not; that is the
 *                 entire fact being recorded, and putting a refusal on her
 *                 record for a message she never saw is exactly the kind of
 *                 manufactured story this build exists to stop.
 *   `pending`   — leaves the ask answerable forever and keeps the evening
 *                 reminder firing at a carer about a dead question.
 *   `cancelled` — correct: the booking is off, the window is open, the shift
 *                 is immutable, and it drops out of both the covering and the
 *                 scheduled status sets on every surface for free.
 *
 * Expiry is then distinguished from a parent's withdrawal by the ABSENCE OF AN
 * ACTOR: `cancelled_by` is null, because nobody did it — which is what expiry
 * means, and the same reasoning migration 064 used for change requests
 * ("`expired` is deliberately not `withdrawn`: withdrawn means the requester
 * acted"). A withdrawal always carries the withdrawing parent's id. Together
 * with a non-null `cover_ask_expires_at` that is an unambiguous read for the
 * two different sentences §5.3 asks for ("This ask expired Thursday at 6:00
 * PM." vs "The family withdrew this ask.").
 *
 * ---------------------------------------------------------------------------
 * ORDERING: CLAIM AND SEND FIRST, FLIP SECOND
 * ---------------------------------------------------------------------------
 * Not the intuitive order, and the intuitive order loses pushes. Flip-then-push
 * means a process death between the two leaves an ask that is closed and a
 * parent who was never told — permanently, because the next tick no longer
 * sees a pending row. Push-then-flip means a death leaves the ask pending, the
 * next tick retries, and the once-ever claim key `cover_ask_expired:<shiftId>`
 * collides so nobody is told twice. Same claim → send → confirm ledger as
 * every other push job (GOLDEN-FIXES #24).
 *
 * QUIET HOURS: conditionally exempt. `cover_ask_expired` breaks through only
 * when the shift starts within 12h — see `isQuietHoursExempt` in
 * `domains/notification/constants.ts` for D-47's reasoning. That is why the
 * payload carries `shiftStartsAt`: the exemption is decided from a fact about
 * the shift, never from a flag the emitter sets.
 *
 * SETUP: scheduled every 5 minutes via pg_cron in migration
 * `088_cover_ask_expiry.sql` (POST `/api/jobs/cover-ask-expiry`) — a repo file
 * only, never applied (Phase 3 slice scope; Phase 6 applies it).
 *
 * @module jobs/coverAskExpiryJob
 */

import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import {
  SHIFT_KINDS,
  SHIFT_STATUSES,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import { supabaseService } from '../config/supabase';
import { formatPushTime12h } from '../domains/child/services/uncoveredCareService';
import { ReminderLogRepository } from '../domains/notification/repositories/reminderLogRepository';
import type { PushPayload } from '../domains/notification/types';
import { DatabaseError } from '../errors';
import { logger } from '../middlewares/logger';
import {
  claimAndSend,
  DefaultReminderParentLister,
  defaultPushService,
  emptyRuleStats,
  type ReminderJobClock,
  type ReminderLogClaim,
  type ReminderParentLister,
  type ReminderPushService,
  type ReminderRuleStats,
} from './reminderJob';

/**
 * Ask kinds that carry a fuse. `recurring` is deliberately excluded: a
 * materialised week awaiting the carer's acceptance is a standing arrangement,
 * not a question with a deadline on it, and expiring one would silently cancel
 * a family's schedule. `parent_cover` has no carer to answer.
 */
export const EXPIRING_ASK_KINDS: readonly string[] = [
  SHIFT_KINDS.EXTRA,
  SHIFT_KINDS.COVER,
];

/** The narrow shift row this job needs. */
export type ExpiringAsk = Pick<
  Shift,
  'id' | 'household_id' | 'carer_id' | 'starts_at' | 'timezone' | 'local_date'
> & { cover_ask_expires_at: string | null };

export interface CoverAskExpirySource {
  /** Pending asks whose stored deadline has passed (or which the shift has outrun). */
  listDueAsks(now: Date): Promise<ExpiringAsk[]>;
}

export interface CoverAskExpiryWriter {
  /** CAS `pending` → `cancelled` with no actor. Returns the ids it actually flipped. */
  expireAsk(shiftId: string, at: string): Promise<boolean>;
}

export interface CoverAskExpiryJobResult {
  expiry: ReminderRuleStats;
  expiredCount: number;
  errorCount: number;
  message: string;
}

/** Once ever per shift — an ask can only die once. */
export function buildCoverAskExpiredKey(shiftId: string): string {
  return `cover_ask_expired:${shiftId}`;
}

export class DefaultCoverAskExpirySource implements CoverAskExpirySource {
  async listDueAsks(now: Date): Promise<ExpiringAsk[]> {
    const nowIso = now.toISOString();
    const { data, error } = await supabaseService
      .from('shifts')
      .select(
        'id, household_id, carer_id, starts_at, timezone, local_date, cover_ask_expires_at'
      )
      .eq('status', SHIFT_STATUSES.PENDING)
      .in('kind', [...EXPIRING_ASK_KINDS])
      .not('carer_id', 'is', null)
      // Two arms, and the second is not redundant. Asks created before
      // migration 088 have a null deadline, and an ask whose shift has already
      // started is over however it got there — §5.2's "expiry never fires
      // after the shift has started" cuts both ways: not later than the start,
      // and not still open past it either.
      .or(`cover_ask_expires_at.lte.${nowIso},starts_at.lte.${nowIso}`);

    if (error) {
      throw new DatabaseError(
        'Failed to list due cover asks',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }
    return (data ?? []) as ExpiringAsk[];
  }
}

export class DefaultCoverAskExpiryWriter implements CoverAskExpiryWriter {
  async expireAsk(shiftId: string, at: string): Promise<boolean> {
    const { data, error } = await supabaseService
      .from('shifts')
      .update({
        status: SHIFT_STATUSES.CANCELLED,
        cancelled_at: at,
        // NULL ON PURPOSE — see the module header. Nobody cancelled this; it
        // ran out. A non-null actor here turns an expiry into a withdrawal on
        // every surface that reads it.
        cancelled_by: null,
        cancellation_paid: false,
      })
      .eq('id', shiftId)
      // CAS: a carer who accepted or declined in the last five minutes wins.
      // Silence lost the race, and it should.
      .eq('status', SHIFT_STATUSES.PENDING)
      .select('id')
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to expire cover ask', 'DATABASE_ERROR', {
        details: error.message,
        shiftId,
      });
    }
    return data !== null;
  }
}

/**
 * N8's copy. Leads with the WINDOW, not the carer (M15): this is the red
 * sentence on the parent's screen, and whoever is named first in it is what
 * they read as the problem. The window is the problem; the carer did not
 * answer a question. The second clause is the next step, because "hand the
 * alarm back" without one is just an alarm.
 */
export function buildCoverAskExpiredPayload(ask: ExpiringAsk): PushPayload {
  return {
    title: 'No answer on that cover request',
    body: `Nobody is booked for the ${formatPushTime12h(ask.starts_at, ask.timezone)} shift — ask someone else, or mark that you've got it.`,
    data: {
      type: PUSH_NOTIFICATION_TYPES.COVER_ASK_EXPIRED,
      shiftId: ask.id,
      householdId: ask.household_id,
      localDate: ask.local_date,
      // The quiet-hours exemption is decided from this, not from a flag —
      // see `isQuietHoursExempt`.
      shiftStartsAt: ask.starts_at,
    },
  };
}

export async function runCoverAskExpiryJob(
  source: CoverAskExpirySource = new DefaultCoverAskExpirySource(),
  writer: CoverAskExpiryWriter = new DefaultCoverAskExpiryWriter(),
  log: ReminderLogClaim = new ReminderLogRepository(),
  parents: ReminderParentLister = new DefaultReminderParentLister(),
  push: ReminderPushService = defaultPushService,
  clock: ReminderJobClock = { now: () => new Date() }
): Promise<CoverAskExpiryJobResult> {
  const now = clock.now();
  const stats = emptyRuleStats();
  let expiredCount = 0;

  // Free the claims a crashed run died holding, before anything claims.
  await log.sweepStaleClaims();

  let due: ExpiringAsk[];
  try {
    due = await source.listDueAsks(now);
  } catch (error) {
    logger.error('Cover-ask expiry: failed to list due asks', { error });
    return {
      expiry: stats,
      expiredCount: 0,
      errorCount: 1,
      message: 'Cover-ask expiry failed to list due asks',
    };
  }

  stats.candidates = due.length;

  for (const ask of due) {
    try {
      const payload = buildCoverAskExpiredPayload(ask);
      const reminderKey = buildCoverAskExpiredKey(ask.id);

      // SEND FIRST — see the ordering note in the module header.
      const parentIds = await parents.listParentUserIds(ask.household_id);
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
          logger.error('Cover-ask expiry failed to notify a parent', {
            shiftId: ask.id,
            parentId,
            error,
          });
        }
      }

      // THEN close the ask. `cancelled_at` is the DEADLINE, not the moment the
      // tick happened: the ask died when its fuse ran out, and recording the
      // sweep's own clock would make a five-minute tick look like the reason.
      const at = ask.cover_ask_expires_at ?? ask.starts_at;
      if (await writer.expireAsk(ask.id, at)) {
        expiredCount++;
      }
    } catch (error) {
      stats.errors++;
      logger.error('Cover-ask expiry failed for a shift', {
        shiftId: ask.id,
        error,
      });
    }
  }

  return {
    expiry: stats,
    expiredCount,
    errorCount: stats.errors,
    message: `Expired ${expiredCount} cover ask(s), sent ${stats.sent} push(es)`,
  };
}
