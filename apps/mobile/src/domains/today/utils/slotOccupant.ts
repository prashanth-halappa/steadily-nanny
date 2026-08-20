/**
 * @module domains/today/utils/slotOccupant
 *
 * What goes in Today's pinned slot — the one control that sits OUTSIDE the
 * feed's ScrollView and can therefore never fall under the fold (the respond
 * CTA once landed at y 881–929 with the viewport ending at 873, and the tap
 * hit the Hours tab underneath).
 *
 * `resolveAttentionOwner` ranks the obligations; this maps that ranking, plus
 * the two facts the ladder cannot see (which role the viewer holds, and
 * whether a timer is already running), onto the single thing the slot may
 * hold. Everything it does not name renders in the feed at default tone.
 *
 * A running timer beating every T1 is deliberate: it is the one thing
 * happening RIGHT NOW, and an inbox item waits safely for the length of a
 * scroll. A terms block still outranks it — see `attentionOwner.ts`.
 *
 * The parent's ordinary day pins today's cover at L3; the slot is empty only
 * for a role that has neither a clock nor a coverage view.
 */
import type { SetupRole } from '@/src/domains/setup/types';
import { canViewParentSchedule, SETUP_ROLES } from '@/src/domains/setup/types';
import type { AttentionOwner } from './attentionOwner';

export type SlotOccupant =
  | 'membershipEnded'
  | 'blockedClockIn'
  | 'pendingOffer'
  | 'clockIn'
  | 'coverageGap'
  | 'coverage'
  | 'termsProposal'
  | 'inbox'
  | null;

export function resolveSlotOccupant(inputs: {
  role: SetupRole | null;
  isPastMember: boolean;
  /** A time entry is running for this user (`useOverdueClockOut().clockInAt`). */
  onClock: boolean;
  attentionOwner: AttentionOwner;
}): SlotOccupant {
  const activeNanny = inputs.role === SETUP_ROLES.NANNY && !inputs.isPastMember;
  const pastNanny = inputs.role === SETUP_ROLES.NANNY && inputs.isPastMember;

  // She may be mid-shift at the moment the household ends. Clock-out is the
  // one write a removed member keeps (she is completing a record, not taking
  // on an obligation), so the running timer holds the slot and the
  // explanation renders beneath it in the feed. Above the ladder for the same
  // reason the ordinary running clock is: it is the thing happening NOW, and
  // without it she has no way to close the entry at all.
  if (pastNanny && inputs.onClock) return 'clockIn';

  if (inputs.attentionOwner === 'termsBlocked') return 'blockedClockIn';
  // Ahead of the running-timer check below for the same reason the ladder
  // puts it there — and moot in practice, since it is a parent-only verdict
  // and a parent has no clock.
  if (inputs.attentionOwner === 'sentOfferBlocking') return 'pendingOffer';
  if (activeNanny && inputs.onClock) return 'clockIn';

  switch (inputs.attentionOwner) {
    case 'overdue':
      return 'clockIn';
    case 'uncoveredCare':
      return 'coverageGap';
    case 'termsProposal':
      return 'termsProposal';
    case 'inbox':
      return 'inbox';
    default:
      // An ordinary day: the nanny's slot is the clock, the parent's is
      // today's cover. Nothing is demanding anything, and the slot still
      // holds the one thing that viewer opened the app to do.
      // A past-member nanny's slot used to be EMPTY here, which is the
      // silence this card exists to end: her employer's account is gone and
      // the one surface that cannot fall under the fold said nothing. Below
      // every ladder verdict on purpose — a queried week she can still answer
      // is more urgent than an explanation of a state that is not changing.
      if (pastNanny) return 'membershipEnded';
      return activeNanny
        ? 'clockIn'
        : canViewParentSchedule(inputs.role)
          ? 'coverage'
          : null;
  }
}
