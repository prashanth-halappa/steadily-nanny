/**
 * Pay domain errors.
 * @module domains/pay/errors/payErrors
 */
import { NotFoundError, ValidationError } from '../../../errors';
import type { ErrorMetadata } from '../../../errors/BaseError';

/**
 * 404 — the pay arrangements of this (household, carer) pair are not the
 * caller's to see or write. ONE error for every failing case, deliberately:
 *
 * - the household doesn't exist, or the caller isn't an active member of it;
 * - the caller is a member but a `helper` (no pay access at all), or a nanny
 *   asking about somebody else's terms;
 * - the `carer_id` names nobody, somebody who is not an active member, or an
 *   active member who is not a `nanny` of THIS household.
 *
 * Collapsing them is the house convention (`HouseholdNotFoundError`,
 * `TimesheetNotFoundError`) and it is load-bearing here: a distinguishable
 * "that carer exists, just not for you" would let a caller enumerate other
 * families' carers by uuid. Discriminating detail goes in `metadata.reason`,
 * which BaseError only ships to the client for 4xx — see `toClientJSON`.
 */
export class PayArrangementNotFoundError extends NotFoundError {
  constructor(householdId: string, carerId: string, metadata?: ErrorMetadata) {
    super('Pay arrangement not found', 'PAY_ARRANGEMENT_NOT_FOUND', {
      householdId,
      carerId,
      ...metadata,
    });
    this.name = 'PayArrangementNotFoundError';
  }
}

/**
 * 400 — the submitted terms cannot describe a real agreement. Currently one
 * arm: `valid_from` after the household's local today. There are no
 * future-dated arrangements in v1 (owner decision 4) — a raise is recorded on
 * or after the day it starts, and backdating stays legal so an open week
 * recomputes.
 *
 * Shaped like `InvalidClockTimesError` (a `ValidationError` carrying a
 * machine-readable `reason`) rather than a bespoke 4xx, so the client can
 * branch on the reason without string-matching a message.
 */
export class PayArrangementValidationError extends ValidationError {
  constructor(reason: string, metadata?: ErrorMetadata) {
    super('Those pay terms are not valid', reason, 400, metadata);
    this.name = 'PayArrangementValidationError';
  }
}
