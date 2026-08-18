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

/**
 * S7 (PER-CARER EVERYWHERE): this card used to speak for `carers.data?.[0]`
 * only (`ponytail:` comment on the old code admitted it) — a second nanny's
 * missing week was invisible. Every `setup` carer (no pattern at all, or her
 * only one withdrew/ended — `VARIANT_BY_REASON` already collapses those
 * three reasons together) shares ONE combined card, since the act is
 * identical for all of them: open the builder, which lets her pick which
 * carer. `draft`/`declined` stay one card PER carer — each names a specific
 * pattern to resume or explain, so joining them would either resume the
 * wrong draft or hide which of two declines needs a look.
 */
export interface WeeklyHoursSetupGroup {
  kind: 'setup';
  carerUserIds: readonly string[];
  dismissKeys: readonly string[];
}
export interface WeeklyHoursSoloGroup {
  kind: 'draft' | 'declined';
  carerUserId: string;
  dismissKey: string;
}
export type WeeklyHoursNotSetGroup =
  | WeeklyHoursSetupGroup
  | WeeklyHoursSoloGroup;

export function groupWeeklyHoursNotSetCards(
  entries: readonly { carerUserId: string; state: WeeklyHoursNotSetState }[]
): WeeklyHoursNotSetGroup[] {
  const setupCarerIds: string[] = [];
  const setupDismissKeys: string[] = [];
  const soloGroups: WeeklyHoursSoloGroup[] = [];

  for (const { carerUserId, state } of entries) {
    if (state.kind !== 'card') continue;
    if (state.variant === 'setup') {
      setupCarerIds.push(carerUserId);
      setupDismissKeys.push(state.dismissKey);
    } else {
      soloGroups.push({
        kind: state.variant,
        carerUserId,
        dismissKey: state.dismissKey,
      });
    }
  }

  const groups: WeeklyHoursNotSetGroup[] = [];
  if (setupCarerIds.length > 0) {
    groups.push({
      kind: 'setup',
      carerUserIds: setupCarerIds,
      dismissKeys: setupDismissKeys,
    });
  }
  groups.push(...soloGroups);
  return groups;
}
