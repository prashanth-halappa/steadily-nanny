/**
 * `decline` — B4, the counterparty's refusal.
 *
 * `withdraw` only ever let the AUTHOR close a round. This gives the OTHER
 * side — whichever direction the round points — a real "no" that creates NO
 * money: no `pay_arrangements` insert, no candidate activation, unlike
 * `accept`.
 *
 * @module tests/unit/domains/termsProposal/services/termsProposalCommandService.decline
 */
import { describe, expect, it } from 'bun:test';
import { TermsProposalCommandService } from '../../../../../src/domains/termsProposal/services/termsProposalCommandService';
import {
  CARER_ID,
  HELPER_ID,
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
} from './fixtures';

/** A round the PARENT authored — the direction the nanny answers. */
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

describe('TermsProposalCommandService.decline — the counterparty refuses, either direction', () => {
  it('a parent declines a carer-authored round: declined + responded_at, no money', async () => {
    const proposalRepo = makeProposalRepo();
    const arrangements = makeArrangements();
    const candidates = makeCandidates();
    const svc = service({ proposalRepo, arrangements, candidates });
    const declined = await svc.decline(PARENT_ID, PROPOSAL_ID);
    expect(declined.status).toBe('declined');
    const [id, patch] = proposalRepo.resolve.mock.calls[0];
    expect(id).toBe(PROPOSAL_ID);
    expect(patch.status).toBe('declined');
    expect(typeof patch.responded_at).toBe('string');
    expect(arrangements.create).not.toHaveBeenCalled();
    expect(candidates.activateCandidate).not.toHaveBeenCalled();
  });

  it('a carer declines a parent-authored round: declined + responded_at, no money', async () => {
    const proposalRepo = makeProposalRepo({
      findById: async () => parentRound(),
    });
    const arrangements = makeArrangements();
    const candidates = makeCandidates();
    const svc = service({ proposalRepo, arrangements, candidates });
    const declined = await svc.decline(CARER_ID, PROPOSAL_ID);
    expect(declined.status).toBe('declined');
    expect(arrangements.create).not.toHaveBeenCalled();
    expect(candidates.activateCandidate).not.toHaveBeenCalled();
  });

  it('the AUTHOR cannot decline her own carer-authored round', async () => {
    const svc = service();
    await expect(svc.decline(CARER_ID, PROPOSAL_ID)).rejects.toThrow(
      'Terms proposal not found'
    );
  });

  it('the AUTHOR cannot decline his own parent-authored round', async () => {
    const svc = service({
      proposalRepo: makeProposalRepo({ findById: async () => parentRound() }),
    });
    await expect(svc.decline(PARENT_ID, PROPOSAL_ID)).rejects.toThrow(
      'Terms proposal not found'
    );
  });

  it('a helper may not decline', async () => {
    const svc = service({ members: { [HELPER_ID]: member('helper') } });
    await expect(svc.decline(HELPER_ID, PROPOSAL_ID)).rejects.toThrow(
      'Terms proposal not found'
    );
  });

  it('declining a non-proposed round is refused as not-actionable', async () => {
    const proposalRepo = makeProposalRepo({
      findById: async () => proposal({ status: 'accepted' }),
    });
    const svc = service({ proposalRepo });
    await expect(svc.decline(PARENT_ID, PROPOSAL_ID)).rejects.toThrow(
      'That terms proposal can no longer be answered'
    );
  });

  it('a non-member gets the same opaque 404 as a stray id', async () => {
    const svc = service({ members: {} });
    await expect(svc.decline('a-stranger', PROPOSAL_ID)).rejects.toThrow(
      'Terms proposal not found'
    );
  });

  it('a lost CAS race does not leave the caller thinking it landed', async () => {
    const proposalRepo = makeProposalRepo({ resolve: async () => null });
    const svc = service({ proposalRepo });
    await expect(svc.decline(PARENT_ID, PROPOSAL_ID)).rejects.toThrow(
      'That terms proposal can no longer be answered'
    );
  });

  // The partial index (092/097) is scoped to status='proposed', so a decline
  // must free the slot exactly like withdraw/accept/counter already do — the
  // repository contract is identical, proven here at the service boundary by
  // the same `resolve` CAS every other terminal write goes through.
  it('routes the write through the same CAS `resolve` as every other terminal status', async () => {
    const proposalRepo = makeProposalRepo();
    const svc = service({ proposalRepo });
    await svc.decline(PARENT_ID, PROPOSAL_ID);
    expect(proposalRepo.resolve).toHaveBeenCalledTimes(1);
  });
});
