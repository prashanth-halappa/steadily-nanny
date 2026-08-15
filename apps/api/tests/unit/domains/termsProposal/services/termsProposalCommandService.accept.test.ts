/**
 * `accept` — THE BINDING ACT (spec §7.3, §8.2.1, §17).
 *
 * The three things this file exists to keep true:
 *  - the arrangement is inserted through the EXISTING
 *    `payArrangementCommandService` under a PARENT's credentials — the
 *    accepter's when a parent accepts, the AUTHOR's when the carer accepts a
 *    parent-authored round — so `WRITE_ROLES = {owner, parent}` is untouched
 *    and the nanny never inserts one;
 *  - a failed arrangement insert leaves the proposal `proposed` (§12: "retry
 *    is one tap") — never a half-accepted row;
 *  - a `candidate` nanny is `active` by the time the arrangement is written,
 *    because `payArrangementCommandService.assertActiveNanny` refuses a
 *    candidate outright.
 *
 * @module tests/unit/domains/termsProposal/services/termsProposalCommandService.accept
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { HouseholdMemberRepository } from '../../../../../src/domains/household';
import { TermsProposalCommandService } from '../../../../../src/domains/termsProposal/services/termsProposalCommandService';
import {
  CARER_ID,
  HELPER_ID,
  HOUSEHOLD_ID,
  makeArrangements,
  makeCandidates,
  makeHouseholdRepo,
  makeMemberRepo,
  makeProposalRepo,
  makePush,
  makeUserService,
  member,
  PARENT_ID,
  PROPOSAL_ID,
  proposal,
  terms,
} from './fixtures';

const CONFIRMED = { responsibility_confirmed: true } as const;

/**
 * A round the PARENT authored — the direction the nanny answers. The default
 * fixture is the carer-authored one, so every parent-direction test starts
 * from this instead.
 */
function parentRound(overrides: Record<string, unknown> = {}) {
  return proposal({
    direction: 'parent',
    proposed_by: PARENT_ID,
    ...overrides,
  });
}

function service(
  parts: {
    proposalRepo?: any;
    members?: Record<string, unknown>;
    push?: any;
    arrangements?: any;
    candidates?: any;
  } = {}
): any {
  return new TermsProposalCommandService(
    parts.proposalRepo ?? makeProposalRepo(),
    makeMemberRepo(
      parts.members ?? {
        [CARER_ID]: member('nanny'),
        [PARENT_ID]: member('parent'),
      }
    ),
    makeHouseholdRepo(),
    makeUserService(),
    parts.push ?? makePush(),
    parts.arrangements ?? makeArrangements(),
    parts.candidates ?? makeCandidates()
  );
}

describe('TermsProposalCommandService.accept — the arrangement goes through the existing service', () => {
  it('calls payArrangementCommandService.create with the ACCEPTER as caller and the proposal`s own terms', async () => {
    const arrangements = makeArrangements();
    const svc = service({ arrangements });
    await svc.accept(PARENT_ID, PROPOSAL_ID, CONFIRMED);
    expect(arrangements.create).toHaveBeenCalledTimes(1);
    const [callerId, householdId, carerId, request] =
      arrangements.create.mock.calls[0];
    expect(callerId).toBe(PARENT_ID);
    expect(householdId).toBe(HOUSEHOLD_ID);
    expect(carerId).toBe(CARER_ID);
    expect(request).toEqual(terms());
  });

  it('stamps the proposal accepted with the accepter, the arrangement and the checkbox', async () => {
    const proposalRepo = makeProposalRepo();
    const svc = service({ proposalRepo });
    await svc.accept(PARENT_ID, PROPOSAL_ID, CONFIRMED);
    const [id, patch] = proposalRepo.resolve.mock.calls[0];
    expect(id).toBe(PROPOSAL_ID);
    expect(patch.status).toBe('accepted');
    expect(patch.accepted_by).toBe(PARENT_ID);
    expect(patch.accepted_arrangement_id).toBe('arrangement-1');
    expect(patch.responsibility_confirmed).toBe(true);
    expect(typeof patch.responded_at).toBe('string');
  });

  it('notifies the carer, with no figure in the body (A8)', async () => {
    const push = makePush();
    const svc = service({ push });
    await svc.accept(PARENT_ID, PROPOSAL_ID, CONFIRMED);
    const [userId, payload] = push.notifyUser.mock.calls[0];
    expect(userId).toBe(CARER_ID);
    expect(payload.data.type).toBe('terms_proposal_accepted');
    expect(payload.data.proposalId).toBe(PROPOSAL_ID);
    expect(`${payload.title} ${payload.body}`).not.toMatch(/\d/);
  });
});

describe('TermsProposalCommandService.accept — §12, a failed insert leaves the proposal proposed', () => {
  it('the proposal is never stamped when the arrangement insert throws', async () => {
    const proposalRepo = makeProposalRepo();
    const arrangements = makeArrangements({
      create: async () => {
        throw new Error('pay_arrangements insert failed');
      },
    });
    const svc = service({ proposalRepo, arrangements });
    await expect(svc.accept(PARENT_ID, PROPOSAL_ID, CONFIRMED)).rejects.toThrow(
      'pay_arrangements insert failed'
    );
    expect(proposalRepo.resolve).not.toHaveBeenCalled();
  });

  it('no acceptance push goes out when the arrangement insert throws', async () => {
    const push = makePush();
    const arrangements = makeArrangements({
      create: async () => {
        throw new Error('boom');
      },
    });
    const svc = service({ push, arrangements });
    await expect(svc.accept(PARENT_ID, PROPOSAL_ID, CONFIRMED)).rejects.toThrow(
      'boom'
    );
    expect(push.notifyUser).not.toHaveBeenCalled();
  });

  it('a lost CAS race on the stamp does not leave the caller thinking it landed', async () => {
    const proposalRepo = makeProposalRepo({ resolve: async () => null });
    const svc = service({ proposalRepo });
    await expect(svc.accept(PARENT_ID, PROPOSAL_ID, CONFIRMED)).rejects.toThrow(
      'That terms proposal can no longer be answered'
    );
  });
});

describe('TermsProposalCommandService.accept — §8.2.1, the candidate flip', () => {
  it('activates the candidate BEFORE the arrangement insert, which refuses a non-active nanny', async () => {
    const order: string[] = [];
    const candidates = {
      activateCandidate: async () => {
        order.push('activate');
        return { status: 'active' };
      },
    };
    const arrangements = makeArrangements({
      create: async () => {
        order.push('arrangement');
        return { id: 'arrangement-1' };
      },
    });
    const svc = service({
      candidates,
      arrangements,
      members: {
        [CARER_ID]: member('nanny', 'candidate'),
        [PARENT_ID]: member('parent'),
      },
    });
    await svc.accept(PARENT_ID, PROPOSAL_ID, CONFIRMED);
    expect(order).toEqual(['activate', 'arrangement']);
  });

  it('passes the CANDIDATE`s own membership id, not the parent`s', async () => {
    const candidates = makeCandidates();
    const svc = service({
      candidates,
      members: {
        [CARER_ID]: member('nanny', 'candidate'),
        [PARENT_ID]: member('parent'),
      },
    });
    await svc.accept(PARENT_ID, PROPOSAL_ID, CONFIRMED);
    expect(candidates.activateCandidate).toHaveBeenCalledWith(
      'member-nanny-candidate'
    );
  });

  // The gate must find her at all before it can flip her. The fixture answers
  // `findMembershipAnyStatus` with null for a candidate, so this fails on the
  // wrong method choice rather than on the flip.
  it('resolves the candidate through the candidate-inclusive lookup', async () => {
    const memberRepo = makeMemberRepo({
      [CARER_ID]: member('nanny', 'candidate'),
      [PARENT_ID]: member('parent'),
    });
    const svc = new TermsProposalCommandService(
      makeProposalRepo(),
      memberRepo,
      makeHouseholdRepo(),
      makeUserService(),
      makePush(),
      makeArrangements(),
      makeCandidates()
    );
    await svc.accept(PARENT_ID, PROPOSAL_ID, CONFIRMED);
    expect(memberRepo.findMembershipAnyStatus).not.toHaveBeenCalled();
  });

  it('an already-active nanny still routes through the same CAS (it no-ops)', async () => {
    const candidates = makeCandidates();
    const svc = service({ candidates });
    await svc.accept(PARENT_ID, PROPOSAL_ID, CONFIRMED);
    expect(candidates.activateCandidate).toHaveBeenCalledTimes(1);
  });

  it('the production default activates the candidate via HouseholdMemberRepository', async () => {
    const activateSpy = spyOn(
      HouseholdMemberRepository.prototype,
      'activateCandidate'
    ).mockImplementation(async () => member('nanny', 'active'));

    const svc = new TermsProposalCommandService(
      makeProposalRepo(),
      makeMemberRepo({
        [CARER_ID]: member('nanny', 'candidate'),
        [PARENT_ID]: member('parent'),
      }),
      makeHouseholdRepo(),
      makeUserService(),
      makePush(),
      makeArrangements()
    );

    await svc.accept(PARENT_ID, PROPOSAL_ID, CONFIRMED);
    expect(activateSpy).toHaveBeenCalledWith('member-nanny-candidate');
    activateSpy.mockRestore();
  });
});

describe('TermsProposalCommandService.accept — who may perform the binding act', () => {
  it('a nanny may not accept her own proposal', async () => {
    const arrangements = makeArrangements();
    const svc = service({ arrangements });
    await expect(svc.accept(CARER_ID, PROPOSAL_ID, CONFIRMED)).rejects.toThrow(
      'Terms proposal not found'
    );
    expect(arrangements.create).not.toHaveBeenCalled();
  });

  it('a helper may not accept', async () => {
    const svc = service({ members: { [HELPER_ID]: member('helper') } });
    await expect(svc.accept(HELPER_ID, PROPOSAL_ID, CONFIRMED)).rejects.toThrow(
      'Terms proposal not found'
    );
  });

  it('an already-accepted proposal cannot be accepted twice', async () => {
    const arrangements = makeArrangements();
    const proposalRepo = makeProposalRepo({
      findById: async () => proposal({ status: 'accepted' }),
    });
    const svc = service({ proposalRepo, arrangements });
    await expect(svc.accept(PARENT_ID, PROPOSAL_ID, CONFIRMED)).rejects.toThrow(
      'That terms proposal can no longer be answered'
    );
    expect(arrangements.create).not.toHaveBeenCalled();
  });

  // Under id-only scoping the row supplies its own household, so "another
  // family's proposal" is no longer a URL mismatch — it is a caller who is not
  // on THAT household's read circle. That is the check now, and it is the one
  // that actually stops a guessed uuid.
  it('a caller with no membership in the proposal`s household 404s opaquely', async () => {
    const arrangements = makeArrangements();
    const svc = service({ arrangements, members: {} });
    await expect(
      svc.accept('a-stranger', PROPOSAL_ID, CONFIRMED)
    ).rejects.toThrow('Terms proposal not found');
    expect(arrangements.create).not.toHaveBeenCalled();
  });

  it('an id that names no proposal 404s the same way', async () => {
    const proposalRepo = makeProposalRepo({ findById: async () => null });
    const svc = service({ proposalRepo });
    await expect(svc.accept(PARENT_ID, PROPOSAL_ID, CONFIRMED)).rejects.toThrow(
      'Terms proposal not found'
    );
  });
});

/**
 * B1 — the gate is AUTHORSHIP, not side. The round's counterparty answers it,
 * whichever way it points: P16 is "parent counters -> nanny accepts", and the
 * parent-offer flow promotes an offer into a `direction: 'parent'` round that
 * only she can answer. What does NOT move is §17: the `pay_arrangements`
 * insert still runs under a PARENT's credentials, so when she accepts, the
 * identity handed to the pay service is the parent who AUTHORED the round.
 */
describe('TermsProposalCommandService.accept — the counterparty answers, either direction', () => {
  it('a carer accepts a parent-direction round, and the arrangement is created', async () => {
    const arrangements = makeArrangements();
    const svc = service({
      proposalRepo: makeProposalRepo({ findById: async () => parentRound() }),
      arrangements,
    });
    await svc.accept(CARER_ID, PROPOSAL_ID, CONFIRMED);
    expect(arrangements.create).toHaveBeenCalledTimes(1);
  });

  it('the arrangement is created with the AUTHOR parent`s id, never the carer`s (§17)', async () => {
    const arrangements = makeArrangements();
    const svc = service({
      proposalRepo: makeProposalRepo({ findById: async () => parentRound() }),
      arrangements,
    });
    await svc.accept(CARER_ID, PROPOSAL_ID, CONFIRMED);
    const [callerId, householdId, carerId, request] =
      arrangements.create.mock.calls[0];
    expect(callerId).toBe(PARENT_ID);
    expect(householdId).toBe(HOUSEHOLD_ID);
    expect(carerId).toBe(CARER_ID);
    expect(request).toEqual(terms());
  });

  // `accepted_by` records who really tapped Agree, which is NOT the identity
  // the arrangement was written under. Both facts are true and neither may
  // borrow the other's id.
  it('the proposal is stamped accepted BY THE CARER who tapped it', async () => {
    const proposalRepo = makeProposalRepo({
      findById: async () => parentRound(),
    });
    const svc = service({ proposalRepo });
    await svc.accept(CARER_ID, PROPOSAL_ID, CONFIRMED);
    const [id, patch] = proposalRepo.resolve.mock.calls[0];
    expect(id).toBe(PROPOSAL_ID);
    expect(patch.status).toBe('accepted');
    expect(patch.accepted_by).toBe(CARER_ID);
    expect(patch.accepted_arrangement_id).toBe('arrangement-1');
    expect(patch.responsibility_confirmed).toBe(true);
  });

  // §8.2.1's window: a nanny absorbed into a household is a `candidate` until
  // acceptance activates her, and the pay service refuses a candidate outright
  // — so the flip must land first on HER OWN acceptance too, not just a
  // parent's.
  it('a CANDIDATE carer accepting a parent round activates before the arrangement insert', async () => {
    const order: string[] = [];
    const candidates = {
      activateCandidate: async () => {
        order.push('activate');
        return { status: 'active' };
      },
    };
    const arrangements = makeArrangements({
      create: async () => {
        order.push('arrangement');
        return { id: 'arrangement-1' };
      },
    });
    const svc = service({
      proposalRepo: makeProposalRepo({ findById: async () => parentRound() }),
      candidates,
      arrangements,
      members: {
        [CARER_ID]: member('nanny', 'candidate'),
        [PARENT_ID]: member('parent'),
      },
    });
    await svc.accept(CARER_ID, PROPOSAL_ID, CONFIRMED);
    expect(order).toEqual(['activate', 'arrangement']);
  });

  it('a carer may not accept her OWN carer-direction round', async () => {
    const arrangements = makeArrangements();
    const svc = service({ arrangements });
    await expect(svc.accept(CARER_ID, PROPOSAL_ID, CONFIRMED)).rejects.toThrow(
      'Terms proposal not found'
    );
    expect(arrangements.create).not.toHaveBeenCalled();
  });

  it('a parent may not accept a round the family side authored', async () => {
    const arrangements = makeArrangements();
    const svc = service({
      proposalRepo: makeProposalRepo({ findById: async () => parentRound() }),
      arrangements,
    });
    await expect(svc.accept(PARENT_ID, PROPOSAL_ID, CONFIRMED)).rejects.toThrow(
      'Terms proposal not found'
    );
    expect(arrangements.create).not.toHaveBeenCalled();
  });

  it('a helper may not accept a parent-direction round either', async () => {
    const arrangements = makeArrangements();
    const svc = service({
      proposalRepo: makeProposalRepo({ findById: async () => parentRound() }),
      arrangements,
      members: { [HELPER_ID]: member('helper') },
    });
    await expect(svc.accept(HELPER_ID, PROPOSAL_ID, CONFIRMED)).rejects.toThrow(
      'Terms proposal not found'
    );
    expect(arrangements.create).not.toHaveBeenCalled();
  });

  // Part 2 — B4's follow-on. Before this, `notifyCarerOfAcceptance` always
  // pushed the CARER; once she can be the accepter, that told the wrong side
  // (or told her about her own acceptance) and the family — who authored the
  // offer — heard nothing. The fix is a parent-audience twin,
  // `terms_offer_accepted`, emitted to the household's parents instead.
  it('a carer accepting a parent-direction round notifies the HOUSEHOLD PARENTS, not the carer', async () => {
    const push = makePush();
    const svc = service({
      proposalRepo: makeProposalRepo({ findById: async () => parentRound() }),
      push,
    });
    await svc.accept(CARER_ID, PROPOSAL_ID, CONFIRMED);
    expect(push.notifyHouseholdParents).toHaveBeenCalledTimes(1);
    expect(push.notifyUser).not.toHaveBeenCalled();
    const [householdId, payload] = push.notifyHouseholdParents.mock.calls[0];
    expect(householdId).toBe(HOUSEHOLD_ID);
    expect(payload.data.type).toBe('terms_offer_accepted');
    expect(payload.data.proposalId).toBe(PROPOSAL_ID);
    expect(`${payload.title} ${payload.body}`).not.toMatch(/\d/);
  });

  it('a parent accepting a carer-direction round still notifies the carer via terms_proposal_accepted (unchanged)', async () => {
    const push = makePush();
    const svc = service({ push });
    await svc.accept(PARENT_ID, PROPOSAL_ID, CONFIRMED);
    expect(push.notifyUser).toHaveBeenCalledTimes(1);
    expect(push.notifyHouseholdParents).not.toHaveBeenCalled();
    const [userId, payload] = push.notifyUser.mock.calls[0];
    expect(userId).toBe(CARER_ID);
    expect(payload.data.type).toBe('terms_proposal_accepted');
  });

  it('a failed arrangement insert on HER acceptance leaves the round proposed', async () => {
    const proposalRepo = makeProposalRepo({
      findById: async () => parentRound(),
    });
    const arrangements = makeArrangements({
      create: async () => {
        throw new Error('pay_arrangements insert failed');
      },
    });
    const svc = service({ proposalRepo, arrangements });
    await expect(svc.accept(CARER_ID, PROPOSAL_ID, CONFIRMED)).rejects.toThrow(
      'pay_arrangements insert failed'
    );
    expect(proposalRepo.resolve).not.toHaveBeenCalled();
  });
});
