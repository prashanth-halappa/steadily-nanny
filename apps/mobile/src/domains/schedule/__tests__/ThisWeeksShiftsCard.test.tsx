/**
 * @module domains/schedule/__tests__/ThisWeeksShiftsCard.test
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, within } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';

/** The typography factory always puts the token's base style first in the
 * `style` array (`[baseStyle, weightStyle, tabularStyle, callerStyle]`) —
 * read it directly rather than via RN's `StyleSheet.flatten`, which is a
 * no-op passthrough under this test runtime. */
function baseStyle(style: unknown): Record<string, unknown> {
  const layers = Array.isArray(style) ? style : [style];
  const merged: Record<string, unknown> = {};
  for (const layer of layers) {
    if (layer && typeof layer === 'object') Object.assign(merged, layer);
  }
  return merged;
}

const HOUSEHOLD_ID = 'hh1';
const AMARA_ID = '33333333-3333-4333-8333-333333333333';
const BEA_ID = '44444444-4444-4444-8444-444444444444';

let ThisWeeksShiftsCard: typeof import('../components/ThisWeeksShiftsCard').ThisWeeksShiftsCard;
let mockPush: ReturnType<typeof mock>;
let mockUseShiftsRange: ReturnType<typeof mock>;
let mockUseHouseholdMembers: ReturnType<typeof mock>;
let mockUseSchedulePatterns: ReturnType<typeof mock>;
let refetchShifts: ReturnType<typeof mock>;
let refetchMembers: ReturnType<typeof mock>;
let refetchPatterns: ReturnType<typeof mock>;

function member(userId: string, profileName: string) {
  return {
    id: `member-${userId}`,
    household_id: HOUSEHOLD_ID,
    user_id: userId,
    role: 'nanny',
    can_edit: false,
    status: 'active',
    display_name_override: null,
    profile_name: profileName,
    colour: null,
    joined_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

/** Far enough ahead that the card always lists it, whenever the suite runs. */
function shift(id: string, carerId: string, day: string) {
  return {
    id,
    household_id: HOUSEHOLD_ID,
    carer_id: carerId,
    local_date: day,
    status: 'confirmed',
    starts_at: `${day}T09:00:00.000Z`,
    ends_at: `${day}T17:00:00.000Z`,
  };
}

const SHIFTS = [
  shift('shift-a', AMARA_ID, '2099-08-06'),
  shift('shift-b', BEA_ID, '2099-08-07'),
];

beforeAll(async () => {
  mockPush = mock();
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush }),
  }));
  // The global key-echo mock (bun.setup.ts) drops interpolation vars — the
  // merged "Next up · {{name}}" eyebrow needs the name to actually land, so
  // re-mock locally with a minimal interpolation, same pattern
  // SchedulePatternBanner.test.tsx uses.
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, opts?: { name?: string }) =>
        opts?.name === undefined ? key : `${key}(${opts.name})`,
      i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
    }),
    Trans: ({ children }: { children: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: () => ({
      householdId: HOUSEHOLD_ID,
      household: { timezone: 'Europe/London' },
    }),
  }));
  refetchShifts = mock();
  refetchMembers = mock();
  refetchPatterns = mock();
  mockUseShiftsRange = mock(() => ({
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: refetchShifts,
  }));
  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: mockUseShiftsRange,
  }));
  mockUseHouseholdMembers = mock(() => ({
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: refetchMembers,
  }));
  // The card now forks its empty line on whether a weekly schedule was ever
  // sent, so both reads have to be stubbed or every render hits a real
  // useQuery with no provider.
  mockUseSchedulePatterns = mock(() => ({
    data: [],
    isLoading: false,
    isPending: false,
    isError: false,
    refetch: refetchPatterns,
  }));
  mock.module('@/src/hooks/queries/useSchedulePatterns', () => ({
    useSchedulePatterns: mockUseSchedulePatterns,
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({ role: 'parent' }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: mockUseHouseholdMembers,
  }));

  const mod = await import('../components/ThisWeeksShiftsCard');
  ThisWeeksShiftsCard = mod.ThisWeeksShiftsCard;
});

beforeEach(() => {
  mockUseShiftsRange.mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
    refetch: refetchShifts,
  });
  mockUseHouseholdMembers.mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
    refetch: refetchMembers,
  });
  mockUseSchedulePatterns.mockReturnValue({
    data: [],
    isLoading: false,
    isPending: false,
    isError: false,
    refetch: refetchPatterns,
  });
  useAuthStore.setState({ user: null } as never);
});

describe('ThisWeeksShiftsCard', () => {
  it('renders the Next up card', () => {
    const { getByTestId } = render(<ThisWeeksShiftsCard />);
    expect(getByTestId('today-shifts-card')).toBeTruthy();
  });

  it('navigates to /schedule/shifts from the calendar link', () => {
    const { getByTestId } = render(<ThisWeeksShiftsCard />);
    const cta = getByTestId('today-shifts-cta');
    cta.props.onPress?.();
    expect(mockPush).toHaveBeenCalledWith('/(private)/schedule/shifts');
  });

  it('one-carer household: names her once in the eyebrow, not on every row', () => {
    mockUseShiftsRange.mockReturnValue({ data: SHIFTS });
    mockUseHouseholdMembers.mockReturnValue({
      data: [member(AMARA_ID, 'Amara Okafor')],
    });

    const { getByTestId, queryByTestId } = render(<ThisWeeksShiftsCard />);

    // Her FULL name, once, merged into the "Next up · {{name}}" eyebrow —
    // repeating it per row is noise in a one-carer home.
    expect(
      within(getByTestId('today-next-up-carer')).getByText(
        'todayCard.nextUpTitleWithCarer(Amara Okafor)'
      )
    ).toBeTruthy();
    expect(queryByTestId('today-next-up-carer-shift-a')).toBeNull();
  });

  it('two-carer household: each row carries its own carer first name', () => {
    mockUseShiftsRange.mockReturnValue({ data: SHIFTS });
    mockUseHouseholdMembers.mockReturnValue({
      data: [member(AMARA_ID, 'Amara Okafor'), member(BEA_ID, 'Beatriz Ruiz')],
    });

    const { getByTestId, queryByTestId } = render(<ThisWeeksShiftsCard />);

    expect(queryByTestId('today-next-up-carer')).toBeNull();
    expect(getByTestId('today-next-up-carer-shift-a').props.children).toBe(
      'Amara'
    );
    expect(getByTestId('today-next-up-carer-shift-b').props.children).toBe(
      'Beatriz'
    );
  });

  // Agenda ShiftRow uses resolveMemberDisplayName → "You" when the viewer
  // owns the shift; this card used resolveCarerName and showed her own name.
  it('two-carer household: viewer sees "You" on her own upcoming shift', () => {
    mockUseShiftsRange.mockReturnValue({ data: SHIFTS });
    mockUseHouseholdMembers.mockReturnValue({
      data: [member(AMARA_ID, 'Amara Okafor'), member(BEA_ID, 'Beatriz Ruiz')],
    });
    useAuthStore.setState({ user: { id: AMARA_ID } } as never);

    const { getByTestId } = render(<ThisWeeksShiftsCard />);

    expect(getByTestId('today-next-up-carer-shift-a').props.children).toBe(
      'detail.you'
    );
    expect(getByTestId('today-next-up-carer-shift-b').props.children).toBe(
      'Beatriz'
    );
  });

  // Documented: an unresolvable carer / nameless member contributes no label
  // at all — not "Someone", not a role word. Empty someone/roleFallback keep
  // resolveMemberDisplayName while restoring that silence.
  it('two-carer household: unresolvable or nameless carer renders no row label', () => {
    const UNKNOWN_ID = '99999999-9999-4999-8999-999999999999';
    const nameless = {
      ...member(BEA_ID, ''),
      profile_name: null,
      display_name_override: null,
    };
    mockUseShiftsRange.mockReturnValue({
      data: [
        shift('shift-unknown', UNKNOWN_ID, '2099-08-06'),
        shift('shift-nameless', BEA_ID, '2099-08-07'),
      ],
    });
    mockUseHouseholdMembers.mockReturnValue({
      data: [member(AMARA_ID, 'Amara Okafor'), nameless],
    });

    const { queryByTestId } = render(<ThisWeeksShiftsCard />);

    expect(queryByTestId('today-next-up-carer-shift-unknown')).toBeNull();
    expect(queryByTestId('today-next-up-carer-shift-nameless')).toBeNull();
  });

  // Narrow rows used to cap the name at 38% + ellipsize, so "Andrea" became
  // "A...". Time must yield; the name must keep its full first token.
  it('does not truncate the carer name — time Figure yields space first', () => {
    mockUseShiftsRange.mockReturnValue({ data: SHIFTS });
    mockUseHouseholdMembers.mockReturnValue({
      data: [member(AMARA_ID, 'Andrea Smith'), member(BEA_ID, 'Beatriz Ruiz')],
    });

    const { getByTestId } = render(<ThisWeeksShiftsCard />);
    const name = getByTestId('today-next-up-carer-shift-a');
    const line = getByTestId('today-next-up-line-shift-a');

    expect(name.props.children).toBe('Andrea');
    expect(String(name.props.className ?? '')).not.toContain('max-w-[');
    expect(name.props.numberOfLines).toBeUndefined();
    expect(name.props.ellipsizeMode).toBeUndefined();
    expect(String(line.props.className ?? '')).toMatch(/flex-1|shrink/);
  });

  it('rows meet the 44pt touch target, carry hit slop, and take the row surface', () => {
    mockUseShiftsRange.mockReturnValue({ data: SHIFTS });

    const { getByTestId } = render(<ThisWeeksShiftsCard />);
    const row = getByTestId('today-next-up-shift-a');

    expect(row.props.hitSlop).toBe(8);
    const style = baseStyle(row.props.style);
    expect(style.minHeight).toBe(44);
    // Wave 2-F (T4): the row itself carries `rounded-row bg-card` +
    // `elevation.row` — the card wrapper around them is gone.
    expect(style.boxShadow).toBeTruthy();
    expect(String(row.props.className)).toContain('rounded-row');
    expect(String(row.props.className)).toContain('bg-card');
  });

  it('shows the weekday in its short form so the row stays on one line', () => {
    mockUseShiftsRange.mockReturnValue({ data: SHIFTS });

    const { getByTestId } = render(<ThisWeeksShiftsCard />);
    const line = getByTestId('today-next-up-line-shift-a').props
      .children as string;

    expect(line).toContain('weekdayShort.');
    expect(line).not.toContain('weekday.');
  });

  // Section adoption: the "Next up" title is now a Section header (DayGroup,
  // 17/24/700) rather than a MetadataLabel eyebrow (13/18) — the group
  // heading is no longer smaller than the rows it labels.
  it('renders the "Next up" title as a Section header', () => {
    const { getByText } = render(<ThisWeeksShiftsCard />);

    const style = baseStyle(getByText('todayCard.nextUpTitle').props.style);
    expect(style.fontSize).toBe(17);
    expect(style.lineHeight).toBe(24);
  });

  it('has no card surface around the rows — bare ground, no shadow', () => {
    const { getByTestId } = render(<ThisWeeksShiftsCard />);

    const outer = getByTestId('today-shifts-card');
    const style = baseStyle(outer.props.style);
    expect(style.boxShadow).toBeFalsy();
    expect(String(outer.props.className ?? '')).not.toContain('bg-card');
  });

  // Review fix: a nanny viewing her own Today saw "Test Nanny" — her own
  // name, on her own screen, pure noise. The sole-carer summary line is
  // useful only when the VIEWER isn't that carer (the parent/helper view).
  it('hides the sole-carer name when the viewer IS that carer', () => {
    mockUseShiftsRange.mockReturnValue({ data: SHIFTS });
    mockUseHouseholdMembers.mockReturnValue({
      data: [member(AMARA_ID, 'Amara Okafor')],
    });
    useAuthStore.setState({ user: { id: AMARA_ID } } as never);

    const { queryByTestId } = render(<ThisWeeksShiftsCard />);

    expect(queryByTestId('today-next-up-carer')).toBeNull();
  });

  it('still shows the sole-carer name to a viewer who is NOT that carer', () => {
    mockUseShiftsRange.mockReturnValue({ data: SHIFTS });
    mockUseHouseholdMembers.mockReturnValue({
      data: [member(AMARA_ID, 'Amara Okafor')],
    });
    useAuthStore.setState({ user: { id: 'parent-1' } } as never);

    const { getByTestId } = render(<ThisWeeksShiftsCard />);

    expect(
      within(getByTestId('today-next-up-carer')).getByText(
        'todayCard.nextUpTitleWithCarer(Amara Okafor)'
      )
    ).toBeTruthy();
  });

  it('shows a StatusPill on a row whose status is not confirmed', () => {
    mockUseShiftsRange.mockReturnValue({
      data: [
        { ...SHIFTS[0], status: 'pending' },
        { ...SHIFTS[1], status: 'confirmed' },
      ],
    });

    const { getByTestId, queryByTestId } = render(<ThisWeeksShiftsCard />);

    expect(getByTestId('today-next-up-status-shift-a')).toBeTruthy();
    expect(queryByTestId('today-next-up-status-shift-b')).toBeNull();
  });

  it('excludes declined shifts from Next up — they must not show a Pending pill', () => {
    const declinedShift = {
      ...shift('shift-declined', AMARA_ID, '2099-08-08'),
      status: 'declined',
    };
    mockUseShiftsRange.mockReturnValue({ data: [declinedShift] });

    const { queryByTestId } = render(<ThisWeeksShiftsCard />);

    expect(queryByTestId('today-next-up-shift-declined')).toBeNull();
    expect(queryByTestId('today-next-up-status-shift-declined')).toBeNull();
  });
});

// False alarm (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B): this card had NO
// loading or error gate at all — a still-loading or failed read fell
// straight through to the empty-fortnight branch, accusing the parent of
// never setting up a week she DID set up.
describe('ThisWeeksShiftsCard — loading and error (no gate existed before)', () => {
  it('renders a loading skeleton, never the empty-week copy, while shifts are still loading', () => {
    mockUseShiftsRange.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: refetchShifts,
    });

    const { getByTestId, queryByTestId } = render(<ThisWeeksShiftsCard />);

    expect(getByTestId('today-shifts-skeleton')).toBeTruthy();
    expect(queryByTestId('today-shifts-empty')).toBeNull();
  });

  it('renders InlineRetry, never the empty-week copy, when shifts failed', () => {
    mockUseShiftsRange.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: refetchShifts,
    });

    const { getByTestId, queryByTestId } = render(<ThisWeeksShiftsCard />);

    expect(getByTestId('today-shifts-retry')).toBeTruthy();
    expect(queryByTestId('today-shifts-empty')).toBeNull();
  });

  it('wires the retry to the failed query only', () => {
    mockUseShiftsRange.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: refetchShifts,
    });

    const { getByTestId } = render(<ThisWeeksShiftsCard />);
    getByTestId('today-shifts-retry-button').props.onPress?.();

    expect(refetchShifts).toHaveBeenCalledTimes(1);
    expect(refetchMembers).not.toHaveBeenCalled();
  });

  it('renders the ordinary card once every query is ready', () => {
    const { getByTestId, queryByTestId } = render(<ThisWeeksShiftsCard />);

    expect(getByTestId('today-shifts-card')).toBeTruthy();
    expect(queryByTestId('today-shifts-skeleton')).toBeNull();
    expect(queryByTestId('today-shifts-retry')).toBeNull();
  });
});
