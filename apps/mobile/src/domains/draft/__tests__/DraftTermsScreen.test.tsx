/**
 * @module domains/draft/__tests__/DraftTermsScreen
 *
 * The screen the draft home's three terms CTAs push to. It shipped without
 * one: `TERMS_ROUTE` named `/onboarding/terms`, which has no route file behind
 * it, so every tap landed on `+not-found` and a nanny in a draft household
 * could not write the terms the card invites her to write.
 *
 * Four things are pinned, all of them about the WRITE rather than layout:
 *  - the route module the CTA names really renders the form;
 *  - saving writes a terms PROPOSAL for the draft household (a draft has no
 *    owner and no parent, so `pay_arrangements`' `WRITE_ROLES = {owner,
 *    parent}` matches nobody — D-36; the proposal is how she asks);
 *  - editing her open round SUPERSEDES it rather than editing in place, which
 *    is what keeps the negotiation append-only;
 *  - with no household resolved there is nothing to propose INTO, and the CTA
 *    says so by staying disabled rather than firing at an empty id.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import {
  SETUP_PATHS,
  SETUP_ROLES,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
import { useAuthStore } from '@/src/store/auth';
import { useSetupProgressStore } from '@/src/store/setupProgress';
import { renderWithProviders } from '@/src/test-utils';
import { draftHousehold, draftProposal, NANNY_ID } from './fixtures';

mock.module('@/src/components/ui/loading-indicator', () => {
  const React = require('react');
  return {
    LoadingIndicator: (props?: { testID?: string }) =>
      React.createElement('View', {
        testID: props?.testID ?? 'loading-indicator-container',
      }),
  };
});
const pushMock = mock((_href: string) => undefined);
const backMock = mock(() => undefined);
const replaceMock = mock((_href: string) => undefined);
mock.module('expo-router', () => ({
  useRouter: () => ({
    push: pushMock,
    back: backMock,
    replace: replaceMock,
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

let proposal: typeof draftProposal | null = null;
let household: typeof draftHousehold | null = draftHousehold;

mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
  useActiveHousehold: () => ({
    household,
    householdId: household?.id ?? null,
    households: household ? [household] : [],
    pastHouseholds: [],
    isPastHousehold: false,
    setActiveHouseholdId: mock(),
    isLoading: false,
    isError: false,
  }),
}));
let proposalReadFailed = false;
const refetchMock = mock(() => Promise.resolve({ data: proposal }));
mock.module('@/src/domains/draft/hooks/draftQueries', () => ({
  useDraftProposal: () => ({
    data: proposalReadFailed ? undefined : proposal,
    isPending: false,
    isError: proposalReadFailed,
    refetch: refetchMock,
  }),
}));

interface ProposeInput {
  terms: {
    rate_minor: number;
    valid_from: string;
    cancellation_paid_within_hours: number | null;
    guaranteed_minutes_per_week: number | null;
  };
  supersedes_id?: string;
}
const proposeAsync = mock((_input: ProposeInput) =>
  Promise.resolve(draftProposal)
);
const proposeArgs: { householdId: string; carerId: string }[] = [];
mock.module('@/src/hooks/mutations/useProposeTerms', () => ({
  useProposeTerms: (householdId: string, carerId: string) => {
    proposeArgs.push({ householdId, carerId });
    return { mutateAsync: proposeAsync, isPending: false, isError: false };
  },
}));

let DraftTermsScreen: typeof import('../components/DraftTermsScreen').DraftTermsScreen;
let TermsRoute: () => React.ReactElement;

beforeAll(async () => {
  DraftTermsScreen = (await import('../components/DraftTermsScreen'))
    .DraftTermsScreen;
  TermsRoute = (await import('@/src/app/(private)/draft/terms')).default;
});

beforeEach(() => {
  proposal = null;
  proposalReadFailed = false;
  household = draftHousehold;
  proposeAsync.mockClear();
  proposeAsync.mockImplementation(() => Promise.resolve(draftProposal));
  proposeArgs.length = 0;
  pushMock.mockClear();
  backMock.mockClear();
  replaceMock.mockClear();
  refetchMock.mockClear();
  // Not mid-wizard by default — every wizard finish path calls `reset()`,
  // which puts `currentStep` back on ROLE, so this is what a nanny arriving
  // from her draft home looks like.
  useSetupProgressStore.setState({
    role: SETUP_ROLES.NANNY,
    path: SETUP_PATHS.CREATE,
    currentStep: SETUP_STEPS.ROLE,
  });
  useAuthStore.setState({
    session: { user: { id: NANNY_ID } } as unknown as never,
    user: { id: NANNY_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('DraftTermsScreen — the screen the draft CTA pushes to', () => {
  it('is what the route the CTA names renders', () => {
    const { getByTestId } = renderWithProviders(<TermsRoute />);

    expect(getByTestId('draft-terms-form-rate-input')).toBeTruthy();
    expect(getByTestId('draft-terms-form-cancellation-chip-none')).toBeTruthy();
    expect(getByTestId('draft-terms-form-cta')).toBeTruthy();
  });

  it('proposes the typed terms for the DRAFT household, for herself', async () => {
    const { getByTestId } = renderWithProviders(<DraftTermsScreen />);

    fireEvent.changeText(getByTestId('draft-terms-form-rate-input'), '28.00');
    fireEvent.press(getByTestId('draft-terms-form-cancellation-chip-none'));
    fireEvent.press(getByTestId('draft-terms-form-cta'));

    await waitFor(() => expect(proposeAsync).toHaveBeenCalled());
    expect(proposeArgs.at(-1)).toEqual({
      householdId: draftHousehold.id,
      carerId: NANNY_ID,
    });
    const input = proposeAsync.mock.calls[0]?.[0] as ProposeInput;
    expect(input.terms.rate_minor).toBe(2800);
    // An explicit "no" is null, never a fabricated 0-hour window (T16).
    expect(input.terms.cancellation_paid_within_hours).toBeNull();
    expect(input.supersedes_id).toBeUndefined();
  });

  it('opens seeded from her open round and SUPERSEDES it rather than editing in place', async () => {
    proposal = draftProposal;
    const { getByTestId } = renderWithProviders(<DraftTermsScreen />);

    expect(getByTestId('draft-terms-form-rate-input').props.value).toBe(
      '28.00'
    );

    fireEvent.press(getByTestId('draft-terms-form-cta'));

    await waitFor(() => expect(proposeAsync).toHaveBeenCalled());
    const input = proposeAsync.mock.calls[0]?.[0] as ProposeInput;
    expect(input.supersedes_id).toBe(draftProposal.id);
    // T17: an edit re-sends every term, or the new append-only row silently
    // drops the ones it did not restate.
    expect(input.terms.guaranteed_minutes_per_week).toBe(3000);
    // Her future start date survives the edit — "starting Monday 17 Aug" is
    // the normal interview case (spec §4.1), not something to reset to today.
    expect(input.terms.valid_from).toBe('2026-08-17');
  });

  it('refuses to save when her open round could not be read', () => {
    // A failed read is not "she has nothing written". Saving on top of it
    // omits `supersedes_id`, the server refuses the second open round, and
    // she gets a 409 that refreshing cannot clear (092's partial unique
    // index) — the exact loop that stranded a real nanny on this screen.
    proposalReadFailed = true;
    const { getByTestId } = renderWithProviders(<DraftTermsScreen />);

    fireEvent.changeText(getByTestId('draft-terms-form-rate-input'), '28.00');
    fireEvent.press(getByTestId('draft-terms-form-cancellation-chip-none'));

    expect(getByTestId('draft-terms-form-cta').props.disabled).toBe(true);
    expect(getByTestId('draft-terms-form-cta-hint')).toBeTruthy();
  });

  it('cannot propose into nothing when no household has resolved', () => {
    household = null;
    const { getByTestId } = renderWithProviders(<DraftTermsScreen />);

    fireEvent.changeText(getByTestId('draft-terms-form-rate-input'), '28.00');
    fireEvent.press(getByTestId('draft-terms-form-cancellation-chip-none'));

    expect(getByTestId('draft-terms-form-cta').props.disabled).toBe(true);
  });
});

describe('DraftTermsScreen — saving mid-wizard ADVANCES the wizard', () => {
  type Queries = ReturnType<typeof renderWithProviders>;
  const fillAndSave = (getByTestId: Queries['getByTestId']) => {
    fireEvent.changeText(getByTestId('draft-terms-form-rate-input'), '28.00');
    fireEvent.press(getByTestId('draft-terms-form-cancellation-chip-none'));
    fireEvent.press(getByTestId('draft-terms-form-cta'));
  };

  it('moves the step machine on and navigates to the next step', async () => {
    // The trap: this screen used to go BACK on save, leaving `currentStep`
    // on TERMS forever. `getUnfinishedSetupResumeRoute` then relaunched her
    // into this same form on every cold start — terms written, no way out.
    useSetupProgressStore.setState({ currentStep: SETUP_STEPS.TERMS });
    const { getByTestId } = renderWithProviders(<DraftTermsScreen />);

    fillAndSave(getByTestId);

    await waitFor(() => expect(proposeAsync).toHaveBeenCalled());
    await waitFor(() =>
      expect(useSetupProgressStore.getState().currentStep).toBe(
        SETUP_STEPS.AVAILABILITY
      )
    );
    expect(pushMock).toHaveBeenCalledWith('/onboarding/availability');
    expect(backMock).not.toHaveBeenCalled();
  });

  it('shows the wizard progress bar only while she is on the TERMS step', () => {
    useSetupProgressStore.setState({ currentStep: SETUP_STEPS.TERMS });
    const inWizard = renderWithProviders(<DraftTermsScreen />);
    expect(inWizard.queryByTestId('slim-progress-bar')).toBeTruthy();
  });

  it('still goes back when she reached the form from her draft home', async () => {
    const { getByTestId } = renderWithProviders(<DraftTermsScreen />);

    fillAndSave(getByTestId);

    await waitFor(() => expect(proposeAsync).toHaveBeenCalled());
    expect(useSetupProgressStore.getState().currentStep).toBe(SETUP_STEPS.ROLE);
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe('DraftTermsScreen — a 409 reloads her terms instead of shrugging', () => {
  const conflict = Object.assign(new Error('conflict'), {
    response: { status: 409, data: { error: { code: 'CONFLICT' } } },
  });

  it('refetches the round, re-seeds the form from it, and says so inline', async () => {
    // `errors:conflict` says "refresh and try again" on a full-screen form
    // with nothing to refresh WITH — the screen has to do the refreshing.
    proposal = draftProposal;
    proposeAsync.mockImplementation(() => Promise.reject(conflict));
    const { getByTestId, rerender } = renderWithProviders(<DraftTermsScreen />);

    fireEvent.press(getByTestId('draft-terms-form-cta'));

    await waitFor(() => expect(refetchMock).toHaveBeenCalled());
    const hint = getByTestId('draft-terms-form-cta-hint');
    expect(hint).toBeTruthy();

    // The seed guard was released, so the round that came back replaces what
    // is on screen rather than being silently ignored.
    proposal = {
      ...draftProposal,
      id: '55555555-5555-4555-8555-555555555555',
      terms: { ...draftProposal.terms, rate_minor: 3200 },
    };
    rerender(<DraftTermsScreen />);
    await waitFor(() =>
      expect(getByTestId('draft-terms-form-rate-input').props.value).toBe(
        '32.00'
      )
    );
  });

  it('leaves a non-conflict failure alone — no reload, no reseed', async () => {
    proposal = draftProposal;
    proposeAsync.mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('boom'), {
          response: { status: 500 },
        })
      )
    );
    const { getByTestId } = renderWithProviders(<DraftTermsScreen />);

    fireEvent.press(getByTestId('draft-terms-form-cta'));

    await waitFor(() => expect(proposeAsync).toHaveBeenCalled());
    expect(refetchMock).not.toHaveBeenCalled();
  });
});
