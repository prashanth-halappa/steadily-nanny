/**
 * The read gate — 092's SELECT policy expressed in the service, so a
 * service-role repository (which bypasses RLS) can never read wider than the
 * policy would have allowed. Parents/owner plus the carer the proposal is
 * FOR; helpers and OTHER carers denied (D-21), and the D-49 candidate reads
 * her own.
 *
 * @module tests/unit/domains/termsProposal/services/termsProposalQueryService
 */
import { describe, expect, it, mock } from 'bun:test';
import { TermsProposalQueryService } from '../../../../../src/domains/termsProposal/services/termsProposalQueryService';
import {
  CARER_ID,
  HELPER_ID,
  HOUSEHOLD_ID,
  makeMemberRepo,
  makeProposalRepo,
  member,
  PARENT_ID,
  proposal,
} from './fixtures';

const OTHER_CARER_ID = '99999999-9999-4999-8999-999999999999';

function service(
  parts: { proposalRepo?: any; members?: Record<string, unknown> } = {}
): any {
  return new TermsProposalQueryService(
    parts.proposalRepo ?? makeProposalRepo(),
    makeMemberRepo(
      parts.members ?? {
        [CARER_ID]: member('nanny'),
        [PARENT_ID]: member('parent'),
      }
    )
  );
}

describe('TermsProposalQueryService.getOpen', () => {
  it('a parent reads the open proposal for a carer', async () => {
    const proposalRepo = makeProposalRepo({
      findOpenForCarer: mock(async () => proposal()),
    });
    const svc = service({ proposalRepo });
    const row = await svc.getOpen(PARENT_ID, HOUSEHOLD_ID, CARER_ID);
    expect(row?.status).toBe('proposed');
    expect(proposalRepo.findOpenForCarer).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      CARER_ID
    );
  });

  it('no open proposal is a normal null, never an error', async () => {
    const svc = service();
    expect(await svc.getOpen(PARENT_ID, HOUSEHOLD_ID, CARER_ID)).toBeNull();
  });

  it('the carer reads her own', async () => {
    const proposalRepo = makeProposalRepo({
      findOpenForCarer: async () => proposal(),
    });
    const svc = service({ proposalRepo });
    expect(await svc.getOpen(CARER_ID, HOUSEHOLD_ID, CARER_ID)).not.toBeNull();
  });

  it('D-49: a CANDIDATE carer reads her own', async () => {
    const proposalRepo = makeProposalRepo({
      findOpenForCarer: async () => proposal(),
    });
    const svc = service({
      proposalRepo,
      members: { [CARER_ID]: member('nanny', 'candidate') },
    });
    expect(await svc.getOpen(CARER_ID, HOUSEHOLD_ID, CARER_ID)).not.toBeNull();
  });

  // The carve-out is exactly one door wide. `findMembershipAnyStatus` is the
  // sibling the six money-read gates use, it filters to `{active, removed}`,
  // and a candidate reads NULL from it — which is what keeps her out of the
  // household's pay, hours, expenses, PTO, payments and settlements. Asserting
  // the gate asked the candidate-inclusive lookup INSTEAD is what makes this a
  // test of the right method rather than of "some method was called": the
  // fixture answers the two differently on purpose.
  it('asks the candidate-inclusive lookup, never the money-read one', async () => {
    const memberRepo = makeMemberRepo({
      [CARER_ID]: member('nanny', 'candidate'),
    });
    const proposalRepo = makeProposalRepo({
      findOpenForCarer: async () => proposal(),
    });
    const svc = new TermsProposalQueryService(proposalRepo, memberRepo);
    await svc.getOpen(CARER_ID, HOUSEHOLD_ID, CARER_ID);
    expect(memberRepo.findMembershipIncludingCandidate).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      CARER_ID
    );
    expect(memberRepo.findMembershipAnyStatus).not.toHaveBeenCalled();
  });

  it('the mirror: a candidate is still refused another carer`s proposal', async () => {
    const proposalRepo = makeProposalRepo();
    const svc = service({
      proposalRepo,
      members: { [CARER_ID]: member('nanny', 'candidate') },
    });
    await expect(
      svc.getOpen(CARER_ID, HOUSEHOLD_ID, OTHER_CARER_ID)
    ).rejects.toThrow('Terms proposal not found');
    expect(proposalRepo.findOpenForCarer).not.toHaveBeenCalled();
  });

  it('the mirror: a candidate HELPER is refused — the carve-out is nanny-only', async () => {
    const svc = service({
      members: { [HELPER_ID]: member('helper', 'candidate') },
    });
    await expect(
      svc.getOpen(HELPER_ID, HOUSEHOLD_ID, HELPER_ID)
    ).rejects.toThrow('Terms proposal not found');
  });

  it('D-21: the OTHER nanny may not read a colleague`s proposed rate', async () => {
    const proposalRepo = makeProposalRepo();
    const svc = service({
      proposalRepo,
      members: { [OTHER_CARER_ID]: member('nanny') },
    });
    await expect(
      svc.getOpen(OTHER_CARER_ID, HOUSEHOLD_ID, CARER_ID)
    ).rejects.toThrow('Terms proposal not found');
    expect(proposalRepo.findOpenForCarer).not.toHaveBeenCalled();
  });

  it('a helper is denied', async () => {
    const svc = service({ members: { [HELPER_ID]: member('helper') } });
    await expect(
      svc.getOpen(HELPER_ID, HOUSEHOLD_ID, CARER_ID)
    ).rejects.toThrow('Terms proposal not found');
  });

  it('a non-member is denied', async () => {
    const svc = service({ members: {} });
    await expect(svc.getOpen('nobody', HOUSEHOLD_ID, CARER_ID)).rejects.toThrow(
      'Terms proposal not found'
    );
  });

  it('a REMOVED parent is denied', async () => {
    const svc = service({
      members: { [PARENT_ID]: member('parent', 'removed') },
    });
    await expect(
      svc.getOpen(PARENT_ID, HOUSEHOLD_ID, CARER_ID)
    ).rejects.toThrow('Terms proposal not found');
  });
});

describe('TermsProposalQueryService.getChain — §7.2 "How we got here"', () => {
  it('returns every round for the pair, newest first, with the same gate', async () => {
    const proposalRepo = makeProposalRepo({
      listChain: async () => [
        proposal({ id: 'round-2', supersedes_id: 'round-1' }),
        proposal({ id: 'round-1', status: 'countered' }),
      ],
    });
    const svc = service({ proposalRepo });
    const rows = await svc.getChain(PARENT_ID, HOUSEHOLD_ID, CARER_ID);
    expect(rows.map((r: { id: string }) => r.id)).toEqual([
      'round-2',
      'round-1',
    ]);
  });

  it('a helper is denied the history too', async () => {
    const proposalRepo = makeProposalRepo();
    const svc = service({
      proposalRepo,
      members: { [HELPER_ID]: member('helper') },
    });
    await expect(
      svc.getChain(HELPER_ID, HOUSEHOLD_ID, CARER_ID)
    ).rejects.toThrow('Terms proposal not found');
    expect(proposalRepo.listChain).not.toHaveBeenCalled();
  });
});
