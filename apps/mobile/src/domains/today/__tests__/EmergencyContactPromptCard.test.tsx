/**
 * @module domains/today/__tests__/EmergencyContactPromptCard.test
 *
 * Direction §6. Parent-only, feed (not the pinned slot), shown once when the
 * first carer membership goes active and the household's emergency fields
 * are empty. "Not now" persists like `SendMyTermsCard`'s dismissal.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';

let EmergencyContactPromptCard: typeof import('../components/EmergencyContactPromptCard').EmergencyContactPromptCard;
let store: typeof import('@/src/store/todayCardDismissalStore').useTodayCardDismissalStore;

let mockUseIsOnboarded: ReturnType<typeof mock>;
let mockUseActiveHousehold: ReturnType<typeof mock>;
let mockUseHouseholdMembers: ReturnType<typeof mock>;
let mockMutateAsync: ReturnType<typeof mock>;

const HOUSEHOLD_ID = 'household-1';
const ACTIVE_NANNY = {
  id: 'member-1',
  user_id: 'nanny-1',
  role: 'nanny',
  status: 'active',
};

function household(overrides: Record<string, unknown> = {}) {
  return {
    id: HOUSEHOLD_ID,
    name: 'The Ahmeds',
    state: 'live',
    emergency_contact_name: null,
    emergency_contact_phone: null,
    emergency_contact_relationship: null,
    ...overrides,
  };
}

beforeAll(async () => {
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) =>
        opts ? `${key}(${JSON.stringify(opts)})` : key,
      i18n: { language: 'en', changeLanguage: mock() },
    }),
    initReactI18next: { type: '3rdParty', init: mock() },
  }));

  mock.module('@/src/components/custom/BottomSheetBase', () => {
    const R = require('react');
    return {
      BottomSheetBase: ({
        visible,
        children,
        testID,
      }: {
        visible: boolean;
        children: unknown;
        testID?: string;
      }) => (visible ? R.createElement('View', { testID }, children) : null),
    };
  });

  mockUseIsOnboarded = mock(() => ({
    role: 'parent',
    isPastMember: false,
    householdId: HOUSEHOLD_ID,
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: mockUseIsOnboarded,
  }));

  mockUseActiveHousehold = mock(() => ({
    household: household(),
    householdId: HOUSEHOLD_ID,
    households: [household()],
    pastHouseholds: [],
    isPastHousehold: false,
    setActiveHouseholdId: mock(),
    isLoading: false,
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: mockUseActiveHousehold,
  }));

  mockUseHouseholdMembers = mock(() => ({
    data: [ACTIVE_NANNY],
    isLoading: false,
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: mockUseHouseholdMembers,
  }));

  mockMutateAsync = mock(() => Promise.resolve({}));
  mock.module('@/src/hooks/mutations/useUpdateHousehold', () => ({
    useUpdateHousehold: () => ({
      mutateAsync: mockMutateAsync,
      isPending: false,
      isError: false,
    }),
  }));

  const mod = await import('../components/EmergencyContactPromptCard');
  EmergencyContactPromptCard = mod.EmergencyContactPromptCard;
  store = (await import('@/src/store/todayCardDismissalStore'))
    .useTodayCardDismissalStore;
});

beforeEach(() => {
  mockUseIsOnboarded.mockImplementation(() => ({
    role: 'parent',
    isPastMember: false,
    householdId: HOUSEHOLD_ID,
  }));
  mockUseActiveHousehold.mockImplementation(() => ({
    household: household(),
    householdId: HOUSEHOLD_ID,
    households: [household()],
    pastHouseholds: [],
    isPastHousehold: false,
    setActiveHouseholdId: mock(),
    isLoading: false,
  }));
  mockUseHouseholdMembers.mockImplementation(() => ({
    data: [ACTIVE_NANNY],
    isLoading: false,
  }));
  store.getState().reset();
  mockMutateAsync.mockClear();
});

describe('EmergencyContactPromptCard', () => {
  it('renders for a parent with an active carer and no emergency contact', () => {
    const { getByTestId } = render(<EmergencyContactPromptCard />);
    expect(getByTestId('emergency-contact-prompt-card')).toBeTruthy();
  });

  it('renders nothing for a nanny', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'nanny',
      isPastMember: false,
      householdId: HOUSEHOLD_ID,
    }));
    const { queryByTestId } = render(<EmergencyContactPromptCard />);
    expect(queryByTestId('emergency-contact-prompt-card')).toBeNull();
  });

  it('renders nothing when no carer is active yet', () => {
    mockUseHouseholdMembers.mockImplementation(() => ({
      data: [],
      isLoading: false,
    }));
    const { queryByTestId } = render(<EmergencyContactPromptCard />);
    expect(queryByTestId('emergency-contact-prompt-card')).toBeNull();
  });

  it('renders nothing once the household already has an emergency contact', () => {
    mockUseActiveHousehold.mockImplementation(() => ({
      household: household({ emergency_contact_name: 'Grace' }),
      householdId: HOUSEHOLD_ID,
      households: [],
      pastHouseholds: [],
      isPastHousehold: false,
      setActiveHouseholdId: mock(),
      isLoading: false,
    }));
    const { queryByTestId } = render(<EmergencyContactPromptCard />);
    expect(queryByTestId('emergency-contact-prompt-card')).toBeNull();
  });

  it('renders nothing once dismissed', () => {
    store.getState().dismiss(`emergencyContact:${HOUSEHOLD_ID}`);
    const { queryByTestId } = render(<EmergencyContactPromptCard />);
    expect(queryByTestId('emergency-contact-prompt-card')).toBeNull();
  });

  it('"Not now" dismisses via the shared today-card dismissal store, keyed by household', () => {
    const { getByTestId, queryByTestId } = render(
      <EmergencyContactPromptCard />
    );
    fireEvent.press(getByTestId('emergency-contact-not-now'));
    expect(queryByTestId('emergency-contact-prompt-card')).toBeNull();
  });

  it('never uses the word "emergency" in a field label — the copy itself, not the mocked t()', () => {
    // The global test preload's `t` echoes i18n KEYS, which of course
    // contain the word "emergencyContactPrompt" — asserting against a
    // render would test the mock, not the copy. Read the real English
    // strings instead: this is the ONE place the rule can actually be
    // pinned. The word appears exactly once in the whole product, as the
    // nanny-side section heading "If something happens".
    const copy = require('../../../i18n/locales/en/today.json')
      .emergencyContactPrompt as Record<string, string>;
    for (const [field, value] of Object.entries(copy)) {
      if (field === 'saveFailed') continue; // an error message, not a field label
      expect(value.toLowerCase()).not.toContain('emergency');
    }
  });

  it('opens the sheet and PATCHes the household with the typed fields', () => {
    const { getByTestId } = render(<EmergencyContactPromptCard />);
    fireEvent.press(getByTestId('emergency-contact-cta'));

    fireEvent.changeText(getByTestId('emergency-contact-name-input'), 'Grace');
    fireEvent.changeText(
      getByTestId('emergency-contact-phone-input'),
      '07700 900222'
    );
    fireEvent.changeText(
      getByTestId('emergency-contact-relationship-input'),
      'Neighbour'
    );
    fireEvent.press(getByTestId('emergency-contact-save'));

    expect(mockMutateAsync).toHaveBeenCalledWith({
      householdId: HOUSEHOLD_ID,
      input: {
        emergency_contact_name: 'Grace',
        emergency_contact_phone: '07700 900222',
        emergency_contact_relationship: 'Neighbour',
      },
    });
  });
});
