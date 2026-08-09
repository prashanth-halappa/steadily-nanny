/**
 * @module domains/inbox/__tests__/buildInboxItems.test
 *
 * Pure unit tests for the inbox aggregator — filters each pending-work
 * source into actionable rows the screen can render. Role + identity
 * gates keep parents from seeing weeks they queried and nannies from
 * seeing parent-only surfaces.
 */
import { describe, expect, it } from 'bun:test';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { buildInboxItems } from '../utils/buildInboxItems';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PARENT = '33333333-3333-4333-8333-333333333333';

describe('buildInboxItems', () => {
  it('returns an empty list when every source is empty', () => {
    expect(
      buildInboxItems({
        role: SETUP_ROLES.PARENT,
        currentUserId: ME,
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
          changeRequests: [],
          patterns: [],
          timesheets,
        })
      ).toEqual([]);
    }
  });
});
