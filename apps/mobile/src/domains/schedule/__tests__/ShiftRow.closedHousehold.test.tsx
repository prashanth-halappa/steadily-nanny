/**
 * @module domains/schedule/__tests__/ShiftRow.closedHousehold
 *
 * "Undo covering" must stay visible and disabled (never hidden) with the
 * shared closed-household reason once the reader's household has closed —
 * `AgendaView` computes the reason and threads it down as
 * `coverUndoDisabledReason`.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { fireEvent, render } from '@testing-library/react-native';
import { serializeTree } from '@/src/test-utils';

mock.module('expo-router', () => ({
  useRouter: () => ({ push: () => {} }),
  router: { push: () => {}, replace: () => {}, back: () => {} },
}));

const mockMutateAsync = mock(async () => {});

mock.module('@/src/hooks/mutations/useRemoveParentCover', () => ({
  useRemoveParentCover: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

let ShiftRow: typeof import('../components/ShiftRow').ShiftRow;

beforeAll(async () => {
  ShiftRow = (await import('../components/ShiftRow')).ShiftRow;
});

const TZ = 'America/New_York';
const CLOSED_REASON =
  "This family's account is closed. You can read this, not change it.";

const MEMBER_LABELS = {
  you: 'You',
  someone: 'Someone',
  roleFallback: (role: 'owner' | 'parent' | 'nanny' | 'helper') => role,
};

function makeCoverShift(): Shift {
  return {
    id: 'cover-1',
    household_id: '11111111-1111-4111-8111-111111111111',
    carer_id: null,
    starts_at: '2026-08-03T13:00:00.000Z',
    ends_at: '2026-08-03T21:00:00.000Z',
    timezone: TZ,
    local_date: '2026-08-03',
    kind: 'parent_cover',
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
    ical_uid: 'cover-1@steadily',
    sequence: 0,
    created_by: 'parent-1',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  } as Shift;
}

const defaultProps = {
  displayTimeZone: TZ,
  currentUserId: 'parent-1',
  membersByUserId: new Map(),
  memberLabels: MEMBER_LABELS,
  showParentCoverUndo: true,
};

describe('ShiftRow — closed household', () => {
  it('disables Undo covering with the reason beneath it, but keeps it visible', () => {
    const { getByTestId } = render(
      <ShiftRow
        {...defaultProps}
        shift={makeCoverShift()}
        coverUndoDisabledReason={CLOSED_REASON}
      />
    );

    const link = getByTestId('schedule-parent-cover-undo-cover-1');
    expect(link).toBeTruthy();
    expect(link.props.disabled).toBe(true);
    expect(link.props.accessibilityHint).toBe(CLOSED_REASON);
    expect(
      getByTestId('schedule-parent-cover-undo-cover-1-reason').props.children
    ).toBe(CLOSED_REASON);

    fireEvent.press(link);
    // `fireEvent.press` fires regardless of `disabled` in this test harness
    // (bare host component) — same caveat `RestrictedActionButton`'s own
    // suite documents. The `disabled` PROP is the contract, not a runtime
    // block here.
  });

  it('renders normally, no reason, when the household is open', () => {
    const tree = render(
      <ShiftRow {...defaultProps} shift={makeCoverShift()} />
    );

    const link = tree.getByTestId('schedule-parent-cover-undo-cover-1');
    expect(link.props.disabled).toBe(false);
    expect(
      tree.queryByTestId('schedule-parent-cover-undo-cover-1-reason')
    ).toBeNull();
    expect(serializeTree(tree.toJSON())).not.toContain(CLOSED_REASON);
  });
});
