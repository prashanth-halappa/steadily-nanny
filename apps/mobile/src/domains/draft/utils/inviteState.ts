/**
 * @module domains/draft/utils/inviteState
 *
 * §5.3's six state words for one `household_invites` row, plus the timeline
 * that sits under them.
 *
 * TWO SEPARATE ANSWERS, DELIBERATELY. `resolveInviteState` says what the row
 * IS right now — one pill, each state replacing the one before it.
 * `buildInviteTimeline` says how it GOT there — every milestone date it has
 * earned, oldest first, so "Sent Aug 10 · opened Aug 11" reads as a small
 * history rather than a status that erased its own past. Between sending her
 * terms and hearing back, "did they even open it" is the only question the
 * nanny has, and a pill alone cannot answer it.
 *
 * WHAT IS NOT HERE, ON PURPOSE: how many times, from where, for how long.
 * The question is "did this reach them", not surveillance of a family's
 * evening (§5.3).
 */
import type { HouseholdInvite } from '@steadily-nanny/shared-types/schemas/household.schema';

/** Sentence-case labels come from i18n; these are the key suffixes. */
export type InviteStateWord =
  | 'sent'
  | 'opened'
  | 'viewed'
  | 'joined'
  | 'expired'
  | 'revoked';

export interface InviteState {
  /**
   * A `StatusPill` variant, and only ever one of these three. `status-pill`
   * has six variants and none is named `neutral` — `cancelled` IS the neutral
   * treatment, and no new variant is added for this screen (§16 item 8).
   */
  variant: 'pending' | 'confirmed' | 'cancelled';
  word: InviteStateWord;
}

export interface InviteTimelineEntry {
  key: 'sent' | 'opened' | 'viewed' | 'joined';
  date: string;
}

interface InviteStateContext {
  /**
   * `terms_proposals.viewed_at` for the proposal this invite carried, or
   * null. It lives on a different table from the invite, so it arrives as an
   * argument rather than being dug out of the row.
   */
  viewedAt: string | null;
  now: Date;
}

/**
 * The moment the row stops being live. The LINK's clock when there is one,
 * falling back to the code's own 30 days for invites minted before 093.
 *
 * These are genuinely two clocks (§6.1) — the code may still redeem after the
 * public page has gone dark — but §5.3 puts a single "Expired" on the row, so
 * the earlier of the two is what the pill reads.
 */
function expiryOf(invite: HouseholdInvite): Date {
  const code = new Date(invite.expires_at);
  if (invite.link_expires_at === null) return code;
  const link = new Date(invite.link_expires_at);
  return link < code ? link : code;
}

export function resolveInviteState(
  invite: HouseholdInvite,
  { viewedAt, now }: InviteStateContext
): InviteState {
  // Terminal states first, and they are terminal: a redeemed invite never
  // ages back out of "Joined", because what it recorded already happened.
  if (invite.status === 'accepted') {
    return { variant: 'confirmed', word: 'joined' };
  }
  if (invite.status === 'revoked') {
    return { variant: 'cancelled', word: 'revoked' };
  }
  if (invite.status === 'expired' || now >= expiryOf(invite)) {
    return { variant: 'cancelled', word: 'expired' };
  }
  // Still live. Each fact replaces the one before it — opening the app beats
  // opening the web page, which beats having merely been sent.
  if (viewedAt !== null) return { variant: 'pending', word: 'viewed' };
  if (invite.opened_at !== null) return { variant: 'pending', word: 'opened' };
  return { variant: 'pending', word: 'sent' };
}

export function buildInviteTimeline(
  invite: HouseholdInvite,
  { viewedAt }: Pick<InviteStateContext, 'viewedAt'>
): InviteTimelineEntry[] {
  const entries: InviteTimelineEntry[] = [
    { key: 'sent', date: invite.created_at },
  ];
  if (invite.opened_at !== null) {
    entries.push({ key: 'opened', date: invite.opened_at });
  }
  if (viewedAt !== null) {
    entries.push({ key: 'viewed', date: viewedAt });
  }
  if (invite.accepted_at !== null) {
    entries.push({ key: 'joined', date: invite.accepted_at });
  }
  return entries;
}
