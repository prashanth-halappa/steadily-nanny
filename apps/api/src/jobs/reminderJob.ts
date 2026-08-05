/**
 * Reminders-hourly job.
 *
 * Fans out time-based push reminders on an hourly pg_cron schedule (migration
 * 048). Recipients span timezones, so the job runs every hour and gates each
 * rule on the recipient's local wall-clock hour; `push_reminder_log` (047)
 * makes overlapping runs idempotent.
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
import {
  notifyHouseholdParents,
  notifyUser,
} from '../domains/notification/services/householdPush';
import type { PushPayload } from '../domains/notification/types';
import { DatabaseError } from '../errors';
import { logger } from '../middlewares/logger';

const SHIFT_REMINDER_HOUR = 18;
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

function emptyRuleStats(): ReminderRuleStats {
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
}

export interface UserTimezoneResolver {
  resolve(userId: string): Promise<string>;
}

export interface ReminderParentLister {
  listParentUserIds(householdId: string): Promise<string[]>;
}

export interface ReminderPushService {
  notifyUser(userId: string, payload: PushPayload): Promise<void>;
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

class DefaultReminderParentLister implements ReminderParentLister {
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

const defaultPushService: ReminderPushService = {
  async notifyUser(userId, payload) {
    notifyUser(userId, payload);
  },
  async notifyHouseholdParents(householdId, payload) {
    notifyHouseholdParents(householdId, payload);
  },
};

const defaultClock: ReminderJobClock = {
  now: () => new Date(),
};

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

      if (clock.hour !== SHIFT_REMINDER_HOUR) {
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
      const claimed = await deps.log.claim(carerId, reminderKey);
      if (!claimed) {
        stats.skipped++;
        continue;
      }
      stats.claimed++;

      await deps.push.notifyUser(carerId, {
        title: 'Shift tomorrow',
        body: 'You have a confirmed shift starting tomorrow.',
        data: {
          type: PUSH_NOTIFICATION_TYPES.SHIFT_REMINDER,
          shiftId: shift.id,
          householdId: shift.household_id,
        },
      });
      stats.sent++;
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

          if (clock.hour !== TIMESHEET_NUDGE_HOUR) {
            stats.skipped++;
            continue;
          }

          const reminderKey = buildTimesheetAwaitingApprovalKey(
            timesheet.id,
            clock.date
          );
          const claimed = await deps.log.claim(parentId, reminderKey);
          if (!claimed) {
            stats.skipped++;
            continue;
          }
          stats.claimed++;

          await deps.push.notifyUser(parentId, {
            title: 'Hours awaiting approval',
            body: 'A timesheet has been waiting for your approval.',
            data: {
              type: PUSH_NOTIFICATION_TYPES.TIMESHEET_AWAITING_APPROVAL,
              timesheetId: timesheet.id,
              householdId: timesheet.household_id,
              weekStart: timesheet.week_start,
            },
          });
          stats.sent++;
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
          const claimed = await deps.log.claim(responderId, reminderKey);
          if (!claimed) {
            stats.skipped++;
            continue;
          }
          stats.claimed++;

          await deps.push.notifyUser(responderId, {
            title: 'Approval expiring soon',
            body: 'A co-parent approval request is about to time out.',
            data: {
              type: PUSH_NOTIFICATION_TYPES.APPROVAL_EXPIRING,
              householdId: approval.household_id,
            },
          });
          stats.sent++;
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
