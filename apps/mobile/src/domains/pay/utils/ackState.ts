/**
 * @module domains/pay/utils/ackState
 *
 * Collapses the append-only `pay_arrangement_acks` rows for ONE arrangement
 * version into the single state both screens render (§8.2's vocabulary
 * table): the nanny's own state word (§8.3) and the parent's header pill
 * (§8.4) are the same fact worded for two readers, so they resolve it here
 * rather than each walking the row list their own way.
 *
 * D-41, and the reason this file exists at all: the 'seen' state renders as
 * **"Seen by {name} on {date}"**. It is never worded as agreement — that word
 * belongs to a 3-O proposal the other party accepted, and applying it to a
 * button the carer pressed on terms the parent wrote would turn a receipt
 * into consent.
 *
 * §8.4: a disagreement OUTRANKS a seen. Both rows can exist (seeing something
 * and disagreeing with it are different facts, and the unique key allows
 * both) — the state word reports the disagreement, because that is the one
 * the reader would be misled by not seeing.
 *
 * WHICH FUNCTION TO CALL. Anything that WORDS the state uses
 * `resolveAckState`. Anything that GATES THE PROMPT — or asks the plain
 * question "has she recorded reading this version?" — uses `hasSeenAck` /
 * `seenAckAt`. Gating on `resolveAckState(...).kind === 'seen'` is the bug
 * that stranded a real nanny: she had disagreed once, so the outranking rule
 * hid her 'seen' row forever and "I've read these terms" could never clear
 * the prompt however many times she pressed it.
 */
import type { PayArrangementAck } from '@steadily-nanny/shared-types/schemas/payArrangementAck.schema';
import { PAY_ARRANGEMENT_ACK_KINDS } from '@steadily-nanny/shared-types/schemas/payArrangementAck.schema';

export type AckState =
  | { kind: 'none' }
  | { kind: 'seen'; createdAt: string }
  | { kind: 'disagreed'; createdAt: string; note: string | null };

/** The newest row of `kind`, or undefined — the list's order is not relied on. */
function newestOfKind(
  acks: readonly PayArrangementAck[],
  kind: PayArrangementAck['kind']
): PayArrangementAck | undefined {
  return acks
    .filter(row => row.kind === kind)
    .reduce<PayArrangementAck | undefined>(
      // Date.parse, never a string compare: created_at arrives in mixed
      // serialisations ('…+00:00' vs '….mmmZ'), which do not string-order
      // by instant (GOLDEN #25).
      (newest, row) =>
        !newest || Date.parse(row.created_at) > Date.parse(newest.created_at)
          ? row
          : newest,
      undefined
    );
}

/** When she recorded seeing this version, regardless of any disagreement. */
export function seenAckAt(
  acks: readonly PayArrangementAck[] | undefined
): string | null {
  return (
    newestOfKind(acks ?? [], PAY_ARRANGEMENT_ACK_KINDS.SEEN)?.created_at ?? null
  );
}

/** Whether she has recorded seeing this version. The prompt's only gate. */
export function hasSeenAck(
  acks: readonly PayArrangementAck[] | undefined
): boolean {
  return seenAckAt(acks) !== null;
}

export function resolveAckState(
  acks: readonly PayArrangementAck[] | undefined
): AckState {
  if (!acks || acks.length === 0) return { kind: 'none' };

  const disagreed = newestOfKind(acks, PAY_ARRANGEMENT_ACK_KINDS.DISAGREED);
  if (disagreed) {
    return {
      kind: 'disagreed',
      createdAt: disagreed.created_at,
      note: disagreed.note,
    };
  }

  const seen = newestOfKind(acks, PAY_ARRANGEMENT_ACK_KINDS.SEEN);
  return seen ? { kind: 'seen', createdAt: seen.created_at } : { kind: 'none' };
}
