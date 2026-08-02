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
import { HOUSEHOLD_ROLES } from '../schemas';
import type { HouseholdMember } from '../types';

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
