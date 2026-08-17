/**
 * @module domains/pay/utils/termsAgreement
 *
 * "Were these terms agreed, or merely set?" — one predicate, both roles, one
 * slot on both screens (T16: the parent had it above the rate and the nanny
 * below the rows, which is the drift `buildTermRows` exists to prevent and
 * the document around it kept re-introducing).
 *
 * P1 deleted the direct `pay_arrangements` write path, so every row written
 * from now on IS an acceptance — `terms_proposals.accepted_arrangement_id`
 * is the join, and it is already on the rows both screens fetch. Rows written
 * BEFORE that are GRANDFATHERED AND LABELLED, never migrated: they stay in
 * force (otherwise every existing household loses its clock on deploy day)
 * and stop being described as agreed. A fabricated acceptance is worse than
 * an honest label, so there is no `agreed_at` column and no synthetic
 * accepted proposal anywhere.
 *
 * THE SECOND WRITER. `payArrangementCommandService.cancelScheduled` appends
 * its own row, cloning the currently-in-effect terms to undo a scheduled
 * change. No proposal points at that row, and calling it "not agreed in
 * Steadily" would be the exact class of untrue statement this work exists to
 * remove — it RESTORES terms both sides agreed to.
 *
 * The fix is to follow the TERMS, not the row: a row whose agreed terms are
 * identical to a row an acceptance already points at is a restatement of that
 * agreement. `buildTermsDiff` is the one function that answers "what differs
 * between two arrangements" (it is what the change review and the version
 * history both render), and an empty diff is the whole test. Deliberately NOT
 * keyed on `note === 'Scheduled change cancelled'` or on any other shape:
 * shape-matching a server literal is how the label starts lying the next time
 * that string is edited.
 *
 * The known width, stated: two independently-set rows carrying byte-identical
 * terms also read as agreed. Those terms WERE agreed — the sentence stays
 * true — and it takes an exact match across every priced term to get there.
 */
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { buildTermsDiff } from './termsDiff';

/** The `termRows.ts` convention — a narrow translate fn (see `termsDiff`). */
type Translate = (key: string, params?: Record<string, unknown>) => string;

export type TermsAgreement =
  /** Both sides agreed, and this is the round that says so. */
  | { kind: 'agreed'; proposal: TermsProposal }
  /** In force, and nobody agreed it here. Grandfathered, and labelled. */
  | { kind: 'notAgreedInSteadily' };

export function resolveTermsAgreement(
  arrangement: PayArrangement,
  proposals: readonly TermsProposal[] | undefined,
  history: readonly PayArrangement[] | undefined,
  t: Translate
): TermsAgreement {
  const accepted = (proposals ?? []).filter(
    row => row.status === 'accepted' && row.accepted_arrangement_id !== null
  );

  const direct = accepted.find(
    row => row.accepted_arrangement_id === arrangement.id
  );
  if (direct) return { kind: 'agreed', proposal: direct };

  const byId = new Map((history ?? []).map(row => [row.id, row]));
  const restated = accepted.find(row => {
    const agreedId = row.accepted_arrangement_id;
    if (!agreedId) return false;
    const agreedRow = byId.get(agreedId);
    return (
      agreedRow !== undefined &&
      agreedRow.id !== arrangement.id &&
      buildTermsDiff(agreedRow, arrangement, t).length === 0
    );
  });

  return restated
    ? { kind: 'agreed', proposal: restated }
    : { kind: 'notAgreedInSteadily' };
}
