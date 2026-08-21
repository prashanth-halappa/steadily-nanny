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
          created_at: '2026-08-20T09:00:00.000Z',
        },
        {
          id: 'cr-mine',
          shift_id: 'shift-2',
          requested_by: ME,
          kind: 'cancel',
          status: 'pending',
          created_at: '2026-08-20T09:00:00.000Z',
        },
        {
          id: 'cr-done',
          shift_id: 'shift-3',
          requested_by: OTHER,
          kind: 'time_change',
          status: 'accepted',
          created_at: '2026-08-20T09:00:00.000Z',
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
        requestedAt: '2026-08-20T09:00:00.000Z',
        requesterName: null,
        shiftStartsAt: null,
      },
    ]);
  });

  it('excludes a pending change request raised by a since-deleted carer', () => {
    // Account deletion nulls `requested_by` (033-style ON DELETE SET NULL)
    // but does not resolve the request — with no null guard, `null === me`
    // is false for every remaining member, so the row sticks in every
    // household member's inbox forever with no counterparty left to answer
    // it.
    const items = buildInboxItems({
      role: SETUP_ROLES.NANNY,
      currentUserId: ME,
      todayISO: '2026-08-25',
      changeRequests: [
        {
          id: 'cr-orphaned',
          shift_id: 'shift-1',
          requested_by: null,
          kind: 'time_change',
          status: 'pending',
          created_at: '2026-08-20T09:00:00.000Z',
        },
      ],
      patterns: [],
      timesheets: [],
    });

    expect(items).toEqual([]);
  });

  // WP-H — a change_request item names who asked and when.
  it('resolves the requester name against the household member roster', () => {
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
          created_at: '2026-08-20T09:00:00.000Z',
        },
      ],
      patterns: [],
      timesheets: [],
      householdMembers: [
        {
          user_id: OTHER,
          display_name_override: null,
          profile_name: 'Dana Lee',
        },
      ],
    });

    expect(items[0]).toMatchObject({
      kind: 'change_request',
      requesterName: 'Dana Lee',
    });
  });

  it('names the shift start when the shift is already in scope (the viewer’s own me/shifts window)', () => {
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
          created_at: '2026-08-20T09:00:00.000Z',
        },
      ],
      patterns: [],
      timesheets: [],
      shifts: [
        {
          id: 'shift-1',
          household_id: 'hh-1',
          carer_id: ME,
          status: 'confirmed',
          local_date: '2026-08-26',
          starts_at: '2026-08-26T08:00:00.000Z',
          ends_at: '2026-08-26T13:00:00.000Z',
          created_at: '2026-08-19T00:00:00.000Z',
        },
      ],
    });

    expect(items[0]).toMatchObject({
      shiftStartsAt: '2026-08-26T08:00:00.000Z',
    });
  });

  it('sorts two change requests within the same rank by requestedAt, oldest first', () => {
    const items = buildInboxItems({
      role: SETUP_ROLES.NANNY,
      currentUserId: ME,
      todayISO: '2026-08-25',
      changeRequests: [
        {
          id: 'cr-newer',
          shift_id: 'shift-2',
          requested_by: OTHER,
          kind: 'time_change',
          status: 'pending',
          created_at: '2026-08-22T09:00:00.000Z',
        },
        {
          id: 'cr-older',
          shift_id: 'shift-1',
          requested_by: OTHER,
          kind: 'time_change',
          status: 'pending',
          created_at: '2026-08-18T09:00:00.000Z',
        },
      ],
      patterns: [],
      timesheets: [],
    });

    expect(items.map(i => i.id)).toEqual(['cr-older', 'cr-newer']);
  });

  it('names the household a queried week belongs to', () => {
    const items = buildInboxItems({
      role: SETUP_ROLES.NANNY,
      currentUserId: ME,
      todayISO: '2026-08-25',
      changeRequests: [],
      patterns: [],
      timesheets: [
        {
          household_id: 'hh-1',
          id: 'ts-1',
          carer_id: ME,
          week_start: '2026-07-28',
          status: 'queried',
          query_note: null,
        },
      ],
      households: [{ id: 'hh-1', name: 'The Ortiz Family' }],
    });

    expect(items[0]).toMatchObject({
      kind: 'queried_week',
      householdName: 'The Ortiz Family',
    });
  });

  it('includes pending schedule patterns addressed to me', () => {
    const items = buildInboxItems({
      role: SETUP_ROLES.NANNY,
      currentUserId: ME,
      todayISO: '2026-08-25',
      changeRequests: [],
      patterns: [
        {
          household_id: 'hh-1',
          id: 'pat-1',
          carer_id: ME,
          status: 'pending',
          dtstart: '2026-08-05',
        },
        {
          household_id: 'hh-1',
          id: 'pat-other',
          carer_id: OTHER,
          status: 'pending',
          dtstart: '2026-08-05',
        },
        {
          household_id: 'hh-1',
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
        householdId: 'hh-1',
        patternId: 'pat-1',
        dtstart: '2026-08-05',
      },
    ]);
  });

  it('includes queried timesheet weeks only for the carer who must respond', () => {
    const timesheets = [
      {
        household_id: 'hh-1',
        id: 'ts-1',
        carer_id: ME,
        week_start: '2026-07-28',
        status: 'queried',
        query_note: 'Break looks long',
      },
      {
        household_id: 'hh-1',
        id: 'ts-other',
        carer_id: OTHER,
        week_start: '2026-07-28',
        status: 'queried',
        query_note: null,
      },
      {
        household_id: 'hh-1',
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
        householdId: 'hh-1',
        weekStart: '2026-07-28',
        queryNote: 'Break looks long',
        householdName: null,
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
        household_id: 'hh-1',
        id: 'ts-sub-1',
        carer_id: OTHER,
        week_start: '2026-08-04',
        status: 'submitted',
        query_note: null,
        carer_display_name: 'Jamie Carer',
        total_minutes: 2310,
      },
      {
        household_id: 'hh-1',
        id: 'ts-approved',
        carer_id: OTHER,
        week_start: '2026-07-28',
        status: 'approved',
        query_note: null,
        carer_display_name: 'Jamie Carer',
      },
      {
        household_id: 'hh-1',
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
        householdId: 'hh-1',
        weekStart: '2026-08-04',
        carerDisplayName: 'Jamie Carer',
        personName: 'Jamie Carer',
        totalMinutes: 2310,
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
          household_id: 'hh-1',
          id: 'ts-sub-2',
          carer_id: OTHER,
          week_start: '2026-08-04',
          status: 'submitted',
          query_note: null,
          total_minutes: 1200,
        },
      ],
    });

    expect(items).toEqual([
      {
        kind: 'submitted_week',
        id: 'ts-sub-2',
        householdId: 'hh-1',
        weekStart: '2026-08-04',
        carerDisplayName: null,
        totalMinutes: 1200,
      },
    ]);
  });

  it('carries totalMinutes from the sheet row onto submitted_week (same as stale_submitted_week)', () => {
    const [item] = buildInboxItems({
      role: SETUP_ROLES.PARENT,
      currentUserId: ME,
      todayISO: '2026-08-25',
      changeRequests: [],
      patterns: [],
      timesheets: [
        {
          household_id: 'hh-1',
          id: 'ts-sub-hours',
          carer_id: OTHER,
          week_start: '2026-01-04',
          status: 'submitted',
          query_note: null,
          carer_display_name: 'Jamie Carer',
          total_minutes: 2310,
        },
      ],
    });
    expect(item).toMatchObject({
      kind: 'submitted_week',
      totalMinutes: 2310,
    });
  });

  // D-46 / M13: her pay is late and she cannot move it herself. An inbox
  // item, never a push — a buzz about her employer's inaction is a nudge she
  // cannot act on. 14 days, not 3: `timesheet_awaiting_approval` starts
  // nudging the parent at 3, and telling her a week is late before that loop
  // has had a fair run manufactures a grievance out of a normal Friday.
  describe('stale_submitted_week (carer-side)', () => {
    const staleSheet = {
      id: 'ts-stale',
      household_id: 'hh-1',
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
          householdId: 'hh-1',
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
        household_id: 'hh-1',
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
    household_id: 'hh-1',
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
        householdId: 'hh-1',
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
          household_id: 'hh-1',
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

describe('buildInboxItems — cross_family_clash kind (S4b)', () => {
  const clashedShift = {
    id: 'shift-clash-1',
    household_id: 'hh-1',
    carer_id: ME,
    status: 'confirmed',
    local_date: '2026-08-26',
    starts_at: '2026-08-26T08:00:00.000Z',
    ends_at: '2026-08-26T13:00:00.000Z',
    created_at: '2026-08-24T00:00:00.000Z',
    clashes_with_other_household: true,
  } as const;

  it('surfaces a nanny-side shift flagged clashes_with_other_household', () => {
    const items = buildInboxItems({
      role: SETUP_ROLES.NANNY,
      currentUserId: ME,
      todayISO: '2026-08-25',
      changeRequests: [],
      patterns: [],
      timesheets: [],
      shifts: [clashedShift],
    });
    expect(items).toEqual([
      {
        kind: 'cross_family_clash',
        id: 'shift-clash-1',
        shiftId: 'shift-clash-1',
        householdId: 'hh-1',
        startsAt: '2026-08-26T08:00:00.000Z',
      },
    ]);
  });

  it('excludes a shift with no clash flag', () => {
    expect(
      buildInboxItems({
        role: SETUP_ROLES.NANNY,
        currentUserId: ME,
        todayISO: '2026-08-25',
        changeRequests: [],
        patterns: [],
        timesheets: [],
        shifts: [{ ...clashedShift, clashes_with_other_household: false }],
      })
    ).toEqual([]);
  });

  it('excludes a flagged shift when the flag is simply absent (legacy response)', () => {
    const { clashes_with_other_household: _drop, ...withoutFlag } =
      clashedShift;
    expect(
      buildInboxItems({
        role: SETUP_ROLES.NANNY,
        currentUserId: ME,
        todayISO: '2026-08-25',
        changeRequests: [],
        patterns: [],
        timesheets: [],
        shifts: [withoutFlag],
      })
    ).toEqual([]);
  });

  it('is nanny-only, mirroring pending_shift (B5)', () => {
    expect(
      buildInboxItems({
        role: SETUP_ROLES.PARENT,
        currentUserId: ME,
        todayISO: '2026-08-25',
        changeRequests: [],
        patterns: [],
        timesheets: [],
        shifts: [clashedShift],
      })
    ).toEqual([]);
  });

  it('excludes a flagged shift assigned to someone else', () => {
    expect(
      buildInboxItems({
        role: SETUP_ROLES.NANNY,
        currentUserId: ME,
        todayISO: '2026-08-25',
        changeRequests: [],
        patterns: [],
        timesheets: [],
        shifts: [{ ...clashedShift, carer_id: OTHER }],
      })
    ).toEqual([]);
  });

  it('ranks after every other kind — advisory, not blocking her own action', () => {
    const items = buildInboxItems({
      role: SETUP_ROLES.NANNY,
      currentUserId: ME,
      todayISO: '2026-08-25',
      changeRequests: [],
      patterns: [],
      timesheets: [
        {
          household_id: 'hh-1',
          id: 'ts-q',
          carer_id: ME,
          week_start: '2026-08-18',
          status: 'queried',
          query_note: null,
        },
      ],
      shifts: [clashedShift],
    });
    expect(items.map(i => i.kind)).toEqual([
      'queried_week',
      'cross_family_clash',
    ]);
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
        personName: 'Marisol',
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
          household_id: 'hh-1',
          id: 'ts-q',
          carer_id: ME,
          week_start: '2026-08-18',
          status: 'queried',
          query_note: null,
        },
      ],
      shifts: [
        {
          household_id: 'hh-1',
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
        personName: 'Marisol',
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
      // `declined` gets the author its OWN kind (D66) rather than nothing at
      // all, so this asserts the absence of the LIVE row, not an empty list.
      expect(
        buildInboxItems({
          ...base,
          role: SETUP_ROLES.PARENT,
          termsProposals: [{ ...parentProposal, status }],
        }).map(i => i.kind)
      ).not.toContain('terms_proposal_sent');
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
          direction: null,
        },
      ],
    });

    expect(items.map(i => i.kind)).toEqual([
      'terms_ack',
      'terms_proposal_sent',
    ]);
  });
});

// D66 — the AUTHOR's record of a refusal. Before this kind existed the
// decline was pure silence for the person who proposed: the push is
// fire-and-forget (nothing is written to the database), and her own
// `terms_proposal_sent` row simply vanished from the list, leaving a blank
// pay form as if she had never asked.
describe('buildInboxItems — terms_proposal_declined kind (D66)', () => {
  const NOW = '2026-08-27T12:00:00.000Z';

  // Parent-authored, refused by the nanny — the parent is the author.
  const declinedByCarer: InboxTermsProposalInput = {
    id: 'prop-1',
    household_id: 'hh-1',
    carer_id: OTHER,
    direction: 'parent',
    status: 'declined',
    carer_display_name: 'Marisol',
    created_at: '2026-08-24T09:00:00.000Z',
    responded_at: '2026-08-26T15:00:00.000Z',
    weekly_equivalent_minor: 154000,
    terms: { rate_minor: 2800, currency: 'USD' },
  };

  // Carer-authored, refused by the family — the nanny is the author.
  const declinedByFamily: InboxTermsProposalInput = {
    ...declinedByCarer,
    id: 'prop-2',
    carer_id: ME,
    direction: 'carer',
  };

  const base = {
    currentUserId: ME,
    todayISO: '2026-08-27',
    nowISO: NOW,
    changeRequests: [],
    patterns: [],
    timesheets: [],
  };

  it('gives the parent who wrote the terms a durable record that they were declined', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.PARENT,
        termsProposals: [declinedByCarer],
      })
    ).toEqual([
      {
        kind: 'terms_proposal_declined',
        id: 'prop-1',
        householdId: 'hh-1',
        carerId: OTHER,
        carerDisplayName: 'Marisol',
        personName: 'Marisol',
        proposedAt: '2026-08-24T09:00:00.000Z',
        declinedAt: '2026-08-26T15:00:00.000Z',
        direction: 'parent',
      },
    ]);
  });

  it('gives the carer who wrote hers the same record when the family refused', () => {
    const items = buildInboxItems({
      ...base,
      role: SETUP_ROLES.NANNY,
      termsProposals: [declinedByFamily],
    });
    expect(items.map(i => i.kind)).toEqual(['terms_proposal_declined']);
    expect(items[0]).toMatchObject({ carerId: ME, direction: 'carer' });
  });

  // Self-clearing, and that is the whole dismiss story: sending the next
  // round IS the acknowledgement, so there is no dismiss state to store.
  it('says nothing once a newer round exists for that carer', () => {
    for (const status of ['proposed', 'countered', 'accepted']) {
      const items = buildInboxItems({
        ...base,
        role: SETUP_ROLES.PARENT,
        termsProposals: [
          declinedByCarer,
          {
            ...declinedByCarer,
            id: 'prop-newer',
            status,
            created_at: '2026-08-27T09:00:00.000Z',
          },
        ],
      });
      expect(items.map(i => i.kind)).not.toContain('terms_proposal_declined');
    }
  });

  // Two declined rounds in a row: the record is about the LATEST refusal,
  // never a stack of every round the negotiation ever lost.
  it('keeps only the newest refusal when an earlier round was also declined', () => {
    const items = buildInboxItems({
      ...base,
      role: SETUP_ROLES.PARENT,
      termsProposals: [
        declinedByCarer,
        {
          ...declinedByCarer,
          id: 'prop-newer',
          created_at: '2026-08-27T09:00:00.000Z',
          responded_at: '2026-08-27T10:00:00.000Z',
        },
      ],
    });
    expect(items.map(i => i.kind)).toEqual(['terms_proposal_declined']);
    expect(items[0]).toMatchObject({ id: 'prop-newer' });
  });

  // A newer round for a DIFFERENT carer supersedes nothing — two nannies in
  // one household are two independent negotiations (D-21).
  it('is not superseded by a newer round for another carer', () => {
    const items = buildInboxItems({
      ...base,
      role: SETUP_ROLES.PARENT,
      termsProposals: [
        declinedByCarer,
        {
          ...declinedByCarer,
          id: 'prop-other-carer',
          carer_id: PARENT,
          status: 'proposed',
          created_at: '2026-08-27T09:00:00.000Z',
        },
      ],
    });
    expect(items.map(i => i.kind)).toContain('terms_proposal_declined');
  });

  it('never shows the record to the side that did the declining', () => {
    // The nanny refused the parent's terms — she has no record to keep.
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.NANNY,
        currentUserId: OTHER,
        termsProposals: [declinedByCarer],
      })
    ).toEqual([]);
    // And the family that refused hers sees nothing either.
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.PARENT,
        termsProposals: [declinedByFamily],
      })
    ).toEqual([]);
  });

  // D-21, same gate as every other row in this domain.
  it('is not hers when the declined round names a different carer', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.NANNY,
        termsProposals: [{ ...declinedByFamily, carer_id: OTHER }],
      })
    ).toEqual([]);
  });

  it('B5: a helper never sees a declined record — she authors nothing', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.HELPER,
        termsProposals: [declinedByCarer, declinedByFamily],
      })
    ).toEqual([]);
  });

  // No `responded_at` on the row (a legacy pre-097 decline) still dates the
  // record — the day it was sent, never an invented one.
  it('falls back to the sent date when the row carries no responded_at', () => {
    const items = buildInboxItems({
      ...base,
      role: SETUP_ROLES.PARENT,
      termsProposals: [{ ...declinedByCarer, responded_at: null }],
    });
    expect(items[0]).toMatchObject({ declinedAt: '2026-08-24T09:00:00.000Z' });
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
    direction: null,
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
        direction: null,
      },
    ]);
  });

  it('threads agreement direction onto the terms_ack item', () => {
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.NANNY,
        termsAcks: [{ ...liveAck, direction: 'carer' }],
      })[0]
    ).toMatchObject({ kind: 'terms_ack', direction: 'carer' });
    expect(
      buildInboxItems({
        ...base,
        role: SETUP_ROLES.NANNY,
        termsAcks: [{ ...liveAck, direction: 'parent' }],
      })[0]
    ).toMatchObject({ kind: 'terms_ack', direction: 'parent' });
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
          household_id: 'hh-1',
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
    carer_display_name: 'Marisol Reyes',
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
          household_id: 'hh-1',
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

// The attention surfaces name a person in copy but showed nobody. These
// three kinds already know who in their source data; the rest do not.
describe('buildInboxItems — person on the item', () => {
  const NOW = '2026-08-25T12:00:00.000Z';
  const base = {
    currentUserId: ME,
    todayISO: '2026-08-25',
    nowISO: NOW,
    changeRequests: [] as const,
    patterns: [] as const,
    timesheets: [] as const,
  };

  it('carries the person name on submitted_week, terms_proposal and terms_proposal_sent items', () => {
    const submitted = buildInboxItems({
      ...base,
      role: SETUP_ROLES.PARENT,
      timesheets: [
        {
          household_id: 'hh-1',
          id: 'ts-sub-1',
          carer_id: OTHER,
          week_start: '2026-08-04',
          status: 'submitted',
          query_note: null,
          carer_display_name: 'Jamie Carer',
        },
      ],
    });
    expect(submitted[0]).toMatchObject({
      kind: 'submitted_week',
      personName: 'Jamie Carer',
    });

    const proposal: InboxTermsProposalInput = {
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
    const answerable = buildInboxItems({
      ...base,
      role: SETUP_ROLES.PARENT,
      termsProposals: [proposal],
    });
    expect(answerable[0]).toMatchObject({
      kind: 'terms_proposal',
      personName: 'Marisol',
    });

    const sent = buildInboxItems({
      ...base,
      role: SETUP_ROLES.PARENT,
      termsProposals: [
        { ...proposal, id: 'prop-2', carer_id: OTHER, direction: 'parent' },
      ],
    });
    expect(sent[0]).toMatchObject({
      kind: 'terms_proposal_sent',
      personName: 'Marisol',
    });
  });

  it('leaves the person absent on kinds that concern nobody in particular', () => {
    const items = buildInboxItems({
      ...base,
      role: SETUP_ROLES.NANNY,
      changeRequests: [
        {
          id: 'cr-1',
          shift_id: 'shift-1',
          requested_by: OTHER,
          kind: 'time_change',
          status: 'pending',
          created_at: '2026-08-20T09:00:00.000Z',
        },
      ],
      patterns: [
        {
          household_id: 'hh-1',
          id: 'pat-1',
          carer_id: ME,
          status: 'pending',
          dtstart: '2026-08-05',
        },
      ],
      timesheets: [
        {
          household_id: 'hh-1',
          id: 'ts-q',
          carer_id: ME,
          week_start: '2026-07-28',
          status: 'queried',
          query_note: null,
        },
        {
          household_id: 'hh-1',
          id: 'ts-stale',
          carer_id: ME,
          week_start: '2026-08-04',
          status: 'submitted',
          query_note: null,
          total_minutes: 2310,
          updated_at: '2026-08-04T18:00:00+00:00',
        },
      ],
      shifts: [
        {
          household_id: 'hh-1',
          id: 'shift-ask-1',
          carer_id: ME,
          status: 'pending',
          local_date: '2026-08-26',
          starts_at: '2026-08-26T08:00:00.000Z',
          ends_at: '2026-08-26T13:00:00.000Z',
          created_at: '2026-08-24T00:00:00.000Z',
        },
      ],
      termsAcks: [
        {
          household_id: 'hh-1',
          arrangement_id: 'arr-1',
          valid_from: '2026-08-01',
          is_first_terms: true,
          acks: [],
          direction: null,
        },
      ],
    });

    const parentItems = buildInboxItems({
      ...base,
      role: SETUP_ROLES.PARENT,
      currentUserId: PARENT,
      timesheets: [
        {
          household_id: 'hh-1',
          id: 'ts-sub-2',
          carer_id: OTHER,
          week_start: '2026-08-04',
          status: 'submitted',
          query_note: null,
        },
      ],
      unsettledReimbursements: [
        {
          household_id: 'hh-1',
          carer_id: ME,
          carer_display_name: 'Marisol Reyes',
          week_start: '2026-08-17',
          amount_minor: 3480,
          currency: 'GBP',
        },
      ],
    });

    for (const item of [...items, ...parentItems]) {
      expect(item).not.toHaveProperty('personName');
    }
  });
});

// D77 — a nanny books time off and the family's only signal was a push into
// a screen two levels down in Settings. Parent-side, informational: there is
// no approve/decline endpoint anywhere, so this row can never be answered in
// place, only re-planned around.
describe('buildInboxItems — carer_time_off kind (D77)', () => {
  const NOW = '2026-08-25T12:00:00.000Z';

  const timeOffRow = {
    id: 'to-1',
    household_id: 'hh-1',
    user_id: OTHER,
    starts_at: '2026-08-27T00:00:00.000Z',
    ends_at: '2026-08-29T23:59:00.000Z',
    kind: 'personal',
    status: 'confirmed',
  } as const;

  type BuildInput = Parameters<typeof buildInboxItems>[0];

  function build(overrides: Partial<BuildInput> = {}) {
    return buildInboxItems({
      role: SETUP_ROLES.PARENT,
      currentUserId: PARENT,
      todayISO: '2026-08-25',
      nowISO: NOW,
      changeRequests: [],
      patterns: [],
      timesheets: [],
      timeOff: [timeOffRow],
      ...overrides,
    });
  }

  it('surfaces a confirmed future absence to a parent, named from the roster', () => {
    expect(
      build({
        householdMembers: [
          {
            user_id: OTHER,
            display_name_override: null,
            profile_name: 'Marisol',
          },
        ],
      })
    ).toEqual([
      {
        kind: 'carer_time_off',
        id: 'to-1',
        householdId: 'hh-1',
        carerDisplayName: 'Marisol',
        startsAt: '2026-08-27T00:00:00.000Z',
        endsAt: '2026-08-29T23:59:00.000Z',
        timeOffKind: 'personal',
      },
    ]);
  });

  it('leaves the name null when the roster cannot name her — never a blank', () => {
    const items = build();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'carer_time_off',
      carerDisplayName: null,
    });
  });

  it('is never shown to a nanny — her own absence waits on nobody', () => {
    expect(build({ role: SETUP_ROLES.NANNY, currentUserId: OTHER })).toEqual(
      []
    );
  });

  it('excludes a cancelled absence', () => {
    expect(
      build({ timeOff: [{ ...timeOffRow, status: 'cancelled' }] })
    ).toEqual([]);
  });

  it('excludes an absence that has already ended', () => {
    expect(
      build({
        timeOff: [
          {
            ...timeOffRow,
            starts_at: '2026-08-10T00:00:00.000Z',
            ends_at: '2026-08-12T23:59:00.000Z',
          },
        ],
      })
    ).toEqual([]);
  });

  it('keeps an absence that started but has not finished', () => {
    const items = build({
      timeOff: [
        {
          ...timeOffRow,
          starts_at: '2026-08-24T00:00:00.000Z',
          ends_at: '2026-08-26T23:59:00.000Z',
        },
      ],
    });
    expect(items.map(i => i.kind)).toEqual(['carer_time_off']);
  });

  it('sorts between a change request and a queried week (rank 2.5)', () => {
    const items = build({
      role: SETUP_ROLES.PARENT,
      currentUserId: ME,
      changeRequests: [
        {
          id: 'cr-1',
          shift_id: 'shift-1',
          requested_by: OTHER,
          kind: 'time_change',
          status: 'pending',
          created_at: '2026-08-20T09:00:00.000Z',
        },
      ],
      timesheets: [
        {
          id: 'ts-q',
          household_id: 'hh-1',
          carer_id: ME,
          week_start: '2026-08-18',
          status: 'queried',
          query_note: null,
        },
      ],
    });
    expect(items.map(i => i.kind)).toEqual([
      'change_request',
      'carer_time_off',
      'queried_week',
    ]);
  });

  it('orders two absences soonest-first', () => {
    const items = build({
      timeOff: [
        {
          ...timeOffRow,
          id: 'to-later',
          starts_at: '2026-09-10T00:00:00.000Z',
          ends_at: '2026-09-12T00:00:00.000Z',
        },
        timeOffRow,
      ],
    });
    expect(items.map(i => i.id)).toEqual(['to-1', 'to-later']);
  });
});
