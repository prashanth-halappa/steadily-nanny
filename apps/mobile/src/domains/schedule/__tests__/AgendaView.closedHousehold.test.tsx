/**
 * @module domains/schedule/__tests__/AgendaView.closedHousehold
 *
 * When the household has closed (`useCanWriteHousehold` resolves
 * canWrite:false), the Ask/I've got it buttons on an uncovered row, and the
 * Undo-covering link on a parent-cover shift row, must stay VISIBLE but
 * disabled with the shared `common:householdClosedReason` sentence — the
 * existing role-based `showUncoveredActions` hide/show behaviour is
 * untouched (that's a different, correct gate).
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { uncoveredKey } from '@steadily-nanny/shared-types/uncoveredCare';
import type { UncoveredWindowDisplay } from '@/src/domains/schedule/utils/uncoveredDisplay';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMMITMENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CLOSED_REASON =
  "This family's account is closed. You can read this, not change it.";

let mockCanWriteHousehold: ReturnType<typeof mock>;

beforeAll(async () => {
  mock.module('react-i18next', () => ({
    useTranslation: (ns?: string | string[]) => ({
      t: (key: string, vars?: Record<string, unknown>) => {
        const namespace = Array.isArray(ns) ? (ns[0] ?? '') : (ns ?? '');
        if (namespace === 'common' && key === 'householdClosedReason') {
          return CLOSED_REASON;
        }
        return vars
          ? `${namespace}:${key}:${JSON.stringify(vars)}`
          : `${namespace}:${key}`;
      },
      i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
    }),
    Trans: ({ children }: { children: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: () => {} }),
    router: { push: () => {}, replace: () => {}, back: () => {} },
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: () => ({ data: [] }),
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({
      data: [{ id: CHILD_ID, name: 'Mia' }],
      isLoading: false,
    }),
  }));
  mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
    useHouseholdCarers: () => ({ data: [] }),
  }));
  mock.module('@/src/hooks/mutations/useCreateParentCover', () => ({
    useCreateParentCover: () => ({
      mutateAsync: async () => {},
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useRemoveParentCover', () => ({
    useRemoveParentCover: () => ({
      mutateAsync: async () => {},
      isPending: false,
    }),
  }));
  mockCanWriteHousehold = mock(() => ({
    canWrite: true,
    isPastMember: false,
    isLoading: false,
  }));
  mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
    useCanWriteHousehold: (...args: unknown[]) =>
      mockCanWriteHousehold(...args),
  }));
});

let AgendaView: typeof import('../components/AgendaView').AgendaView;
let render: typeof import('@testing-library/react-native').render;

beforeAll(async () => {
  AgendaView = (await import('../components/AgendaView')).AgendaView;
  render = (await import('@testing-library/react-native')).render;
});

function makeWindow(
  startsAt = '2026-08-03T13:00:00.000Z'
): UncoveredWindowDisplay {
  return {
    childId: CHILD_ID,
    commitmentId: COMMITMENT_ID,
    startsAt,
    endsAt: '2026-08-03T17:00:00.000Z',
    cause: 'nothingScheduled',
  };
}

describe('AgendaView — closed household', () => {
  it('disables the uncovered-row Ask/I’ve got it buttons with the shared reason, still visible', () => {
    mockCanWriteHousehold.mockReturnValue({
      canWrite: false,
      isPastMember: true,
      isLoading: false,
    });
    const w = makeWindow();
    const { getByTestId } = render(
      <AgendaView
        shifts={[]}
        householdId={HOUSEHOLD_ID}
        weekDates={['2026-08-03']}
        uncoveredByDay={{ '2026-08-03': [w] }}
        showUncoveredActions
      />
    );

    const key = uncoveredKey(w);
    const askButton = getByTestId(`schedule-uncovered-ask-${key}`);
    const coverButton = getByTestId(`schedule-uncovered-cover-${key}`);
    expect(askButton).toBeTruthy();
    expect(coverButton).toBeTruthy();
    expect(askButton.props.disabled).toBe(true);
    expect(coverButton.props.disabled).toBe(true);
    expect(
      getByTestId(`schedule-uncovered-ask-${key}-reason`).props.children
    ).toBe(CLOSED_REASON);
  });

  it('leaves the buttons active with no reason when the household is open', () => {
    mockCanWriteHousehold.mockReturnValue({
      canWrite: true,
      isPastMember: false,
      isLoading: false,
    });
    const w = makeWindow();
    const { getByTestId, queryByTestId } = render(
      <AgendaView
        shifts={[]}
        householdId={HOUSEHOLD_ID}
        weekDates={['2026-08-03']}
        uncoveredByDay={{ '2026-08-03': [w] }}
        showUncoveredActions
      />
    );
    const key = uncoveredKey(w);
    expect(getByTestId(`schedule-uncovered-ask-${key}`).props.disabled).toBe(
      false
    );
    expect(queryByTestId(`schedule-uncovered-ask-${key}-reason`)).toBeNull();
  });

  it('never re-derives canWrite per row — calls the hook once with the AgendaView-level householdId', () => {
    mockCanWriteHousehold.mockClear();
    render(
      <AgendaView
        shifts={[]}
        householdId={HOUSEHOLD_ID}
        weekDates={['2026-08-03', '2026-08-04']}
        uncoveredByDay={{
          '2026-08-03': [makeWindow()],
          '2026-08-04': [makeWindow('2026-08-04T13:00:00.000Z')],
        }}
        showUncoveredActions
      />
    );
    expect(mockCanWriteHousehold).toHaveBeenCalledTimes(1);
    expect(mockCanWriteHousehold).toHaveBeenCalledWith(HOUSEHOLD_ID);
  });
});
