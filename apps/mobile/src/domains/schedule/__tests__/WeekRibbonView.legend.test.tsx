/**
 * @module domains/schedule/__tests__/WeekRibbonView.legend.test
 *
 * Pattern B (mock rendering, docs/09-TESTING.md §5) — the hour axis and the
 * status legend actually reach the screen, and the legend's 4th item only
 * shows up once the week genuinely has more than one carer to disambiguate.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

mock.module('expo-router', () => ({
  useRouter: () => ({ push: () => {} }),
}));

let WeekRibbonView: typeof import('../components/WeekRibbonView').WeekRibbonView;

beforeAll(async () => {
  WeekRibbonView = (await import('../components/WeekRibbonView'))
    .WeekRibbonView;
});

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    household_id: 'hh-1',
    carer_id: 'carer-a',
    starts_at: '2026-08-03T13:00:00.000Z',
    ends_at: '2026-08-03T21:00:00.000Z',
    timezone: 'UTC',
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

describe('WeekRibbonView axis', () => {
  it('formats hour rows as zero-padded HH:00, not a bare integer', () => {
    const { getByText } = render(<WeekRibbonView shifts={[]} weekDates={[]} />);

    expect(getByText('08:00')).toBeTruthy();
  });
});

/** DFS pre-order collection of `testID`s from a rendered tree — sibling
 * order in the array matches the order the JSX wrote them in. */
function collectTestIds(node: unknown, out: string[]): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collectTestIds(child, out);
    return;
  }
  const { props, children } = node as {
    props?: Record<string, unknown>;
    children?: unknown[];
  };
  const testID = props?.testID;
  if (typeof testID === 'string') out.push(testID);
  if (children) collectTestIds(children, out);
}

describe('WeekRibbonView legend', () => {
  it('REGRESSION: renders the legend before the first hour row, so it survives on a full grid', () => {
    const { toJSON } = render(
      <WeekRibbonView shifts={[makeShift()]} weekDates={[]} />
    );

    const testIds: string[] = [];
    collectTestIds(toJSON(), testIds);
    const legendIndex = testIds.indexOf('week-ribbon-legend');
    const firstCellIndex = testIds.findIndex(id =>
      id.startsWith('week-ribbon-cell-')
    );

    expect(legendIndex).toBeGreaterThanOrEqual(0);
    expect(firstCellIndex).toBeGreaterThanOrEqual(0);
    expect(legendIndex).toBeLessThan(firstCellIndex);
  });

  it('adds a parent-cover legend item, reusing the shared cover.parentCoveringRow label, only when a parent_cover shift is present this week', () => {
    const { getByText, queryByText } = render(
      <WeekRibbonView
        shifts={[makeShift({ kind: 'parent_cover' })]}
        weekDates={[]}
      />
    );

    expect(getByText('cover.parentCoveringRow')).toBeTruthy();
    // Not the uncovered vocabulary — parent_cover is a distinct fact.
    expect(queryByText('cover.rowPill')).toBeNull();
  });

  it('omits the parent-cover legend item when no parent_cover shift is present', () => {
    const { queryByText } = render(
      <WeekRibbonView shifts={[makeShift()]} weekDates={[]} />
    );

    expect(queryByText('cover.parentCoveringRow')).toBeNull();
  });

  it('shows only the states present in the visible week, with no multi-carer item for 0/1 carers', () => {
    const { getByTestId, queryByTestId, getByText, queryByText } = render(
      <WeekRibbonView shifts={[makeShift()]} weekDates={[]} />
    );

    expect(getByTestId('week-ribbon-legend')).toBeTruthy();
    expect(getByTestId('week-ribbon-legend-confirmed')).toBeTruthy();
    expect(getByText('shifts.statusConfirmed')).toBeTruthy();
    // A legend item with no matching cell is noise.
    expect(queryByText('shifts.statusPending')).toBeNull();
    expect(queryByText('shifts.statusCancelled')).toBeNull();
    expect(queryByTestId('week-ribbon-legend-pending')).toBeNull();
    expect(queryByTestId('week-ribbon-legend-cancelled')).toBeNull();
    expect(queryByTestId('week-ribbon-legend-multi-carer')).toBeNull();
  });

  it('orders legend items by consequence: not booked, pending, confirmed, covering, cancelled', () => {
    const day = (
      d: string,
      status: Shift['status'],
      kind: Shift['kind'] = 'recurring'
    ) =>
      makeShift({
        id: `shift-${d}`,
        local_date: `2026-08-0${d}`,
        starts_at: `2026-08-0${d}T13:00:00.000Z`,
        ends_at: `2026-08-0${d}T14:00:00.000Z`,
        status,
        kind,
      });
    const { toJSON } = render(
      <WeekRibbonView
        shifts={[
          day('4', 'cancelled'),
          day('5', 'confirmed', 'parent_cover'),
          day('6', 'confirmed'),
          day('7', 'pending'),
        ]}
        displayTimeZone="UTC"
        weekDates={[]}
        uncoveredByDay={{
          '2026-08-03': [
            {
              childId: 'child-1',
              commitmentId: 'commitment-1',
              startsAt: '2026-08-03T09:00:00.000Z',
              endsAt: '2026-08-03T10:00:00.000Z',
            },
          ],
        }}
      />
    );

    const ids: string[] = [];
    collectTestIds(toJSON(), ids);
    const legendIds = ids.filter(
      id => id.startsWith('week-ribbon-legend-') && !id.endsWith('-swatch')
    );
    expect(legendIds).toEqual([
      'week-ribbon-legend-uncovered',
      'week-ribbon-legend-pending',
      'week-ribbon-legend-confirmed',
      'week-ribbon-legend-parent-cover',
      'week-ribbon-legend-cancelled',
    ]);
  });

  it('draws swatches as mini cells in the grid style: dashed pending capsule, half-height cancelled bar', () => {
    const { getByTestId } = render(
      <WeekRibbonView
        shifts={[
          makeShift({ id: 'p', status: 'pending' }),
          makeShift({
            id: 'c',
            status: 'cancelled',
            local_date: '2026-08-04',
            starts_at: '2026-08-04T13:00:00.000Z',
            ends_at: '2026-08-04T14:00:00.000Z',
          }),
        ]}
        displayTimeZone="UTC"
        weekDates={[]}
      />
    );

    const pending = StyleSheet.flatten(
      getByTestId('week-ribbon-legend-pending-swatch').props.style
    );
    expect(pending.width).toBe(20);
    expect(pending.height).toBe(10);
    expect(pending.borderStyle).toBe('dashed');
    expect(pending.borderWidth).toBe(1);
    expect(pending.borderColor).toBe('#9C6E2E'); // warningStrong

    const cancelled = StyleSheet.flatten(
      getByTestId('week-ribbon-legend-cancelled-swatch').props.style
    );
    expect(cancelled.width).toBe(20);
    expect(cancelled.height).toBe(5);
    expect(cancelled.backgroundColor).toBe('#7E7280'); // gray[500]
  });

  it('adds the multi-carer legend item once the week has 2+ distinct carer_ids', () => {
    const shifts = [
      makeShift({ id: 'shift-1', carer_id: 'carer-a' }),
      makeShift({ id: 'shift-2', carer_id: 'carer-b' }),
    ];

    const { getByTestId, getByText } = render(
      <WeekRibbonView shifts={shifts} weekDates={[]} />
    );

    expect(getByTestId('week-ribbon-legend-multi-carer')).toBeTruthy();
    expect(getByText('shifts.legendMultiCarer')).toBeTruthy();
  });

  it('does not double-count the same carer across multiple shifts', () => {
    const shifts = [
      makeShift({ id: 'shift-1', carer_id: 'carer-a' }),
      makeShift({ id: 'shift-2', carer_id: 'carer-a' }),
    ];

    const { queryByTestId } = render(
      <WeekRibbonView shifts={shifts} weekDates={[]} />
    );

    expect(queryByTestId('week-ribbon-legend-multi-carer')).toBeNull();
  });
});
