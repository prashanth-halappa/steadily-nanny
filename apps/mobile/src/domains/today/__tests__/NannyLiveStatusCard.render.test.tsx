/**
 * @module domains/today/__tests__/NannyLiveStatusCard.render
 *
 * F-B1-3-sibling: the `finished` arm names ONE carer (the last to clock out
 * today) but sums `formatDuration` over EVERY carer's entries for the day —
 * a two-carer household shows "Amara has finished — 12h today" when Amara
 * herself only worked 8h (Bea's separate 4h leaked into the total). This is
 * the same "household total wearing one person's name" pattern as the S0
 * Hours-screen defect, just on the Today card.
 *
 * `react-i18next` is globally mocked (bun.setup.ts) to echo the key and
 * drop interpolation — re-mocked here to splice params into the rendered
 * text (same technique as NeedsAttentionCard.test.tsx / HandoffChipsCard.
 * render.test.tsx), since the duration leaking across carers is only
 * observable through the interpolated value.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { TimeEntry } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { render } from '@testing-library/react-native';
import { localDateInZone } from '@/src/lib/localDate';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PARENT_ID = '22222222-2222-4222-8222-222222222222';
const AMARA_ID = '33333333-3333-4333-8333-333333333333';
const BEA_ID = '44444444-4444-4444-8444-444444444444';
const TIME_ZONE = 'UTC';
const TODAY = localDateInZone(TIME_ZONE);

let NannyLiveStatusCard: typeof import('../components/NannyLiveStatusCard').NannyLiveStatusCard;
let mockUseWeekTimeEntries: ReturnType<typeof mock>;

function makeEntry(overrides: Partial<TimeEntry>): TimeEntry {
  return {
    id: `entry-${overrides.carer_id ?? 'x'}`,
    household_id: HOUSEHOLD_ID,
    carer_id: null,
    carer_display_name: 'Carer',
    shift_id: null,
    clock_in_at: null,
    clock_out_at: null,
    break_minutes: 0,
    scheduled_minutes: null,
    kind: 'worked',
    note: null,
    clock_in_location_ok: null,
    clock_out_location_ok: null,
    status: 'submitted',
    local_date: TODAY,
    timezone: TIME_ZONE,
    created_at: `${TODAY}T08:00:00.000Z`,
    updated_at: `${TODAY}T08:00:00.000Z`,
    ...overrides,
  };
}

beforeAll(async () => {
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) =>
        options ? `${key}::${JSON.stringify(options)}` : key,
      i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
    }),
    Trans: ({ children }: { children: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mock(), back: mock(), replace: mock() }),
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: mock((selector: (s: unknown) => unknown) =>
      selector({ user: { id: PARENT_ID } })
    ),
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: mock(() => ({
      data: [
        {
          id: 'member-amara',
          household_id: HOUSEHOLD_ID,
          user_id: AMARA_ID,
          role: 'nanny',
          can_edit: false,
          status: 'active',
          display_name_override: 'Amara',
          colour: null,
          joined_at: `${TODAY}T00:00:00.000Z`,
          created_at: `${TODAY}T00:00:00.000Z`,
          updated_at: `${TODAY}T00:00:00.000Z`,
        },
        {
          id: 'member-bea',
          household_id: HOUSEHOLD_ID,
          user_id: BEA_ID,
          role: 'nanny',
          can_edit: false,
          status: 'active',
          display_name_override: 'Bea',
          colour: null,
          joined_at: `${TODAY}T00:00:00.000Z`,
          created_at: `${TODAY}T00:00:00.000Z`,
          updated_at: `${TODAY}T00:00:00.000Z`,
        },
      ],
    })),
  }));
  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: mock(() => ({ data: [] })),
  }));
  mockUseWeekTimeEntries = mock(() => ({ data: [] as TimeEntry[] }));
  mock.module('@/src/hooks/queries/useWeekTimeEntries', () => ({
    useWeekTimeEntries: mockUseWeekTimeEntries,
  }));

  const mod = await import('../components/NannyLiveStatusCard');
  NannyLiveStatusCard = mod.NannyLiveStatusCard;
});

describe('NannyLiveStatusCard finished arm', () => {
  it('F-B1-3-sibling: names the last carer to clock out but sums ONLY her own entries, not the whole household', () => {
    // Amara: 08:00-16:00 (8h), clocks out LAST -> she is the named carer.
    // Bea: 08:00-12:00 (4h), clocks out earlier, a DIFFERENT carer's hours.
    // Buggy sum: 8h + 4h = 12h attributed to Amara. Correct: 8h, hers alone.
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        makeEntry({
          carer_id: AMARA_ID,
          carer_display_name: 'Amara',
          clock_in_at: `${TODAY}T08:00:00.000Z`,
          clock_out_at: `${TODAY}T16:00:00.000Z`,
        }),
        makeEntry({
          carer_id: BEA_ID,
          carer_display_name: 'Bea',
          clock_in_at: `${TODAY}T08:00:00.000Z`,
          clock_out_at: `${TODAY}T12:00:00.000Z`,
        }),
      ],
    });

    const { getByText, queryByText } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    expect(getByText(/"name":"Amara"/)).toBeTruthy();
    expect(getByText(/"duration":"8h"/)).toBeTruthy();
    expect(queryByText(/"duration":"12h"/)).toBeNull();
  });

  it('single carer: duration is unaffected (no other carer to leak in)', () => {
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        makeEntry({
          carer_id: AMARA_ID,
          carer_display_name: 'Amara',
          clock_in_at: `${TODAY}T09:00:00.000Z`,
          clock_out_at: `${TODAY}T15:00:00.000Z`,
        }),
      ],
    });

    const { getByText } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    expect(getByText(/"name":"Amara"/)).toBeTruthy();
    expect(getByText(/"duration":"6h"/)).toBeTruthy();
  });

  it('reopened: two DEPARTED carers (carer_id null) on the same day must not be summed under one name', () => {
    // 033_preserve_payroll_on_carer_deletion.sql sets carer_id to NULL on
    // account deletion but keeps the entries (carer_display_name is the
    // durable snapshot). `e.carer_id === finishedToday.carer_id` with both
    // null matches BOTH departed carers' entries collectively: 8h + 6h = 14h.
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        makeEntry({
          carer_id: null,
          carer_display_name: 'Departed Carer 1',
          clock_in_at: `${TODAY}T08:00:00.000Z`,
          clock_out_at: `${TODAY}T16:00:00.000Z`, // last to clock out -> named
        }),
        makeEntry({
          carer_id: null,
          carer_display_name: 'Departed Carer 2',
          clock_in_at: `${TODAY}T08:00:00.000Z`,
          clock_out_at: `${TODAY}T14:00:00.000Z`,
        }),
      ],
    });

    const { getByText, queryByText } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    expect(getByText(/"duration":"8h"/)).toBeTruthy();
    expect(queryByText(/"duration":"14h"/)).toBeNull();
  });
});
