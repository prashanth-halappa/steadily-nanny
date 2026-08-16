/**
 * @module domains/inbox/utils/pendingOfferEscalation
 *
 * A7's escalation, as one pure answer. A parent who wrote the terms is the
 * only person who can unblock them, and today he gets no Today signal at all
 * (`buildInboxItems` routes a live proposal to the side that must ANSWER) —
 * so under A1 the responsible party cannot see the work stoppage he owns.
 *
 * TWO AXES, AND THEY NEVER MIX.
 *
 *  - CONSEQUENCE (`hasShiftToday`) is the only thing that produces
 *    `'blocking'`, and `'blocking'` is the only variant the card may render
 *    attention-toned. This is the axis that means something is going wrong
 *    RIGHT NOW: she is due in the house and her hours cannot be recorded.
 *  - ELAPSED DAYS move the copy through sentToday -> waiting -> stale, and at
 *    day 10 unlock a Withdraw affordance. They never touch the tone.
 *
 * The rule that keeps this from becoming a false alarm: a stale offer for a
 * nanny with NO shift scheduled never goes loud, however old it gets. A card
 * that shouts about a contract nobody is waiting on today is exactly what
 * teaches a parent to ignore the one that matters.
 *
 * Days are counted in the HOUSEHOLD's zone. "Sent 10 days ago" appearing a
 * day early because the server stamped 23:30 local is a small lie on a screen
 * about money, and small lies there are the expensive kind.
 */
import { localDateInZone } from '@/src/lib/localDate';

/** Where the day counter stops being patience and starts being a dead offer. */
const STALE_DAYS = 10;

export type PendingOfferVariant =
  | 'sentToday'
  | 'waiting'
  | 'stale'
  | 'blocking';

export interface PendingOfferState {
  variant: PendingOfferVariant;
  /** `viewed_at` is stamped automatically on open — "opened", never "agreed". */
  opened: boolean;
  /** Whole household-local days since it was sent. */
  days: number;
}

/** Whole days between two YYYY-MM-DD calendar dates. */
function daysBetween(fromISO: string, toISO: string): number {
  const utcMs = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((utcMs(toISO) - utcMs(fromISO)) / 86_400_000);
}

export function resolvePendingOfferState(input: {
  proposedAt: string;
  /** ISO instant the OTHER side first opened it, or null. */
  viewedAt: string | null;
  /** The carer this offer names has a scheduled shift today. */
  hasShiftToday: boolean;
  nowMs: number;
  /** The HOUSEHOLD's IANA zone (GOLDEN-FIXES #21) — never the device's. */
  timeZone: string;
}): PendingOfferState {
  const days = daysBetween(
    localDateInZone(input.timeZone, new Date(input.proposedAt)),
    localDateInZone(input.timeZone, new Date(input.nowMs))
  );
  const opened = input.viewedAt !== null;

  // Consequence first, and consequence alone: this is the only branch that
  // may reach a loud tone, and it reaches it at any age.
  if (input.hasShiftToday) return { variant: 'blocking', opened, days };
  if (days <= 0)
    return { variant: 'sentToday', opened, days: Math.max(days, 0) };
  if (days >= STALE_DAYS) return { variant: 'stale', opened, days };
  return { variant: 'waiting', opened, days };
}
