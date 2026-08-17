/**
 * @module domains/setup/__tests__/ManageCommitmentsSection.error
 *
 * False alarm (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B): `canOfferWeek`
 * only ever checked `isLoading` on its two gating queries — a query that
 * SETTLED WITH AN ERROR has `isLoading: false`, so a failed carers or
 * patterns read could offer "confirm this as your usual week" (or hide a
 * genuinely pending week) off data that never arrived.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';

const HOUSEHOLD_ID = 'household-1';
const CHILD_ID = 'child-1';

let ManageCommitmentsSection: typeof import('../components/ManageCommitmentsSection').ManageCommitmentsSection;
let mockUseCommitments: ReturnType<typeof mock>;
let mockUseHouseholdCarers: ReturnType<typeof mock>;
let mockUseSchedulePatterns: ReturnType<typeof mock>;

function commitment(id: string) {
  return {
    id,
    child_id: CHILD_ID,
    kind: 'other',
    label: null,
    rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    start_time: '09:00:00',
    end_time: '17:00:00',
  };
}

beforeAll(async () => {
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
    }),
    Trans: ({ children }: { children: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mock() }),
  }));
  mockUseCommitments = mock(() => ({
    data: [commitment('c1')],
    isLoading: false,
    isError: false,
  }));
  mockUseHouseholdCarers = mock(() => ({
    data: [{ user_id: 'nanny-1' }],
    isLoading: false,
    isError: false,
    refetch: mock(),
  }));
  mockUseSchedulePatterns = mock(() => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: mock(),
  }));
  mock.module('@/src/hooks/queries/useCommitments', () => ({
    useCommitments: mockUseCommitments,
  }));
  mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
    useHouseholdCarers: mockUseHouseholdCarers,
  }));
  mock.module('@/src/hooks/queries/useSchedulePatterns', () => ({
    useSchedulePatterns: mockUseSchedulePatterns,
  }));
  mock.module('@/src/hooks/mutations/useCreateCommitment', () => ({
    useCreateCommitment: () => ({ mutate: mock(), isPending: false }),
  }));
  mock.module('@/src/hooks/mutations/useDeleteCommitment', () => ({
    useDeleteCommitment: () => ({ mutate: mock(), isPending: false }),
  }));

  ManageCommitmentsSection = (
    await import('../components/ManageCommitmentsSection')
  ).ManageCommitmentsSection;
});

beforeEach(() => {
  mockUseCommitments.mockReturnValue({
    data: [commitment('c1')],
    isLoading: false,
    isError: false,
  });
  mockUseHouseholdCarers.mockReturnValue({
    data: [{ user_id: 'nanny-1' }],
    isLoading: false,
    isError: false,
    refetch: mock(),
  });
  mockUseSchedulePatterns.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    refetch: mock(),
  });
});

describe('ManageCommitmentsSection — a failed carers/patterns read', () => {
  it('offers the confirm-week CTA once both reads succeed (baseline)', () => {
    const { getByTestId } = render(
      <ManageCommitmentsSection
        householdId={HOUSEHOLD_ID}
        childId={CHILD_ID}
        childName="Maya"
      />
    );
    expect(getByTestId(`commitment-confirm-week-${CHILD_ID}`)).toBeTruthy();
  });

  it('never offers "confirm this as your usual week" when the carers read failed', () => {
    mockUseHouseholdCarers.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mock(),
    });

    const { queryByTestId, getByTestId } = render(
      <ManageCommitmentsSection
        householdId={HOUSEHOLD_ID}
        childId={CHILD_ID}
        childName="Maya"
      />
    );

    expect(queryByTestId(`commitment-confirm-week-${CHILD_ID}`)).toBeNull();
    expect(getByTestId(`commitment-retry-${CHILD_ID}`)).toBeTruthy();
  });

  it('never offers the CTA when the patterns read failed either', () => {
    mockUseSchedulePatterns.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mock(),
    });

    const { queryByTestId, getByTestId } = render(
      <ManageCommitmentsSection
        householdId={HOUSEHOLD_ID}
        childId={CHILD_ID}
        childName="Maya"
      />
    );

    expect(queryByTestId(`commitment-confirm-week-${CHILD_ID}`)).toBeNull();
    expect(getByTestId(`commitment-retry-${CHILD_ID}`)).toBeTruthy();
  });

  it('wires the retry to both failed queries', () => {
    const refetchCarers = mock();
    const refetchPatterns = mock();
    mockUseHouseholdCarers.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: refetchCarers,
    });
    mockUseSchedulePatterns.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: refetchPatterns,
    });

    const { getByTestId } = render(
      <ManageCommitmentsSection
        householdId={HOUSEHOLD_ID}
        childId={CHILD_ID}
        childName="Maya"
      />
    );

    getByTestId(`commitment-retry-${CHILD_ID}-button`).props.onPress?.();
    expect(refetchCarers).toHaveBeenCalledTimes(1);
    expect(refetchPatterns).toHaveBeenCalledTimes(1);
  });
});
