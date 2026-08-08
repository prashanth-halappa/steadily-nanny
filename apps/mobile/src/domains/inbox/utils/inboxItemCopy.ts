/**
 * @module domains/inbox/utils/inboxItemCopy
 *
 * The one place that turns an `InboxItem` into words and a destination.
 * Extracted from `InboxScreen.tsx` so `NeedsAttentionCard` (Today's T1
 * summary) and `InboxScreen` (the full list) share the exact same sentence
 * per item — Today and the inbox must never word the same fact differently.
 */
import type { Href } from 'expo-router';
import type { InboxItem } from '@/src/domains/inbox/utils/buildInboxItems';
import { formatApprovalDeadline } from '@/src/domains/inbox/utils/formatApprovalDeadline';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';

export type InboxItemT = (key: string, opts?: Record<string, string>) => string;

export function hrefForItem(item: InboxItem): Href {
  switch (item.kind) {
    case 'change_request':
      return `/(private)/schedule/shifts/${item.shiftId}` as Href;
    case 'co_parent_approval':
      return item.shiftId
        ? (`/(private)/schedule/shifts/${item.shiftId}` as Href)
        : ('/(private)/(tabs)/schedule' as Href);
    case 'pending_pattern':
      return `/(private)/schedule/respond/${item.patternId}` as Href;
    case 'queried_week':
      return `/(private)/(tabs)/hours?weekStart=${item.weekStart}` as Href;
    case 'submitted_week':
      return `/(private)/(tabs)/hours?weekStart=${item.weekStart}` as Href;
  }
}

export function titleForItem(item: InboxItem, t: InboxItemT): string {
  switch (item.kind) {
    case 'change_request':
      return t('items.changeRequest.title', {
        kind: t(`items.changeRequest.kind.${item.requestKind}`, {
          defaultValue: item.requestKind,
        }),
      });
    case 'co_parent_approval':
      return t('items.approval.title', {
        action: t(`items.approval.action.${item.action}`, {
          defaultValue: item.action,
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
    case 'co_parent_approval':
      return t('items.approval.subtitle', {
        when: formatApprovalDeadline(item.timeoutAt, timeZone),
      });
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
  }
}

/** The verb on the T1 card's single primary button — one per item kind. */
export function ctaForItem(item: InboxItem, t: InboxItemT): string {
  switch (item.kind) {
    case 'change_request':
      return t('items.changeRequest.cta');
    case 'co_parent_approval':
      return t('items.approval.cta');
    case 'pending_pattern':
      return t('items.pendingPattern.cta');
    case 'queried_week':
      return t('items.queriedWeek.cta');
    case 'submitted_week':
      return t('items.submittedWeek.cta');
  }
}

/**
 * The auto-approve deadline, in `destructive` on the T1 card (Rule B's one
 * coloured-text exception) — `null` for every kind but `co_parent_approval`,
 * which always carries a `timeoutAt`.
 */
export function deadlineForItem(
  item: InboxItem,
  t: InboxItemT,
  timeZone: string
): string | null {
  if (item.kind !== 'co_parent_approval') {
    return null;
  }
  return t('items.approval.deadlineLabel', {
    when: formatApprovalDeadline(item.timeoutAt, timeZone),
  });
}
