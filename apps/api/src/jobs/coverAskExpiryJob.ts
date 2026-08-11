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
 * ORDERING: FLIP FIRST, SEND ONLY ON A SUCCESSFUL FLIP
 * ---------------------------------------------------------------------------
 * This was push-then-flip, for a real reason: a process death between the two
 * leaves an ask that is closed and a parent who was never told, permanently,
 * because the next tick no longer sees a pending row. Push-then-flip made a
 * death recoverable — the ask stays pending, the next tick retries, and the
 * once-ever claim key collides so nobody is told twice.
 *
 * It also made the job LIE, every time it mattered most. `due` is a snapshot;
 * a carer who accepts at 05:38 is still in the 05:40 tick's list, and carers
 * answer near the deadline because that is what deadlines do. Push-then-flip
 * told every parent "nobody is booked for the 7:00 AM shift" and only THEN let
 * `expireAsk`'s `.eq('status','pending')` CAS correctly fail. The claim key
 * `cover_ask_expired:<shiftId>` is once-ever, so nothing retracts it: the
 * parent has been told nobody is coming to a shift that IS covered, forever.
 *
 * The CAS is the only thing in this job that knows whether the ask is still
 * unanswered, so nothing may be sent before it runs.
 *
 * THE WINDOW THAT BUYS: a death between the flip and the push loses the push.
 * The ask is `cancelled` with no actor, no tick will retry it, and the parent
 * never gets the buzz. Accepted, because the two failures are not the same
 * size — a lost push loses a NOTIFICATION of a fact that is still on the
 * parent's schedule (the ask reads as expired there, and the shift is
 * uncovered on every surface that shows coverage), whereas a wrong push
 * manufactures a fact that is false and unretractable. One is a missed buzz in
 * a sub-second crash window on a five-minute cron; the other fires on the
 * ordinary case of a carer accepting late.
 *
 * The claim → send → confirm ledger inside `claimAndSend` is untouched
 * (GOLDEN-FIXES #24) and still stops a double-send within the push loop.
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

/**
 * How far back the sweep reaches. Without a floor the `starts_at.lte.now` arm
 * matches EVERY pending extra/cover shift ever created — including rows that
 * predate 088 and therefore have a null deadline and a start months in the
 * past — so the first tick after 088 ships would push "Nobody is booked for
 * the ..." to every parent about all of them at once.
 *
 * Seven days is generous against the failure it has to survive: the job ticks
 * every five minutes, so anything older than that was not missed, it was never
 * in scope. An ask older than the floor stays `pending`; it is out of the
 * reminder job's ±window too, so it is inert rather than noisy.
 */
export const EXPIRY_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Rows per tick. A cap, not a filter — the remainder is picked up five minutes
 * later, because `starts_at ascending` makes the drain deterministic and every
 * ask this tick closes leaves the pending set. Hitting it is reported and
 * logged, never swallowed (the playbook's no-silent-caps rule).
 */
export const EXPIRY_BATCH_LIMIT = 200;

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
  /** The tick filled `EXPIRY_BATCH_LIMIT` — there is more waiting. */
  batchCapped: boolean;
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
    const floorIso = new Date(now.getTime() - EXPIRY_LOOKBACK_MS).toISOString();
    const { data, error } = await supabaseService
      .from('shifts')
      .select(
        'id, household_id, carer_id, starts_at, timezone, local_date, cover_ask_expires_at'
      )
      .eq('status', SHIFT_STATUSES.PENDING)
      .in('kind', [...EXPIRING_ASK_KINDS])
      .not('carer_id', 'is', null)
      // THE FLOOR — see `EXPIRY_LOOKBACK_MS`. Anchored on `starts_at` because
      // that is the one instant both arms below share; the deadline arm is
      // always earlier than its own shift's start, so a floor here bounds both.
      .gte('starts_at', floorIso)
      // Two arms, and the second is not redundant. Asks created before
      // migration 088 have a null deadline, and an ask whose shift has already
      // started is over however it got there — §5.2's "expiry never fires
      // after the shift has started" cuts both ways: not later than the start,
      // and not still open past it either.
      .or(`cover_ask_expires_at.lte.${nowIso},starts_at.lte.${nowIso}`)
      // Oldest first, so a capped batch drains over the next ticks rather than
      // re-picking the same slice forever.
      .order('starts_at', { ascending: true })
      .limit(EXPIRY_BATCH_LIMIT);

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
      batchCapped: false,
      errorCount: 1,
      message: 'Cover-ask expiry failed to list due asks',
    };
  }

  stats.candidates = due.length;
  const batchCapped = due.length >= EXPIRY_BATCH_LIMIT;
  if (batchCapped) {
    logger.warn('Cover-ask expiry hit its batch cap; more asks are waiting', {
      limit: EXPIRY_BATCH_LIMIT,
    });
  }

  for (const ask of due) {
    try {
      // CLOSE THE ASK FIRST — see the ordering note in the module header. The
      // CAS is the only thing that knows the carer has not answered in the
      // last five minutes, and a lost race must cost a push, never send one.
      //
      // `cancelled_at` is the DEADLINE, not the moment the tick happened: the
      // ask died when its fuse ran out, and recording the sweep's own clock
      // would make a five-minute tick look like the reason.
      const at = ask.cover_ask_expires_at ?? ask.starts_at;
      if (!(await writer.expireAsk(ask.id, at))) {
        // She answered. Nothing expired, so nobody is told anything.
        stats.skipped++;
        continue;
      }
      expiredCount++;

      const payload = buildCoverAskExpiredPayload(ask);
      const reminderKey = buildCoverAskExpiredKey(ask.id);

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
    batchCapped,
    errorCount: stats.errors,
    message: `Expired ${expiredCount} cover ask(s), sent ${stats.sent} push(es)${
      batchCapped ? ' (batch capped — more waiting)' : ''
    }`,
  };
}
