/**
 * Shared "may this membership write?" role gate, used by the co-parent
 * approval services. Deliberately a standalone copy of the constant
 * `householdCommandService` keeps privately (rather than importing it) — it
 * keeps the two call sites decoupled so a change to one doesn't ripple into
 * the other's tests.
 *
 * @module domains/household/utils/assertHouseholdRole
 */
import { NotAHouseholdParentError } from '../errors/householdErrors';
import { HOUSEHOLD_ROLES, HOUSEHOLD_STATES } from '../schemas';
import type { Household, HouseholdMember } from '../types';

/** Roles allowed to write household-scoped resources: owner and parent. */
export const HOUSEHOLD_WRITE_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

/** Throws NotAHouseholdParentError unless the membership is owner/parent. */
export function assertHouseholdWriteRole(
  householdId: string,
  membership: HouseholdMember
): void {
  if (!HOUSEHOLD_WRITE_ROLES.has(membership.role)) {
    throw new NotAHouseholdParentError(householdId, membership.role);
  }
}

/**
 * The §2.2 draft-author capability — the TypeScript twin of 093's
 * `private.is_draft_author`, and the ONLY thing 3-O adds beside the role gate
 * above.
 *
 * `HOUSEHOLD_WRITE_ROLES` does not widen. It cannot: a draft has no owner and
 * no parent, and widening it to admit a nanny would admit her in every LIVE
 * household too — including the one where she is the incumbent and
 * `pay_arrangements` is one insert away (D-36, spec §17).
 *
 * So the capability is narrow by construction, and all three conjuncts carry
 * weight:
 * - `state = 'draft'` makes it evaluate FALSE FOREVER the moment a family
 *   joins, which is what makes it safe to write once and never revisit. A
 *   household goes draft -> live exactly once, inside 094, and never back.
 * - `role = 'nanny'` is the shape a draft's only membership has.
 * - `user_id = created_by` is what stops a SECOND nanny — one who redeemed
 *   into the draft somehow — inheriting authorship of somebody else's terms.
 *
 * What it grants is enumerated at each call site, not here: the household
 * NAME (never the rest of the settings), children CRUD, and minting/revoking
 * her own invites. Nothing else, and nothing that can reach money.
 */
export function isDraftAuthor(
  household: Household | null,
  membership: HouseholdMember
): boolean {
  return (
    household !== null &&
    household.state === HOUSEHOLD_STATES.DRAFT &&
    membership.role === HOUSEHOLD_ROLES.NANNY &&
    membership.user_id === household.created_by
  );
}
