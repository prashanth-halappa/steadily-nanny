/**
 * @module domains/today/__tests__/useOverdueClockOut.test
 *
 * The single source of "is MY running clock-out overdue right now" —
 * lifted out of ClockInCard so ClockInCard and TodayScreen's T1
 * arbitration read the same rule instead of two copies drifting apart.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { renderHook } from '@testing-library/react-native';

let useOverdueClockOut: typeof import('../hooks/useOverdueClockOut').useOverdueClockOut;
let mockUseRunningTimeEntry: ReturnType<typeof mock>;
let mockUseShift: ReturnType<typeof mock>;

beforeAll(async () => {
  mockUseRunningTimeEntry = mock(() => ({ data: null }));
  mock.module('@/src/hooks/queries/useRunningTimeEntry', () => ({
    useRunningTimeEntry: mockUseRunningTimeEntry,
  }));
  mockUseShift = mock(() => ({ data: undefined }));
  mock.module('@/src/hooks/queries/useShift', () => ({
    useShift: mockUseShift,
  }));

  const mod = await import('../hooks/useOverdueClockOut');
  useOverdueClockOut = mod.useOverdueClockOut;
});

describe('useOverdueClockOut', () => {
  it('is false when nothing is running', () => {
    mockUseRunningTimeEntry.mockReturnValue({ data: null });

    const { result } = renderHook(() => useOverdueClockOut());

    expect(result.current.overdue).toBe(false);
    expect(result.current.clockInAt).toBeNull();
  });

  it('is false for a running entry well inside its scheduled window', () => {
    mockUseRunningTimeEntry.mockReturnValue({
      data: {
        clock_in_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        shift_id: 'shift-1',
      },
    });
    mockUseShift.mockReturnValue({
      data: { ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
    });

    const { result } = renderHook(() => useOverdueClockOut());

    expect(result.current.overdue).toBe(false);
  });

  it('is true once past the scheduled finish plus grace', () => {
    mockUseRunningTimeEntry.mockReturnValue({
      data: {
        clock_in_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
        shift_id: 'shift-1',
      },
    });
    const shiftEndsAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    mockUseShift.mockReturnValue({ data: { ends_at: shiftEndsAt } });

    const { result } = renderHook(() => useOverdueClockOut());

    expect(result.current.overdue).toBe(true);
    expect(result.current.shiftEndsAt).toBe(shiftEndsAt);
  });

  it('is true past the flat 10h backstop when no shift was matched', () => {
    mockUseRunningTimeEntry.mockReturnValue({
      data: {
        clock_in_at: new Date(Date.now() - 11 * 60 * 60 * 1000).toISOString(),
        shift_id: null,
      },
    });
    mockUseShift.mockReturnValue({ data: undefined });

    const { result } = renderHook(() => useOverdueClockOut());

    expect(result.current.overdue).toBe(true);
    expect(result.current.shiftEndsAt).toBeNull();
  });
});
