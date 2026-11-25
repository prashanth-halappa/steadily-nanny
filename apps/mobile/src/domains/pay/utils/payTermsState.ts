/**
 * @module domains/pay/utils/payTermsState
 *
 * ONE answer to "what terms does this pair have", for every screen that
 * asks. `current` is the server's row effective TODAY, so agreed terms that
 * start tomorrow leave it null; reading `current` alone printed "No pay
 * terms set yet" over an agreed row. The history (newest first) holds it.
 */
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';

export type PayTermsKind = 'none' | 'inEffect' | 'startsLater';

export interface PayTermsState {
  kind: PayTermsKind;
  /** `current`, else the EARLIEST future row (when terms first start). */
  shown: PayArrangement | null;
  /** A later change over a `current` row. Never set without `current`: there
   * is no "before" to diff, and cancel-scheduled has nothing to revert to. */
  scheduled: PayArrangement | null;
  openProposal: TermsProposal | undefined;
}

export function payTermsState({
  current,
  history,
  openProposal,
  todayISO,
}: {
  current: PayArrangement | null | undefined;
  history: readonly PayArrangement[] | undefined;
  openProposal: TermsProposal | undefined;
  todayISO: string;
}): PayTermsState {
  // Newest first, so the last future row is the earliest one.
  const nextFuture =
    (history ?? []).filter(row => row.valid_from > todayISO).at(-1) ?? null;
  if (current) {
    return {
      kind: 'inEffect',
      shown: current,
      scheduled: nextFuture,
      openProposal,
    };
  }
  return {
    kind: nextFuture ? 'startsLater' : 'none',
    shown: nextFuture,
    scheduled: null,
    openProposal,
  };
}
