/**
 * @module domains/today/__tests__/TodayCoverage.askState
 *
 * §2.4a — the cover-ask lifecycle inside the gap card's cause line + action
 * row. 3-T3 shipped the wire (`cover_ask_expires_at`) and the T-12h
 * escalation; the per-ask-state cause lines and action rows are this slice's.
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
import type { ChildCommitment } from '@steadily-nanny/shared-types/schemas/child.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_KINDS } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { fireEvent, waitFor } from '@testing-library/react-native';
import i18n from '@/src/i18n';
import { renderWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMMITMENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NANNY_ID = '33333333-3333-4333-8333-333333333333';
const ZONE = 'Europe/London';
const LOCAL_DATE = '2026-08-10';
/**
 * 05:00 London, well over 12h before the 18:00 window below — deliberately
 * OUTSIDE §5.4's T-12h self-escalation so these tests isolate the ask-state
 * cause line/action row from the (already-shipped, 3-T3) escalation copy.
 */
const PINNED_NOW = new Date('2026-08-10T04:00:00.000Z');

setSystemTime(PINNED_NOW);
afterAll(() => setSystemTime());

function makeCommitment(): ChildCommitment {
  return {
    id: COMMITMENT_ID,
    child_id: CHILD_ID,
    household_id: HOUSEHOLD_ID,
    kind: 'school',
    label: null,
    rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    start_time: '18:00:00',
    end_time: '22:00:00',
    starts_on: null,
    ends_on: null,
    exdates: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    household_id: HOUSEHOLD_ID,
    carer_id: NANNY_ID,
    starts_at: '2026-08-10T17:00:00.000Z',
    ends_at: '2026-08-10T21:00:00.000Z',
    timezone: ZONE,
    local_date: LOCAL_DATE,
    kind: SHIFT_KINDS.RECURRING,
    status: 'cancelled',
    source_pattern_id: null,
    origin: 'system_generated',
    is_short_notice: false,
    note: null,
    reason: null,
    cancelled_at: '2026-08-08T00:00:00.000Z',
    cancelled_by: NANNY_ID,
    cancellation_paid: false,
    cancellation_message: null,
    cover_ask_expires_at: null,
    ical_uid: 'uid-1',
    sequence: 0,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    shift_children: [
      {
        id: 'sc-1',
        shift_id: 'shift-1',
        child_id: CHILD_ID,
        starts_at: '2026-08-10T17:00:00.000Z',
        ends_at: '2026-08-10T21:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

/** An outstanding cover-ask (kind=extra, carer assigned) overlapping the gap. */
function makeAsk(overrides: Partial<Shift> = {}): Shift {
  return makeShift({
    id: 'ask-1',
    kind: SHIFT_KINDS.EXTRA,
    origin: 'parent_proposed',
    cancelled_at: null,
    cancelled_by: null,
    created_at: '2026-08-09T00:00:00.000Z',
    shift_children: [],
    ...overrides,
  });
}

let TodayCoverage: typeof import('../components/TodayCoverage').TodayCoverage;
let mockShiftsRange: ReturnType<typeof mock>;
let mockCreateParentCover: ReturnType<typeof mock>;
let mockRestrictedAction: ReturnType<typeof mock>;
let mockPush: ReturnType<typeof mock>;

function household() {
  return [
    {
      user_id: NANNY_ID,
      profile_name: 'Priya',
      display_name_override: null,
      role: 'carer',
    },
  ];
}

let mockWithdrawCoverAsk: ReturnType<typeof mock>;

beforeAll(async () => {
  await i18n.changeLanguage('en');

  mock.module('react-i18next', () => ({
    useTranslation: (ns?: string | string[]) => ({
      t: (key: string, options?: Record<string, unknown>) => {
        const namespace = Array.isArray(ns)
          ? (ns[0] ?? 'today')
          : (ns ?? 'today');
        return options
          ? i18n.t(`${namespace}:${key}`, options)
          : i18n.t(`${namespace}:${key}`);
      },
      i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
    }),
    Trans: ({ children }: { children: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: mock() },
  }));

  mockWithdrawCoverAsk = mock(() => Promise.resolve({}));
  mock.module('@/src/hooks/mutations/useWithdrawCoverAsk', () => ({
    useWithdrawCoverAsk: () => ({
      mutateAsync: mockWithdrawCoverAsk,
      isPending: false,
      error: null,
      reset: mock(),
    }),
  }));

  mockShiftsRange = mock(() => ({ data: [], isLoading: false }));
  mockCreateParentCover = mock(() => ({
    isPending: false,
    mutateAsync: mock(() => Promise.resolve({})),
  }));
  mockRestrictedAction = mock(() => ({ disabled: false, reason: null }));
  mockPush = mock();

  mock.module('@/src/hooks/queries/useWeekTimeEntries', () => ({
    useWeekTimeEntries: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: mockShiftsRange,
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: () => ({ data: household(), isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdCommitments', () => ({
    useHouseholdCommitments: () => ({
      data: [makeCommitment()],
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdClosures', () => ({
    useHouseholdClosures: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/mutations/useCreateParentCover', () => ({
    useCreateParentCover: () => mockCreateParentCover(),
  }));
  mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
    useHouseholdCarers: () => ({
      data: [
        {
          user_id: NANNY_ID,
          profile_name: 'Priya',
          display_name_override: null,
        },
      ],
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useRestrictedAction', () => ({
    useRestrictedAction: (...args: unknown[]) => mockRestrictedAction(...args),
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush, back: mock(), replace: mock() }),
    router: { push: mockPush, back: mock(), replace: mock() },
    Link: 'Link',
    Redirect: 'Redirect',
    Stack: { Screen: 'StackScreen' },
    Tabs: { Screen: 'TabsScreen' },
  }));

  const mod = await import('../components/TodayCoverage');
  TodayCoverage = mod.TodayCoverage;
});

function renderCoverage(shifts: Shift[]) {
  mockShiftsRange = mock(() => ({ data: shifts, isLoading: false }));
  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: mockShiftsRange,
  }));
  return renderWithProviders(
    <TodayCoverage
      householdId={HOUSEHOLD_ID}
      timeZone={ZONE}
      weekStartsOn={1}
      householdChildren={[{ id: CHILD_ID, name: 'Ayla' } as never]}
    />
  );
}

describe('TodayCoverage — cover-ask lifecycle cause line + actions (§2.4a)', () => {
  it('shows the original cause line, and the default action row, when there is no ask', () => {
    const tree = renderCoverage([makeShift()]);
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('shift was cancelled');
    tree.getByTestId('today-coverage-ask-cover');
    tree.getByTestId('today-coverage-parent-cover');
    tree.getByTestId('today-coverage-hours-wrong');
  });

  it("swaps to the pending-ask cause line and drops to Ask someone else / I've got it", () => {
    const ask = makeAsk({ status: 'pending' });
    const tree = renderCoverage([makeShift(), ask]);
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('still uncovered');
    expect(rendered).toContain('You asked Priya');
    expect(rendered).not.toContain('shift was cancelled');
    expect(rendered).toContain(i18n.t('schedule:cover.askSomeoneElse'));
    tree.getByTestId('today-coverage-parent-cover');
    expect(() => tree.getByTestId('today-coverage-hours-wrong')).toThrow();
  });

  it('shows the declined-ask cause line without inventing "unavailable"/"declined" as a verdict', () => {
    const ask = makeAsk({ status: 'declined' });
    const tree = renderCoverage([makeShift(), ask]);
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain("can't cover this one");
    expect(rendered.toLowerCase()).not.toContain('unavailable');
  });

  it("shows the expired-ask cause line and offers Ask again / Ask someone else / I've got it", () => {
    const ask = makeAsk({
      status: 'cancelled',
      cancelled_by: null,
      cover_ask_expires_at: '2026-08-09T18:00:00.000Z',
    });
    const tree = renderCoverage([makeShift(), ask]);
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('expired');
    expect(rendered).toContain(
      i18n.t('schedule:cover.askAgain', { carerName: 'Priya' })
    );
    tree.getByTestId('today-coverage-ask-someone-else');
    tree.getByTestId('today-coverage-parent-cover');
  });

  it('treats a withdrawn ask (cancelled_by set) as if no ask exists — falls back to the plain cause line', () => {
    const ask = makeAsk({
      status: 'cancelled',
      cancelled_by: NANNY_ID,
      cover_ask_expires_at: '2026-08-09T18:00:00.000Z',
    });
    const tree = renderCoverage([makeShift(), ask]);
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('shift was cancelled');
    expect(rendered).not.toContain('expired');
    expect(rendered).not.toContain(i18n.t('schedule:cover.askSomeoneElse'));
  });

  it('applies the restricted-action reason to the Ask button when a co-parent is gated', () => {
    mockRestrictedAction.mockReturnValue({
      disabled: true,
      reason: 'Only David can do this.',
    });
    const tree = renderCoverage([makeShift()]);
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Only David can do this.');
    mockRestrictedAction.mockReturnValue({ disabled: false, reason: null });
  });
});

describe('TodayCoverage — withdraw the ask (§2.4a)', () => {
  it('shows a ghost Withdraw link only while the ask is pending', () => {
    const ask = makeAsk({ status: 'pending' });
    const tree = renderCoverage([makeShift(), ask]);
    tree.getByTestId('today-coverage-withdraw-ask');
    expect(JSON.stringify(tree.toJSON())).toContain(
      i18n.t('schedule:cover.withdrawAsk')
    );
  });

  it('does not show Withdraw for declined, expired, or no-ask gaps', () => {
    const declined = renderCoverage([
      makeShift(),
      makeAsk({ status: 'declined' }),
    ]);
    expect(() => declined.getByTestId('today-coverage-withdraw-ask')).toThrow();

    const expired = renderCoverage([
      makeShift(),
      makeAsk({
        status: 'cancelled',
        cancelled_by: null,
        cover_ask_expires_at: '2026-08-09T18:00:00.000Z',
      }),
    ]);
    expect(() => expired.getByTestId('today-coverage-withdraw-ask')).toThrow();

    const plain = renderCoverage([makeShift()]);
    expect(() => plain.getByTestId('today-coverage-withdraw-ask')).toThrow();
  });

  it('opens the confirm dialog with spec copy and withdraws on confirm', async () => {
    const ask = makeAsk({ status: 'pending', id: 'ask-withdraw-1' });
    const tree = renderCoverage([makeShift(), ask]);

    fireEvent.press(tree.getByTestId('today-coverage-withdraw-ask'));
    expect(JSON.stringify(tree.toJSON())).toContain(
      i18n.t('schedule:cover.withdrawAskConfirmTitle')
    );
    expect(mockWithdrawCoverAsk).not.toHaveBeenCalled();

    fireEvent.press(tree.getByTestId('today-coverage-withdraw-ask-confirm'));
    await waitFor(() =>
      expect(mockWithdrawCoverAsk).toHaveBeenCalledWith('ask-withdraw-1')
    );
  });

  it('disables Withdraw with a reason when a co-parent is restricted', () => {
    mockRestrictedAction.mockImplementation(({ action }: { action: string }) =>
      action.includes('withdraw')
        ? { disabled: true, reason: 'Only David can withdraw this ask.' }
        : { disabled: false, reason: null }
    );
    const ask = makeAsk({ status: 'pending' });
    const tree = renderCoverage([makeShift(), ask]);
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Only David can withdraw this ask.');
    mockRestrictedAction.mockReturnValue({ disabled: false, reason: null });
  });
});
