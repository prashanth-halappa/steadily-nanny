/**
 * @module domains/schedule/__tests__/AgendaView.names.test
 *
 * Pattern B (mock rendering, docs/09-TESTING.md §5) — FlashList is globally
 * mocked to a plain non-virtualized list (bun.setup.ts), so AgendaView can
 * be rendered for real here, unlike the sibling `AgendaView.test.ts` (source
 * inspection only).
 *
 * A single-carer household never needs a name on the shift row — the parent
 * already knows who "the nanny" is. Once a household has 2+ active
 * nanny/helper members, each shift becomes ambiguous without a name, so the
 * row grows a first-name label — except for a shift with no carer assigned
 * yet, which stays blank rather than lying about who's covering it.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { render } from '@testing-library/react-native';

mock.module('expo-router', () => ({
  useRouter: () => ({ push: () => {} }),
  router: { push: () => {}, replace: () => {}, back: () => {} },
}));

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const NANNY_A_ID = '22222222-2222-4222-8222-222222222222';
const NANNY_B_ID = '33333333-3333-4333-8333-333333333333';

const mockUseHouseholdMembers = mock((): { data: unknown[] } => ({
  data: [],
}));

mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
  useHouseholdMembers: mockUseHouseholdMembers,
}));
mock.module('@/src/hooks/queries/useChildren', () => ({
  useChildren: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
  useHouseholdCarers: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/hooks/mutations/useCreateParentCover', () => ({
  useCreateParentCover: () => ({
    mutateAsync: async () => {},
    isPending: false,
  }),
}));
mock.module('@/src/hooks/mutations/useRemoveParentCover', () => ({
  useRemoveParentCover: () => ({
    mutateAsync: async () => {},
    isPending: false,
  }),
}));

let AgendaView: typeof import('../components/AgendaView').AgendaView;

beforeAll(async () => {
  AgendaView = (await import('../components/AgendaView')).AgendaView;
});

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    household_id: HOUSEHOLD_ID,
    carer_id: NANNY_A_ID,
    starts_at: '2026-08-03T13:00:00.000Z',
    ends_at: '2026-08-03T21:00:00.000Z',
    timezone: 'America/New_York',
    local_date: '2026-08-03',
    kind: 'recurring',
    status: 'confirmed',
    source_pattern_id: null,
    origin: 'system_generated',
    is_short_notice: false,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: 'shift-1@steadily',
    sequence: 0,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Shift;
}

function nannyMember(userId: string, displayName: string) {
  return {
    id: `member-${userId}`,
    household_id: HOUSEHOLD_ID,
    user_id: userId,
    role: 'nanny' as const,
    can_edit: false,
    status: 'active' as const,
    display_name_override: displayName,
    colour: null,
    joined_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('AgendaView carer names', () => {
  it('shows no carer name row in a single-carer household', () => {
    mockUseHouseholdMembers.mockImplementation(() => ({
      data: [nannyMember(NANNY_A_ID, 'Amara Diallo')],
    }));

    const { queryByTestId } = render(
      <AgendaView
        shifts={[makeShift()]}
        householdId={HOUSEHOLD_ID}
        weekDates={['2026-08-03']}
      />
    );

    expect(queryByTestId('schedule-shift-carer-shift-1')).toBeNull();
    expect(queryByTestId('schedule-shift-avatar-shift-1')).toBeNull();
  });

  it("shows each shift carer's first name once the household has 2+ carers, and nothing for a null carer_id", () => {
    mockUseHouseholdMembers.mockImplementation(() => ({
      data: [
        nannyMember(NANNY_A_ID, 'Amara Diallo'),
        nannyMember(NANNY_B_ID, 'Priya Shah'),
      ],
    }));

    const { getByTestId, queryByTestId } = render(
      <AgendaView
        shifts={[
          makeShift({
            id: 'shift-1',
            carer_id: NANNY_A_ID,
            local_date: '2026-08-03',
          }),
          makeShift({
            id: 'shift-2',
            carer_id: null,
            local_date: '2026-08-04',
          }),
        ]}
        householdId={HOUSEHOLD_ID}
        weekDates={['2026-08-03', '2026-08-04']}
      />
    );

    expect(getByTestId('schedule-shift-carer-shift-1').props.children).toBe(
      'Amara'
    );
    expect(getByTestId('schedule-shift-avatar-shift-1')).toBeTruthy();
    expect(queryByTestId('schedule-shift-carer-shift-2')).toBeNull();
    expect(queryByTestId('schedule-shift-avatar-shift-2')).toBeNull();
  });

  it("keeps names on and shows a fallback name for a departed carer's shift after the roster drops to 1", () => {
    // The carer who worked shift-2 deleted her account: her
    // `household_members` row is destroyed (058/061) and `shifts.carer_id`
    // goes NULL (015_shifts.sql, on delete set null) — `shifts` carries no
    // `carer_display_name` snapshot the way `time_entries` does. Only one
    // active nanny is left on the roster.
    mockUseHouseholdMembers.mockImplementation(() => ({
      data: [nannyMember(NANNY_A_ID, 'Amara Diallo')],
    }));

    const { getByTestId } = render(
      <AgendaView
        shifts={[
          makeShift({
            id: 'shift-1',
            carer_id: NANNY_A_ID,
            local_date: '2026-08-03',
          }),
          makeShift({
            id: 'shift-2',
            carer_id: null,
            status: 'completed',
            local_date: '2026-08-02',
          }),
        ]}
        householdId={HOUSEHOLD_ID}
        weekDates={['2026-08-02', '2026-08-03']}
      />
    );

    // The remaining nanny still gets her name — dropping to 1 active member
    // must not silently turn names off for the whole agenda.
    expect(getByTestId('schedule-shift-carer-shift-1').props.children).toBe(
      'Amara'
    );
    // The departed carer's own shift renders SOME name rather than going
    // blank, which would read as "nobody worked this" or blend into the
    // remaining nanny's unlabeled rows. Rendered outside an i18n provider
    // here, so `t()` echoes the key (docs/09-TESTING.md §6) — 'detail.someone'
    // is `memberLabels.someone`'s translated value in a real app.
    expect(getByTestId('schedule-shift-carer-shift-2').props.children).toBe(
      'detail.someone'
    );
  });
});
