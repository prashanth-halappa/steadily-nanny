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
 */
import type { Href } from 'expo-router';
import type { InboxItem } from '@/src/domains/inbox/utils/buildInboxItems';
import { formatDisplayDateWithYear } from '@/src/domains/pay/utils/payArrangementForm';
import { isCoverAskUrgent } from '@/src/domains/schedule/utils/coverAskDeadline';
import {
  formatClockTime,
  formatDuration,
} from '@/src/domains/timesheet/utils/duration';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { localDateInZone } from '@/src/lib/localDate';
import { formatMoney, formatRate } from '@/src/lib/money';
import { shiftDetailHref } from '@/src/lib/notificationRouteMap';

export type InboxItemT = (key: string, opts?: Record<string, string>) => string;

export function hrefForItem(item: InboxItem): Href {
  switch (item.kind) {
    // Same destination the push notification produces (SHIFT_CHANGE_REQUESTED
    // carries `changeRequestId` too) — one contract, both surfaces.
    case 'change_request':
      return (shiftDetailHref({
        shiftId: item.shiftId,
        changeRequestId: item.id,
      }) ?? '/(private)/(tabs)/schedule') as Href;
    case 'pending_pattern':
      return `/(private)/schedule/respond/${item.patternId}` as Href;
    // The Hours TAB can only show one household at a time (HYBRID contract,
    // §A) — every href landing on it must carry `householdId` so the tab can
    // switch to the right one.
    case 'queried_week':
      return `/(private)/(tabs)/hours?weekStart=${item.weekStart}&householdId=${item.householdId}` as Href;
    case 'submitted_week':
      return `/(private)/(tabs)/hours?weekStart=${item.weekStart}&householdId=${item.householdId}` as Href;
    case 'stale_submitted_week':
      return `/(private)/(tabs)/hours?weekStart=${item.weekStart}&householdId=${item.householdId}` as Href;
    case 'pending_shift':
      return (shiftDetailHref({
        shiftId: item.id,
        householdId: item.householdId,
      }) ?? '/(private)/(tabs)/schedule') as Href;
    // §7.2 — the review screen IS the proposal, in view mode.
    case 'terms_proposal':
    // A7 — the same screen, in view mode: it is where a sent proposal lives
    // too, and there is no second surface for "the thing I sent".
    case 'terms_proposal_sent':
      return `/(private)/pay/proposal/${item.id}` as Href;
    case 'terms_ack':
      return '/(private)/settings/my-pay' as Href;
    case 'reimbursement_owed':
      return `/(private)/(tabs)/hours?weekStart=${item.weekStart}&householdId=${item.householdId}` as Href;
  }
}

/** The day a proposal was sent, in the reader's zone — §10's law is that the
 * state word never appears without its date. */
function proposedOn(proposedAt: string, timeZone: string): string {
  return formatDisplayDate(localDateInZone(timeZone, new Date(proposedAt)));
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
    // "Terms proposed by Marisol · 24 Aug" — §10's state word with a date,
    // and no figure at all (the same discipline the push copy keeps, §13).
    // A counter names the other side instead: the carer's own name on a row
    // she has to ANSWER would read like her own proposal came back to her.
    case 'terms_proposal':
      return item.direction === 'carer'
        ? t('items.termsProposal.title', {
            carer: item.carerDisplayName,
            date: proposedOn(item.proposedAt, timeZone),
          })
        : t('items.termsProposal.titleCountered', {
            date: proposedOn(item.proposedAt, timeZone),
          });
    // A7 — names the carer it was SENT TO. "Terms you sent Marisol" is the
    // author's own sentence; "Terms proposed by Marisol" (the row above) is
    // the answerer's, and swapping them names the wrong author, which is the
    // exact bug this kind exists to fix.
    case 'terms_proposal_sent':
      return t('items.termsProposalSent.title', {
        carer: item.carerDisplayName,
        date: proposedOn(item.proposedAt, timeZone),
      });
    case 'terms_ack':
      return item.isFirstTerms
        ? t('items.termsAck.titleFirst')
        : t('items.termsAck.titleChanged', {
            date: formatDisplayDateWithYear(item.validFrom),
          });
    case 'reimbursement_owed':
      return t('items.reimbursementOwed.title', {
        amount: formatMoney(item.amountMinor, item.currency),
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
    // The figures live here, never in the title. The weekly equivalent is the
    // server's (`weekly_equivalent_minor`) — a client-side rate x hours prints
    // $1,400 where the truth is $1,540 once overtime applies (§17, D23) — and
    // with no currency on the proposal's terms there is no honest way to
    // render either amount, so the row names none.
    case 'terms_proposal': {
      if (!item.currency) return t('items.termsProposal.subtitleNoFigures');
      const rate = formatRate(item.rateMinor, item.currency);
      return item.weeklyEquivalentMinor === null
        ? t('items.termsProposal.subtitleRateOnly', { rate })
        : t('items.termsProposal.subtitle', {
            rate,
            weekly: formatMoney(item.weeklyEquivalentMinor, item.currency),
          });
    }
    // §1's law: the state word never appears without its date, and "opened"
    // never appears without "not answered" attached — `viewed_at` is stamped
    // automatically on open, so it is evidence of attention and nothing more.
    case 'terms_proposal_sent':
      return item.viewedAt
        ? t('items.termsProposalSent.subtitleOpened', {
            date: proposedOn(item.proposedAt, timeZone),
          })
        : t('items.termsProposalSent.subtitleNotOpened', {
            date: proposedOn(item.proposedAt, timeZone),
          });
    case 'terms_ack':
      return t('items.termsAck.subtitle');
    case 'reimbursement_owed':
      return t('items.reimbursementOwed.subtitle', {
        week: formatDisplayDate(item.weekStart),
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
    case 'terms_proposal':
      return t('items.termsProposal.cta');
    case 'terms_proposal_sent':
      return t('items.termsProposalSent.cta');
    case 'terms_ack':
      return t('items.termsAck.cta');
    case 'reimbursement_owed':
      return t('items.reimbursementOwed.cta');
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
 *
 * `terms_proposal` in particular has no deadline BY DESIGN (§7.5): a
 * proposal never expires and there is no round limit, because two people
 * negotiating a contract is not a workflow to time out. There is no date to
 * colour, so this stays null for it forever, not until some later slice.
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
