/**
 * @module domains/schedule/components/WeeklyHoursNotSetCard.utils
 *
 * The decision behind the "nothing is scheduled yet" card, kept
 * dependency-free so it tests without a QueryClient, a router or MMKV — the
 * same split `InviteWaitingCard.utils` uses.
 *
 * NO TIME DECAY, NO QUIET TIER. `InviteWaitingCard` fades because the parent
 * is waiting on somebody else and nagging her about it is rude. Here she is
 * the only actor: the week does not arrive unless she sends it, so the card
 * stays whole until she acts or hides it.
 *
 * THE REASON IS PART OF THE DISMISS KEY, deliberately. Hiding "you haven't
 * set a week" must not also hide "she declined the week you sent" — those
 * are different facts about the household, and the second one is news.
 */
import type { SchedulePatternStatus } from '@steadily-nanny/shared-types/schemas/schedule.schema';

export type WeeklyHoursNotSetReason =
  | 'none'
  | 'draft'
  | 'declined'
  | 'withdrawn'
  | 'ended';

/** Which of the three bodies/CTAs to render. */
export type WeeklyHoursNotSetVariant = 'setup' | 'draft' | 'declined';

export type WeeklyHoursNotSetState =
  | { kind: 'hidden' }
  | {
      kind: 'card';
      reason: WeeklyHoursNotSetReason;
      variant: WeeklyHoursNotSetVariant;
      dismissKey: string;
    };

interface Context {
  householdId: string | null | undefined;
  carerUserId: string | null | undefined;
  isParentEditor: boolean;
  isPastMember: boolean;
  householdIsLive: boolean;
  hasActiveNanny: boolean;
  termsAgreed: boolean;
  /** Already precedence-resolved by the caller; null = no pattern at all. */
  patternStatus: SchedulePatternStatus | null;
  /** The nanny-joined moment is rendering this frame. */
  momentShowing: boolean;
  isDismissed: (key: string) => boolean;
}

const VARIANT_BY_REASON: Record<
  WeeklyHoursNotSetReason,
  WeeklyHoursNotSetVariant
> = {
  none: 'setup',
  draft: 'draft',
  declined: 'declined',
  // A withdrawn or ended week leaves her exactly where she started: nothing
  // is scheduled and she has to send one. Same body, same door.
  withdrawn: 'setup',
  ended: 'setup',
};

export function resolveWeeklyHoursNotSet({
  householdId,
  carerUserId,
  isParentEditor,
  isPastMember,
  householdIsLive,
  hasActiveNanny,
  termsAgreed,
  patternStatus,
  momentShowing,
  isDismissed,
}: Context): WeeklyHoursNotSetState {
  const hidden: WeeklyHoursNotSetState = { kind: 'hidden' };

  if (!isParentEditor || isPastMember) return hidden;
  if (!householdIsLive) return hidden;
  if (!hasActiveNanny || !householdId || !carerUserId) return hidden;
  if (!termsAgreed) return hidden;
  // From `pending` onward the Schedule tab's L1 banner owns "it's with her",
  // and Today says nothing.
  if (patternStatus === 'pending' || patternStatus === 'accepted') {
    return hidden;
  }
  if (momentShowing) return hidden;

  const reason: WeeklyHoursNotSetReason = patternStatus ?? 'none';
  const dismissKey = `weeklyHoursNotSet:${householdId}:${carerUserId}:${reason}`;
  if (isDismissed(dismissKey)) return hidden;

  return {
    kind: 'card',
    reason,
    variant: VARIANT_BY_REASON[reason],
    dismissKey,
  };
}
