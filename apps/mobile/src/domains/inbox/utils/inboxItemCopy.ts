/**
 * @module domains/inbox/utils/inboxItemCopy
 *
 * The one place that turns an `InboxItem` into words and a destination.
 * Extracted from `InboxScreen.tsx` so `NeedsAttentionCard` (Today's T1
 * summary) and `InboxScreen` (the full list) share the exact same sentence
 * per item — Today and the inbox must never word the same fact differently.
 *
 * `pending_shift` (§2.2/§2.3a) is the one kind this module dates/times
 * rather than just naming a week — `titleForItem`/`subtitleForItem` take
 * `timeZone` for it, following `formatDisplayDate`'s day/month convention
 * every other kind here already uses (never a weekday name — that flavour
 * stays on the parent-facing `TodayCoverage` cause line, which already has
 * `tSchedule`'s `weekday.*` keys in scope; duplicating them into this
 * namespace for one kind was not worth it).
 *
 * The kinds this build's spec assigns to Today/inbox but does not ship here
 * — `terms_proposal`, `reimbursement_owed`, `terms_ack` — are NOT arms of
 * `InboxItem` at all (not stubbed, not partially wired): the ack/proposal
 * wire does not exist on `main` yet (3-U1's territory), and reimbursements
 * have no household-wide "which weeks are unsettled" read (only a per-week
 * one) without a new aggregate endpoint this mobile-only slice does not add.
 * See the slice report for the full reasoning; a future slice adds the case
 * here when the data exists, never before.
 */
import type { Href } from 'expo-router';
import type { InboxItem } from '@/src/domains/inbox/utils/buildInboxItems';
import { isCoverAskUrgent } from '@/src/domains/schedule/utils/coverAskDeadline';
import {
  formatClockTime,
  formatDuration,
} from '@/src/domains/timesheet/utils/duration';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { localDateInZone } from '@/src/lib/localDate';

export type InboxItemT = (key: string, opts?: Record<string, string>) => string;

export function hrefForItem(item: InboxItem): Href {
  switch (item.kind) {
    case 'change_request':
      return `/(private)/schedule/shifts/${item.shiftId}` as Href;
    case 'pending_pattern':
      return `/(private)/schedule/respond/${item.patternId}` as Href;
    case 'queried_week':
      return `/(private)/(tabs)/hours?weekStart=${item.weekStart}` as Href;
    case 'submitted_week':
      return `/(private)/(tabs)/hours?weekStart=${item.weekStart}` as Href;
    case 'stale_submitted_week':
      return `/(private)/(tabs)/hours?weekStart=${item.weekStart}` as Href;
    case 'pending_shift':
      return `/(private)/schedule/shifts/${item.id}` as Href;
  }
}

export function titleForItem(
  item: InboxItem,
  t: InboxItemT,
  timeZone = 'UTC'
): string {
  switch (item.kind) {
    case 'change_request':
      return t('items.changeRequest.title', {
        kind: t(`items.changeRequest.kind.${item.requestKind}`, {
          defaultValue: item.requestKind,
        }),
      });
    case 'pending_pattern':
      return t('items.pendingPattern.title');
    case 'queried_week':
      return t('items.queriedWeek.title', {
        week: formatDisplayDate(item.weekStart),
      });
    case 'submitted_week':
      return t('items.submittedWeek.title', {
        week: formatDisplayDate(item.weekStart),
      });
    // "Week of 4 Aug — submitted 21 days ago, not approved". It says how
    // long and stops: a fact about a date, not a verdict about a family.
    case 'stale_submitted_week':
      return t('items.staleSubmittedWeek.title', {
        week: formatDisplayDate(item.weekStart),
        days: String(item.daysAgo),
      });
    // "Can you cover 26 Aug, 8:00 AM – 1:00 PM?" — the whole ask in one
    // sentence, no verdict about whether she has answered (§2.3a).
    case 'pending_shift':
      return t('items.pendingShift.title', {
        date: formatDisplayDate(item.localDate),
        start: formatClockTime(item.startsAt, timeZone),
        end: formatClockTime(item.endsAt, timeZone),
      });
  }
}

export function subtitleForItem(
  item: InboxItem,
  t: InboxItemT,
  timeZone: string
): string {
  switch (item.kind) {
    case 'change_request':
      return t('items.changeRequest.subtitle');
    case 'pending_pattern':
      return t('items.pendingPattern.subtitle', {
        start: formatDisplayDate(item.dtstart),
      });
    case 'queried_week':
      return item.queryNote?.trim()
        ? t('items.queriedWeek.subtitleWithNote', { note: item.queryNote })
        : t('items.queriedWeek.subtitle');
    case 'submitted_week':
      return item.carerDisplayName
        ? t('items.submittedWeek.subtitle', { carer: item.carerDisplayName })
        : t('items.submittedWeek.subtitleFallback');
    case 'stale_submitted_week':
      return t('items.staleSubmittedWeek.subtitle', {
        hours: formatDuration(item.totalMinutes),
      });
    // "Asked 24 Aug · Answer by 27 Aug, 6:00 PM" — never invents a deadline
    // for a legacy/pre-088 row with no `cover_ask_expires_at` stamped.
    case 'pending_shift':
      return item.coverAskExpiresAt
        ? t('items.pendingShift.subtitle', {
            askedDate: formatDisplayDate(
              localDateInZone(timeZone, new Date(item.createdAt))
            ),
            deadlineDate: formatDisplayDate(
              localDateInZone(timeZone, new Date(item.coverAskExpiresAt))
            ),
            deadlineTime: formatClockTime(item.coverAskExpiresAt, timeZone),
          })
        : t('items.pendingShift.subtitleNoDeadline', {
            askedDate: formatDisplayDate(
              localDateInZone(timeZone, new Date(item.createdAt))
            ),
          });
  }
}

/** The verb on the T1 card's single primary button — one per item kind. */
export function ctaForItem(item: InboxItem, t: InboxItemT): string {
  switch (item.kind) {
    case 'change_request':
      return t('items.changeRequest.cta');
    case 'pending_pattern':
      return t('items.pendingPattern.cta');
    case 'queried_week':
      return t('items.queriedWeek.cta');
    case 'submitted_week':
      return t('items.submittedWeek.cta');
    case 'stale_submitted_week':
      return t('items.staleSubmittedWeek.cta');
    case 'pending_shift':
      return t('items.pendingShift.cta');
  }
}

/**
 * Rule B's one coloured-text exception (§2.3a/M21): a string ONLY for
 * `pending_shift`, and only inside the urgent window shared with
 * `ShiftDetailScreen`'s M21 deadline sentence (`coverAskDeadline.ts` —
 * "same rule, same threshold, both surfaces"). Every other kind, and a
 * `pending_shift` outside the window or already past it, stays `null` — an
 * expired ask is "Expired", never a red deadline that lied about still
 * being open.
 */
export function deadlineForItem(
  item: InboxItem,
  t: InboxItemT,
  timeZone: string,
  nowMs: number = Date.now()
): string | null {
  if (item.kind !== 'pending_shift') return null;
  if (!isCoverAskUrgent(item.coverAskExpiresAt, nowMs)) return null;
  const expiresAt = item.coverAskExpiresAt as string;
  return t('items.pendingShift.deadline', {
    deadlineDate: formatDisplayDate(
      localDateInZone(timeZone, new Date(expiresAt))
    ),
    deadlineTime: formatClockTime(expiresAt, timeZone),
  });
}
