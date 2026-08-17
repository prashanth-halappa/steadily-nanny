/**
 * @module domains/today/__tests__/crossFamilyAlerts.test
 *
 * P5 (A2). The strip's entire value is scarcity — these pin the three
 * qualifying rules exactly, that ordinary cross-household inbox noise never
 * qualifies, and that the ACTIVE household's own facts never appear (they
 * belong to this household's own Today, not the strip).
 */
import { describe, expect, it } from 'bun:test';
import type { InboxItem } from '@/src/domains/inbox/utils/buildInboxItems';
import { resolveCrossFamilyAlerts } from '../utils/crossFamilyAlerts';

const ACTIVE_ID = 'household-active';
const OTHER_A = 'household-wilson';
const OTHER_B = 'household-okafor';
const NOW = '2026-08-16T12:00:00.000Z';
const TODAY = '2026-08-16';

const HOUSEHOLDS = [
  { id: ACTIVE_ID, name: 'The Grants' },
  { id: OTHER_A, name: 'Wilson family' },
  { id: OTHER_B, name: 'Okafor family' },
];

function termsProposalItem(householdId: string): InboxItem {
  return {
    kind: 'terms_proposal',
    id: `proposal-${householdId}`,
    householdId,
    carerDisplayName: 'Test Carer',
    proposedAt: '2026-08-10T09:00:00.000Z',
    direction: 'parent',
    rateMinor: 1800,
    weeklyEquivalentMinor: null,
    currency: 'USD',
  };
}

function baseArgs(
  overrides: Partial<Parameters<typeof resolveCrossFamilyAlerts>[0]> = {}
) {
  return {
    items: [] as InboxItem[],
    runningEntry: null,
    activeHouseholdId: ACTIVE_ID,
    households: HOUSEHOLDS,
    meShifts: [],
    todayLocalDateFor: () => TODAY,
    nowISO: NOW,
    ...overrides,
  };
}

describe('resolveCrossFamilyAlerts — running clock', () => {
  it('qualifies a running time entry in another household', () => {
    const alerts = resolveCrossFamilyAlerts(
      baseArgs({
        runningEntry: {
          household_id: OTHER_A,
          clock_in_at: '2026-08-16T08:14:00.000Z',
        },
      })
    );
    expect(alerts).toEqual([
      {
        householdId: OTHER_A,
        familyName: 'Wilson family',
        kind: 'runningClock',
        since: '2026-08-16T08:14:00.000Z',
      },
    ]);
  });

  it('never surfaces the ACTIVE household’s own running clock', () => {
    const alerts = resolveCrossFamilyAlerts(
      baseArgs({
        runningEntry: {
          household_id: ACTIVE_ID,
          clock_in_at: '2026-08-16T08:14:00.000Z',
        },
      })
    );
    expect(alerts).toEqual([]);
  });

  it('no running entry at all → no runningClock alert', () => {
    expect(resolveCrossFamilyAlerts(baseArgs({ runningEntry: null }))).toEqual(
      []
    );
  });
});

describe('resolveCrossFamilyAlerts — pending shift (expires)', () => {
  it('qualifies a pending shift in another household starting within 48h', () => {
    const alerts = resolveCrossFamilyAlerts(
      baseArgs({
        meShifts: [
          {
            household_id: OTHER_A,
            status: 'pending',
            starts_at: '2026-08-17T09:00:00.000Z', // 21h out
            local_date: '2026-08-17',
          },
        ],
      })
    );
    expect(alerts).toEqual([
      {
        householdId: OTHER_A,
        familyName: 'Wilson family',
        kind: 'pendingShift',
      },
    ]);
  });

  it('excludes a pending shift more than 48h out', () => {
    const alerts = resolveCrossFamilyAlerts(
      baseArgs({
        meShifts: [
          {
            household_id: OTHER_A,
            status: 'pending',
            starts_at: '2026-08-25T09:00:00.000Z',
            local_date: '2026-08-25',
          },
        ],
      })
    );
    expect(alerts).toEqual([]);
  });

  it('excludes a shift that is not pending (already confirmed)', () => {
    const alerts = resolveCrossFamilyAlerts(
      baseArgs({
        meShifts: [
          {
            household_id: OTHER_A,
            status: 'confirmed',
            starts_at: '2026-08-17T09:00:00.000Z',
            local_date: '2026-08-17',
          },
        ],
      })
    );
    expect(alerts).toEqual([]);
  });

  it('never surfaces a pending shift in the ACTIVE household', () => {
    const alerts = resolveCrossFamilyAlerts(
      baseArgs({
        meShifts: [
          {
            household_id: ACTIVE_ID,
            status: 'pending',
            starts_at: '2026-08-17T09:00:00.000Z',
            local_date: '2026-08-17',
          },
        ],
      })
    );
    expect(alerts).toEqual([]);
  });
});

describe('resolveCrossFamilyAlerts — terms block on a shift today', () => {
  it('qualifies a terms_proposal in another household where she has a shift today', () => {
    const alerts = resolveCrossFamilyAlerts(
      baseArgs({
        items: [termsProposalItem(OTHER_A)],
        meShifts: [
          {
            household_id: OTHER_A,
            status: 'confirmed',
            starts_at: '2026-08-16T09:00:00.000Z',
            local_date: TODAY,
          },
        ],
      })
    );
    expect(alerts).toEqual([
      { householdId: OTHER_A, familyName: 'Wilson family', kind: 'termsBlock' },
    ]);
  });

  it('does NOT qualify a terms_proposal with no shift today in that household — it survives until she switches', () => {
    const alerts = resolveCrossFamilyAlerts(
      baseArgs({
        items: [termsProposalItem(OTHER_A)],
        meShifts: [],
      })
    );
    expect(alerts).toEqual([]);
  });

  it('a terms_proposal in the ACTIVE household never appears — her own Today already handles it', () => {
    const alerts = resolveCrossFamilyAlerts(
      baseArgs({
        items: [termsProposalItem(ACTIVE_ID)],
        meShifts: [
          {
            household_id: ACTIVE_ID,
            status: 'confirmed',
            starts_at: '2026-08-16T09:00:00.000Z',
            local_date: TODAY,
          },
        ],
      })
    );
    expect(alerts).toEqual([]);
  });

  it('a cancelled shift today does not count as "has a shift today"', () => {
    const alerts = resolveCrossFamilyAlerts(
      baseArgs({
        items: [termsProposalItem(OTHER_A)],
        meShifts: [
          {
            household_id: OTHER_A,
            status: 'cancelled',
            starts_at: '2026-08-16T09:00:00.000Z',
            local_date: TODAY,
          },
        ],
      })
    );
    expect(alerts).toEqual([]);
  });

  // Pattern A: a shift 23:30 B-local is already TOMORROW in A's zone. A
  // single "today" computed from the active household would silently miss
  // this termsBlock — the exact "lose a paid shift" failure §termsBlock
  // exists to prevent.
  it("a shift at 23:30 in OTHER_A's own zone still counts as 'today' for OTHER_A, even though it is tomorrow in the active household's zone", () => {
    const TOMORROW = '2026-08-17';
    const alerts = resolveCrossFamilyAlerts(
      baseArgs({
        items: [termsProposalItem(OTHER_A)],
        todayLocalDateFor: householdId =>
          householdId === OTHER_A ? TOMORROW : TODAY,
        meShifts: [
          {
            household_id: OTHER_A,
            status: 'confirmed',
            starts_at: '2026-08-16T23:30:00.000Z',
            local_date: TOMORROW,
          },
        ],
      })
    );
    expect(alerts).toEqual([
      { householdId: OTHER_A, familyName: 'Wilson family', kind: 'termsBlock' },
    ]);
  });
});

describe('resolveCrossFamilyAlerts — ordinary inbox noise never qualifies', () => {
  const NOISE: InboxItem[] = [
    {
      kind: 'queried_week',
      id: 'q1',
      householdId: OTHER_A,
      weekStart: '2026-08-10',
      queryNote: 'Check Tuesday',
    },
    {
      kind: 'submitted_week',
      id: 's1',
      householdId: OTHER_A,
      weekStart: '2026-08-10',
      carerDisplayName: 'Test Carer',
    },
    {
      kind: 'pending_pattern',
      id: 'p1',
      householdId: OTHER_A,
      patternId: 'p1',
      dtstart: '2026-08-20',
    },
    {
      kind: 'terms_proposal_sent',
      id: 'sent1',
      householdId: OTHER_A,
      carerId: 'carer-1',
      carerDisplayName: 'Test Carer',
      proposedAt: '2026-08-10T09:00:00.000Z',
      viewedAt: null,
      direction: 'carer',
    },
    {
      kind: 'terms_ack',
      id: 'ack1',
      householdId: OTHER_A,
      validFrom: '2026-08-01',
      isFirstTerms: false,
    },
    {
      kind: 'reimbursement_owed',
      id: 'r1',
      householdId: OTHER_A,
      weekStart: '2026-08-10',
      amountMinor: 500,
      currency: 'USD',
    },
    {
      kind: 'change_request',
      id: 'cr1',
      shiftId: 'shift-1',
      requestKind: 'time_change',
    },
  ];

  it('none of these kinds ever produce a cross-family alert', () => {
    const alerts = resolveCrossFamilyAlerts(baseArgs({ items: NOISE }));
    expect(alerts).toEqual([]);
  });
});

describe('resolveCrossFamilyAlerts — ordering and one-alert-per-household', () => {
  it('orders runningClock > termsBlock > pendingShift across different households', () => {
    const alerts = resolveCrossFamilyAlerts(
      baseArgs({
        households: [
          { id: ACTIVE_ID, name: 'The Grants' },
          { id: OTHER_A, name: 'Wilson family' }, // pending shift
          { id: OTHER_B, name: 'Okafor family' }, // running clock
        ],
        runningEntry: {
          household_id: OTHER_B,
          clock_in_at: '2026-08-16T08:14:00.000Z',
        },
        meShifts: [
          {
            household_id: OTHER_A,
            status: 'pending',
            starts_at: '2026-08-17T09:00:00.000Z',
            local_date: '2026-08-17',
          },
        ],
      })
    );
    expect(alerts.map(a => a.kind)).toEqual(['runningClock', 'pendingShift']);
    expect(alerts.map(a => a.householdId)).toEqual([OTHER_B, OTHER_A]);
  });

  it('one household with BOTH a running clock and an expiring pending shift shows only the higher rung', () => {
    const alerts = resolveCrossFamilyAlerts(
      baseArgs({
        runningEntry: {
          household_id: OTHER_A,
          clock_in_at: '2026-08-16T08:14:00.000Z',
        },
        meShifts: [
          {
            household_id: OTHER_A,
            status: 'pending',
            starts_at: '2026-08-17T09:00:00.000Z',
            local_date: '2026-08-17',
          },
        ],
      })
    );
    expect(alerts).toEqual([
      {
        householdId: OTHER_A,
        familyName: 'Wilson family',
        kind: 'runningClock',
        since: '2026-08-16T08:14:00.000Z',
      },
    ]);
  });
});

describe('resolveCrossFamilyAlerts — a single-household parent', () => {
  it('has nothing to render — structural, not a role check', () => {
    const alerts = resolveCrossFamilyAlerts(
      baseArgs({
        households: [{ id: ACTIVE_ID, name: 'The Grants' }],
        runningEntry: { household_id: ACTIVE_ID, clock_in_at: NOW },
        items: [termsProposalItem(ACTIVE_ID)],
        meShifts: [
          {
            household_id: ACTIVE_ID,
            status: 'pending',
            starts_at: '2026-08-17T09:00:00.000Z',
            local_date: '2026-08-17',
          },
        ],
      })
    );
    expect(alerts).toEqual([]);
  });
});
