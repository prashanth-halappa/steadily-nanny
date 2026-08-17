/**
 * @module domains/schedule/components/NoWeekYetCard.utils
 *
 * The decision behind the "no usual week yet" card, kept dependency-free so
 * it can be tested without a QueryClient, a router, or MMKV — the same split
 * `InviteWaitingCard.utils` uses.
 *
 * The card tells a nanny that her family hasn't sent a weekly schedule yet.
 * It asks nothing of her and it never nudges them: it appears at most once a
 * week, it never counts how many weeks have passed, and it is identical on
 * week one and week nine. The moment it starts counting it becomes a
 * grievance meter (`docs/design/attention-and-notifications.md` §2.4(a)).
 */
import {
  SCHEDULE_PATTERN_STATUSES,
  type SchedulePatternStatus,
} from '@steadily-nanny/shared-types/schemas/schedule.schema';

export type NoWeekYetState =
  | { kind: 'hidden' }
  | { kind: 'card'; afterDecline: boolean; dismissKey: string };

interface Context {
  householdId: string | null | undefined;
  isNanny: boolean;
  isPastMember: boolean;
  householdIsLive: boolean;
  termsAgreed: boolean;
  /** Already precedence-resolved by the caller; null = no pattern at all. */
  patternStatus: SchedulePatternStatus | null;
  /** The most recent resolved pattern was declined BY HER. */
  declinedByHer: boolean;
  /** Shifts assigned to her, today through +14 days. */
  shiftCountNext14Days: number;
  /** The joined-household welcome card is rendering this frame. */
  joinedCardShowing: boolean;
  /** Week start in the HOUSEHOLD timezone, from `getWeekStartISO`. */
  weekStartISO: string;
  isDismissed: (key: string) => boolean;
}

export function resolveNoWeekYet({
  householdId,
  isNanny,
  isPastMember,
  householdIsLive,
  termsAgreed,
  patternStatus,
  declinedByHer,
  shiftCountNext14Days,
  joinedCardShowing,
  weekStartISO,
  isDismissed,
}: Context): NoWeekYetState {
  const hidden: NoWeekYetState = { kind: 'hidden' };

  if (!householdId || !isNanny || isPastMember || !householdIsLive) {
    return hidden;
  }

  // Before terms are agreed she is blocked and `ClockInBlockedCard` owns her
  // screen — a second card about a second missing thing is noise.
  if (!termsAgreed) return hidden;

  // One fact, one owner: `pending` belongs to `PendingScheduleCard`, and an
  // `accepted` week means there is nothing missing. A `draft` is invisible to
  // her, so from her side it reads exactly like `null` — both show the card.
  if (
    patternStatus === SCHEDULE_PATTERN_STATUSES.PENDING ||
    patternStatus === SCHEDULE_PATTERN_STATUSES.ACCEPTED
  ) {
    return hidden;
  }

  // The real gate, and what keeps the card honest later in the relationship:
  // a household running entirely on one-off shifts never sees it.
  if (shiftCountNext14Days > 0) return hidden;

  // Her first impression of a new family is the welcome, not a to-do.
  if (joinedCardShowing) return hidden;

  // Bucketed by week start so "Hide this" hides it for the REST OF THIS WEEK
  // and it can re-arm at most once, on her first Today open in a new week
  // that is still empty.
  // ponytail: ~52 keys per household per year in MMKV — fine at this scale;
  // prune the store by key prefix if it ever grows.
  const dismissKey = `noWeekNanny:${householdId}:${weekStartISO}`;
  if (isDismissed(dismissKey)) return hidden;

  return { kind: 'card', afterDecline: declinedByHer, dismissKey };
}
