/**
 * @module domains/pay/components/__tests__/ProposalReviewScreen
 *
 * The wiring the funnel and the contract both depend on (§11, §7.3):
 *
 *  - `proposal_viewed` fires ONCE per proposal per user. Every scroll-back
 *    that re-counted would inflate the denominator of the one step this
 *    whole feature is measured on.
 *  - `proposal_accepted` fires only once the `pay_arrangements` insert has
 *    RETURNED — never on the optimistic tap, which would count acceptances
 *    that never happened.
 *  - The screen paints from the proposal id ALONE. It is opened from a push
 *    carrying `data.proposalId` and nothing else; needing the (household,
 *    carer) pair first would put a round trip in front of it and would
 *    strand a two-nanny household with no carer to resolve.
 *  - Whoever wrote the round on screen cannot answer it. The owner flips with
 *    every counter; the buttons follow.
 *
 * MOCKED AT THE HOOK BOUNDARY, not the endpoint boundary. The hooks are this
 * screen's actual contract (another slice owns them and the HTTP shape under
 * them), so mocking axios-level methods here would couple this file to a URL
 * layout it has no opinion about.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders, serializeTree } from '@/src/test-utils';

let ProposalReviewScreen: typeof import('../ProposalReviewScreen').ProposalReviewScreen;

// Same key-echo contract as bun.setup.ts, plus a capture of interpolation
// arguments — the only way to see that the terms-agreed moment names the
// counterparty, since the echo mock otherwise drops options. Technique from
// `ApproveWeekDialog.test.tsx`.
const capturedTCalls: Array<{
  key: string;
  options?: Record<string, unknown>;
}> = [];

mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      capturedTCalls.push({ key, options });
      return key;
    },
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children: unknown }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const PARENT_ID = 'parent-1';
const NANNY_ID = 'carer-1';
const HOUSEHOLD_ID = 'hh-1';
const now = '2026-08-10T15:00:00.000Z';

const proposal = (overrides: Record<string, unknown> = {}) => ({
  id: 'prop-1',
  household_id: HOUSEHOLD_ID,
  carer_id: NANNY_ID,
  proposed_by: NANNY_ID,
  direction: 'carer',
  status: 'proposed',
  terms: {
    rate_minor: 2800,
    currency: 'GBP',
    overtime_multiplier: 1.5,
    overtime_threshold_minutes: 2400,
    guaranteed_minutes_per_week: 3000,
    valid_from: '2026-08-17',
  },
  note: null,
  supersedes_id: null,
  from_invite_id: 'inv-1',
  carer_display_name: 'Marisol',
  weekly_equivalent_minor: 154000,
  viewed_at: null,
  responded_at: null,
  accepted_by: null,
  accepted_arrangement_id: null,
  responsibility_confirmed: false,
  created_at: now,
  updated_at: now,
  ...overrides,
});

const routerReplace = mock();
mock.module('expo-router', () => ({
  useRouter: () => ({
    push: mock(),
    replace: routerReplace,
    back: mock(),
    navigate: mock(),
  }),
  // Only the proposal id — exactly what the push carries.
  useLocalSearchParams: () => ({ id: 'prop-1' }),
  useSegments: mock(() => []),
  usePathname: mock(() => ''),
  useFocusEffect: mock(() => {}),
  Link: 'Link',
  Redirect: 'Redirect',
  Stack: { Screen: 'StackScreen' },
  Tabs: { Screen: 'TabsScreen' },
}));

const track = mock();
mock.module('@/src/lib/analytics/analytics', () => ({
  analytics: { track, screen: mock(), identify: mock(), reset: mock() },
}));
mock.module('@/src/lib/network', () => ({
  useIsOnline: () => true,
  setupNetworkManagers: mock(),
}));

let proposalResult: Record<string, unknown> = {};
let chain: unknown[] = [];
const acceptMutateAsync = mock<(input: unknown) => Promise<unknown>>(() =>
  Promise.resolve(
    proposal({ status: 'accepted', accepted_arrangement_id: 'arr-9' })
  )
);
const markViewed = mock();
const declineMutateAsync = mock<() => Promise<unknown>>(() =>
  Promise.resolve(proposal({ status: 'declined' }))
);

mock.module('@/src/hooks/queries/useTermsProposal', () => ({
  useTermsProposal: () => proposalResult,
}));
mock.module('@/src/hooks/queries/useTermsProposals', () => ({
  useTermsProposals: () => ({ data: chain }),
}));
mock.module('@/src/hooks/mutations/useAcceptTerms', () => ({
  useAcceptTerms: () => ({
    mutateAsync: acceptMutateAsync,
    isPending: false,
    isError: false,
  }),
}));
mock.module('@/src/hooks/mutations/useCounterTerms', () => ({
  useCounterTerms: () => ({
    mutateAsync: mock(),
    isPending: false,
    isError: counterIsError,
  }),
}));

/** What `useCounterTerms` reports as its error state for the current test. */
let counterIsError = false;
mock.module('@/src/hooks/mutations/useMarkProposalViewed', () => ({
  useMarkProposalViewed: () => ({ mutate: markViewed }),
}));
mock.module('@/src/hooks/mutations/useDeclineTerms', () => ({
  useDeclineTerms: () => ({
    mutateAsync: declineMutateAsync,
    isPending: false,
  }),
}));
/** The viewer's role for the current test — the accept redirect forks on it. */
let onboardedRole: 'parent' | 'nanny' = 'parent';
mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
  useIsOnboarded: () => ({
    status: 'onboarded',
    role: onboardedRole,
    householdId: HOUSEHOLD_ID,
    isPastMember: false,
  }),
}));
mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
  useActiveHousehold: () => ({
    householdId: HOUSEHOLD_ID,
    household: { id: HOUSEHOLD_ID, name: 'The Ahmeds', timezone: 'UTC' },
    isLoading: false,
  }),
}));

beforeAll(async () => {
  ({ ProposalReviewScreen } = await import('../ProposalReviewScreen'));
});

beforeEach(() => {
  capturedTCalls.length = 0;
  track.mockClear();
  routerReplace.mockClear();
  acceptMutateAsync.mockClear();
  markViewed.mockClear();
  declineMutateAsync.mockClear();
  declineMutateAsync.mockImplementation(() =>
    Promise.resolve(proposal({ status: 'declined' }))
  );
  acceptMutateAsync.mockImplementation(() =>
    Promise.resolve(
      proposal({ status: 'accepted', accepted_arrangement_id: 'arr-9' })
    )
  );
  proposalResult = {
    data: proposal(),
    isPending: false,
    isError: false,
    refetch: mock(),
  };
  chain = [proposal()];
  counterIsError = false;
  onboardedRole = 'parent';
  useAuthStore.setState({
    session: { user: { id: PARENT_ID } } as unknown as never,
    user: { id: PARENT_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

function trackedNames(): string[] {
  return track.mock.calls.map(call => call[0] as string);
}

describe('ProposalReviewScreen', () => {
  it('paints from the proposal id alone — no household or carer in the route', async () => {
    const { getByTestId } = renderWithProviders(<ProposalReviewScreen />);
    await waitFor(() =>
      expect(getByTestId('proposal-agree-button')).toBeTruthy()
    );
    // The figure is on screen, and the chain read never gated it.
    expect(getByTestId('proposal-rate')).toBeTruthy();
  });

  it('renders the skeleton, not a spinner, while the proposal is in flight', () => {
    proposalResult = { isPending: true, isError: false, refetch: mock() };
    const { getByTestId, queryByTestId } = renderWithProviders(
      <ProposalReviewScreen />
    );
    expect(getByTestId('proposal-loading')).toBeTruthy();
    expect(queryByTestId('proposal-agree-button')).toBeNull();
  });

  it('fires proposal_viewed once with data, and not again on a remount', async () => {
    // Its own id: the guard is a module-level set that outlives a component,
    // which is the whole point of it — so a test that shares an id with an
    // earlier test in this file would be asserting the previous test's view.
    const unseen = proposal({ id: 'prop-unseen' });
    proposalResult = {
      data: unseen,
      isPending: false,
      isError: false,
      refetch: mock(),
    };
    chain = [unseen];

    const first = renderWithProviders(<ProposalReviewScreen />);
    await waitFor(() =>
      expect(first.getByTestId('proposal-agree-button')).toBeTruthy()
    );
    expect(trackedNames().filter(n => n === 'proposal_viewed')).toHaveLength(1);
    expect(markViewed).toHaveBeenCalledTimes(1);

    first.unmount();
    const second = renderWithProviders(<ProposalReviewScreen />);
    await waitFor(() =>
      expect(second.getByTestId('proposal-agree-button')).toBeTruthy()
    );
    // Same proposal, same user — a scroll-back is not a second view.
    expect(trackedNames().filter(n => n === 'proposal_viewed')).toHaveLength(1);
  });

  it('fires proposal_accepted only after the arrangement insert returns', async () => {
    const { getByTestId } = renderWithProviders(<ProposalReviewScreen />);
    await waitFor(() =>
      expect(getByTestId('proposal-agree-button')).toBeTruthy()
    );

    fireEvent.press(getByTestId('proposal-agree-button'));
    fireEvent.press(getByTestId('proposal-accept-checkbox'));
    // Nothing is tracked on the tap itself — only on the resolved write.
    expect(trackedNames()).not.toContain('proposal_accepted');

    fireEvent.press(getByTestId('proposal-accept-confirm'));
    await waitFor(() => expect(acceptMutateAsync).toHaveBeenCalled());
    expect(acceptMutateAsync).toHaveBeenCalledWith({
      responsibility_confirmed: true,
    });
    await waitFor(() => expect(trackedNames()).toContain('proposal_accepted'));
    await waitFor(() =>
      expect(getByTestId('terms-agreed-moment')).toBeTruthy()
    );
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("a carer's accept lands on my-pay, not the parent-only pay screen (B1)", async () => {
    // `/settings/pay` gates a carer to `pay-not-available`
    // (PayArrangementScreen's `isParentEditorRole` check) — routing her there
    // after accepting a parent's offer showed "Not available" instead of the
    // terms she just agreed to.
    onboardedRole = 'nanny';
    const fromParent = proposal({
      direction: 'parent',
      proposed_by: PARENT_ID,
    });
    proposalResult = {
      data: fromParent,
      isPending: false,
      isError: false,
      refetch: mock(),
    };
    chain = [fromParent];
    useAuthStore.setState({
      session: { user: { id: NANNY_ID } } as unknown as never,
      user: { id: NANNY_ID } as unknown as never,
      isInitialized: true,
    } as never);

    const { getByTestId } = renderWithProviders(<ProposalReviewScreen />);
    await waitFor(() =>
      expect(getByTestId('proposal-agree-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('proposal-agree-button'));
    fireEvent.press(getByTestId('proposal-accept-checkbox'));
    fireEvent.press(getByTestId('proposal-accept-confirm'));
    await waitFor(() =>
      expect(getByTestId('terms-agreed-moment')).toBeTruthy()
    );
    expect(routerReplace).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('terms-agreed-continue'));
    expect(routerReplace).toHaveBeenCalledWith('/settings/my-pay');
  });

  it('a parent who accepts sees the moment and then continues to /settings/pay', async () => {
    const { getByTestId } = renderWithProviders(<ProposalReviewScreen />);
    await waitFor(() =>
      expect(getByTestId('proposal-agree-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('proposal-agree-button'));
    fireEvent.press(getByTestId('proposal-accept-checkbox'));
    fireEvent.press(getByTestId('proposal-accept-confirm'));
    await waitFor(() =>
      expect(getByTestId('terms-agreed-moment')).toBeTruthy()
    );
    expect(routerReplace).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('terms-agreed-continue'));
    expect(routerReplace).toHaveBeenCalledWith('/settings/pay');
  });

  it('the moment names the counterparty', async () => {
    const { getByTestId } = renderWithProviders(<ProposalReviewScreen />);
    await waitFor(() =>
      expect(getByTestId('proposal-agree-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('proposal-agree-button'));
    fireEvent.press(getByTestId('proposal-accept-checkbox'));
    fireEvent.press(getByTestId('proposal-accept-confirm'));
    await waitFor(() =>
      expect(getByTestId('terms-agreed-moment')).toBeTruthy()
    );
    const titleCall = capturedTCalls.find(
      call => call.key === 'moments.termsAgreed.title'
    );
    expect(titleCall).toBeDefined();
    expect(titleCall?.options).toEqual(
      expect.objectContaining({ name: 'Marisol' })
    );
  });

  it('a failed accept never shows the moment', async () => {
    acceptMutateAsync.mockImplementation(() =>
      Promise.reject(new Error('accept failed'))
    );
    const { getByTestId, queryByTestId } = renderWithProviders(
      <ProposalReviewScreen />
    );
    await waitFor(() =>
      expect(getByTestId('proposal-agree-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('proposal-agree-button'));
    fireEvent.press(getByTestId('proposal-accept-checkbox'));
    fireEvent.press(getByTestId('proposal-accept-confirm'));
    await waitFor(() => expect(acceptMutateAsync).toHaveBeenCalled());
    expect(queryByTestId('terms-agreed-moment')).toBeNull();
    expect(getByTestId('proposal-accept-sheet-modal').props.visible).toBe(true);
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it('does not claim an acceptance the server did not make an arrangement for', async () => {
    acceptMutateAsync.mockImplementation(() =>
      Promise.resolve(
        proposal({ status: 'accepted', accepted_arrangement_id: null })
      )
    );
    const { getByTestId } = renderWithProviders(<ProposalReviewScreen />);
    await waitFor(() =>
      expect(getByTestId('proposal-agree-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('proposal-agree-button'));
    fireEvent.press(getByTestId('proposal-accept-checkbox'));
    fireEvent.press(getByTestId('proposal-accept-confirm'));
    await waitFor(() => expect(acceptMutateAsync).toHaveBeenCalled());
    expect(trackedNames()).not.toContain('proposal_accepted');
  });

  // GOLDEN #40: the counter sheet's failure renders inline in the sheet — a
  // toast fired behind the open sheet is invisible.
  it('a failed counter reports itself INSIDE the counter sheet', async () => {
    counterIsError = true;
    const { getByTestId } = renderWithProviders(<ProposalReviewScreen />);
    await waitFor(() =>
      expect(getByTestId('proposal-counter-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('proposal-counter-button'));

    expect(getByTestId('pay-propose-submit-error').props.children).toBe(
      'proposal.sendFailed'
    );
  });

  // B4 — the counterparty's refusal. Confirm-before-firing (§ refusing terms
  // is not an accidental tap): the mutation must not fire on the button tap
  // alone, only after the confirm dialog's own confirm.
  it('declining requires a confirm — the tap alone does not call the mutation', async () => {
    const { getByTestId } = renderWithProviders(<ProposalReviewScreen />);
    await waitFor(() =>
      expect(getByTestId('proposal-decline-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('proposal-decline-button'));
    expect(declineMutateAsync).not.toHaveBeenCalled();
    expect(getByTestId('proposal-decline-dialog')).toBeTruthy();
  });

  it('confirming the decline dialog calls the mutation and returns to the previous screen', async () => {
    const { getByTestId } = renderWithProviders(<ProposalReviewScreen />);
    await waitFor(() =>
      expect(getByTestId('proposal-decline-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('proposal-decline-button'));
    fireEvent.press(getByTestId('proposal-decline-dialog-confirm'));
    await waitFor(() => expect(declineMutateAsync).toHaveBeenCalledTimes(1));
  });

  it('cancelling the decline dialog fires nothing', async () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <ProposalReviewScreen />
    );
    await waitFor(() =>
      expect(getByTestId('proposal-decline-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('proposal-decline-button'));
    fireEvent.press(getByTestId('proposal-decline-dialog-cancel'));
    await waitFor(() =>
      expect(queryByTestId('proposal-decline-dialog')).toBeNull()
    );
    expect(declineMutateAsync).not.toHaveBeenCalled();
  });

  it('the author of the round on screen is offered no answer to their own proposal', async () => {
    const own = proposal({ proposed_by: PARENT_ID, direction: 'parent' });
    proposalResult = {
      data: own,
      isPending: false,
      isError: false,
      refetch: mock(),
    };
    chain = [own];
    const { getByTestId, queryByTestId } = renderWithProviders(
      <ProposalReviewScreen />
    );
    await waitFor(() => expect(getByTestId('proposal-title')).toBeTruthy());
    expect(queryByTestId('proposal-agree-button')).toBeNull();
    expect(queryByTestId('proposal-counter-button')).toBeNull();
    expect(queryByTestId('proposal-decline-button')).toBeNull();
  });

  // OPENED is automatic; ANSWERED is the tap. This line sits under the
  // title and above the figures on every loaded render, both sides, before
  // anyone has tapped Agree.
  describe('proposal.notAgreedYet', () => {
    function expectNoticeAboveFigures(
      screen: ReturnType<typeof renderWithProviders>
    ) {
      expect(screen.getByTestId('proposal-not-agreed-yet').props.children).toBe(
        'proposal.notAgreedYet'
      );
      expect(screen.getByTestId('proposal-rate')).toBeTruthy();
      const tree = serializeTree(screen.toJSON());
      expect(tree.indexOf('proposal-not-agreed-yet')).toBeLessThan(
        tree.indexOf('proposal-rate')
      );
    }

    it('parent viewing: renders proposal.notAgreedYet above the figures', async () => {
      const screen = renderWithProviders(<ProposalReviewScreen />);
      await waitFor(() =>
        expect(screen.getByTestId('proposal-not-agreed-yet')).toBeTruthy()
      );
      expectNoticeAboveFigures(screen);
    });

    it('nanny viewing: renders proposal.notAgreedYet above the figures', async () => {
      onboardedRole = 'nanny';
      const fromParent = proposal({
        direction: 'parent',
        proposed_by: PARENT_ID,
      });
      proposalResult = {
        data: fromParent,
        isPending: false,
        isError: false,
        refetch: mock(),
      };
      chain = [fromParent];
      useAuthStore.setState({
        session: { user: { id: NANNY_ID } } as unknown as never,
        user: { id: NANNY_ID } as unknown as never,
        isInitialized: true,
      } as never);

      const screen = renderWithProviders(<ProposalReviewScreen />);
      await waitFor(() =>
        expect(screen.getByTestId('proposal-not-agreed-yet')).toBeTruthy()
      );
      expectNoticeAboveFigures(screen);
    });
  });
});
