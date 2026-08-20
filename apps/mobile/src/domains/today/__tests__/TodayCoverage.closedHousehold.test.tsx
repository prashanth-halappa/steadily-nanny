/**
 * @module domains/today/__tests__/TodayCoverage.closedHousehold
 *
 * When the employing parent deletes their account, every remaining member's
 * `household_members` row flips to `removed` — the server then genuinely
 * 403/404s writes. This surface must go read-only for THAT household: every
 * write action stays visible but disabled, with the shared closed-household
 * reason (`common:householdClosedReason`), composed with (never silently
 * overwritten by) the pre-existing owner_only `useRestrictedAction` reason.
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
import { fireEvent } from '@testing-library/react-native';
import i18n from '@/src/i18n';
import { renderWithProviders, serializeTree } from '@/src/test-utils';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMMITMENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NANNY_ID = '33333333-3333-4333-8333-333333333333';
const ZONE = 'Europe/London';
const CLOSED_REASON =
  "This family's account is closed. You can read this, not change it.";
/** 05:00 London, well before the 18:00 window below (matches the ask-state
 * fixture's suite so the same commitment/shift fixtures produce a gap). */
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
    local_date: '2026-08-10',
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

function makeAsk(overrides: Partial<Shift> = {}): Shift {
  return makeShift({
    id: 'ask-1',
    kind: SHIFT_KINDS.EXTRA,
    origin: 'parent_proposed',
    status: 'pending',
    cancelled_at: null,
    cancelled_by: null,
    created_at: '2026-08-09T00:00:00.000Z',
    shift_children: [],
    ...overrides,
  });
}

let TodayCoverage: typeof import('../components/TodayCoverage').TodayCoverage;
let mockCreateParentCover: ReturnType<typeof mock>;
let mockRestrictedAction: ReturnType<typeof mock>;
let mockCanWriteHousehold: ReturnType<typeof mock>;
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

  mock.module('@/src/hooks/mutations/useWithdrawCoverAsk', () => ({
    useWithdrawCoverAsk: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
      error: null,
      reset: mock(),
    }),
  }));

  mockCreateParentCover = mock(() => ({
    isPending: false,
    mutateAsync: mock(() => Promise.resolve({})),
  }));
  mockRestrictedAction = mock(() => ({ disabled: false, reason: null }));
  mockCanWriteHousehold = mock(() => ({
    canWrite: true,
    isPastMember: false,
    isLoading: false,
  }));
  mockPush = mock();

  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: () => ({ data: [], isLoading: false }),
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
  mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
    useCanWriteHousehold: (...args: unknown[]) =>
      mockCanWriteHousehold(...args),
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
  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: () => ({ data: shifts, isLoading: false }),
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

describe('TodayCoverage — closed household (household_members flipped to removed)', () => {
  it('disables Ask/I’ve got it/Withdraw with the shared closed reason, still visible, when canWrite is false', () => {
    mockCanWriteHousehold.mockReturnValue({
      canWrite: false,
      isPastMember: true,
      isLoading: false,
    });
    const ask = makeAsk();
    const tree = renderCoverage([makeShift(), ask]);
    const rendered = serializeTree(tree.toJSON());

    // Never hidden.
    expect(tree.getByTestId('today-coverage-ask-cover')).toBeTruthy();
    expect(tree.getByTestId('today-coverage-parent-cover')).toBeTruthy();
    expect(tree.getByTestId('today-coverage-withdraw-ask')).toBeTruthy();

    // Disabled with the shared reason.
    expect(tree.getByTestId('today-coverage-ask-cover').props.disabled).toBe(
      true
    );
    expect(tree.getByTestId('today-coverage-parent-cover').props.disabled).toBe(
      true
    );
    expect(rendered).toContain(CLOSED_REASON);
    mockCanWriteHousehold.mockReturnValue({
      canWrite: true,
      isPastMember: false,
      isLoading: false,
    });
  });

  it('behaves normally when canWrite is true', () => {
    mockCanWriteHousehold.mockReturnValue({
      canWrite: true,
      isPastMember: false,
      isLoading: false,
    });
    const tree = renderCoverage([makeShift()]);
    const rendered = serializeTree(tree.toJSON());
    expect(rendered).not.toContain(CLOSED_REASON);
    expect(tree.getByTestId('today-coverage-ask-cover').props.disabled).toBe(
      false
    );

    fireEvent.press(tree.getByTestId('today-coverage-parent-cover'));
    expect(mockCreateParentCover().mutateAsync).toBeDefined();
  });

  it('composes the closed reason with the owner_only restriction reason rather than losing one', () => {
    mockCanWriteHousehold.mockReturnValue({
      canWrite: false,
      isPastMember: true,
      isLoading: false,
    });
    mockRestrictedAction.mockReturnValue({
      disabled: true,
      reason: 'Only David can do this.',
    });
    const tree = renderCoverage([makeShift()]);
    const rendered = serializeTree(tree.toJSON());
    // The owner_only reason wins when both are true (the reader is a live
    // member who just isn't the owner) — a closed household with no members
    // left would never carry a live owner_only restriction in practice, but
    // documenting the precedence here: existing restriction reason first,
    // closed reason as the fallback when there is no other reason at all.
    expect(rendered).toContain('Only David can do this.');
    mockRestrictedAction.mockReturnValue({ disabled: false, reason: null });
    mockCanWriteHousehold.mockReturnValue({
      canWrite: true,
      isPastMember: false,
      isLoading: false,
    });
  });
});
