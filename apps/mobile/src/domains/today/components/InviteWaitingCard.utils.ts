/**
 * @module domains/today/components/InviteWaitingCard.utils
 *
 * The decision behind the invite waiting card, kept dependency-free so it can
 * be tested without a QueryClient, a router, or MMKV — the same split every
 * date field in this app uses.
 */
import type { HouseholdInvite } from '@steadily-nanny/shared-types/schemas/household.schema';

/** After this many whole days the card collapses to a single line. */
export const QUIET_AFTER_DAYS = 3;

export type InviteWaitingState =
  | { kind: 'hidden' }
  | { kind: 'card'; invite: HouseholdInvite; dismissKey: string }
  | { kind: 'quiet'; invite: HouseholdInvite; dismissKey: string };

interface Context {
  householdId: string | undefined;
  invites: readonly HouseholdInvite[] | undefined;
  /** Someone has already joined as a nanny — nothing left to wait for. */
  hasActiveNanny: boolean;
  isDismissed: (key: string) => boolean;
  now: Date;
}

export function resolveInviteWaiting({
  householdId,
  invites,
  hasActiveNanny,
  isDismissed,
  now,
}: Context): InviteWaitingState {
  if (hasActiveNanny || !householdId) return { kind: 'hidden' };

  // The server repairs a lapsed `pending` to `expired` on read, so a row that
  // still says pending here is genuinely still redeemable. Only a NANNY invite
  // counts: a pending co-parent code says nothing about childcare starting.
  const invite = (invites ?? []).find(
    row => row.status === 'pending' && row.role === 'nanny'
  );
  if (!invite) return { kind: 'hidden' };

  // Keyed on the INVITE, not the household: minting a new code is a new
  // intent and should re-arm a card she hid for the previous one.
  const dismissKey = `inviteWaiting:${householdId}:${invite.id}`;
  if (isDismissed(dismissKey)) return { kind: 'hidden' };

  const days = Math.floor(
    (now.getTime() - new Date(invite.created_at).getTime()) / 86_400_000
  );
  return days >= QUIET_AFTER_DAYS
    ? { kind: 'quiet', invite, dismissKey }
    : { kind: 'card', invite, dismissKey };
}
