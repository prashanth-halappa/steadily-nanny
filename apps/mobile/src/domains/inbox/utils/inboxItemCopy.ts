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
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';

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
  _timeZone: string
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
  }
}

/** Reserved for Rule B's one coloured-text exception — always null now. */
export function deadlineForItem(
  _item: InboxItem,
  _t: InboxItemT,
  _timeZone: string
): string | null {
  return null;
}
