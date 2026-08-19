/**
 * §6.2 — the public terms page's data source.
 *
 * THE 404 TABLE IS THE CONTRACT. The page is live for exactly one window and
 * then it is gone, and every refusal is the SAME opaque error a missing code
 * gets, because naming the reason confirms the code was real (the convention
 * `previewInvite`'s header protects, §17). The rows below are §6.2's table,
 * one test each.
 *
 * Two of them are load-bearing beyond correctness: the redemption row and the
 * link-window row are two of Marisol's three standing conditions for her RATE
 * being on that page at all (D-51). If either stops holding, the rate comes
 * off the page and the owner decision re-opens.
 */
import { describe, expect, it, mock } from 'bun:test';
import { InviteNotFoundError } from '../../../../../src/domains/household/errors/householdErrors';
import { HouseholdQueryService } from '../../../../../src/domains/household/services/householdQueryService';
import type {
  Household,
  HouseholdInvite,
} from '../../../../../src/domains/household/types';

const CODE = 'R4K-92T';
const CARER_ID = 'u-nanny';
const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE_CREATED_AT = new Date(Date.now() - 2 * DAY_MS).toISOString();

const draft: Household = {
  id: 'h-draft',
  name: null,
  timezone: 'America/Chicago',
  address_line: null,
  latitude: null,
  longitude: null,
  approval_mode: 'either',
  approval_scope: 'short_notice_and_cancellations',
  short_notice_hours: 24,
  cancellation_paid_within_hours: 24,
  currency: 'USD',
  jurisdiction: null,
  week_starts_on: 1,
  country: 'US',
  state: 'draft',
  created_by: CARER_ID,
  created_at: FIXTURE_CREATED_AT,
  updated_at: FIXTURE_CREATED_AT,
};

function invite(overrides: Partial<HouseholdInvite> = {}): HouseholdInvite {
  return {
    id: 'i1',
    household_id: 'h-draft',
    code: CODE,
    email: null,
    role: 'parent',
    invited_by: CARER_ID,
    expires_at: '2999-01-01T00:00:00Z',
    status: 'pending',
    accepted_by: null,
    accepted_at: null,
    link_expires_at: '2999-01-01T00:00:00Z',
    opened_at: null,
    label: 'The Bakers',
    pay_offer: null,
    pay_offer_promotion: null,
    created_at: FIXTURE_CREATED_AT,
    updated_at: FIXTURE_CREATED_AT,
    ...overrides,
  };
}

const proposal = {
  id: 'p1',
  household_id: 'h-draft',
  carer_id: CARER_ID,
  proposed_by: CARER_ID,
  direction: 'carer',
  status: 'proposed',
  terms: { rate_minor: 2800, currency: 'USD' },
  note: null,
  supersedes_id: null,
  from_invite_id: null,
  carer_display_name: 'Marisol Mendez',
  viewed_at: null,
  responded_at: null,
  accepted_by: null,
  accepted_arrangement_id: null,
  responsibility_confirmed: false,
  created_at: FIXTURE_CREATED_AT,
  updated_at: FIXTURE_CREATED_AT,
};

function makeService(parts: {
  invite?: HouseholdInvite | null;
  household?: Household | null;
  proposal?: unknown;
}): HouseholdQueryService {
  const inviteRepo: any = {
    findByCode: mock(async () =>
      parts.invite === undefined ? invite() : parts.invite
    ),
  };
  const householdRepo: any = {
    findById: mock(async () =>
      parts.household === undefined ? draft : parts.household
    ),
    listActiveChildFirstNames: mock(async () => []),
  };
  const proposalRepo: any = {
    findOpenForCarer: mock(async () =>
      parts.proposal === undefined ? proposal : parts.proposal
    ),
  };
  return new HouseholdQueryService(
    householdRepo,
    { findActiveMembership: mock(async () => null) } as any,
    inviteRepo,
    { listForHousehold: mock(async () => []) } as any,
    proposalRepo
  );
}

describe('householdQueryService.termsPreview — the happy path', () => {
  it('returns her first name and last INITIAL, never her surname', async () => {
    const preview = await makeService({}).termsPreview(CODE);

    expect(preview.carer_name).toBe('Marisol M.');
  });

  it('carries the code, the proposal and the window the page prints', async () => {
    const preview = await makeService({}).termsPreview(CODE);

    expect(preview).toMatchObject({
      code: CODE,
      currency: 'USD',
      link_expires_at: '2999-01-01T00:00:00Z',
      proposed_at: FIXTURE_CREATED_AT,
    });
    expect(preview.proposal.id).toBe('p1');
  });

  it('never carries her private recipient label or the children', async () => {
    const preview = await makeService({}).termsPreview(CODE);

    // "The Bakers" is hers alone (§6.1) — never on the public page, never
    // shown to the recipient — and the children never travel at all.
    expect(JSON.stringify(preview)).not.toContain('The Bakers');
    expect(Object.keys(preview)).not.toContain('children_first_names');
    // Her SURNAME is stripped at the wire edge rather than here: this is the
    // raw proposal row on its way to the controller, and the wire shape it
    // becomes is pinned in `routes/publicInviteRoutes.test.ts`.
  });
});

describe('householdQueryService.termsPreview — §6.2 404 table', () => {
  const cases: [string, Parameters<typeof makeService>[0]][] = [
    ['no such code', { invite: null }],
    // Row 1, the most important one: once the family joins, the terms live in
    // the app under D-21's carer-scoped reads. A public copy of her rate after
    // the private one exists is the whole exposure with none of the benefit.
    [
      'redeemed the instant it happens',
      { invite: invite({ status: 'accepted' }) },
    ],
    ['revoked from the row menu', { invite: invite({ status: 'revoked' }) }],
    [
      'past the code’s own 30 days',
      { invite: invite({ expires_at: '2020-01-01T00:00:00Z' }) },
    ],
    [
      'past the link window, while the code still redeems',
      { invite: invite({ link_expires_at: '2020-01-01T00:00:00Z' }) },
    ],
    [
      'an invite minted before the link window existed',
      { invite: invite({ link_expires_at: null }) },
    ],
    ['not a nanny-authored invite', { household: { ...draft, state: 'live' } }],
    ['a household that has gone', { household: null }],
    ['a draft with no terms to show', { proposal: null }],
  ];

  it.each(cases)('404s on %s', async (_name, parts) => {
    await expect(makeService(parts).termsPreview(CODE)).rejects.toBeInstanceOf(
      InviteNotFoundError
    );
  });

  it('gives the SAME error for every one of them, metadata included', async () => {
    // Not just the message: `BaseError` serialises `metadata` to the client on
    // a 4xx, so an error carrying WHICH row fired would disclose it as surely
    // as a different message would. Which row fired goes to the log.
    const serialised = await Promise.all(
      cases.map(([, parts]) =>
        makeService(parts)
          .termsPreview(CODE)
          .catch((error: any) =>
            JSON.stringify(error.toClientJSON?.() ?? error.message)
          )
      )
    );

    expect(new Set(serialised).size).toBe(1);
  });
});
