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
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from 'bun:test';
import type { TimeEntry } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { render } from '@testing-library/react-native';
import { localDateInZone } from '@/src/lib/localDate';

/** RN's own `StyleSheet.flatten` is a no-op passthrough under this test
 * runtime (verified directly), so merge the `style` array by hand — the
 * same left-to-right, later-layer-wins semantics RN applies natively. */
function baseStyle(style: unknown): Record<string, unknown> {
  const layers = Array.isArray(style) ? style : [style];
  const merged: Record<string, unknown> = {};
  for (const layer of layers) {
    if (layer && typeof layer === 'object') Object.assign(merged, layer);
  }
  return merged;
}

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PARENT_ID = '22222222-2222-4222-8222-222222222222';
const AMARA_ID = '33333333-3333-4333-8333-333333333333';
const BEA_ID = '44444444-4444-4444-8444-444444444444';
/** `household_members.id` values — 058's per-membership bucket key. */
const EMMA_A_MEMBER_ID = '55555555-5555-4555-8555-555555555555';
const EMMA_B_MEMBER_ID = '66666666-6666-4666-8666-666666666666';
// Pin the wall clock: fixtures below use absolute times on "today", and the
// card's arriving-vs-scheduled split depends on now (ARRIVING_WINDOW_MS) —
// unpinned, this file goes red in the hour before an 18:00Z fixture starts.
setSystemTime(new Date('2026-08-06T12:00:00Z'));
afterAll(() => setSystemTime());

const TIME_ZONE = 'UTC';
const TODAY = localDateInZone(TIME_ZONE);

let NannyLiveStatusCard: typeof import('../components/NannyLiveStatusCard').NannyLiveStatusCard;
let mockUseWeekTimeEntries: ReturnType<typeof mock>;
let mockUseShiftsRange: ReturnType<typeof mock>;

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
  mockUseShiftsRange = mock(() => ({ data: [] as unknown[] }));
  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: mockUseShiftsRange,
  }));
  mockUseWeekTimeEntries = mock(() => ({ data: [] as TimeEntry[] }));
  mock.module('@/src/hooks/queries/useWeekTimeEntries', () => ({
    useWeekTimeEntries: mockUseWeekTimeEntries,
  }));

  const mod = await import('../components/NannyLiveStatusCard');
  NannyLiveStatusCard = mod.NannyLiveStatusCard;
});

describe('NannyLiveStatusCard finished arm', () => {
  it('F-B1-3-sibling: gives each carer her OWN duration, never the household sum', () => {
    // Amara: 08:00-16:00 (8h). Bea: 08:00-12:00 (4h).
    // The old single-winner card named Amara and summed both: 12h.
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

    expect(getByText('Amara')).toBeTruthy();
    expect(getByText('Bea')).toBeTruthy();
    expect(getByText(/"duration":"8h"/)).toBeTruthy();
    expect(getByText(/"duration":"4h"/)).toBeTruthy();
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

    expect(getByText('Amara')).toBeTruthy();
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

  // C1 / migration 058 — the mirror of ParentWeekView's case. The
  // display-name fallback above tells two departed carers apart only while
  // their names differ; two Emmas merge, and the card reports one Emma's day
  // as the sum of both. 058's `household_member_id` is stamped at insert, so
  // it is still on the row after the account is gone.
  it('two departed carers who SHARED a name are kept apart by their membership ids', () => {
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        makeEntry({
          id: 'entry-emma-a',
          carer_id: null,
          carer_display_name: 'Emma',
          household_member_id: EMMA_A_MEMBER_ID,
          clock_in_at: `${TODAY}T08:00:00.000Z`,
          clock_out_at: `${TODAY}T16:00:00.000Z`, // last out -> named
        }),
        makeEntry({
          id: 'entry-emma-b',
          carer_id: null,
          carer_display_name: 'Emma',
          household_member_id: EMMA_B_MEMBER_ID,
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

  // F2 (C1 round 2). The duration was hers; the NAME was not. `nameFor` takes
  // a user id, and a departed carer has none — so the card read "Someone has
  // finished — 8h today" while her own display-name snapshot sat unread on
  // every one of those rows.
  it('F2: names a departed carer from her snapshot rather than "Someone"', () => {
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        makeEntry({
          id: 'entry-emma',
          carer_id: null,
          carer_display_name: 'Emma',
          household_member_id: EMMA_A_MEMBER_ID,
          clock_in_at: `${TODAY}T08:00:00.000Z`,
          clock_out_at: `${TODAY}T16:00:00.000Z`,
        }),
      ],
    });

    const { getByText } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    expect(getByText('Emma')).toBeTruthy();
    expect(getByText(/"duration":"8h"/)).toBeTruthy();
  });

  it('one departed carer, two sessions in a day: still summed under her own id', () => {
    // The other direction — the membership key must not split one person.
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        makeEntry({
          id: 'entry-emma-morning',
          carer_id: null,
          carer_display_name: 'Emma',
          household_member_id: EMMA_A_MEMBER_ID,
          clock_in_at: `${TODAY}T08:00:00.000Z`,
          clock_out_at: `${TODAY}T12:00:00.000Z`,
        }),
        makeEntry({
          id: 'entry-emma-afternoon',
          carer_id: null,
          carer_display_name: 'Emma',
          household_member_id: EMMA_A_MEMBER_ID,
          clock_in_at: `${TODAY}T13:00:00.000Z`,
          clock_out_at: `${TODAY}T17:00:00.000Z`,
        }),
      ],
    });

    const { getByText } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    expect(getByText(/"duration":"8h"/)).toBeTruthy();
  });

  it('pre-058 rows (no membership id) keep the display-name fallback', () => {
    // Rows NULLed before 058 ran cannot be backfilled — their memberships
    // were cascade-deleted. They keep today's behaviour: told apart by name,
    // merged when the name is shared. Pinned so the fallback is not dropped.
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        makeEntry({
          id: 'entry-legacy-1',
          carer_id: null,
          carer_display_name: 'Departed Carer 1',
          clock_in_at: `${TODAY}T08:00:00.000Z`,
          clock_out_at: `${TODAY}T16:00:00.000Z`,
        }),
        makeEntry({
          id: 'entry-legacy-2',
          carer_id: null,
          carer_display_name: 'Departed Carer 2',
          clock_in_at: `${TODAY}T08:00:00.000Z`,
          clock_out_at: `${TODAY}T14:00:00.000Z`,
        }),
      ],
    });

    const { getByText } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    expect(getByText(/"duration":"8h"/)).toBeTruthy();
  });
});

describe("NannyLiveStatusCard Today's cover rows", () => {
  it('renders one row per carer: the live one first, the finished one after', () => {
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        // Bea finished earlier today; Amara is still on the clock. Sorted by
        // state, Amara (live) must come first however the rows arrive.
        makeEntry({
          id: 'entry-bea',
          carer_id: BEA_ID,
          carer_display_name: 'Bea',
          clock_in_at: `${TODAY}T06:00:00.000Z`,
          clock_out_at: `${TODAY}T10:00:00.000Z`,
        }),
        makeEntry({
          id: 'entry-amara',
          carer_id: AMARA_ID,
          carer_display_name: 'Amara',
          status: 'running',
          clock_in_at: `${TODAY}T11:00:00.000Z`,
          clock_out_at: null,
        }),
      ],
    });

    const { getByTestId, getAllByTestId, getByText } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    expect(getByText('todayCoverTitle')).toBeTruthy();
    const rows = getAllByTestId(/^today-cover-row-/);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.props.testID).toBe(`today-cover-row-${AMARA_ID}`);
    expect(rows[1]?.props.testID).toBe(`today-cover-row-${BEA_ID}`);
    // The apricot live dot belongs to the live row only.
    expect(getByTestId(`today-cover-live-dot-${AMARA_ID}`)).toBeTruthy();
    expect(getByText(/stateLive::/)).toBeTruthy();
    expect(getByText(/stateFinished::.*"duration":"4h"/)).toBeTruthy();
  });

  it("gives a scheduled carer her own row when she hasn't clocked in yet", () => {
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        makeEntry({
          id: 'entry-amara',
          carer_id: AMARA_ID,
          carer_display_name: 'Amara',
          status: 'running',
          clock_in_at: `${TODAY}T08:00:00.000Z`,
          clock_out_at: null,
        }),
      ],
    });
    mockUseShiftsRange.mockReturnValue({
      data: [
        // Bea's evening shift — far enough out to read as "scheduled".
        {
          id: 'shift-bea',
          household_id: HOUSEHOLD_ID,
          carer_id: BEA_ID,
          local_date: TODAY,
          status: 'confirmed',
          starts_at: `${TODAY}T18:00:00.000Z`,
          ends_at: `${TODAY}T22:00:00.000Z`,
        },
        // Amara is already on the clock — her shift must NOT add a second row.
        {
          id: 'shift-amara',
          household_id: HOUSEHOLD_ID,
          carer_id: AMARA_ID,
          local_date: TODAY,
          status: 'confirmed',
          starts_at: `${TODAY}T08:00:00.000Z`,
          ends_at: `${TODAY}T16:00:00.000Z`,
        },
      ],
    });

    const { getAllByTestId, getByText } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    const rows = getAllByTestId(/^today-cover-row-/);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.props.testID).toBe(`today-cover-row-${AMARA_ID}`);
    expect(getByText('Bea')).toBeTruthy();
    expect(getByText(/stateScheduled::/)).toBeTruthy();
  });

  it('falls back to the no-cover copy when nothing is on today', () => {
    mockUseWeekTimeEntries.mockReturnValue({ data: [] });
    mockUseShiftsRange.mockReturnValue({ data: [] });

    const { getByText, queryAllByTestId } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    expect(queryAllByTestId(/^today-cover-row-/)).toHaveLength(0);
    expect(getByText('nannyNoShiftTitle')).toBeTruthy();
    expect(getByText('nannyNoShiftBody')).toBeTruthy();
  });
});

describe('NannyLiveStatusCard voided entries (069 soft delete)', () => {
  it('excludes voided minutes from a finished carer today duration', () => {
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        makeEntry({
          id: 'entry-voided',
          carer_id: AMARA_ID,
          carer_display_name: 'Amara',
          status: 'voided',
          clock_in_at: `${TODAY}T06:00:00.000Z`,
          clock_out_at: `${TODAY}T10:00:00.000Z`,
        }),
        makeEntry({
          id: 'entry-real',
          carer_id: AMARA_ID,
          carer_display_name: 'Amara',
          status: 'submitted',
          clock_in_at: `${TODAY}T12:00:00.000Z`,
          clock_out_at: `${TODAY}T16:00:00.000Z`,
        }),
      ],
    });
    mockUseShiftsRange.mockReturnValue({ data: [] });

    const { getByText, queryByText } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    expect(getByText(/"duration":"4h"/)).toBeTruthy();
    expect(queryByText(/"duration":"8h"/)).toBeNull();
  });

  it('does not treat a voided-only carer as finished for today', () => {
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        makeEntry({
          id: 'entry-voided-only',
          carer_id: AMARA_ID,
          carer_display_name: 'Amara',
          status: 'voided',
          clock_in_at: `${TODAY}T08:00:00.000Z`,
          clock_out_at: `${TODAY}T16:00:00.000Z`,
        }),
      ],
    });
    mockUseShiftsRange.mockReturnValue({ data: [] });

    const { queryByText } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    expect(queryByText(/stateFinished::/)).toBeNull();
  });
});

// P0-6/eyebrow-headline (Wave 1-D): "Today's cover" is the label, the
// carer's name is the fact — so the label drops to MetadataLabel (13/18)
// and the name is promoted to H4 (18/27 @600), no longer tied at Body/600
// (16/24) with its own subtitle underneath it.
describe('NannyLiveStatusCard title scale (P0-6 eyebrow/headline)', () => {
  it('renders "Today\'s cover" as a MetadataLabel eyebrow, not Small', () => {
    mockUseWeekTimeEntries.mockReturnValue({ data: [] });
    mockUseShiftsRange.mockReturnValue({ data: [] });

    const { getByText } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    const style = baseStyle(getByText('todayCoverTitle').props.style);
    expect(style.fontSize).toBe(13);
    expect(style.lineHeight).toBe(18);
  });

  it("promotes the carer's name to H4 (18/27), not Body semibold (16/24)", () => {
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        makeEntry({
          carer_id: AMARA_ID,
          carer_display_name: 'Amara',
          status: 'running',
          clock_in_at: `${TODAY}T08:00:00.000Z`,
          clock_out_at: null,
        }),
      ],
    });
    mockUseShiftsRange.mockReturnValue({ data: [] });

    const { getByText } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    const style = baseStyle(getByText('Amara').props.style);
    expect(style.fontSize).toBe(18);
    expect(style.lineHeight).toBe(27);
  });

  it('promotes the empty-state title to H4, not Body semibold', () => {
    mockUseWeekTimeEntries.mockReturnValue({ data: [] });
    mockUseShiftsRange.mockReturnValue({ data: [] });

    const { getByText } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    const style = baseStyle(getByText('nannyNoShiftTitle').props.style);
    expect(style.fontSize).toBe(18);
    expect(style.lineHeight).toBe(27);
  });
});

// Wave 2-D: a per-row 8px dot by `kind` — only `live` got one before. The
// live dot stays the protected `LiveDot` (apricot, GOLDEN-FIXES vocabulary);
// the other three kinds get a plain coloured dot.
describe('NannyLiveStatusCard per-kind dot colour (Wave 2-D)', () => {
  it('colours a finished row success #4A7A5C', () => {
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        makeEntry({
          carer_id: AMARA_ID,
          carer_display_name: 'Amara',
          clock_in_at: `${TODAY}T08:00:00.000Z`,
          clock_out_at: `${TODAY}T10:00:00.000Z`,
        }),
      ],
    });
    mockUseShiftsRange.mockReturnValue({ data: [] });

    const { getByTestId } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    const dot = getByTestId(`today-cover-dot-${AMARA_ID}`);
    expect(baseStyle(dot.props.style).backgroundColor).toBe('#4A7A5C');
  });

  it('colours an arriving row warning #C08A3E', () => {
    mockUseWeekTimeEntries.mockReturnValue({ data: [] });
    mockUseShiftsRange.mockReturnValue({
      data: [
        {
          id: 'shift-bea',
          household_id: HOUSEHOLD_ID,
          carer_id: BEA_ID,
          local_date: TODAY,
          status: 'confirmed',
          // Pinned "now" is 12:00Z — 30 min out is inside the 1h arriving window.
          starts_at: `${TODAY}T12:30:00.000Z`,
          ends_at: `${TODAY}T16:00:00.000Z`,
        },
      ],
    });

    const { getByTestId } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    const dot = getByTestId(`today-cover-dot-shift-${BEA_ID}`);
    expect(baseStyle(dot.props.style).backgroundColor).toBe('#C08A3E');
  });

  it('colours a scheduled row borderStrong #D2C5CD', () => {
    mockUseWeekTimeEntries.mockReturnValue({ data: [] });
    mockUseShiftsRange.mockReturnValue({
      data: [
        {
          id: 'shift-bea',
          household_id: HOUSEHOLD_ID,
          carer_id: BEA_ID,
          local_date: TODAY,
          status: 'confirmed',
          // Hours out — well past the arriving window.
          starts_at: `${TODAY}T18:00:00.000Z`,
          ends_at: `${TODAY}T22:00:00.000Z`,
        },
      ],
    });

    const { getByTestId } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    const dot = getByTestId(`today-cover-dot-shift-${BEA_ID}`);
    expect(baseStyle(dot.props.style).backgroundColor).toBe('#D2C5CD');
  });

  it('keeps the protected LiveDot (no plain dot) for a live row', () => {
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        makeEntry({
          carer_id: AMARA_ID,
          carer_display_name: 'Amara',
          status: 'running',
          clock_in_at: `${TODAY}T08:00:00.000Z`,
          clock_out_at: null,
        }),
      ],
    });
    mockUseShiftsRange.mockReturnValue({ data: [] });

    const { getByTestId, queryByTestId } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    expect(getByTestId(`today-cover-live-dot-${AMARA_ID}`)).toBeTruthy();
    expect(queryByTestId(`today-cover-dot-${AMARA_ID}`)).toBeNull();
  });
});

// Wave 2-D: "nothing is happening, so nothing should lift" — the empty
// state drops to bg-muted with no elevation instead of a lifted white card.
describe('NannyLiveStatusCard empty-state surface (Wave 2-D)', () => {
  it('drops the card to bg-muted with no shadow when there is no cover today', () => {
    mockUseWeekTimeEntries.mockReturnValue({ data: [] });
    mockUseShiftsRange.mockReturnValue({ data: [] });

    const { getByTestId } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    const card = getByTestId('today-nanny-live-status-card');
    expect(String(card.props.className)).toContain('bg-muted');
    const style = baseStyle(card.props.style) as { boxShadow?: unknown[] };
    expect(style.boxShadow).toEqual([]);
  });

  it('keeps the normal card surface once there is a row', () => {
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        makeEntry({
          carer_id: AMARA_ID,
          carer_display_name: 'Amara',
          clock_in_at: `${TODAY}T08:00:00.000Z`,
          clock_out_at: `${TODAY}T10:00:00.000Z`,
        }),
      ],
    });
    mockUseShiftsRange.mockReturnValue({ data: [] });

    const { getByTestId } = render(
      <NannyLiveStatusCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    const card = getByTestId('today-nanny-live-status-card');
    expect(String(card.props.className)).not.toContain('bg-muted');
  });
});
