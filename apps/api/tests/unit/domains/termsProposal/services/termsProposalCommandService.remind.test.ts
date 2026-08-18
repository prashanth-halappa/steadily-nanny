/**
 * `remind` — WP-G, the one-tap nudge on a round nobody has answered.
 *
 * The whole feature is a rate limit with a push attached, so that is what
 * this file pins. Three things it must never become:
 *
 *  - an automatic reminder (there is no job here; a person taps a button);
 *  - a way to reach a household you are not in (same 404 as every other verb);
 *  - a way to put a rate on somebody's lock screen (A8 — the pushes carry no
 *    figure, exactly like `notifyOfNewRound`).
 *
 * @module tests/unit/domains/termsProposal/services/termsProposalCommandService.remind
 */
import { describe, expect, it } from 'bun:test';
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
  makeReminderLog,
  makeUserService,
  member,
  PARENT_ID,
  PROPOSAL_ID,
  proposal,
} from './fixtures';

const HOUR_MS = 60 * 60 * 1000;
/** The instant every test calls `remind` at. */
const NOW = Date.parse('2026-08-20T12:00:00.000Z');
const at = (hoursAgo: number) =>
  new Date(NOW - hoursAgo * HOUR_MS).toISOString();

/** A round old enough to be nudged: sent three days ago. */
const OLD_ENOUGH = at(72);

function service(
  parts: {
    proposalRepo?: any;
    members?: Record<string, unknown>;
    push?: any;
    reminderLog?: any;
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
    makeArrangements(),
    makeCandidates(),
    parts.reminderLog ?? makeReminderLog()
  );
}

/** A repo whose one row is `overrides` applied to the carer-authored default. */
function repoWith(overrides: Record<string, unknown>) {
  const row = proposal({ created_at: OLD_ENOUGH, ...overrides });
  return makeProposalRepo({ findById: async () => row });
}

const now = () => new Date(NOW);

describe('TermsProposalCommandService.remind — who may nudge', () => {
  it('the AUTHOR nudges her own open round and gets the instant back', async () => {
    const svc = service({ proposalRepo: repoWith({}) });

    const result = await svc.remind(CARER_ID, PROPOSAL_ID, now);

    expect(result.reminded_at).toBe(new Date(NOW).toISOString());
  });

  it('the counterparty may NOT nudge — answering is their move, not chasing', async () => {
    const svc = service({ proposalRepo: repoWith({}) });

    await expect(svc.remind(PARENT_ID, PROPOSAL_ID, now)).rejects.toThrow(
      'Terms proposal not found'
    );
  });

  it('someone with no membership at all gets the same opaque 404', async () => {
    const svc = service({
      proposalRepo: repoWith({}),
      members: { [CARER_ID]: member('nanny') },
    });

    await expect(svc.remind(HELPER_ID, PROPOSAL_ID, now)).rejects.toThrow(
      'Terms proposal not found'
    );
  });

  it('a round that has already been answered cannot be nudged', async () => {
    const svc = service({
      proposalRepo: repoWith({ status: 'declined' }),
    });

    await expect(svc.remind(CARER_ID, PROPOSAL_ID, now)).rejects.toThrow(
      'That terms proposal can no longer be answered'
    );
  });
});

describe('TermsProposalCommandService.remind — the 48-hour rule', () => {
  it('refuses a round sent less than 48h ago, and sends nothing', async () => {
    const push = makePush();
    const reminderLog = makeReminderLog();
    const svc = service({
      proposalRepo: repoWith({ created_at: at(47) }),
      push,
      reminderLog,
    });

    await expect(svc.remind(CARER_ID, PROPOSAL_ID, now)).rejects.toThrow(
      'You can send one reminder every two days'
    );
    expect(push.notifyHouseholdParents).not.toHaveBeenCalled();
    expect(reminderLog.claim).not.toHaveBeenCalled();
  });

  it('refuses a second nudge inside 48h of the last one', async () => {
    const push = makePush();
    const reminderLog = makeReminderLog(at(47));
    const svc = service({ proposalRepo: repoWith({}), push, reminderLog });

    await expect(svc.remind(CARER_ID, PROPOSAL_ID, now)).rejects.toThrow(
      'You can send one reminder every two days'
    );
    expect(push.notifyHouseholdParents).not.toHaveBeenCalled();
    expect(reminderLog.claim).not.toHaveBeenCalled();
  });

  it('allows the next nudge once 48h have passed since the last one', async () => {
    const push = makePush();
    const svc = service({
      proposalRepo: repoWith({}),
      push,
      reminderLog: makeReminderLog(at(48)),
    });

    await expect(svc.remind(CARER_ID, PROPOSAL_ID, now)).resolves.toBeTruthy();
    expect(push.notifyHouseholdParents).toHaveBeenCalledTimes(1);
  });

  it('reads the ledger for THIS proposal only — one nudged round never mutes another', async () => {
    const reminderLog = makeReminderLog();
    const svc = service({ proposalRepo: repoWith({}), reminderLog });

    await svc.remind(CARER_ID, PROPOSAL_ID, now);

    const [userId, prefix] = reminderLog.findLastSentAt.mock.calls[0];
    expect(userId).toBe(CARER_ID);
    expect(prefix).toContain(PROPOSAL_ID);
  });

  it('records the nudge as a CONFIRMED ledger row — an unconfirmed claim is swept in 2h', async () => {
    const reminderLog = makeReminderLog();
    const svc = service({ proposalRepo: repoWith({}), reminderLog });

    await svc.remind(CARER_ID, PROPOSAL_ID, now);

    const [userId, key] = reminderLog.claim.mock.calls[0];
    expect(userId).toBe(CARER_ID);
    expect(key).toContain(PROPOSAL_ID);
    // The key carries the instant, so the ledger is an append-only history
    // rather than one row that has to be rewritten to move the clock on.
    expect(key).toContain(new Date(NOW).toISOString());
    expect(reminderLog.confirm).toHaveBeenCalledWith(CARER_ID, key);
  });
});

describe('TermsProposalCommandService.remind — who hears it', () => {
  it('a carer-authored round nudges the FAMILY, once, with no figure', async () => {
    const push = makePush();
    const svc = service({ proposalRepo: repoWith({}), push });

    await svc.remind(CARER_ID, PROPOSAL_ID, now);

    expect(push.notifyUser).not.toHaveBeenCalled();
    expect(push.notifyHouseholdParents).toHaveBeenCalledTimes(1);
    const [householdId, payload] = push.notifyHouseholdParents.mock.calls[0];
    expect(householdId).toBe(HOUSEHOLD_ID);
    expect(payload.data.type).toBe('terms_proposal_reminder');
    expect(payload.data.proposalId).toBe(PROPOSAL_ID);
    // A8 — her rate is the thing she is most afraid of leaking, and a lock
    // screen is a public surface.
    expect(`${payload.title} ${payload.body}`).not.toMatch(/\d|\$/);
  });

  it('a parent-authored round nudges the CARER, once, with no figure', async () => {
    const push = makePush();
    const svc = service({
      proposalRepo: repoWith({ direction: 'parent', proposed_by: PARENT_ID }),
      push,
    });

    await svc.remind(PARENT_ID, PROPOSAL_ID, now);

    expect(push.notifyHouseholdParents).not.toHaveBeenCalled();
    expect(push.notifyUser).toHaveBeenCalledTimes(1);
    const [userId, payload] = push.notifyUser.mock.calls[0];
    expect(userId).toBe(CARER_ID);
    expect(payload.data.type).toBe('terms_proposal_reminder');
    expect(`${payload.title} ${payload.body}`).not.toMatch(/\d|\$/);
  });

  it('never touches the proposal row — a nudge is not a lifecycle change', async () => {
    const proposalRepo = repoWith({});
    const svc = service({ proposalRepo });

    await svc.remind(CARER_ID, PROPOSAL_ID, now);

    expect(proposalRepo.resolve).not.toHaveBeenCalled();
    expect(proposalRepo.stampViewed).not.toHaveBeenCalled();
  });
});
