/**
 * `propose` / `counter` / `withdraw` / `markViewed` — the author-resolution
 * and gating half of the command service (spec §7.5, §9.1, §8.2.1's D-49
 * candidate window).
 *
 * @module tests/unit/domains/termsProposal/services/termsProposalCommandService.propose
 */
import { describe, expect, it } from 'bun:test';
import { OpenTermsProposalExistsError } from '../../../../../src/domains/termsProposal/errors/termsProposalErrors';
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
  PRIOR_ID,
  PROPOSAL_ID,
  proposal,
  terms,
} from './fixtures';

const NOW = () => new Date();
const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE_VIEWED_AT = new Date(Date.now() - 3 * DAY_MS).toISOString();

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

describe('TermsProposalCommandService.propose — the author resolves from membership', () => {
  it('an active nanny authors direction=carer for herself, ignoring the URL carerId', async () => {
    const proposalRepo = makeProposalRepo();
    const svc = service({ proposalRepo });
    await svc.propose(
      CARER_ID,
      HOUSEHOLD_ID,
      PARENT_ID,
      { terms: terms() },
      NOW
    );
    const row = proposalRepo.create.mock.calls[0][0];
    expect(row.direction).toBe('carer');
    expect(row.carer_id).toBe(CARER_ID);
    expect(row.proposed_by).toBe(CARER_ID);
    expect(row.carer_display_name).toBe('Marisol');
  });

  it('an active parent authors direction=parent for the URL carer', async () => {
    const proposalRepo = makeProposalRepo();
    const svc = service({ proposalRepo });
    await svc.propose(
      PARENT_ID,
      HOUSEHOLD_ID,
      CARER_ID,
      { terms: terms() },
      NOW
    );
    const row = proposalRepo.create.mock.calls[0][0];
    expect(row.direction).toBe('parent');
    expect(row.carer_id).toBe(CARER_ID);
    expect(row.proposed_by).toBe(PARENT_ID);
  });

  it('D-49: a CANDIDATE nanny may propose her own terms', async () => {
    const proposalRepo = makeProposalRepo();
    const svc = service({
      proposalRepo,
      members: { [CARER_ID]: member('nanny', 'candidate') },
    });
    await svc.propose(
      CARER_ID,
      HOUSEHOLD_ID,
      CARER_ID,
      { terms: terms() },
      NOW
    );
    expect(proposalRepo.create).toHaveBeenCalledTimes(1);
  });

  // The carve-out is one door wide, and this is what proves the gate picked
  // the right lookup rather than merely calling one: the fixture answers
  // `findMembershipAnyStatus` (the `{active, removed}` money-read sibling)
  // with NULL for a candidate, on purpose.
  it('D-49: the gate asks the candidate-inclusive lookup, never the money-read one', async () => {
    const memberRepo = makeMemberRepo({
      [CARER_ID]: member('nanny', 'candidate'),
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
    await svc.propose(
      CARER_ID,
      HOUSEHOLD_ID,
      CARER_ID,
      { terms: terms() },
      NOW
    );
    expect(memberRepo.findMembershipIncludingCandidate).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      CARER_ID
    );
    expect(memberRepo.findMembershipAnyStatus).not.toHaveBeenCalled();
  });

  it('D-49: a parent may counter a CANDIDATE`s proposal — she is still the carer', async () => {
    const proposalRepo = makeProposalRepo({
      findById: async () => proposal({ id: PRIOR_ID }),
    });
    const svc = service({
      proposalRepo,
      members: {
        [CARER_ID]: member('nanny', 'candidate'),
        [PARENT_ID]: member('parent'),
      },
    });
    await svc.propose(
      PARENT_ID,
      HOUSEHOLD_ID,
      CARER_ID,
      { terms: terms(), supersedes_id: PRIOR_ID },
      NOW
    );
    expect(proposalRepo.create).toHaveBeenCalledTimes(1);
  });

  it('the mirror: a candidate HELPER may do nothing — the carve-out is nanny-only', async () => {
    const proposalRepo = makeProposalRepo();
    const svc = service({
      proposalRepo,
      members: { [HELPER_ID]: member('helper', 'candidate') },
    });
    await expect(
      svc.propose(HELPER_ID, HOUSEHOLD_ID, HELPER_ID, { terms: terms() }, NOW)
    ).rejects.toThrow('Terms proposal not found');
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  it('a candidate PARENT is not a thing — a non-active parent may not propose', async () => {
    const proposalRepo = makeProposalRepo();
    const svc = service({
      proposalRepo,
      members: { [PARENT_ID]: member('parent', 'candidate') },
    });
    await expect(
      svc.propose(PARENT_ID, HOUSEHOLD_ID, CARER_ID, { terms: terms() }, NOW)
    ).rejects.toThrow('Terms proposal not found');
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  it('a helper may do nothing', async () => {
    const proposalRepo = makeProposalRepo();
    const svc = service({
      proposalRepo,
      members: { [HELPER_ID]: member('helper') },
    });
    await expect(
      svc.propose(HELPER_ID, HOUSEHOLD_ID, CARER_ID, { terms: terms() }, NOW)
    ).rejects.toThrow('Terms proposal not found');
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  it('a REMOVED nanny may not propose', async () => {
    const svc = service({
      members: { [CARER_ID]: member('nanny', 'removed') },
    });
    await expect(
      svc.propose(CARER_ID, HOUSEHOLD_ID, CARER_ID, { terms: terms() }, NOW)
    ).rejects.toThrow('Terms proposal not found');
  });

  it('a parent proposing for someone who is not a nanny of this household 404s', async () => {
    const svc = service({
      members: { [PARENT_ID]: member('parent'), [HELPER_ID]: member('helper') },
    });
    await expect(
      svc.propose(PARENT_ID, HOUSEHOLD_ID, HELPER_ID, { terms: terms() }, NOW)
    ).rejects.toThrow('Terms proposal not found');
  });
});

describe('TermsProposalCommandService.propose — D-16 horizon, never clamped', () => {
  it('refuses a valid_from more than 12 months past household-local today', async () => {
    const proposalRepo = makeProposalRepo();
    const svc = service({ proposalRepo });
    await expect(
      svc.propose(
        CARER_ID,
        HOUSEHOLD_ID,
        CARER_ID,
        { terms: terms({ valid_from: '2027-09-01' }) },
        NOW
      )
    ).rejects.toThrow('Those proposed terms are not valid');
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  it('§7.4: a future valid_from inside the horizon is written UNCHANGED, never clamped to today', async () => {
    const proposalRepo = makeProposalRepo();
    const svc = service({ proposalRepo });
    await svc.propose(
      CARER_ID,
      HOUSEHOLD_ID,
      CARER_ID,
      { terms: terms({ valid_from: '2026-08-17' }) },
      NOW
    );
    expect(proposalRepo.create.mock.calls[0][0].terms.valid_from).toBe(
      '2026-08-17'
    );
  });

  it('refuses terms the pay-arrangement request schema rejects', async () => {
    const proposalRepo = makeProposalRepo();
    const svc = service({ proposalRepo });
    await expect(
      svc.propose(CARER_ID, HOUSEHOLD_ID, CARER_ID, {
        terms: terms({ rate_minor: -1 }),
      })
    ).rejects.toThrow('Those proposed terms are not valid');
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });
});

describe('TermsProposalCommandService.propose — counter is a NEW ROW, never an edit', () => {
  it('flips the superseded row to countered BEFORE inserting, so both are never open', async () => {
    const order: string[] = [];
    const proposalRepo = makeProposalRepo({
      findById: async () => proposal({ id: PRIOR_ID }),
      resolve: async (id: string, patch: Record<string, unknown>) => {
        order.push('resolve');
        return proposal({ id, ...patch });
      },
      create: async (row: Record<string, unknown>) => {
        order.push('create');
        return proposal({ id: 'new-proposal', ...row });
      },
    });
    const svc = service({ proposalRepo });
    const row = await svc.propose(
      PARENT_ID,
      HOUSEHOLD_ID,
      CARER_ID,
      {
        terms: terms(),
        supersedes_id: PRIOR_ID,
      },
      NOW
    );
    expect(order).toEqual(['resolve', 'create']);
    expect(row.supersedes_id).toBe(PRIOR_ID);
  });

  it('stamps responded_at on the row it counters', async () => {
    const resolved: Record<string, unknown>[] = [];
    const proposalRepo = makeProposalRepo({
      findById: async () => proposal({ id: PRIOR_ID }),
      resolve: async (id: string, patch: Record<string, unknown>) => {
        resolved.push(patch);
        return proposal({ id, ...patch });
      },
    });
    const svc = service({ proposalRepo });
    await svc.propose(
      PARENT_ID,
      HOUSEHOLD_ID,
      CARER_ID,
      {
        terms: terms(),
        supersedes_id: PRIOR_ID,
      },
      NOW
    );
    expect(resolved[0]?.status).toBe('countered');
    expect(typeof resolved[0]?.responded_at).toBe('string');
  });

  it('refuses to counter a row that is no longer proposed', async () => {
    const proposalRepo = makeProposalRepo({
      findById: async () => proposal({ id: PRIOR_ID, status: 'accepted' }),
    });
    const svc = service({ proposalRepo });
    await expect(
      svc.propose(
        PARENT_ID,
        HOUSEHOLD_ID,
        CARER_ID,
        {
          terms: terms(),
          supersedes_id: PRIOR_ID,
        },
        NOW
      )
    ).rejects.toThrow('That terms proposal can no longer be answered');
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  it('refuses to counter a row belonging to another household', async () => {
    const proposalRepo = makeProposalRepo({
      findById: async () =>
        proposal({ id: PRIOR_ID, household_id: 'other-household' }),
    });
    const svc = service({ proposalRepo });
    await expect(
      svc.propose(
        PARENT_ID,
        HOUSEHOLD_ID,
        CARER_ID,
        {
          terms: terms(),
          supersedes_id: PRIOR_ID,
        },
        NOW
      )
    ).rejects.toThrow('Terms proposal not found');
  });

  it('refuses to counter a row belonging to another carer', async () => {
    const proposalRepo = makeProposalRepo({
      findById: async () => proposal({ id: PRIOR_ID, carer_id: 'other-carer' }),
    });
    const svc = service({ proposalRepo });
    await expect(
      svc.propose(
        PARENT_ID,
        HOUSEHOLD_ID,
        CARER_ID,
        {
          terms: terms(),
          supersedes_id: PRIOR_ID,
        },
        NOW
      )
    ).rejects.toThrow('Terms proposal not found');
  });

  it('a lost CAS race on the superseded row aborts before the insert', async () => {
    const proposalRepo = makeProposalRepo({
      findById: async () => proposal({ id: PRIOR_ID }),
      resolve: async () => null,
    });
    const svc = service({ proposalRepo });
    await expect(
      svc.propose(
        PARENT_ID,
        HOUSEHOLD_ID,
        CARER_ID,
        {
          terms: terms(),
          supersedes_id: PRIOR_ID,
        },
        NOW
      )
    ).rejects.toThrow('That terms proposal can no longer be answered');
    expect(proposalRepo.create).not.toHaveBeenCalled();
  });

  it('the repository`s open-proposal conflict surfaces as-is', async () => {
    const proposalRepo = makeProposalRepo({
      create: async () => {
        throw new OpenTermsProposalExistsError(HOUSEHOLD_ID, CARER_ID);
      },
    });
    const svc = service({ proposalRepo });
    await expect(
      svc.propose(CARER_ID, HOUSEHOLD_ID, CARER_ID, { terms: terms() }, NOW)
    ).rejects.toBeInstanceOf(OpenTermsProposalExistsError);
  });
});

describe('TermsProposalCommandService — pushes carry no figure (A8)', () => {
  it('a carer-authored proposal notifies the parents, rate-free', async () => {
    const push = makePush();
    const svc = service({ push });
    await svc.propose(
      CARER_ID,
      HOUSEHOLD_ID,
      CARER_ID,
      { terms: terms() },
      NOW
    );
    expect(push.notifyHouseholdParents).toHaveBeenCalledTimes(1);
    const [householdId, payload] = push.notifyHouseholdParents.mock.calls[0];
    expect(householdId).toBe(HOUSEHOLD_ID);
    expect(payload.data.type).toBe('terms_proposal_received');
    expect(payload.data.householdId).toBe(HOUSEHOLD_ID);
    expect(typeof payload.data.proposalId).toBe('string');
    expect(`${payload.title} ${payload.body}`).not.toMatch(/\d/);
  });

  it('a parent-authored counter notifies the carer, rate-free', async () => {
    const push = makePush();
    const proposalRepo = makeProposalRepo({
      findById: async () => proposal({ id: PRIOR_ID }),
    });
    const svc = service({ push, proposalRepo });
    await svc.propose(
      PARENT_ID,
      HOUSEHOLD_ID,
      CARER_ID,
      {
        terms: terms(),
        supersedes_id: PRIOR_ID,
      },
      NOW
    );
    expect(push.notifyUser).toHaveBeenCalledTimes(1);
    const [userId, payload] = push.notifyUser.mock.calls[0];
    expect(userId).toBe(CARER_ID);
    expect(payload.data.type).toBe('terms_proposal_countered');
    expect(`${payload.title} ${payload.body}`).not.toMatch(/\d/);
  });
});

describe('TermsProposalCommandService.withdraw — the author`s side only', () => {
  it('the carer withdraws her own open proposal and the parents hear about it', async () => {
    const proposalRepo = makeProposalRepo();
    const push = makePush();
    const svc = service({ proposalRepo, push });
    const row = await svc.withdraw(CARER_ID, PROPOSAL_ID);
    expect(row.status).toBe('withdrawn');
    expect(proposalRepo.resolve.mock.calls[0][1].status).toBe('withdrawn');
    expect(typeof proposalRepo.resolve.mock.calls[0][1].responded_at).toBe(
      'string'
    );
    const payload = push.notifyHouseholdParents.mock.calls[0][1];
    expect(payload.data.type).toBe('terms_proposal_withdrawn');
    expect(`${payload.title} ${payload.body}`).not.toMatch(/\d/);
  });

  it('the OTHER side may not withdraw', async () => {
    const proposalRepo = makeProposalRepo();
    const svc = service({ proposalRepo });
    await expect(svc.withdraw(PARENT_ID, PROPOSAL_ID)).rejects.toThrow(
      'Terms proposal not found'
    );
    expect(proposalRepo.resolve).not.toHaveBeenCalled();
  });

  it('nothing is deleted — a resolved proposal simply cannot be withdrawn again', async () => {
    const proposalRepo = makeProposalRepo({
      findById: async () => proposal({ status: 'withdrawn' }),
    });
    const svc = service({ proposalRepo });
    await expect(svc.withdraw(CARER_ID, PROPOSAL_ID)).rejects.toThrow(
      'That terms proposal can no longer be answered'
    );
  });
});

describe('TermsProposalCommandService.markViewed — one-way, never the author', () => {
  it('the parent viewing a carer`s proposal stamps viewed_at once', async () => {
    const proposalRepo = makeProposalRepo();
    const svc = service({ proposalRepo });
    const row = await svc.markViewed(PARENT_ID, PROPOSAL_ID);
    expect(proposalRepo.stampViewed).toHaveBeenCalledTimes(1);
    expect(row.viewed_at).not.toBeNull();
  });

  it('the AUTHOR re-reading her own proposal never stamps it', async () => {
    const proposalRepo = makeProposalRepo();
    const svc = service({ proposalRepo });
    const row = await svc.markViewed(CARER_ID, PROPOSAL_ID);
    expect(proposalRepo.stampViewed).not.toHaveBeenCalled();
    expect(row.viewed_at).toBeNull();
  });

  it('an already-viewed proposal is never re-stamped', async () => {
    const proposalRepo = makeProposalRepo({
      findById: async () => proposal({ viewed_at: FIXTURE_VIEWED_AT }),
    });
    const svc = service({ proposalRepo });
    const row = await svc.markViewed(PARENT_ID, PROPOSAL_ID);
    expect(proposalRepo.stampViewed).not.toHaveBeenCalled();
    expect(row.viewed_at).toBe(FIXTURE_VIEWED_AT);
  });

  it('a helper cannot mark anything viewed', async () => {
    const svc = service({ members: { [HELPER_ID]: member('helper') } });
    await expect(svc.markViewed(HELPER_ID, PROPOSAL_ID)).rejects.toThrow(
      'Terms proposal not found'
    );
  });
});
