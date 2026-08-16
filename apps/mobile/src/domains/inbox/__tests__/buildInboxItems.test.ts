/**
 * @module domains/inbox/__tests__/buildInboxItems.test
 *
 * Pure unit tests for the inbox aggregator — filters each pending-work
 * source into actionable rows the screen can render. Role + identity
 * gates keep parents from seeing weeks they queried and nannies from
 * seeing parent-only surfaces.
 */
import { describe, expect, it } from 'bun:test';
import type { PayArrangementAck } from '@steadily-nanny/shared-types/schemas/payArrangementAck.schema';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import {
  buildInboxItems,
  type InboxTermsAckInput,
  type InboxTermsProposalInput,
} from '../utils/buildInboxItems';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PARENT = '33333333-3333-4333-8333-333333333333';

describe('buildInboxItems', () => {
  it('returns an empty list when every source is empty', () => {
    expect(
      buildInboxItems({
        role: SETUP_ROLES.PARENT,
        currentUserId: ME,
        todayISO: '2026-08-25',
        changeRequests: [],
        patterns: [],
        timesheets: [],
      })
    ).toEqual([]);
  });

  it('includes pending change requests opened by someone else (awaiting my response)', () => {
    const items = buildInboxItems({
      role: SETUP_ROLES.NANNY,
      currentUserId: ME,
      todayISO: '2026-08-25',
      changeRequests: [
        {
          id: 'cr-1',
          shift_id: 'shift-1',
          requested_by: OTHER,
          kind: 'time_change',
          status: 'pending',
        },
        {
          id: 'cr-mine',
          shift_id: 'shift-2',
          requested_by: ME,
          kind: 'cancel',
          status: 'pending',
        },
        {
          id: 'cr-done',
          shift_id: 'shift-3',
          requested_by: OTHER,
          kind: 'time_change',
          status: 'accepted',
        },
      ],
      patterns: [],
      timesheets: [],
    });

    expect(items).toEqual([
      {
        kind: 'change_request',
        id: 'cr-1',
        shiftId: 'shift-1',
        requestKind: 'time_change',
      },
    ]);
  });

  it('includes pending schedule patterns addressed to me', () => {
    const items = buildInboxItems({
      role: SETUP_ROLES.NANNY,
      currentUserId: ME,
      todayISO: '2026-08-25',
      changeRequests: [],
      patterns: [
        {
          id: 'pat-1',
          carer_id: ME,
          status: 'pending',
          dtstart: '2026-08-05',
        },
        {
          id: 'pat-other',
          carer_id: OTHER,
          status: 'pending',
          dtstart: '2026-08-05',
        },
        {
          id: 'pat-draft',
          carer_id: ME,
          status: 'draft',
          dtstart: '2026-08-05',
        },
      ],
      timesheets: [],
    });

    expect(items).toEqual([
      {
        kind: 'pending_pattern',
        id: 'pat-1',
        patternId: 'pat-1',
        dtstart: '2026-08-05',
      },
    ]);
  });

  it('includes queried timesheet weeks only for the carer who must respond', () => {
    const timesheets = [
      {
        id: 'ts-1',
        carer_id: ME,
        week_start: '2026-07-28',
        status: 'queried',
        query_note: 'Break looks long',
      },
      {
        id: 'ts-other',
        carer_id: OTHER,
        week_start: '2026-07-28',
        status: 'queried',
        query_note: null,
      },
      {
        id: 'ts-ok',
        carer_id: ME,
        week_start: '2026-07-21',
        status: 'approved',
        query_note: null,
      },
    ] as const;

    expect(
      buildInboxItems({
        role: SETUP_ROLES.NANNY,
        currentUserId: ME,
        todayISO: '2026-08-25',
        changeRequests: [],
        patterns: [],
        timesheets,
      })
    ).toEqual([
      {
        kind: 'queried_week',
        id: 'ts-1',
        weekStart: '2026-07-28',
        queryNote: 'Break looks long',
      },
    ]);

    // Parent who raised the query must not see it as their own pending work.
    expect(
      buildInboxItems({
        role: SETUP_ROLES.PARENT,
        currentUserId: PARENT,
        todayISO: '2026-08-25',
        changeRequests: [],
        patterns: [],
        timesheets,
      })
    ).toEqual([]);
  });

  it('includes submitted weeks for parent/owner viewers, with carer info when available', () => {
    const timesheets = [
      {
        id: 'ts-sub-1',
        carer_id: OTHER,
        week_start: '2026-08-04',
        status: 'submitted',
        query_note: null,
        carer_display_name: 'Jamie Carer',
      },
      {
        id: 'ts-approved',
        carer_id: OTHER,
        week_start: '2026-07-28',
        status: 'approved',
        query_note: null,
        carer_display_name: 'Jamie Carer',
      },
      {
        id: 'ts-queried',
        carer_id: OTHER,
        week_start: '2026-07-21',
        status: 'queried',
        query_note: 'Break looks long',
        carer_display_name: 'Jamie Carer',
      },
    ] as const;

    expect(
      buildInboxItems({
        role: SETUP_ROLES.PARENT,
        currentUserId: ME,
        todayISO: '2026-08-25',
        changeRequests: [],
        patterns: [],
        timesheets,
      })
    ).toEqual([
      {
        kind: 'submitted_week',
        id: 'ts-sub-1',
        weekStart: '2026-08-04',
        carerDisplayName: 'Jamie Carer',
      },
    ]);
  });

  it('falls back to a null carer name when the row carries none', () => {
    const items = buildInboxItems({
      role: SETUP_ROLES.PARENT,
      currentUserId: ME,
      todayISO: '2026-08-25',
      changeRequests: [],
      patterns: [],
      timesheets: [
        {
          id: 'ts-sub-2',
          carer_id: OTHER,
          week_start: '2026-08-04',
          status: 'submitted',
          query_note: null,
        },
      ],
    });

    expect(items).toEqual([
      {
        kind: 'submitted_week',
        id: 'ts-sub-2',
        weekStart: '2026-08-04',
        carerDisplayName: null,
      },
    ]);
  });

  // D-46 / M13: her pay is late and she cannot move it herself. An inbox
  // item, never a push — a buzz about her employer's inaction is a nudge she
  // cannot act on. 14 days, not 3: `timesheet_awaiting_approval` starts
  // nudging the parent at 3, and telling her a week is late before that loop
  // has had a fair run manufactures a grievance out of a normal Friday.
  describe('stale_submitted_week (carer-side)', () => {
    const staleSheet = {
      id: 'ts-stale',
      carer_id: ME,
      week_start: '2026-08-04',
      status: 'submitted',
      query_note: null,
      total_minutes: 2310,
      // Both wire serialisations appear across these fixtures (GOLDEN #25).
      updated_at: '2026-08-04T18:00:00+00:00',
    } as const;

    it('surfaces a submitted week the carer sent more than 14 days ago', () => {
      expect(
        buildInboxItems({
          role: SETUP_ROLES.NANNY,
          currentUserId: ME,
          todayISO: '2026-08-25',
          changeRequests: [],
          patterns: [],
          timesheets: [staleSheet],
        })
      ).toEqual([
        {
          kind: 'stale_submitted_week',
          id: 'ts-stale',
          weekStart: '2026-08-04',
          daysAgo: 21,
          totalMinutes: 2310,
        },
      ]);
    });

    it('stays silent inside the 14-day window — a normal Friday is not late', () => {
      expect(
        buildInboxItems({
          role: SETUP_ROLES.NANNY,
          currentUserId: ME,
          todayISO: '2026-08-18',
          changeRequests: [],
          patterns: [],
          timesheets: [{ ...staleSheet, updated_at: '2026-08-04T18:00:00Z' }],
        })
      ).toEqual([]);
    });

    it('is the carer’s item only — the parent’s copy of this fact is submitted_week', () => {
      const items = buildInboxItems({
        role: SETUP_ROLES.PARENT,
        currentUserId: PARENT,
        todayISO: '2026-08-25',
        changeRequests: [],
        patterns: [],
        timesheets: [staleSheet],
      });

      expect(items.map(i => i.kind)).toEqual(['submitted_week']);
    });

    it('is another carer’s week, not hers, when the ids differ', () => {
      expect(
        buildInboxItems({
          role: SETUP_ROLES.NANNY,
          currentUserId: ME,
          todayISO: '2026-08-25',
          changeRequests: [],
          patterns: [],
          timesheets: [{ ...staleSheet, carer_id: OTHER }],
        })
      ).toEqual([]);
    });

    // Never an item with a blank or zero figure — the same discipline the
    // money rules apply to an unknown total.
    it('produces no item when the row carries no submission date or no hours', () => {
      const base = {
        role: SETUP_ROLES.NANNY,
        currentUserId: ME,
        todayISO: '2026-08-25',
        changeRequests: [],
        patterns: [],
      } as const;

      expect(
        buildInboxItems({
          ...base,
          timesheets: [{ ...staleSheet, updated_at: undefined }],
        })
      ).toEqual([]);
      expect(
        buildInboxItems({
          ...base,
          timesheets: [{ ...staleSheet, total_minutes: undefined }],
        })
      ).toEqual([]);
    });

    // The two items are the same week seen by two people, and neither
    // resolves in place — but a carer must still never see the parent's
    // "review and approve" row bounced back at her.
    it('gives the carer the stale item and never the parent’s submitted_week row', () => {
      const items = buildInboxItems({
        role: SETUP_ROLES.NANNY,
        currentUserId: ME,
        todayISO: '2026-08-25',
        changeRequests: [],
        patterns: [],
        timesheets: [staleSheet],
      });

      expect(items.map(i => i.kind)).toEqual(['stale_submitted_week']);
    });
  });

  it('never surfaces submitted weeks to carer/helper viewers', () => {
    const timesheets = [
      {
        id: 'ts-sub-1',
        carer_id: ME,
        week_start: '2026-08-04',
        status: 'submitted',
        query_note: null,
        carer_display_name: 'Me Carer',
      },
    ] as const;

    for (const role of [SETUP_ROLES.NANNY, SETUP_ROLES.HELPER] as const) {
      expect(
        buildInboxItems({
          role,
          currentUserId: ME,
          todayISO: '2026-08-25',
          changeRequests: [],
          patterns: [],
          timesheets,
        })
      ).toEqual([]);
    }
  });
});

// §2.2/§2.3a — cover-ask-awaiting-you and extra-shift-proposed are the same
// fact (a shift assigned to me, still pending) and the same inbox kind.
describe('buildInboxItems — pending_shift kind (§2.2, §2.3a)', () => {
  const NOW = '2026-08-25T12:00:00.000Z';
  const pendingShift = {
    id: 'shift-ask-1',
    carer_id: ME,
    status: 'pending',
    local_date: '2026-08-26',
    starts_at: '2026-08-26T08:00:00.000Z',
    ends_at: '2026-08-26T13:00:00.000Z',
    created_at: '2026-08-24T00:00:00.000Z',
    cover_ask_expires_at: '2026-08-27T18:00:00.000Z',
  } as const;

  it('includes a shift assigned to me that is still pending', () => {
    const items = buildInboxItems({
      role: SETUP_ROLES.NANNY,
      currentUserId: ME,
      todayISO: '2026-08-25',
      nowISO: NOW,
      changeRequests: [],
      patterns: [],
      timesheets: [],
      shifts: [pendingShift],
    });
    expect(items).toEqual([
      {
        kind: 'pending_shift',
        id: 'shift-ask-1',
        localDate: '2026-08-26',
        startsAt: '2026-08-26T08:00:00.000Z',
        endsAt: '2026-08-26T13:00:00.000Z',
        createdAt: '2026-08-24T00:00:00.000Z',
        coverAskExpiresAt: '2026-08-27T18:00:00.000Z',
      },
    ]);
  });

  it('excludes a shift assigned to someone else', () => {
    expect(
      buildInboxItems({
        role: SETUP_ROLES.NANNY,
        currentUserId: ME,
        todayISO: '2026-08-25',
        changeRequests: [],
        patterns: [],
        timesheets: [],
        shifts: [{ ...pendingShift, carer_id: OTHER }],
      })
    ).toEqual([]);
  });

  it('excludes a shift that is no longer pending', () => {
    expect(
      buildInboxItems({
        role: SETUP_ROLES.NANNY,
        currentUserId: ME,
        todayISO: '2026-08-25',
        changeRequests: [],
        patterns: [],
        timesheets: [],
        shifts: [{ ...pendingShift, status: 'confirmed' }],
      })
    ).toEqual([]);
  });

  // B5 — a helper is never a real carer_id match by data, but the guard is
  // explicit here (not left to fall-through) so a helper's coverage
  // attention item is excluded by construction, not by happenstance.
  it('B5: a helper never sees a pending_shift item, even if carer_id happens to match', () => {
    expect(
      buildInboxItems({
        role: SETUP_ROLES.HELPER,
        currentUserId: ME,
        todayISO: '2026-08-25',
        changeRequests: [],
        patterns: [],
        timesheets: [],
        shifts: [pendingShift],
      })
    ).toEqual([]);
  });

  it('ranks a pending_shift starting within 48h ahead of one further out (§2.2 ordering)', () => {
    const soon = {
      ...pendingShift,
      id: 'soon',
      starts_at: '2026-08-26T08:00:00.000Z',
    };
    const later = {
      ...pendingShift,
      id: 'later',
      starts_at: '2026-09-05T08:00:00.000Z',
      cover_ask_expires_at: '2026-09-04T18:00:00.000Z',
    };
    const items = buildInboxItems({
      role: SETUP_ROLES.NANNY,
      currentUserId: ME,
      todayISO: '2026-08-25',
      nowISO: NOW,
      changeRequests: [],
      patterns: [],
      timesheets: [],
      // Later-starting one listed FIRST in the input — the sort must reorder it.
      shifts: [later, soon],
    });
    expect(items.map(i => (i as { id: string }).id)).toEqual(['soon', 'later']);
  });

  it('ranks a pending_shift within 48h ahead of a queried week (§2.2 ordering)', () => {
    const items = buildInboxItems({
      role: SETUP_ROLES.NANNY,
      currentUserId: ME,
      todayISO: '2026-08-25',
      nowISO: NOW,
      changeRequests: [],
      patterns: [],
      timesheets: [
        {
          id: 'ts-q',
          carer_id: ME,
          week_start: '2026-08-18',
          status: 'queried',
          query_note: 'Thursday looks long',
        },
      ],
      shifts: [pendingShift],
    });
    expect(items.map(i => i.kind)).toEqual(['pending_shift', 'queried_week']);
  });
});

// §7.1 — a live proposal belongs to the side that must ANSWER it. The person
// who wrote it has nothing pending; showing it back to them would turn one
// negotiation into two rows about the same contract.
describe('buildInboxItems — terms_proposal kind (§7.1)', () => {
  const NOW = '2026-08-25T12:00:00.000Z';

  const carerProposal: InboxTermsProposalInput = {
    id: 'prop-1',
    household_id: 'hh-1',
    carer_id: ME,
    direction: 'carer',
    status: 'proposed',
    carer_display_name: 'Marisol',
    created_at: '2026-08-24T09:00:00.000Z',
    weekly_equivalent_minor: 154000,
    terms: { rate_minor: 2800, currency: 'USD' },
  };

  const parentCounter: InboxTermsProposalInput = {
    ...carerProposal,
    id: 'prop-2',
    direction: 'parent',
  };

  const base = {
    currentUserId: ME,
    todayISO: '2026-08-25',
    nowISO: NOW,
    changeRequests: [],
    patterns: [],
    timesheets: [],
  };

  it('gives a carer-authored proposal to the parent who must answer it', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.PARENT,
        termsProposals: [carerProposal],
      })
    ).toEqual([
      {
        kind: 'terms_proposal',
        id: 'prop-1',
        householdId: 'hh-1',
        carerDisplayName: 'Marisol',
        proposedAt: '2026-08-24T09:00:00.000Z',
        direction: 'carer',
        rateMinor: 2800,
        weeklyEquivalentMinor: 154000,
        currency: 'USD',
      },
    ]);
  });

  // The author still never gets the ANSWERABLE kind — there is nothing for
  // her to answer. A7 gives her the author's own kind instead; see the
  // `terms_proposal_sent` block below.
  it('never shows the answerable proposal to the person who wrote it', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.NANNY,
        termsProposals: [carerProposal],
      }).map(i => i.kind)
    ).not.toContain('terms_proposal');
  });

  it('gives a parent counter to the carer it answers', () => {
    const items = buildInboxItems({
      ...base,
      role: SETUP_ROLES.NANNY,
      termsProposals: [parentCounter],
    });
    expect(items.map(i => i.kind)).toEqual(['terms_proposal']);
    expect(items.map(i => (i as { id: string }).id)).toEqual(['prop-2']);
  });

  it('sorts at rank 4 relative to the author’s own rank-10 row', () => {
    const items = buildInboxItems({
      ...base,
      role: SETUP_ROLES.PARENT,
      termsProposals: [carerProposal, { ...parentCounter, carer_id: OTHER }],
    });
    expect(items.map(i => i.kind)).toEqual([
      'terms_proposal',
      'terms_proposal_sent',
    ]);
  });

  it('is another carer’s negotiation, not hers, when the carer ids differ (D-21)', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.NANNY,
        termsProposals: [{ ...parentCounter, carer_id: OTHER }],
      })
    ).toEqual([]);
  });

  // B5, the same explicit role check `pending_shift` uses: a helper cannot
  // accept terms (the API's WRITE_ROLES is {owner, parent}), so she is
  // excluded by construction rather than by never happening to match an id.
  it('B5: a helper never sees a terms_proposal item', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.HELPER,
        termsProposals: [carerProposal],
      })
    ).toEqual([]);
  });

  it('ignores proposals that are no longer awaiting an answer', () => {
    for (const status of ['countered', 'accepted', 'withdrawn']) {
      expect(
        buildInboxItems({
          ...base,
          role: SETUP_ROLES.PARENT,
          termsProposals: [{ ...carerProposal, status }],
        })
      ).toEqual([]);
    }
  });

  it('carries a missing weekly figure and a missing currency through as null, never invented', () => {
    const items = buildInboxItems({
      ...base,
      role: SETUP_ROLES.PARENT,
      termsProposals: [
        {
          ...carerProposal,
          weekly_equivalent_minor: null,
          terms: { rate_minor: 2800 },
        },
      ],
    });
    expect(items[0]).toMatchObject({
      weeklyEquivalentMinor: null,
      currency: null,
    });
  });

  // §2.2's table: rank 4, between a queried week (3) and a pending shift
  // that is not within 48h (5).
  it('sorts at rank 4 — after a queried week, before a far-off pending shift', () => {
    const items = buildInboxItems({
      ...base,
      role: SETUP_ROLES.NANNY,
      timesheets: [
        {
          id: 'ts-q',
          carer_id: ME,
          week_start: '2026-08-18',
          status: 'queried',
          query_note: null,
        },
      ],
      shifts: [
        {
          id: 'shift-far',
          carer_id: ME,
          status: 'pending',
          local_date: '2026-09-05',
          starts_at: '2026-09-05T08:00:00.000Z',
          ends_at: '2026-09-05T13:00:00.000Z',
          created_at: '2026-08-24T00:00:00.000Z',
        },
      ],
      termsProposals: [parentCounter],
    });

    expect(items.map(i => i.kind)).toEqual([
      'queried_week',
      'terms_proposal',
      'pending_shift',
    ]);
  });
});

// A7 — the AUTHOR's side of a live proposal. Until this kind existed, a
// parent who wrote the terms had no Today signal at all; his only trace was
// a settings row titled "Proposed terms from {carerName}", which names the
// wrong author. Under A1 that is a work stoppage the responsible party
// cannot see.
describe('buildInboxItems — terms_proposal_sent kind (A7)', () => {
  const NOW = '2026-08-25T12:00:00.000Z';

  const carerProposal: InboxTermsProposalInput = {
    id: 'prop-1',
    household_id: 'hh-1',
    carer_id: ME,
    direction: 'carer',
    status: 'proposed',
    carer_display_name: 'Marisol',
    created_at: '2026-08-24T09:00:00.000Z',
    weekly_equivalent_minor: 154000,
    terms: { rate_minor: 2800, currency: 'USD' },
    viewed_at: null,
  };
  const parentProposal: InboxTermsProposalInput = {
    ...carerProposal,
    id: 'prop-2',
    carer_id: OTHER,
    direction: 'parent',
    viewed_at: '2026-08-24T18:00:00.000Z',
  };

  const base = {
    currentUserId: ME,
    todayISO: '2026-08-25',
    nowISO: NOW,
    changeRequests: [],
    patterns: [],
    timesheets: [],
  };

  it('gives the parent who WROTE the terms his own row, carrying who and when', () => {
    const items = buildInboxItems({
      ...base,
      role: SETUP_ROLES.PARENT,
      termsProposals: [parentProposal],
    });

    expect(items).toEqual([
      {
        kind: 'terms_proposal_sent',
        id: 'prop-2',
        householdId: 'hh-1',
        carerId: OTHER,
        carerDisplayName: 'Marisol',
        proposedAt: '2026-08-24T09:00:00.000Z',
        viewedAt: '2026-08-24T18:00:00.000Z',
        direction: 'parent',
      },
    ]);
  });

  it('gives the carer who wrote hers the same row', () => {
    const items = buildInboxItems({
      ...base,
      role: SETUP_ROLES.NANNY,
      termsProposals: [carerProposal],
    });

    expect(items.map(i => i.kind)).toEqual(['terms_proposal_sent']);
    expect(items[0]).toMatchObject({ carerId: ME, viewedAt: null });
  });

  it('never gives the author’s row to the side that must answer', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.PARENT,
        termsProposals: [carerProposal],
      }).map(i => i.kind)
    ).toEqual(['terms_proposal']);
  });

  // D-21: a nanny must never see another carer's negotiation, authored or not.
  it('is not hers when the proposal names a different carer', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.NANNY,
        termsProposals: [{ ...carerProposal, carer_id: OTHER }],
      })
    ).toEqual([]);
  });

  it('B5: a helper never sees an author row either', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.HELPER,
        termsProposals: [parentProposal, carerProposal],
      })
    ).toEqual([]);
  });

  it('is a LIVE proposal only — a settled one is history, not pending work', () => {
    for (const status of ['countered', 'accepted', 'withdrawn', 'declined']) {
      expect(
        buildInboxItems({
          ...base,
          role: SETUP_ROLES.PARENT,
          termsProposals: [{ ...parentProposal, status }],
        })
      ).toEqual([]);
    }
  });

  // Rank 10 — last. It is the one row on the list that is waiting on somebody
  // ELSE, so it sits below even the ack prompt.
  it('sorts after terms_ack, at the bottom of the list', () => {
    const items = buildInboxItems({
      ...base,
      role: SETUP_ROLES.NANNY,
      termsProposals: [carerProposal],
      termsAcks: [
        {
          household_id: 'hh-1',
          arrangement_id: 'arr-1',
          valid_from: '2026-08-01',
          is_first_terms: true,
          acks: [],
        },
      ],
    });

    expect(items.map(i => i.kind)).toEqual([
      'terms_ack',
      'terms_proposal_sent',
    ]);
  });
});

// §2.2 rank 9 — nanny-only ack prompt surfaced as an inbox row, not its own card.
describe('buildInboxItems — terms_ack kind', () => {
  const ARRANGEMENT_ID = 'arr-1';
  const base = {
    currentUserId: ME,
    todayISO: '2026-08-25',
    changeRequests: [],
    patterns: [],
    timesheets: [],
    isPastMember: false,
  };

  function payAck(
    kind: PayArrangementAck['kind'],
    created_at: string
  ): PayArrangementAck {
    return {
      id: `ack-${kind}`,
      arrangement_id: ARRANGEMENT_ID,
      carer_id: ME,
      kind,
      note: null,
      created_at,
    };
  }

  const liveAck: InboxTermsAckInput = {
    household_id: 'hh-1',
    arrangement_id: ARRANGEMENT_ID,
    valid_from: '2026-08-01',
    is_first_terms: true,
    acks: [],
  };

  it('includes terms_ack for a nanny with a live arrangement and no ack yet', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.NANNY,
        termsAcks: [liveAck],
      })
    ).toEqual([
      {
        kind: 'terms_ack',
        id: ARRANGEMENT_ID,
        householdId: 'hh-1',
        validFrom: '2026-08-01',
        isFirstTerms: true,
      },
    ]);
  });

  it('excludes terms_ack once she has recorded seen', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.NANNY,
        termsAcks: [
          {
            ...liveAck,
            acks: [payAck('seen', '2026-08-02T10:00:00.000Z')],
          },
        ],
      })
    ).toEqual([]);
  });

  it('excludes terms_ack once she has disagreed', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.NANNY,
        termsAcks: [
          {
            ...liveAck,
            acks: [payAck('disagreed', '2026-08-02T10:00:00.000Z')],
          },
        ],
      })
    ).toEqual([]);
  });

  it('never shows terms_ack to a parent', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.PARENT,
        termsAcks: [liveAck],
      })
    ).toEqual([]);
  });

  it('never shows terms_ack to a past member', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.NANNY,
        isPastMember: true,
        termsAcks: [liveAck],
      })
    ).toEqual([]);
  });

  it('sorts terms_ack after stale_submitted_week (rank 9)', () => {
    const items = buildInboxItems({
      ...base,
      role: SETUP_ROLES.NANNY,
      timesheets: [
        {
          id: 'ts-stale',
          carer_id: ME,
          week_start: '2026-08-04',
          status: 'submitted',
          query_note: null,
          updated_at: '2026-08-01',
          total_minutes: 1200,
        },
      ],
      termsAcks: [liveAck],
    });

    expect(items.map(i => i.kind)).toEqual([
      'stale_submitted_week',
      'terms_ack',
    ]);
  });
});

// §2.2 rank 8 — parent-only unsettled reimbursement weeks, one row per carer-week.
describe('buildInboxItems — reimbursement_owed kind', () => {
  const base = {
    currentUserId: PARENT,
    todayISO: '2026-08-25',
    changeRequests: [],
    patterns: [],
    timesheets: [],
  };

  const unsettledWeek = {
    household_id: 'hh-1',
    carer_id: ME,
    week_start: '2026-08-17',
    amount_minor: 3480,
    currency: 'GBP',
  };

  it('includes one reimbursement_owed row per unsettled carer-week for a parent', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.PARENT,
        unsettledReimbursements: [unsettledWeek],
      })
    ).toEqual([
      {
        kind: 'reimbursement_owed',
        id: 'hh-1:11111111-1111-4111-8111-111111111111:2026-08-17',
        householdId: 'hh-1',
        weekStart: '2026-08-17',
        amountMinor: 3480,
        currency: 'GBP',
      },
    ]);
  });

  it('never shows reimbursement_owed to a nanny', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.NANNY,
        unsettledReimbursements: [unsettledWeek],
      })
    ).toEqual([]);
  });

  it('never shows reimbursement_owed to a helper', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.HELPER,
        unsettledReimbursements: [unsettledWeek],
      })
    ).toEqual([]);
  });

  it('omits weeks with nothing owed — never fabricates a zero', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.PARENT,
        unsettledReimbursements: [],
      })
    ).toEqual([]);
  });

  it('sorts reimbursement_owed after submitted_week (rank 8 vs 6)', () => {
    const items = buildInboxItems({
      ...base,
      role: SETUP_ROLES.PARENT,
      timesheets: [
        {
          id: 'ts-submitted',
          carer_id: ME,
          week_start: '2026-08-04',
          status: 'submitted',
          query_note: null,
        },
      ],
      unsettledReimbursements: [unsettledWeek],
    });

    expect(items.map(i => i.kind)).toEqual([
      'submitted_week',
      'reimbursement_owed',
    ]);
  });
});
