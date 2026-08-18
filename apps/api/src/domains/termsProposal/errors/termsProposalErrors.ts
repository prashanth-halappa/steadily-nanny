/**
 * Terms-proposal domain errors.
 * @module domains/termsProposal/errors/termsProposalErrors
 */
import { ConflictError, NotFoundError, ValidationError } from '../../../errors';
import type { ErrorMetadata } from '../../../errors/BaseError';

/**
 * 404 — this proposal is not the caller's to see, answer or write. ONE error
 * for every failing case, deliberately, the same discipline as
 * `PayArrangementNotFoundError`:
 *
 * - no proposal with that id exists;
 * - the household doesn't exist, or the caller isn't a member of it;
 * - the caller is a `helper` (no money surface at all), a `removed` member,
 *   or a nanny asking about a proposal that is not hers (D-21: a household
 *   with two nannies has two independent negotiations, and neither may see
 *   the other's);
 * - the proposal exists but belongs to another household, or to another
 *   carer within this one;
 * - a WRITE arrived from the side that is not allowed to make it — a nanny
 *   accepting her own proposal, or the non-author trying to withdraw.
 *
 * Collapsing them is load-bearing rather than tidy: a distinguishable "that
 * proposal exists, just not for you" would let a caller enumerate other
 * families' negotiations by uuid, and a proposal id is the handle on a real
 * person's asking rate. Discriminating detail goes in `metadata.reason`,
 * which `BaseError.toClientJSON` only ships to the client for 4xx.
 *
 * NOTE the deliberate asymmetry with the pay domain: `payArrangement`'s write
 * gate 403s a member holding the wrong role (`NotAHouseholdParentError`),
 * because by then she already knows the household and the carer exist. Here
 * even that is withheld — until a caller is on the read circle of THIS
 * (household, carer) pair, she has not established that the pair is hers to
 * ask about, so there is nothing safe to confirm.
 *
 * `metadata` is free-form because the two route families identify a proposal
 * differently: the collection routes know a (household, carer) pair and the
 * item routes know only a `proposalId` — and on a miss they cannot know the
 * pair, because the row they would have read it from is the row that isn't
 * there. Threading placeholder ids through to satisfy a fixed signature would
 * put invented uuids in the log line for the one case worth diagnosing.
 */
export class TermsProposalNotFoundError extends NotFoundError {
  constructor(metadata?: ErrorMetadata) {
    super('Terms proposal not found', 'TERMS_PROPOSAL_NOT_FOUND', metadata);
    this.name = 'TermsProposalNotFoundError';
  }
}

/**
 * 409 — the proposal has already left `proposed`, so it can no longer be
 * accepted, countered or withdrawn. Two ways to get here, both in
 * `metadata.reason`:
 *
 * - `not_proposed` — the row was read as `countered`/`accepted`/`withdrawn`
 *   before anything was attempted.
 * - `lost_race` — the row read as `proposed` but the CAS
 *   (`resolve`'s `.eq('status', 'proposed')`) matched nothing, so a
 *   concurrent answer won between this request's read and its write. This is
 *   the shape `TimesheetNotActionableError` has, for the same reason: the
 *   database, not the service's read, is the source of truth under a race.
 *
 * A CONFLICT rather than a 404: the caller has already passed the read gate,
 * so this is a state answer about a negotiation that is genuinely theirs.
 * Nothing is leaked by saying so, and "someone already answered this" is the
 * actionable message.
 *
 * NOTHING IS EVER DELETED to make room for a retry. The row stays in the
 * history under the status it reached (§9.1), and the correct next move is a
 * new proposal, which is a new row.
 */
export class TermsProposalNotActionableError extends ConflictError {
  constructor(proposalId: string, reason: string, metadata?: ErrorMetadata) {
    super(
      'That terms proposal can no longer be answered',
      'TERMS_PROPOSAL_NOT_ACTIONABLE',
      { proposalId, reason, ...metadata }
    );
    this.name = 'TermsProposalNotActionableError';
  }
}

/**
 * 409 — translated from `terms_proposals_open_unique_idx` (23505, migration
 * 092): this (household, carer) pair already has an open proposal. §9.1's
 * "while a proposal is open the button becomes Withdraw" as an invariant
 * rather than a UI state — it closes the double-submit race a read-then-write
 * check in the service could not.
 *
 * GOLDEN-FIXES #31 is why this exists as a caught-and-translated error rather
 * than an `onConflict` clause: the index is PARTIAL (`where status =
 * 'proposed'`), PostgREST's `onConflict` takes a column-name list only, and
 * so it can never name this index. Catching the bare code is not enough
 * either — the repository additionally requires the error to NAME this index,
 * or an unrelated constraint violation would be swallowed as "already open".
 *
 * A CONFLICT and not a 400: nothing the proposer typed is wrong. Withdrawing
 * or answering the open round makes the identical request succeed.
 */
export class OpenTermsProposalExistsError extends ConflictError {
  constructor(householdId: string, carerId: string) {
    super(
      'There is already an open proposal for this carer',
      'OPEN_TERMS_PROPOSAL_EXISTS',
      { householdId, carerId }
    );
    this.name = 'OpenTermsProposalExistsError';
  }
}

/**
 * 400 — the proposed `terms` cannot describe a real agreement. Reasons in
 * `metadata.reason`:
 *
 * - `TERMS_SCHEMA_INVALID` — the payload is not a `CreatePayArrangementRequest`.
 *   Refused HERE rather than at acceptance, because a proposal the parent can
 *   agree to but the system cannot then write is the worst possible moment to
 *   discover a malformed rate.
 * - `VALID_FROM_TOO_FAR_IN_FUTURE` — D-16's 12-month horizon, mirrored from
 *   `payArrangementCommandService.create` (see the service's own note).
 *
 * The date is NEVER clamped to today to make it fit. §7.4 is explicit: the
 * card would then read "in effect since 12 Aug" for terms both parties agreed
 * start on the 17th, in an app whose entire pitch is that the record says
 * what was agreed. Refusing is the only honest option.
 *
 * Shaped like `PayArrangementValidationError` — a `ValidationError` carrying a
 * machine-readable `reason` — so the client branches without string-matching.
 */
export class TermsProposalValidationError extends ValidationError {
  constructor(reason: string, metadata?: ErrorMetadata) {
    super('Those proposed terms are not valid', reason, 400, metadata);
    this.name = 'TermsProposalValidationError';
  }
}

/**
 * 409 — WP-G: the reminder was asked for too early.
 *
 * TWO CLOCKS, BOTH 48 HOURS, both in `metadata.reason`:
 *
 * - `proposal_too_fresh` — the round itself is younger than the window. A
 *   nudge on the same evening the terms were sent is not a reminder, it is a
 *   second notification about a message the other side has not had an
 *   ordinary chance to read.
 * - `reminded_recently` — a reminder for this round is already less than 48h
 *   old. The whole affordance exists because the alternative is a text
 *   message at 11pm; a button that could be tapped repeatedly would be worse
 *   than the thing it replaces.
 *
 * A CONFLICT and not a 429: nothing is being throttled for capacity, and this
 * is not about the caller's request rate. It is a state answer about a
 * negotiation that is genuinely theirs — "not yet", the same shape as
 * `TermsProposalNotActionableError`'s "not any more". `ConflictError` fixes
 * the client-visible code to `CONFLICT`, so the client branches on
 * `metadata.reason` (the `NO_PAY_ARRANGEMENT` convention in
 * `errorLocalization.ts`), never on the message.
 */
export class TermsProposalReminderTooSoonError extends ConflictError {
  constructor(proposalId: string, reason: string, metadata?: ErrorMetadata) {
    super(
      'You can send one reminder every two days',
      'TERMS_PROPOSAL_REMINDER_TOO_SOON',
      { proposalId, reason, ...metadata }
    );
    this.name = 'TermsProposalReminderTooSoonError';
  }
}
