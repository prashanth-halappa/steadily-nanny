/**
 * @module domains/inbox/hooks/usePendingOffer
 *
 * A7's offer, resolved once. `PendingOfferCard` renders it and `TodayScreen`
 * asks it one question (`isBlocking`) to feed the attention ladder — and they
 * MUST agree, or the slot pins a card that has decided it is quiet, which is
 * the exact stacked-attention bug the ladder exists to prevent. One hook,
 * one answer.
 *
 * Scoped to the ACTIVE household (A2): Today is scoped, so another family's
 * offer belongs on that family's Today, reached through the switcher.
 *
 * Parent-editor roles only. A nanny author's variant is DEFERRED — her side
 * of "I sent terms and nobody has answered" is already `ClockInBlockedCard`'s
 * `youSent` state.
 */
import { SCHEDULED_SHIFT_STATUSES } from '@steadily-nanny/shared-types/uncoveredCare';
import { useMemo } from 'react';
import { isParentEditorRole } from '@/src/domains/setup/types';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useShiftsRange } from '@/src/hooks/queries/useShiftsRange';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { wallClockToUtcIso } from '@/src/lib/wallClock';
import type { InboxItem } from '../utils/buildInboxItems';
import {
  type PendingOfferState,
  resolvePendingOfferState,
} from '../utils/pendingOfferEscalation';
import { useInboxItems } from './useInboxItems';

export type SentOfferItem = Extract<InboxItem, { kind: 'terms_proposal_sent' }>;

export interface PendingOffer {
  offer: SentOfferItem | null;
  state: PendingOfferState | null;
  /** Her scheduled minutes today — the figure that makes the block concrete. */
  scheduledMinutesToday: number;
  /** The ONLY thing that may turn this card loud. */
  isBlocking: boolean;
  timeZone: string;
}

const SCHEDULED = new Set<string>(SCHEDULED_SHIFT_STATUSES);

export function usePendingOffer(nowMs: number = Date.now()): PendingOffer {
  const onboarding = useIsOnboarded();
  const active = useActiveHousehold();
  const timeZone = active.household?.timezone ?? 'UTC';
  const { items, isLoading } = useInboxItems();

  const offer =
    !isLoading && isParentEditorRole(onboarding.role)
      ? ((items.find(
          item =>
            item.kind === 'terms_proposal_sent' &&
            item.householdId === active.household?.id
        ) as SentOfferItem | undefined) ?? null)
      : null;

  const today = localDateInZone(timeZone, new Date(nowMs));
  const from = wallClockToUtcIso(today, '00:00', timeZone);
  const to = wallClockToUtcIso(addLocalDays(today, 1), '00:00', timeZone);
  const shifts = useShiftsRange(active.household?.id, from, to);

  // Only HER scheduled shifts count: another carer working today is no
  // evidence that THIS offer is blocking anything, and a cancelled shift is
  // nothing being prevented.
  const scheduledMinutesToday = useMemo(() => {
    if (!offer) return 0;
    return (shifts.data ?? [])
      .filter(
        shift => shift.carer_id === offer.carerId && SCHEDULED.has(shift.status)
      )
      .reduce(
        (total, shift) =>
          total +
          Math.max(
            0,
            (Date.parse(shift.ends_at) - Date.parse(shift.starts_at)) / 60_000
          ),
        0
      );
  }, [offer, shifts.data]);

  const state = offer
    ? resolvePendingOfferState({
        proposedAt: offer.proposedAt,
        viewedAt: offer.viewedAt,
        hasShiftToday: scheduledMinutesToday > 0,
        nowMs,
        timeZone,
      })
    : null;

  return {
    offer,
    state,
    scheduledMinutesToday,
    isBlocking: state?.variant === 'blocking',
    timeZone,
  };
}
