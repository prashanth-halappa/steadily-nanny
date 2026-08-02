/**
 * @module domains/timeOff/__tests__/TimeOffRow.test
 *
 * Component-level test with props fed directly (docs/09-TESTING.md §5
 * Pattern B) — proves TimeOffRow itself renders and wires correctly in
 * isolation. This does NOT prove anything in the app actually calls it with
 * real data; that's TimeOffScreen.test.tsx's job (see its header comment).
 */
import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { TimeOffRow } from '../components/TimeOffRow';

function makeTimeOff(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    user_id: '11111111-1111-4111-8111-111111111111',
    starts_at: '2026-08-10T00:00:00.000Z',
    ends_at: '2026-08-13T00:00:00.000Z',
    all_day: true,
    message: null,
    status: 'confirmed' as const,
    ical_uid: 'time-off-1@steadily',
    sequence: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('TimeOffRow', () => {
  it('renders the date-range label and status for a confirmed row', () => {
    const { getByTestId } = render(
      <TimeOffRow
        timeOff={makeTimeOff()}
        onCancel={() => {}}
        isCancelling={false}
      />
    );

    expect(
      getByTestId('time-off-row-22222222-2222-4222-8222-222222222222')
    ).toBeTruthy();
    expect(
      getByTestId('time-off-status-22222222-2222-4222-8222-222222222222')
    ).toBeTruthy();
  });

  it('renders the optional message when present', () => {
    const { getByText } = render(
      <TimeOffRow
        timeOff={makeTimeOff({ message: 'Visiting family' })}
        onCancel={() => {}}
        isCancelling={false}
      />
    );
    expect(getByText('Visiting family')).toBeTruthy();
  });

  it('tapping Cancel fires onCancel with the row id', () => {
    const onCancel = mock(() => {});
    const { getByTestId } = render(
      <TimeOffRow
        timeOff={makeTimeOff()}
        onCancel={onCancel}
        isCancelling={false}
      />
    );

    getByTestId(
      'time-off-cancel-22222222-2222-4222-8222-222222222222'
    ).props.onPress?.();

    expect(onCancel).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222'
    );
  });

  it('hides the Cancel control once the row is already cancelled', () => {
    const { queryByTestId } = render(
      <TimeOffRow
        timeOff={makeTimeOff({ status: 'cancelled' })}
        onCancel={() => {}}
        isCancelling={false}
      />
    );

    expect(
      queryByTestId('time-off-cancel-22222222-2222-4222-8222-222222222222')
    ).toBeNull();
  });

  it('stays in the list, dimmed, once cancelled — soft-cancel is a status change, not a deletion', () => {
    const { getByTestId, queryByTestId } = render(
      <TimeOffRow
        timeOff={makeTimeOff({ status: 'cancelled' })}
        onCancel={() => {}}
        isCancelling={false}
      />
    );

    const row = getByTestId(
      'time-off-row-22222222-2222-4222-8222-222222222222'
    );
    expect(row).toBeTruthy();
    expect(row.props.className).toContain('opacity-50');
    expect(
      queryByTestId('time-off-status-22222222-2222-4222-8222-222222222222')
    ).toBeTruthy();
  });

  it('renders a confirmed row at full opacity (no dimming)', () => {
    const { getByTestId } = render(
      <TimeOffRow
        timeOff={makeTimeOff()}
        onCancel={() => {}}
        isCancelling={false}
      />
    );

    const row = getByTestId(
      'time-off-row-22222222-2222-4222-8222-222222222222'
    );
    expect(row.props.className).not.toContain('opacity-50');
  });

  it('disables Cancel while a cancellation is already in flight', () => {
    const { getByTestId } = render(
      <TimeOffRow timeOff={makeTimeOff()} onCancel={() => {}} isCancelling />
    );

    expect(
      getByTestId('time-off-cancel-22222222-2222-4222-8222-222222222222').props
        .disabled
    ).toBe(true);
  });
});
