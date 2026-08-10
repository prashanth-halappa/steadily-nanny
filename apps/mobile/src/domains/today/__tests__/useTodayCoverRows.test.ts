/**
 * @module domains/today/__tests__/useTodayCoverRows.test
 *
 * Pins the 10 Aug 2026 bug: declined/cancelled shifts must not win over the
 * confirmed shift, and parent_cover must never fall through to carerFallback.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_KINDS } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { renderHook } from '@testing-library/react-native';
import i18n from '@/src/i18n';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const NANNY_ID = '33333333-3333-4333-8333-333333333333';
const ZONE = 'Europe/London';
/** 2026-08-10 13:00 London — inside the confirmed 11:22–19:22 shift. */
const PINNED_NOW = new Date('2026-08-10T12:00:00.000Z');

setSystemTime(PINNED_NOW);
afterAll(() => setSystemTime());

let useTodayCoverRows: typeof import('../hooks/useTodayCoverRows').useTodayCoverRows;
let pickCoverShift: typeof import('../hooks/useTodayCoverRows').pickCoverShift;
let mockWeekEntries: ReturnType<typeof mock>;
let mockShiftsRange: ReturnType<typeof mock>;
let mockHouseholdMembers: ReturnType<typeof mock>;

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    household_id: HOUSEHOLD_ID,
    carer_id: NANNY_ID,
    starts_at: '2026-08-10T10:22:00.000Z',
    ends_at: '2026-08-10T18:22:00.000Z',
    timezone: ZONE,
    local_date: '2026-08-10',
    kind: SHIFT_KINDS.RECURRING,
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
    ical_uid: 'uid-1',
    sequence: 0,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Household 1 / 10 Aug 2026 — declined 06:00, two cancelled, confirmed 11:22. */
function aug10Nanny1Shifts(): Shift[] {
  return [
    makeShift({
      id: 'declined-0600',
      status: 'declined',
      starts_at: '2026-08-10T05:00:00.000Z',
      ends_at: '2026-08-10T19:00:00.000Z',
    }),
    makeShift({
      id: 'cancelled-1',
      status: 'cancelled',
      starts_at: '2026-08-10T08:00:00.000Z',
      ends_at: '2026-08-10T12:00:00.000Z',
    }),
    makeShift({
      id: 'cancelled-2',
      status: 'cancelled',
      starts_at: '2026-08-10T13:00:00.000Z',
      ends_at: '2026-08-10T17:00:00.000Z',
    }),
    makeShift({
      id: 'confirmed-1122',
      status: 'confirmed',
      starts_at: '2026-08-10T10:22:00.000Z',
      ends_at: '2026-08-10T18:22:00.000Z',
    }),
  ];
}

beforeAll(async () => {
  await i18n.changeLanguage('en');

  mockWeekEntries = mock(() => ({ data: [], isLoading: false }));
  mockShiftsRange = mock(() => ({ data: [] as Shift[], isLoading: false }));
  mockHouseholdMembers = mock(() => ({
    data: [
      {
        user_id: NANNY_ID,
        profile_name: 'H1 Nanny1',
        display_name_override: null,
        role: 'carer',
      },
    ],
    isLoading: false,
  }));

  mock.module('@/src/hooks/queries/useWeekTimeEntries', () => ({
    useWeekTimeEntries: mockWeekEntries,
  }));
  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: mockShiftsRange,
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: mockHouseholdMembers,
  }));

  const mod = await import('../hooks/useTodayCoverRows');
  useTodayCoverRows = mod.useTodayCoverRows;
  pickCoverShift = mod.pickCoverShift;
});

describe('useTodayCoverRows', () => {
  it('pickCoverShift chooses the confirmed 11:22 shift over declined 06:00', () => {
    const picked = pickCoverShift(aug10Nanny1Shifts(), PINNED_NOW.getTime());
    expect(picked?.id).toBe('confirmed-1122');
    expect(picked?.starts_at).toBe('2026-08-10T10:22:00.000Z');
    expect(picked?.starts_at).not.toBe('2026-08-10T05:00:00.000Z');
  });

  it('picks the confirmed shift when declined and cancelled shifts share the carer', () => {
    mockShiftsRange.mockReturnValue({
      data: aug10Nanny1Shifts(),
      isLoading: false,
    });

    const { result } = renderHook(() => useTodayCoverRows(HOUSEHOLD_ID, ZONE));

    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]?.name).toBe('H1 Nanny1');
  });

  it('never produces a row for a draft shift', () => {
    mockShiftsRange.mockReturnValue({
      data: [
        makeShift({
          id: 'draft-only',
          status: 'draft',
          carer_id: null,
          starts_at: '2026-08-10T09:00:00.000Z',
          ends_at: '2026-08-10T17:00:00.000Z',
        }),
      ],
      isLoading: false,
    });

    const { result } = renderHook(() => useTodayCoverRows(HOUSEHOLD_ID, ZONE));

    expect(result.current.rows).toHaveLength(0);
  });

  it('labels parent_cover with the parent-covering copy, not carerFallback', () => {
    mockShiftsRange.mockReturnValue({
      data: [
        makeShift({
          id: 'parent-cover-1',
          kind: SHIFT_KINDS.PARENT_COVER,
          status: 'confirmed',
          carer_id: null,
          starts_at: '2026-08-10T09:00:00.000Z',
          ends_at: '2026-08-10T17:00:00.000Z',
        }),
      ],
      isLoading: false,
    });

    const { result } = renderHook(() => useTodayCoverRows(HOUSEHOLD_ID, ZONE));

    expect(result.current.rows).toHaveLength(1);
    const name = result.current.rows[0]?.name;

    // The hook resolves this through `useTranslation('schedule')` so the label
    // re-renders on a language switch. Outside a provider that returns the bare
    // key, so accept either form — what must never happen is the row falling
    // through to the anonymous "Carer" fallback, which is the actual bug: the
    // parent who just tapped "I've got it" seeing a stranger booked.
    expect(name).toBeDefined();
    expect([
      i18n.t('schedule:cover.parentCoveringRow'),
      'cover.parentCoveringRow',
    ]).toContain(name as string);
    expect(name).not.toBe(i18n.t('today:carerFallback'));
    expect(name).not.toBe('carerFallback');
  });
});
