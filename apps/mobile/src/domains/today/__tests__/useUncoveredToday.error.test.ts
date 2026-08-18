/**
 * @module domains/today/__tests__/useUncoveredToday.error
 *
 * ERROR WINS OVER LOADING (`src/hooks/queries/queryState.ts`). A read that
 * has failed and is retrying is BOTH `isPending` and `isError`; checking
 * loading first pins the hook at `'loading'` forever, which on Today means a
 * parent stares at nothing instead of a retry he can press.
 *
 * The `retry()` half matters just as much: refetching the whole set would
 * re-fire the two reads that already succeeded.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from 'bun:test';
import { renderHook } from '@testing-library/react-native';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const ZONE = 'Europe/London';
const PINNED_NOW = new Date('2026-08-10T09:00:00.000Z');

setSystemTime(PINNED_NOW);
afterAll(() => setSystemTime());

let useUncoveredToday: typeof import('../hooks/useUncoveredToday').useUncoveredToday;
let mockShiftsRange: ReturnType<typeof mock>;
let mockCommitments: ReturnType<typeof mock>;
let mockClosures: ReturnType<typeof mock>;
let refetchShifts: ReturnType<typeof mock>;
let refetchCommitments: ReturnType<typeof mock>;
let refetchClosures: ReturnType<typeof mock>;

const settled = (refetch: ReturnType<typeof mock>) => ({
  data: [],
  isLoading: false,
  isPending: false,
  isError: false,
  refetch,
});

beforeAll(async () => {
  refetchShifts = mock();
  refetchCommitments = mock();
  refetchClosures = mock();
  mockShiftsRange = mock(() => settled(refetchShifts));
  mockCommitments = mock(() => settled(refetchCommitments));
  mockClosures = mock(() => settled(refetchClosures));

  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: mockShiftsRange,
  }));
  mock.module('@/src/hooks/queries/useHouseholdCommitments', () => ({
    useHouseholdCommitments: mockCommitments,
  }));
  mock.module('@/src/hooks/queries/useHouseholdClosures', () => ({
    useHouseholdClosures: mockClosures,
  }));

  const mod = await import('../hooks/useUncoveredToday');
  useUncoveredToday = mod.useUncoveredToday;
});

beforeEach(() => {
  mockShiftsRange.mockImplementation(() => settled(refetchShifts));
  mockCommitments.mockImplementation(() => settled(refetchCommitments));
  mockClosures.mockImplementation(() => settled(refetchClosures));
  refetchShifts.mockClear();
  refetchCommitments.mockClear();
  refetchClosures.mockClear();
});

describe('useUncoveredToday — the failed read', () => {
  it('reports error, not loading, when a query is both pending and errored', () => {
    // A refetch in flight over a last attempt that failed: `isPending` and
    // `isError` are true together, which is exactly the shape the old
    // loading-first check swallowed.
    mockShiftsRange.mockImplementation(() => ({
      data: undefined,
      isLoading: true,
      isPending: true,
      isError: true,
      refetch: refetchShifts,
    }));

    const { result } = renderHook(() => useUncoveredToday(HOUSEHOLD_ID, ZONE));

    expect(result.current.status).toBe('error');
  });

  it('retry() refetches only the failed query', () => {
    mockClosures.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: true,
      refetch: refetchClosures,
    }));

    const { result } = renderHook(() => useUncoveredToday(HOUSEHOLD_ID, ZONE));
    if (result.current.status !== 'error') {
      throw new Error(`expected error, got ${result.current.status}`);
    }
    result.current.retry();

    expect(refetchClosures).toHaveBeenCalledTimes(1);
    expect(refetchShifts).not.toHaveBeenCalled();
    expect(refetchCommitments).not.toHaveBeenCalled();
  });
});
