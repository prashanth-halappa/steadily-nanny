/**
 * The membership gates both terms-proposal services share.
 *
 * WHY THEY LIVE HERE AND NOT IN THE MIDDLEWARE. Every route in this domain
 * uses `authWithValidation`, never `authWithOwnership` — GOLDEN-FIXES #32:
 * `makeOwnershipValidator` caches its answer under `(user, resource)` with
 * the LOOKUP's identity absent from the key, so a wide read lookup and a
 * narrow write lookup over the same `:proposalId` share one entry and one
 * permitted GET silently removes the write guard for an hour. This domain has
 * exactly that shape — the read circle is wider than the accept gate — so the
 * checks live at the top of each service method instead.
 *
 * WHY `findMembershipIncludingCandidate`, AND NOT EITHER SIBLING. D-49 /
 * spec §8.2.1: a `candidate` nanny — a person who has redeemed a code but
 * whose terms nobody has agreed yet — matches no `status = 'active'`
 * predicate anywhere in this codebase and therefore reads NOTHING in the
 * household she just joined. "The single exception is the proposal itself."
 * That exception has to be written somewhere, and this is the one place: an
 * active-only lookup would close the one door the candidate window depends
 * on. Every OTHER status is still refused explicitly below, so the widening
 * is to exactly one new value and not to "anything that isn't removed" —
 * which is the negated shape §17 forbids.
 *
 * `findMembershipAnyStatus` is the WRONG sibling, and it used to be the right
 * one. Its name predates `candidate`: while the statuses were `{active,
 * removed}`, "any status" and "is or was a member" named the same set, and the
 * day `candidate` arrived they stopped agreeing. It now filters positively to
 * `{active, removed}` — correct for the six money-read gates that call it,
 * because a candidate has no money trail to keep, and wrong here, because this
 * is the one gate whose whole job is to let her through. That divergence broke
 * this carve-out silently once; `tests/.../fixtures.ts` now implements both
 * methods' real semantics so it cannot break silently again.
 *
 * @module domains/termsProposal/utils/proposalAccess
 */
import {
  HOUSEHOLD_MEMBER_STATUSES,
  HOUSEHOLD_ROLES,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { TermsProposalNotFoundError } from '../errors/termsProposalErrors';

/** Roles that speak for the family. Mirrors the pay domain's `PAY_WRITE_ROLES`. */
const PARENT_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

/**
 * The statuses a CARER may hold and still touch her own proposal. A positive
 * list, never a `!== 'removed'` test — §17: a negated filter is the one shape
 * that would silently admit a future status nobody thought about.
 */
const CARER_PROPOSAL_STATUSES: ReadonlySet<string> = new Set([
  HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
  HOUSEHOLD_MEMBER_STATUSES.CANDIDATE,
]);

/** The membership fields these gates read. Narrowed so tests can stub it. */
export interface MembershipRow {
  id: string;
  role: string;
  status: string;
  display_name_override: string | null;
}

/**
 * The one method the gates need from `HouseholdMemberRepository` — and it must
 * be THIS one, not `findMembershipAnyStatus`. See the module header.
 */
export interface MembershipLookup {
  findMembershipIncludingCandidate: (
    householdId: string,
    userId: string
  ) => Promise<MembershipRow | null>;
}

/** Which side of the negotiation a caller is on, resolved from membership. */
export type ProposalSide =
  | { kind: 'parent'; membership: MembershipRow }
  | { kind: 'carer'; membership: MembershipRow };

/**
 * Resolve the caller's side, or refuse. An owner/parent must be ACTIVE (there
 * is no candidate parent — the status exists for the hiring window and a
 * household's own parents are never in it). A nanny may be active or a
 * candidate.
 *
 * Returns null rather than throwing so callers can attach their own
 * `metadata.reason` — every one of them collapses to the same 404.
 */
export async function resolveSide(
  members: MembershipLookup,
  householdId: string,
  callerId: string
): Promise<ProposalSide | null> {
  const membership = await members.findMembershipIncludingCandidate(
    householdId,
    callerId
  );
  if (!membership) return null;
  if (
    PARENT_ROLES.has(membership.role) &&
    membership.status === HOUSEHOLD_MEMBER_STATUSES.ACTIVE
  ) {
    return { kind: 'parent', membership };
  }
  if (
    membership.role === HOUSEHOLD_ROLES.NANNY &&
    CARER_PROPOSAL_STATUSES.has(membership.status)
  ) {
    return { kind: 'carer', membership };
  }
  // A helper, a removed member, or a nanny in some future status nobody has
  // taught this gate about. All three read nothing here.
  return null;
}

/**
 * 092's SELECT policy, expressed in the service so a service-role repository
 * can never read wider than the policy would have allowed: parents/owner
 * household-wide, plus the carer the proposal is FOR reading her own.
 *
 * D-21 lives in the last clause. A household with two nannies has two
 * independent negotiations, and the OTHER nanny is a member in good standing
 * — she passes `resolveSide` and is refused here, on the carer id, which is
 * the only place the distinction exists.
 */
export async function assertCanReadProposals(
  members: MembershipLookup,
  householdId: string,
  callerId: string,
  carerId: string
): Promise<ProposalSide> {
  const side = await resolveSide(members, householdId, callerId);
  if (!side) {
    throw new TermsProposalNotFoundError({
      householdId,
      carerId,
      reason: 'not_on_the_proposal_read_circle',
    });
  }
  if (side.kind === 'carer' && callerId !== carerId) {
    throw new TermsProposalNotFoundError({
      householdId,
      carerId,
      reason: 'another_carers_proposal',
    });
  }
  return side;
}

/**
 * The D12-class assertion for a PARENT-authored proposal: `carerId` arrives
 * from the URL — a client-supplied foreign id on a write, exactly the shape
 * of defects D12/D13/D14 — so the named carer must really be a nanny of THIS
 * household. Candidates included: countering a candidate's proposal is the
 * whole point of the window (§8.2.1), and refusing it here would strand a
 * negotiation the parent is in the middle of.
 */
export async function assertProposalCarer(
  members: MembershipLookup,
  householdId: string,
  carerId: string
): Promise<MembershipRow> {
  const membership = await members.findMembershipIncludingCandidate(
    householdId,
    carerId
  );
  if (
    !membership ||
    membership.role !== HOUSEHOLD_ROLES.NANNY ||
    !CARER_PROPOSAL_STATUSES.has(membership.status)
  ) {
    throw new TermsProposalNotFoundError({
      householdId,
      carerId,
      reason: 'carer_not_a_nanny_of_this_household',
    });
  }
  return membership;
}
