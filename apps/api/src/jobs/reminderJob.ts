/**
 * Reminders-hourly job.
 *
 * Fans out time-based push reminders on an hourly pg_cron schedule (migration
 * 048). Recipients span timezones, so the job runs every hour and gates each
 * rule on the recipient's local wall-clock hour; `push_reminder_log` (047)
 * makes overlapping runs idempotent.
 *
 * CLAIM ORDER: `claimAndSend` below checks `push.canDeliver` (prefs + quiet
 * hours + at least one live token) BEFORE claiming, so a reminder that would
 * be suppressed anyway never touches the ledger — that's the common case
 * (opt-out, quiet hours, no registered device) handled without ever writing
 * a row. For the candidates that pass, the claim INSERT still happens BEFORE
 * the send, not after: this job can have overlapping runs (see above), and
 * "send, then claim" would let two overlapping runs both pass the "not yet
 * claimed" check and both deliver before either claim landed. Claiming first
 * trades that off for a narrow crash window: if the process dies between the
 * claim commit and the send completing, the claim now stands for a reminder
 * that never went out. `claimAndSend` shrinks that window as far as this
 * schema allows — the send result is checked and, on total failure (0
 * devices reached, or a thrown error), the claim is released again so the
 * next run retries. A hard process kill inside that window used to be
 * unrecoverable; migration 060 added the `confirmed_at` column that makes
 * the ledger two-phase, so the claim is only a RESERVATION until the send
 * confirms it, and `sweepStaleClaims` at the top of every run deletes
 * reservations older than two hours that nothing ever confirmed. Given the
 * choice the bias is unchanged: an occasional duplicate reminder from an
 * overlapping-run race is a minor annoyance, a permanently swallowed one
 * (the bug this replaced) is a missed shift or an unpaid timesheet nobody
 * finds out about.
 *
 * SETUP: scheduled hourly via pg_cron in migration `048_reminders_cron.sql`
 * (POST `/api/jobs/reminders`). Requires Vault secrets `cron_api_base_url` and
 * `cron_job_api_key` (see migration 007).
 *
 * @module jobs/reminderJob
 */

import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import {
  SHIFT_KINDS,
  SHIFT_STATUSES,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { Timesheet } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { supabaseService } from '../config/supabase';
import { HouseholdMemberRepository } from '../domains/household/repositories/householdMemberRepository';
import { HOUSEHOLD_ROLES } from '../domains/household/schemas';
import { NotificationPrefsRepository } from '../domains/notification/repositories/notificationPrefsRepository';
import { ReminderLogRepository } from '../domains/notification/repositories/reminderLogRepository';
import { notifyHouseholdParents } from '../domains/notification/services/householdPush';
import {
  hasDeliverableTarget,
  sendToUser,
} from '../domains/notification/services/pushDispatchService';
import type { PushPayload } from '../domains/notification/types';
import { DatabaseError } from '../errors';
import { logger } from '../middlewares/logger';

/**
 * Shift reminders go out in the local-hour window `[18:00, 22:00)`, not at
 * 18:00 exactly.
 *
 * The job runs hourly, so an equality gate meant one missed run — a deploy, a
 * pg_cron blip, an API outage across the 18:00 slot — silently dropped that
 * evening's reminders for every carer in that timezone, with nothing to retry
 * them: by the next run the hour no longer matched. A window turns a missed
 * run into a late reminder instead of no reminder.
 *
 * Widening is safe whatever the key shape, because `claimAndSend` claims on the
 * key STRING: the ledger row from the first successful send blocks every later
 * hour that builds the same string. `shift_reminder:<shiftId>` carries no date
 * segment, so it fires once ever. A DATE-segmented key
 * (`timesheet_awaiting_approval:<id>:<localSendDate>`) is invariant across the
 * hours of one local day, so it fires once per local DAY — not once per hour.
 *
 * (An earlier revision of this comment claimed a dated key "would re-send once
 * per hour instead". That was wrong — `buildTimesheetAwaitingApprovalKey`'s own
 * doc says the segment is "the recipient's local calendar day when the 09:00
 * send fires", which cannot change between 18:00 and 21:00. `uncoveredDigestJob`
 * relies on the corrected reading: a window PLUS a dated key, sending once a day.)
 *
 * 22:00 is the cutoff because a reminder for tomorrow stops being worth a late
 * buzz — quiet hours in `canDeliver` may suppress it anyway, and that is the
 * right side to lose on.
 */
const SHIFT_REMINDER_HOUR = 18;
const SHIFT_REMINDER_WINDOW_END = 22;
const TIMESHEET_NUDGE_HOUR = 9;
const TIMESHEET_SUBMITTED_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/**
 * Stays an EQUALITY, like `TIMESHEET_NUDGE_HOUR` and unlike the shift window.
 * The key is undated, so the ledger would swallow a wider window's extra
 * hours anyway — but an equality says out loud that this fires at nine, once,
 * rather than looking like a retry policy that isn't one.
 */
const SCHEDULE_NOT_SET_HOUR = 9;
/**
 * Day 0 is not a stall. Terms are usually agreed the same day the family has
 * already talked the week through out loud, so the arrangement has to have
 * survived a night before its silence means anything.
 */
const SCHEDULE_NOT_SET_MIN_AGE_MS = MS_PER_DAY;
/**
 * Nag-cap (A7 / D-27, §1.5 of the design spec): 3 consecutive daily nudges
 * from the entry threshold, then weekly. No counter table — the age of the
 * row already carries the count, so the gate is a pure function of
 * `daysSinceSubmitted`: `daysSinceSubmitted <= TIMESHEET_NAG_CONSECUTIVE_DAYS
 * || daysSinceSubmitted % 7 === 0`. `TIMESHEET_SUBMITTED_DAYS` stays 3 as the
 * entry threshold (unchanged); this is a SEPARATE constant on purpose so a
 * future change to either doesn't silently move the other.
 */
const TIMESHEET_NAG_CONSECUTIVE_DAYS = 3;

const PARENT_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

/** Per-rule counters returned in the job summary. */
export interface ReminderRuleStats {
  candidates: number;
  claimed: number;
  sent: number;
  skipped: number;
  errors: number;
}

export interface ReminderJobResult {
  shiftReminder: ReminderRuleStats;
  timesheetAwaitingApproval: ReminderRuleStats;
  scheduleNotSet: ReminderRuleStats;
  errorCount: number;
  message: string;
}

export function emptyRuleStats(): ReminderRuleStats {
  return {
    candidates: 0,
    claimed: 0,
    sent: 0,
    skipped: 0,
    errors: 0,
  };
}

/**
 * Narrow shift row the job needs — no children join. `kind`/`status` decide
 * which of the two evening pushes a candidate gets (A2): a CONFIRMED shift
 * (any kind) is `shift_reminder`; a PENDING `cover`-kind shift (an
 * unanswered cover-ask) is `cover_ask_reminder`. The candidate query below
 * only ever returns one of those two combinations.
 */
export type ShiftReminderCandidate = Pick<
  Shift,
  'id' | 'household_id' | 'carer_id' | 'starts_at' | 'kind' | 'status'
>;

/** Narrow timesheet row the job needs. */
export type TimesheetReminderCandidate = Pick<
  Timesheet,
  'id' | 'household_id' | 'week_start' | 'updated_at'
>;

/**
 * A household/carer pair whose pay terms are agreed and whose week has never
 * been started. Everything that makes it a candidate is decided in
 * `listScheduleNotSet` — by the time a row exists here, conditions 1–5 hold
 * and only the parent's local hour is left to check.
 */
export interface ScheduleNotSetCandidate {
  household_id: string;
  carer_id: string;
  /** What this family calls her; null when nothing resolved. */
  carer_display_name: string | null;
}

export interface ReminderCandidateSource {
  listShiftReminders(now: Date): Promise<ShiftReminderCandidate[]>;
  listTimesheetAwaitingApproval(
    now: Date
  ): Promise<TimesheetReminderCandidate[]>;
  listScheduleNotSet(now: Date): Promise<ScheduleNotSetCandidate[]>;
}

export interface ReminderLogClaim {
  claim(userId: string, reminderKey: string): Promise<boolean>;
  /** Undo a claim after a send that turned out not to deliver anything. */
  release(userId: string, reminderKey: string): Promise<void>;
  /** Promote a claim to a recorded delivery (migration 060). */
  confirm(userId: string, reminderKey: string): Promise<void>;
  /** Drop unconfirmed claims left behind by a crashed run. */
  sweepStaleClaims(): Promise<void>;
}

export interface UserTimezoneResolver {
  resolve(userId: string): Promise<string>;
}

export interface ReminderParentLister {
  listParentUserIds(householdId: string): Promise<string[]>;
}

export interface ReminderPushService {
  /**
   * Whether a send to this user/payload would actually deliver — prefs
   * (opt-out, quiet hours) and at least one live device token. Callers
   * check this BEFORE claiming an idempotency slot so a suppressed
   * reminder is never claimed at all.
   */
  canDeliver(userId: string, payload: PushPayload): Promise<boolean>;
  /** Awaits the real send and reports how many devices actually got it. */
  notifyUser(userId: string, payload: PushPayload): Promise<{ sent: number }>;
  notifyHouseholdParents(
    householdId: string,
    payload: PushPayload
  ): Promise<void>;
}

export interface ReminderJobClock {
  now(): Date;
}

function isValidIanaTimezone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Local calendar date (`yyyy-mm-dd`) and hour (0–23) in `timeZone`, or null on failure. */
export function getLocalClock(
  instant: Date,
  timeZone: string
): { date: string; hour: number } | null {
  if (!isValidIanaTimezone(timeZone)) {
    return null;
  }
  try {
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
    // `hourCycle: 'h23'` forces 24h regardless of locale — internal gating
    // only, never rendered, so the en-US tag (§2.6 sweep, was `en-GB`) is a
    // no-op on the extracted hour.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);
    const hour = Number(parts.find(part => part.type === 'hour')?.value ?? '0');
    return { date, hour };
  } catch {
    return null;
  }
}

/** Shift start as a calendar date in the recipient's zone. */
export function getShiftLocalDate(
  startsAt: string,
  timeZone: string
): string | null {
  const clock = getLocalClock(new Date(startsAt), timeZone);
  return clock?.date ?? null;
}

/** The calendar day after `yyyy-mm-dd` (UTC-safe noon anchor). */
export function nextCalendarDate(yyyyMmDd: string): string {
  const anchor = new Date(`${yyyyMmDd}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + 1);
  return anchor.toISOString().slice(0, 10);
}

export function buildShiftReminderKey(shiftId: string): string {
  return `shift_reminder:${shiftId}`;
}

/**
 * A2 / matrix row N7. Distinct from `buildShiftReminderKey` — a separate
 * key/type so a carer muting one can never mute the other (A6 shape), and
 * so a cover-ask that later gets accepted (status flips to `confirmed`)
 * still gets its own ordinary shift reminder from that point on.
 */
export function buildCoverAskReminderKey(shiftId: string): string {
  return `cover_ask_reminder:${shiftId}`;
}

/**
 * Daily nudge key — the date segment is the recipient's local calendar day
 * when the 09:00 send fires, so a still-unapproved week can be re-nudged on
 * later days (not once-only).
 */
export function buildTimesheetAwaitingApprovalKey(
  timesheetId: string,
  localSendDate: string
): string {
  return `timesheet_awaiting_approval:${timesheetId}:${localSendDate}`;
}

/**
 * UNDATED, so it fires once ever per relationship — the opposite of
 * `buildTimesheetAwaitingApprovalKey`, whose date segment is what makes that
 * one re-nudge daily. "Nobody has sent her a schedule" is a fact about a
 * relationship, not about a day, and a family that has decided to run on text
 * messages should not be asked about it every morning for a year.
 */
export function buildScheduleNotSetKey(
  householdId: string,
  carerId: string
): string {
  return `schedule_not_set:${householdId}:${carerId}`;
}

/** `household_id::carer_id`, the grain both the key and the query work at. */
function pairKey(householdId: string, carerId: string): string {
  return `${householdId}::${carerId}`;
}

/** Narrow rows the `schedule_not_set` query joins in JS. */
interface ActiveNannyRow {
  household_id: string;
  user_id: string;
  display_name_override: string | null;
}
interface ArrangementPairRow {
  household_id: string;
  carer_id: string | null;
  carer_display_name: string | null;
}
interface PatternPairRow {
  household_id: string;
  carer_id: string | null;
}

export class DefaultReminderCandidateSource implements ReminderCandidateSource {
  async listShiftReminders(now: Date): Promise<ShiftReminderCandidate[]> {
    const windowStart = new Date(
      now.getTime() - 12 * 60 * 60 * 1000
    ).toISOString();
    const windowEnd = new Date(
      now.getTime() + 48 * 60 * 60 * 1000
    ).toISOString();

    // A2: a CONFIRMED shift (any kind) OR a PENDING ask assigned to a carer
    // who has not answered yet. `recurring` stays excluded: a materialised
    // week awaiting first acceptance is a standing arrangement, not a question
    // somebody is waiting on an answer to tonight.
    //
    // 3-T3 WIDENED THE ASK ARM FROM `cover` TO `cover, extra`, and it is a fix
    // rather than a scope creep. 3-N wrote this against `kind = 'cover'`
    // because the spec calls a cover-ask a cover-kind shift — but NOTHING in
    // the product has ever written `kind = 'cover'`. The ask a parent actually
    // sends from the uncovered card is an `extra` shift
    // (`createExtraShift` → `SHIFT_KINDS.EXTRA`), so `cover_ask_reminder` had
    // zero possible candidates and N7 could never fire. `cover` stays in the
    // list so the kind means something the day it is written.
    const { data, error } = await supabaseService
      .from('shifts')
      .select('id, household_id, carer_id, starts_at, kind, status')
      .not('carer_id', 'is', null)
      .gte('starts_at', windowStart)
      .lt('starts_at', windowEnd)
      .or(
        `status.eq.${SHIFT_STATUSES.CONFIRMED},and(kind.in.(${SHIFT_KINDS.COVER},${SHIFT_KINDS.EXTRA}),status.eq.${SHIFT_STATUSES.PENDING})`
      );

    if (error) {
      throw new DatabaseError(
        'Failed to list shift reminder candidates',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }

    return (data ?? []) as ShiftReminderCandidate[];
  }

  async listTimesheetAwaitingApproval(
    now: Date
  ): Promise<TimesheetReminderCandidate[]> {
    const cutoff = new Date(
      now.getTime() - TIMESHEET_SUBMITTED_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data, error } = await supabaseService
      .from('timesheets')
      .select('id, household_id, week_start, updated_at')
      .eq('status', 'submitted')
      .lte('updated_at', cutoff);

    if (error) {
      throw new DatabaseError(
        'Failed to list timesheet reminder candidates',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }

    return (data ?? []) as TimesheetReminderCandidate[];
  }

  /**
   * Terms agreed, no week ever started. Three cheap queries joined in JS
   * rather than one clever embed, because the three tables have no FK path
   * between them that PostgREST can walk (`household_members` → `households`
   * is the only join here) and none of the three sets is large: the outer one
   * is "every active nanny in a live household".
   *
   * Conditions, in query order:
   *  1/2. live household + active nanny  — the `households!inner` embed.
   *  3/5. a pay arrangement at least a day old — since `9fa858e` an
   *       arrangement can only be minted by terms acceptance, so its
   *       existence IS "terms agreed".
   *  4.   no `schedule_patterns` row, IN ANY STATUS. There is deliberately no
   *       status filter below: starting the builder proves she found it, and
   *       `draft` is exactly the status a half-built week sits in.
   */
  async listScheduleNotSet(now: Date): Promise<ScheduleNotSetCandidate[]> {
    const { data: memberData, error: memberError } = await supabaseService
      .from('household_members')
      .select(
        'household_id, user_id, display_name_override, households!inner(state)'
      )
      .eq('role', HOUSEHOLD_ROLES.NANNY)
      .eq('status', 'active')
      .eq('households.state', 'live');

    if (memberError) {
      throw new DatabaseError(
        'Failed to list schedule-not-set nannies',
        'DATABASE_ERROR',
        { details: memberError.message }
      );
    }

    const nannies = (memberData ?? []) as ActiveNannyRow[];
    if (nannies.length === 0) {
      return [];
    }

    const carerIds = [...new Set(nannies.map(row => row.user_id))];
    const householdIds = [...new Set(nannies.map(row => row.household_id))];
    const cutoff = new Date(
      now.getTime() - SCHEDULE_NOT_SET_MIN_AGE_MS
    ).toISOString();

    const [arrangements, patterns] = await Promise.all([
      supabaseService
        .from('pay_arrangements')
        .select('household_id, carer_id, carer_display_name')
        .in('household_id', householdIds)
        .in('carer_id', carerIds)
        .lte('created_at', cutoff),
      supabaseService
        .from('schedule_patterns')
        .select('household_id, carer_id')
        .in('household_id', householdIds),
    ]);

    if (arrangements.error || patterns.error) {
      throw new DatabaseError(
        'Failed to list schedule-not-set candidates',
        'DATABASE_ERROR',
        {
          details:
            arrangements.error?.message ?? patterns.error?.message ?? 'unknown',
        }
      );
    }

    const agreedNames = new Map<string, string | null>();
    for (const row of (arrangements.data ?? []) as ArrangementPairRow[]) {
      if (!row.carer_id) continue;
      agreedNames.set(
        pairKey(row.household_id, row.carer_id),
        row.carer_display_name
      );
    }

    const startedPairs = new Set<string>();
    const startedHouseholds = new Set<string>();
    for (const row of (patterns.data ?? []) as PatternPairRow[]) {
      // 014's column comment: a parent can sketch a usual week before any
      // nanny exists, leaving `carer_id` null. That week is still proof the
      // builder was found, so it suppresses every carer in the household —
      // nagging a family that already did the thing is the worse failure.
      if (row.carer_id) {
        startedPairs.add(pairKey(row.household_id, row.carer_id));
      } else {
        startedHouseholds.add(row.household_id);
      }
    }

    const candidates: ScheduleNotSetCandidate[] = [];
    for (const nanny of nannies) {
      const pair = pairKey(nanny.household_id, nanny.user_id);
      if (!agreedNames.has(pair)) continue;
      if (startedHouseholds.has(nanny.household_id)) continue;
      if (startedPairs.has(pair)) continue;

      candidates.push({
        household_id: nanny.household_id,
        carer_id: nanny.user_id,
        // Same precedence `resolveCarerDisplayName` uses across the pay
        // domain: the per-household override is what this family calls her.
        carer_display_name:
          nanny.display_name_override ?? agreedNames.get(pair) ?? null,
      });
    }

    return candidates;
  }
}

class DefaultUserTimezoneResolver implements UserTimezoneResolver {
  constructor(
    private readonly prefsRepo: NotificationPrefsRepository = new NotificationPrefsRepository()
  ) {}

  async resolve(userId: string): Promise<string> {
    const prefs = await this.prefsRepo.findByUserId(userId);
    if (prefs?.timezone && isValidIanaTimezone(prefs.timezone)) {
      return prefs.timezone;
    }

    const { data, error } = await supabaseService
      .from('user_device_info')
      .select('timezone')
      .eq('user_id', userId)
      .not('timezone', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error('Failed to load device timezone for reminder job', {
        userId,
        error: error.message,
      });
      return 'UTC';
    }

    const deviceTz = data?.timezone;
    if (typeof deviceTz === 'string' && isValidIanaTimezone(deviceTz)) {
      return deviceTz;
    }

    return 'UTC';
  }
}

export class DefaultReminderParentLister implements ReminderParentLister {
  constructor(
    private readonly members: HouseholdMemberRepository = new HouseholdMemberRepository()
  ) {}

  async listParentUserIds(householdId: string): Promise<string[]> {
    const members = await this.members.listActiveByHousehold(householdId);
    return members
      .filter(member => PARENT_ROLES.has(member.role))
      .map(member => member.user_id);
  }
}

export const defaultPushService: ReminderPushService = {
  canDeliver(userId, payload) {
    return hasDeliverableTarget(userId, payload);
  },
  notifyUser(userId, payload) {
    return sendToUser(userId, payload);
  },
  async notifyHouseholdParents(householdId, payload) {
    notifyHouseholdParents(householdId, payload);
  },
};

const defaultClock: ReminderJobClock = {
  now: () => new Date(),
};

/**
 * Claim a reminder slot and send it, releasing the claim again if nothing
 * was actually delivered — so a candidate that is suppressed, has no
 * tokens, or hits a total Expo failure is retried on a later run instead of
 * being silently dropped forever (see the header comment in
 * `reminderLogRepository.ts` for the full crash-window analysis).
 *
 * Mutates `stats` in place; throws on a send exception (after releasing the
 * claim) so the caller's existing per-candidate try/catch records the error.
 *
 * Exported for `noShowJob`, which needs the same claim/send/confirm ordering.
 * Keep it here rather than copied: every line of the analysis above applies
 * identically, and a divergent copy would rot silently.
 */
export async function claimAndSend(
  deps: { log: ReminderLogClaim; push: ReminderPushService },
  userId: string,
  reminderKey: string,
  payload: PushPayload,
  stats: ReminderRuleStats
): Promise<void> {
  const deliverable = await deps.push.canDeliver(userId, payload);
  if (!deliverable) {
    stats.skipped++;
    return;
  }

  const claimed = await deps.log.claim(userId, reminderKey);
  if (!claimed) {
    stats.skipped++;
    return;
  }
  stats.claimed++;

  try {
    const result = await deps.push.notifyUser(userId, payload);
    if (result.sent === 0) {
      await deps.log.release(userId, reminderKey);
      stats.skipped++;
      return;
    }
    stats.sent++;

    // Phase two (C3): the claim was a reservation until now. Isolated from
    // the send's try/catch on purpose — the push HAS gone out, so letting a
    // bookkeeping failure fall into the release path below would guarantee a
    // duplicate on the next run in order to fix a problem that costs at most
    // one duplicate after the sweep horizon. Warn and move on.
    try {
      await deps.log.confirm(userId, reminderKey);
    } catch (error) {
      logger.warn('Failed to confirm a delivered reminder claim', {
        userId,
        reminderKey,
        error,
      });
    }
  } catch (error) {
    await deps.log.release(userId, reminderKey);
    throw error;
  }
}

async function processShiftReminders(
  candidates: ShiftReminderCandidate[],
  deps: {
    log: ReminderLogClaim;
    timezone: UserTimezoneResolver;
    push: ReminderPushService;
    now: Date;
  }
): Promise<ReminderRuleStats> {
  const stats = emptyRuleStats();
  stats.candidates = candidates.length;

  for (const shift of candidates) {
    const carerId = shift.carer_id;
    if (!carerId) {
      stats.skipped++;
      continue;
    }

    try {
      const timeZone = await deps.timezone.resolve(carerId);
      const clock =
        getLocalClock(deps.now, timeZone) ?? getLocalClock(deps.now, 'UTC');
      if (!clock) {
        stats.skipped++;
        continue;
      }

      if (
        clock.hour < SHIFT_REMINDER_HOUR ||
        clock.hour >= SHIFT_REMINDER_WINDOW_END
      ) {
        stats.skipped++;
        continue;
      }

      const shiftDate =
        getShiftLocalDate(shift.starts_at, timeZone) ??
        getShiftLocalDate(shift.starts_at, 'UTC');
      if (!shiftDate) {
        stats.skipped++;
        continue;
      }

      const tomorrow = nextCalendarDate(clock.date);
      if (shiftDate !== tomorrow) {
        stats.skipped++;
        continue;
      }

      // A2: a PENDING ask (kind `cover` or `extra`) gets its own type/key —
      // everything else (any CONFIRMED shift) keeps the ordinary reminder.
      // The candidate query above never returns a third combination. See that
      // query for why `extra` is in the set.
      const isPendingCoverAsk =
        (shift.kind === SHIFT_KINDS.COVER ||
          shift.kind === SHIFT_KINDS.EXTRA) &&
        shift.status === SHIFT_STATUSES.PENDING;

      const reminderKey = isPendingCoverAsk
        ? buildCoverAskReminderKey(shift.id)
        : buildShiftReminderKey(shift.id);
      const payload: PushPayload = isPendingCoverAsk
        ? {
            title: 'Cover request tomorrow',
            body: 'Someone asked you to cover a shift starting tomorrow.',
            data: {
              type: PUSH_NOTIFICATION_TYPES.COVER_ASK_REMINDER,
              shiftId: shift.id,
              householdId: shift.household_id,
            },
          }
        : {
            title: 'Shift tomorrow',
            body: 'You have a confirmed shift starting tomorrow.',
            data: {
              type: PUSH_NOTIFICATION_TYPES.SHIFT_REMINDER,
              shiftId: shift.id,
              householdId: shift.household_id,
            },
          };

      await claimAndSend(deps, carerId, reminderKey, payload, stats);
    } catch (error) {
      stats.errors++;
      logger.error('Reminder job failed to send shift reminder', {
        shiftId: shift.id,
        carerId,
        error,
      });
    }
  }

  return stats;
}

async function processTimesheetReminders(
  candidates: TimesheetReminderCandidate[],
  deps: {
    log: ReminderLogClaim;
    timezone: UserTimezoneResolver;
    parents: ReminderParentLister;
    push: ReminderPushService;
    now: Date;
  }
): Promise<ReminderRuleStats> {
  const stats = emptyRuleStats();
  stats.candidates = candidates.length;

  for (const timesheet of candidates) {
    try {
      const parentIds = await deps.parents.listParentUserIds(
        timesheet.household_id
      );
      if (parentIds.length === 0) {
        stats.skipped++;
        continue;
      }

      for (const parentId of parentIds) {
        try {
          const timeZone = await deps.timezone.resolve(parentId);
          const clock =
            getLocalClock(deps.now, timeZone) ?? getLocalClock(deps.now, 'UTC');
          if (!clock) {
            stats.skipped++;
            continue;
          }

          // Stays an equality, unlike the shift gate above: this key IS date
          // segmented, so a window would re-nudge every hour of it rather
          // than once a day. Changing that is a cadence decision, not a
          // reliability fix.
          if (clock.hour !== TIMESHEET_NUDGE_HOUR) {
            stats.skipped++;
            continue;
          }

          // A7 / D-27 nag cap: 3 consecutive daily nudges from the entry
          // threshold, then weekly. Computed in raw elapsed days (same basis
          // the candidate query's `updated_at <= cutoff` filter already
          // uses), not calendar-local days — the row only becomes a
          // candidate once true anyway.
          const daysSinceSubmitted = Math.floor(
            (deps.now.getTime() - Date.parse(timesheet.updated_at)) / MS_PER_DAY
          );
          if (
            !(
              daysSinceSubmitted <= TIMESHEET_NAG_CONSECUTIVE_DAYS ||
              daysSinceSubmitted % 7 === 0
            )
          ) {
            stats.skipped++;
            continue;
          }

          const reminderKey = buildTimesheetAwaitingApprovalKey(
            timesheet.id,
            clock.date
          );
          await claimAndSend(
            deps,
            parentId,
            reminderKey,
            {
              title: 'Hours awaiting approval',
              body: 'A timesheet has been waiting for your approval.',
              data: {
                type: PUSH_NOTIFICATION_TYPES.TIMESHEET_AWAITING_APPROVAL,
                timesheetId: timesheet.id,
                householdId: timesheet.household_id,
                weekStart: timesheet.week_start,
              },
            },
            stats
          );
        } catch (error) {
          stats.errors++;
          logger.error(
            'Reminder job failed to send timesheet awaiting approval reminder',
            {
              timesheetId: timesheet.id,
              parentId,
              error,
            }
          );
        }
      }
    } catch (error) {
      stats.errors++;
      logger.error(
        'Reminder job failed to resolve timesheet reminder parents',
        {
          timesheetId: timesheet.id,
          error,
        }
      );
    }
  }

  return stats;
}

/**
 * The push that closes the post-acceptance gap: terms are agreed, an
 * arrangement exists, and nobody has ever sent her a week.
 *
 * NO FIGURE IN THE BODY, same house rule as the pay domain — a lock screen is
 * a public surface. And when no name resolved, the title names NOBODY rather
 * than printing a placeholder: "Someone doesn't know when she's working" reads
 * like a bug, and "Carer" reads like a database column.
 */
async function processScheduleNotSet(
  candidates: ScheduleNotSetCandidate[],
  deps: {
    log: ReminderLogClaim;
    timezone: UserTimezoneResolver;
    parents: ReminderParentLister;
    push: ReminderPushService;
    now: Date;
  }
): Promise<ReminderRuleStats> {
  const stats = emptyRuleStats();
  stats.candidates = candidates.length;

  for (const candidate of candidates) {
    try {
      const parentIds = await deps.parents.listParentUserIds(
        candidate.household_id
      );
      if (parentIds.length === 0) {
        stats.skipped++;
        continue;
      }

      const title = candidate.carer_display_name
        ? `${candidate.carer_display_name} doesn't know when she's working yet`
        : "Your nanny doesn't know when she's working yet";
      const reminderKey = buildScheduleNotSetKey(
        candidate.household_id,
        candidate.carer_id
      );

      for (const parentId of parentIds) {
        try {
          const timeZone = await deps.timezone.resolve(parentId);
          const clock =
            getLocalClock(deps.now, timeZone) ?? getLocalClock(deps.now, 'UTC');
          if (!clock) {
            stats.skipped++;
            continue;
          }

          if (clock.hour !== SCHEDULE_NOT_SET_HOUR) {
            stats.skipped++;
            continue;
          }

          await claimAndSend(
            deps,
            parentId,
            reminderKey,
            {
              title,
              body: 'Send her the days and times you need each week.',
              data: {
                type: PUSH_NOTIFICATION_TYPES.SCHEDULE_NOT_SET,
                householdId: candidate.household_id,
                carerId: candidate.carer_id,
              },
            },
            stats
          );
        } catch (error) {
          stats.errors++;
          logger.error('Reminder job failed to send schedule-not-set nudge', {
            householdId: candidate.household_id,
            carerId: candidate.carer_id,
            parentId,
            error,
          });
        }
      }
    } catch (error) {
      stats.errors++;
      logger.error('Reminder job failed to resolve schedule-not-set parents', {
        householdId: candidate.household_id,
        carerId: candidate.carer_id,
        error,
      });
    }
  }

  return stats;
}

export async function runReminderJob(
  candidates: ReminderCandidateSource = new DefaultReminderCandidateSource(),
  log: ReminderLogClaim = new ReminderLogRepository(),
  timezone: UserTimezoneResolver = new DefaultUserTimezoneResolver(),
  parents: ReminderParentLister = new DefaultReminderParentLister(),
  push: ReminderPushService = defaultPushService,
  clock: ReminderJobClock = defaultClock
): Promise<ReminderJobResult> {
  const now = clock.now();

  // Before anything is claimed: drop the unconfirmed claims a previous run
  // died holding, so the reminders they suppress become claimable again on
  // this pass rather than never (C3). Best-effort in the repository — a
  // failed sweep must not stop this run from sending anything.
  await log.sweepStaleClaims();

  const [shiftCandidates, timesheetCandidates, scheduleNotSetCandidates] =
    await Promise.all([
      candidates.listShiftReminders(now),
      candidates.listTimesheetAwaitingApproval(now),
      candidates.listScheduleNotSet(now),
    ]);

  const shiftReminder = await processShiftReminders(shiftCandidates, {
    log,
    timezone,
    push,
    now,
  });

  const timesheetAwaitingApproval = await processTimesheetReminders(
    timesheetCandidates,
    {
      log,
      timezone,
      parents,
      push,
      now,
    }
  );

  const scheduleNotSet = await processScheduleNotSet(scheduleNotSetCandidates, {
    log,
    timezone,
    parents,
    push,
    now,
  });

  const errorCount =
    shiftReminder.errors +
    timesheetAwaitingApproval.errors +
    scheduleNotSet.errors;

  const sentTotal =
    shiftReminder.sent + timesheetAwaitingApproval.sent + scheduleNotSet.sent;

  return {
    shiftReminder,
    timesheetAwaitingApproval,
    scheduleNotSet,
    errorCount,
    message: `Reminders job sent ${sentTotal} push(es)`,
  };
}
