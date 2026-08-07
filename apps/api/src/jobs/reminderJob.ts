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

import type { CoParentApproval } from '@steadily-nanny/shared-types/schemas/approval.schema';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
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
 * Widening is only safe because the shift claim key
 * (`shift_reminder:<shiftId>`) carries NO date segment, so the ledger row from
 * the first successful send blocks every later hour in the window. A key with
 * a date segment would re-send once per hour instead (see
 * `TIMESHEET_NUDGE_HOUR` below).
 *
 * 22:00 is the cutoff because a reminder for tomorrow stops being worth a late
 * buzz — quiet hours in `canDeliver` may suppress it anyway, and that is the
 * right side to lose on.
 */
const SHIFT_REMINDER_HOUR = 18;
const SHIFT_REMINDER_WINDOW_END = 22;
const TIMESHEET_NUDGE_HOUR = 9;
const TIMESHEET_SUBMITTED_DAYS = 3;
const APPROVAL_EXPIRING_HOURS = 6;

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
  approvalExpiring: ReminderRuleStats;
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

/** Narrow shift row the job needs — no children join. */
export type ShiftReminderCandidate = Pick<
  Shift,
  'id' | 'household_id' | 'carer_id' | 'starts_at'
>;

/** Narrow timesheet row the job needs. */
export type TimesheetReminderCandidate = Pick<
  Timesheet,
  'id' | 'household_id' | 'week_start' | 'updated_at'
>;

/** Narrow approval row the job needs. */
export type ApprovalExpiringCandidate = Pick<
  CoParentApproval,
  'id' | 'household_id' | 'requested_by' | 'timeout_at'
>;

export interface ReminderCandidateSource {
  listShiftReminders(now: Date): Promise<ShiftReminderCandidate[]>;
  listTimesheetAwaitingApproval(
    now: Date
  ): Promise<TimesheetReminderCandidate[]>;
  listApprovalExpiring(now: Date): Promise<ApprovalExpiringCandidate[]>;
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
    const parts = new Intl.DateTimeFormat('en-GB', {
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

export function buildApprovalExpiringKey(approvalId: string): string {
  return `approval_expiring:${approvalId}`;
}

class DefaultReminderCandidateSource implements ReminderCandidateSource {
  async listShiftReminders(now: Date): Promise<ShiftReminderCandidate[]> {
    const windowStart = new Date(
      now.getTime() - 12 * 60 * 60 * 1000
    ).toISOString();
    const windowEnd = new Date(
      now.getTime() + 48 * 60 * 60 * 1000
    ).toISOString();

    const { data, error } = await supabaseService
      .from('shifts')
      .select('id, household_id, carer_id, starts_at')
      .eq('status', 'confirmed')
      .not('carer_id', 'is', null)
      .gte('starts_at', windowStart)
      .lt('starts_at', windowEnd);

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

  async listApprovalExpiring(now: Date): Promise<ApprovalExpiringCandidate[]> {
    const nowIso = now.toISOString();
    const horizonIso = new Date(
      now.getTime() + APPROVAL_EXPIRING_HOURS * 60 * 60 * 1000
    ).toISOString();

    const { data, error } = await supabaseService
      .from('co_parent_approvals')
      .select('id, household_id, requested_by, timeout_at')
      .eq('status', 'pending')
      .gt('timeout_at', nowIso)
      .lte('timeout_at', horizonIso);

    if (error) {
      throw new DatabaseError(
        'Failed to list approval-expiring candidates',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }

    return (data ?? []) as ApprovalExpiringCandidate[];
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

      const reminderKey = buildShiftReminderKey(shift.id);
      await claimAndSend(
        deps,
        carerId,
        reminderKey,
        {
          title: 'Shift tomorrow',
          body: 'You have a confirmed shift starting tomorrow.',
          data: {
            type: PUSH_NOTIFICATION_TYPES.SHIFT_REMINDER,
            shiftId: shift.id,
            householdId: shift.household_id,
          },
        },
        stats
      );
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

async function processApprovalExpiring(
  candidates: ApprovalExpiringCandidate[],
  deps: {
    log: ReminderLogClaim;
    parents: ReminderParentLister;
    push: ReminderPushService;
  }
): Promise<ReminderRuleStats> {
  const stats = emptyRuleStats();
  stats.candidates = candidates.length;

  for (const approval of candidates) {
    try {
      const parentIds = await deps.parents.listParentUserIds(
        approval.household_id
      );
      const responders = parentIds.filter(id => id !== approval.requested_by);
      if (responders.length === 0) {
        stats.skipped++;
        continue;
      }

      for (const responderId of responders) {
        try {
          const reminderKey = buildApprovalExpiringKey(approval.id);
          await claimAndSend(
            deps,
            responderId,
            reminderKey,
            {
              title: 'Approval expiring soon',
              body: 'A co-parent approval request is about to time out.',
              data: {
                type: PUSH_NOTIFICATION_TYPES.APPROVAL_EXPIRING,
                householdId: approval.household_id,
              },
            },
            stats
          );
        } catch (error) {
          stats.errors++;
          logger.error(
            'Reminder job failed to send approval expiring reminder',
            {
              approvalId: approval.id,
              responderId,
              error,
            }
          );
        }
      }
    } catch (error) {
      stats.errors++;
      logger.error('Reminder job failed to resolve approval expiring parents', {
        approvalId: approval.id,
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

  const [shiftCandidates, timesheetCandidates, approvalCandidates] =
    await Promise.all([
      candidates.listShiftReminders(now),
      candidates.listTimesheetAwaitingApproval(now),
      candidates.listApprovalExpiring(now),
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

  const approvalExpiring = await processApprovalExpiring(approvalCandidates, {
    log,
    parents,
    push,
  });

  const errorCount =
    shiftReminder.errors +
    timesheetAwaitingApproval.errors +
    approvalExpiring.errors;

  const sentTotal =
    shiftReminder.sent + timesheetAwaitingApproval.sent + approvalExpiring.sent;

  return {
    shiftReminder,
    timesheetAwaitingApproval,
    approvalExpiring,
    errorCount,
    message: `Reminders job sent ${sentTotal} push(es)`,
  };
}
