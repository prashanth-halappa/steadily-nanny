/**
 * @module domains/draft/__tests__/DraftInviteScreen
 *
 * The wizard step a creating nanny did not have. She signed up, made a draft,
 * wrote her terms — and was walked past availability into permission prompts
 * without ever being offered a way to send those terms to a family. What is
 * pinned here is the whole of that fix:
 *
 *  - the route the step machine names really renders this screen;
 *  - its CTA opens the EXISTING `ShareTermsSheet` and mints through the
 *    existing `useCreateInvite` with `role: 'parent'` (the family redeeming
 *    her draft becomes its parent) — the same call shape `DraftHomeScreen`
 *    uses, because two share surfaces over one code is how they drift;
 *  - sending advances the wizard;
 *  - and so does skipping. She may have no family yet — the interview is next
 *    Tuesday — and forcing a code she cannot send is how a draft gets
 *    abandoned.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import {
  SETUP_PATHS,
  SETUP_ROLES,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
import { useSetupProgressStore } from '@/src/store/setupProgress';
import { renderWithProviders } from '@/src/test-utils';
import { draftHousehold, draftProposal, makeInvite } from './fixtures';

const pushMock = mock((_href: string) => undefined);
const replaceMock = mock((_href: string) => undefined);
mock.module('expo-router', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
    back: mock(),
    navigate: mock(),
  }),
  useLocalSearchParams: () => ({}),
  useSegments: () => [],
  usePathname: () => '',
  useFocusEffect: () => undefined,
}));

mock.module('@/lib/animations/useReducedMotion', () => ({
  useReducedMotion: mock(() => false),
}));
mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

let isOnline = true;
mock.module('@/src/lib/network', () => ({
  useIsOnline: () => isOnline,
}));

mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
  useActiveHousehold: () => ({
    household: draftHousehold,
    householdId: draftHousehold.id,
    households: [draftHousehold],
    pastHouseholds: [],
    isPastHousehold: false,
    setActiveHouseholdId: mock(),
    isLoading: false,
    isError: false,
  }),
}));

mock.module('@/src/domains/draft/hooks/draftQueries', () => ({
  useDraftProposal: () => ({
    data: draftProposal,
    isPending: false,
    isError: false,
    refetch: mock(),
  }),
}));

interface CreateInviteInput {
  role: string;
  label?: string;
  link_expires_in_days: number;
}
const createInviteAsync = mock((_input: CreateInviteInput) =>
  Promise.resolve(makeInvite())
);
const createInviteArgs: string[] = [];
mock.module('@/src/hooks/mutations/useCreateInvite', () => ({
  useCreateInvite: (householdId: string) => {
    createInviteArgs.push(householdId);
    return {
      mutateAsync: createInviteAsync,
      isPending: false,
      isError: false,
    };
  },
}));

let DraftInviteScreen: typeof import('../components/DraftInviteScreen').DraftInviteScreen;
let InviteRoute: () => React.ReactElement;

beforeAll(async () => {
  DraftInviteScreen = (await import('../components/DraftInviteScreen'))
    .DraftInviteScreen;
  InviteRoute = (await import('@/src/app/(private)/draft/invite')).default;
});

beforeEach(() => {
  isOnline = true;
  pushMock.mockClear();
  replaceMock.mockClear();
  createInviteAsync.mockClear();
  createInviteArgs.length = 0;
  useSetupProgressStore.setState({
    role: SETUP_ROLES.NANNY,
    path: SETUP_PATHS.CREATE,
    currentStep: SETUP_STEPS.INVITE,
  });
});

describe('DraftInviteScreen — the invite step her sequence was missing', () => {
  it('is what the route the step machine names renders', () => {
    const { getByTestId } = renderWithProviders(<InviteRoute />);

    expect(getByTestId('draft-invite-screen-cta')).toBeTruthy();
    expect(getByTestId('draft-invite-screen-skip')).toBeTruthy();
  });

  it('opens the EXISTING share sheet rather than a second one', () => {
    const { getByTestId } = renderWithProviders(<DraftInviteScreen />);

    fireEvent.press(getByTestId('draft-invite-screen-cta'));

    // The one sheet — its own contract (the 7-day link default, the link
    // rather than the bare code) is pinned in ShareTermsSheet.test.tsx and is
    // not restated here.
    expect(getByTestId('draft-share-sheet')).toBeTruthy();
    expect(getByTestId('draft-share-submit')).toBeTruthy();
  });

  it('mints a PARENT-role invite for the draft, then advances the wizard', async () => {
    const { getByTestId } = renderWithProviders(<DraftInviteScreen />);

    fireEvent.press(getByTestId('draft-invite-screen-cta'));
    fireEvent.press(getByTestId('draft-share-submit'));

    await waitFor(() => expect(createInviteAsync).toHaveBeenCalled());
    // The family redeeming her draft becomes its PARENT — the invite grants
    // the role the other side takes, not hers.
    expect(createInviteAsync.mock.calls[0]?.[0]).toEqual({
      role: 'parent',
      link_expires_in_days: 7,
    });
    expect(createInviteArgs.at(-1)).toBe(draftHousehold.id);

    await waitFor(() =>
      expect(useSetupProgressStore.getState().currentStep).toBe(
        SETUP_STEPS.NOTIFICATIONS_PERMISSION
      )
    );
    expect(pushMock).toHaveBeenCalledWith('/onboarding/notifications');
  });

  it('lets her skip without minting anything, and still moves on', () => {
    // She may not have a family yet. A code she cannot send is not progress,
    // and a wizard that will not let her past it is where the draft dies.
    const { getByTestId } = renderWithProviders(<DraftInviteScreen />);

    fireEvent.press(getByTestId('draft-invite-screen-skip'));

    expect(createInviteAsync).not.toHaveBeenCalled();
    expect(useSetupProgressStore.getState().currentStep).toBe(
      SETUP_STEPS.NOTIFICATIONS_PERMISSION
    );
    expect(pushMock).toHaveBeenCalledWith('/onboarding/notifications');
  });

  it('blocks the send offline and says why, but never blocks the skip', () => {
    isOnline = false;
    const { getByTestId } = renderWithProviders(<DraftInviteScreen />);

    expect(getByTestId('draft-invite-screen-cta').props.disabled).toBe(true);
    expect(getByTestId('draft-invite-screen-cta-hint')).toBeTruthy();

    fireEvent.press(getByTestId('draft-invite-screen-skip'));
    expect(pushMock).toHaveBeenCalledWith('/onboarding/notifications');
  });
});
