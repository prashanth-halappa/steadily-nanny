/**
 * @module domains/today/utils/slotOccupant
 *
 * What goes in Today's pinned slot — the one control that sits OUTSIDE the
 * feed's ScrollView and can therefore never fall under the fold (the respond
 * CTA once landed at y 881–929 with the viewport ending at 873, and the tap
 * hit the Hours tab underneath).
 *
 * `resolveAttentionOwner` ranks the obligations; this maps that ranking, plus
 * the two facts the ladder cannot see (who she is here, and whether a timer
 * is already running), onto the single thing the slot may hold. Everything it
 * does not name renders in the feed at default tone.
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
      // An ordinary day: hers is the clock, his is today's cover. Nothing is
      // demanding either of them, and the slot still holds the one thing
      // they opened the app to do.
      return activeNanny
        ? 'clockIn'
        : canViewParentSchedule(inputs.role)
          ? 'coverage'
          : null;
  }
}
