/**
 * @module domains/draft/__tests__/SendMyTermsCard
 *
 * §9.2. A nanny holding a self-authored terms draft, who has since joined a
 * real (live) household, gets a one-time, dismissible card offering to send
 * those terms to the family she actually joined — either as a first round
 * ("Send my terms") or, when the family already opened one, as a counter
 * ("Counter with my terms", carrying `supersedes_id`).
 *
 * `PayChangeSheet` is stubbed rather than exercised end-to-end: its own test
 * file owns its internals. This file owns the CARD's decisions — whether it
 * renders, which mode it picks, what it seeds the sheet with, and what it
 * submits.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';

const DRAFT_HOUSEHOLD_ID = 'draft-hh-1';
const LIVE_HOUSEHOLD_ID = 'live-hh-1';
const MY_USER_ID = 'nanny-1';

const DRAFT_HOUSEHOLD = {
  id: DRAFT_HOUSEHOLD_ID,
  name: null,
  state: 'draft',
  created_by: MY_USER_ID,
  timezone: 'UTC',
  cancellation_paid_within_hours: 0,
  week_starts_on: 1,
};

const LIVE_HOUSEHOLD = {
  id: LIVE_HOUSEHOLD_ID,
  name: 'The Ahmeds',
  state: 'live',
  created_by: 'someone-else',
  timezone: 'America/New_York',
  cancellation_paid_within_hours: 24,
  week_starts_on: 1,
};

const DRAFT_PROPOSAL = {
  id: 'draft-proposal-1',
  household_id: DRAFT_HOUSEHOLD_ID,
  carer_id: MY_USER_ID,
  status: 'proposed',
  proposed_by: MY_USER_ID,
  supersedes_id: null,
  note: null,
  weekly_equivalent_minor: 140000,
  carer_display_name: 'Marisol',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  responded_at: null,
  terms: {
    rate_minor: 2800,
    currency: 'USD',
    overtime_multiplier: 1.5,
    valid_from: '2026-08-17', // written for a DIFFERENT family
    terms: null,
  },
};

let SendMyTermsCard: typeof import('../components/SendMyTermsCard').SendMyTermsCard;

let mockUseIsOnboarded: ReturnType<typeof mock>;
let mockUseActiveHousehold: ReturnType<typeof mock>;
let mockUseDraftProposal: ReturnType<typeof mock>;
let mockUseTermsProposals: ReturnType<typeof mock>;
let mockMutateAsync: ReturnType<typeof mock>;
let mockUseProposeTerms: ReturnType<typeof mock>;
let mockIsDismissed: ReturnType<typeof mock>;
let mockDismiss: ReturnType<typeof mock>;
let lastSheetProps: Record<string, unknown> | null;

function setActiveHousehold(opts: {
  households: unknown[];
  household: unknown;
}) {
  mockUseActiveHousehold.mockImplementation(() => ({
    household: opts.household,
    householdId: (opts.household as { id: string } | null)?.id ?? null,
    households: opts.households,
    pastHouseholds: [],
    isPastHousehold: false,
    setActiveHouseholdId: mock(),
    isLoading: false,
    isError: false,
  }));
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

  mockUseIsOnboarded = mock(() => ({
    role: 'nanny',
    isPastMember: false,
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: mockUseIsOnboarded,
  }));

  mockUseActiveHousehold = mock();
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: mockUseActiveHousehold,
  }));

  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ session: { user: { id: MY_USER_ID } } }),
  }));

  mockUseDraftProposal = mock(() => ({ data: DRAFT_PROPOSAL }));
  mock.module('../hooks/draftQueries', () => ({
    useDraftProposal: mockUseDraftProposal,
  }));

  mockUseTermsProposals = mock(() => ({ data: [], isLoading: false }));
  mock.module('@/src/hooks/queries/useTermsProposals', () => ({
    useTermsProposals: mockUseTermsProposals,
    findOpenTermsProposal: (
      proposals: readonly { status: string }[] | null | undefined
    ) =>
      (proposals ?? []).find(row =>
        ['proposed', 'countered'].includes(row.status)
      ),
  }));

  mockMutateAsync = mock(() => Promise.resolve());
  mockUseProposeTerms = mock(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    isError: false,
  }));
  mock.module('@/src/hooks/mutations/useProposeTerms', () => ({
    useProposeTerms: mockUseProposeTerms,
  }));

  mockIsDismissed = mock(() => false);
  mockDismiss = mock();
  mock.module('@/src/store/todayCardDismissalStore', () => ({
    useTodayCardDismissalStore: (
      selector: (s: {
        isDismissed: typeof mockIsDismissed;
        dismiss: typeof mockDismiss;
      }) => unknown
    ) => selector({ isDismissed: mockIsDismissed, dismiss: mockDismiss }),
  }));

  mock.module('@/src/domains/pay/components/PayChangeSheet', () => {
    const React = require('react');
    const { Pressable, Text } = require('react-native');
    return {
      PayChangeSheet: (props: Record<string, unknown>) => {
        lastSheetProps = props;
        if (!props.visible) return null;
        return React.createElement(
          Pressable,
          {
            testID: 'stub-sheet-submit',
            onPress: () =>
              (
                props.onSubmit as (r: {
                  rate_minor: number;
                  currency: string;
                }) => void
              )({ rate_minor: 3000, currency: 'USD' }),
          },
          React.createElement(Text, null, 'submit')
        );
      },
    };
  });

  const mod = await import('../components/SendMyTermsCard');
  SendMyTermsCard = mod.SendMyTermsCard;
});

beforeEach(() => {
  lastSheetProps = null;
  mockMutateAsync.mockClear?.();
  mockDismiss.mockClear?.();
  mockUseIsOnboarded.mockImplementation(() => ({
    role: 'nanny',
    isPastMember: false,
  }));
  mockUseDraftProposal.mockImplementation(() => ({ data: DRAFT_PROPOSAL }));
  mockUseTermsProposals.mockImplementation(() => ({
    data: [],
    isLoading: false,
  }));
  mockUseProposeTerms.mockImplementation(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    isError: false,
  }));
  mockIsDismissed.mockImplementation(() => false);
  setActiveHousehold({
    households: [DRAFT_HOUSEHOLD],
    household: LIVE_HOUSEHOLD,
  });
});

describe('SendMyTermsCard — render conditions', () => {
  it('renders when every condition holds', () => {
    const { getByTestId } = render(<SendMyTermsCard />);
    expect(getByTestId('send-my-terms-card')).toBeTruthy();
  });

  it('renders nothing when she has no draft household', () => {
    setActiveHousehold({ households: [], household: LIVE_HOUSEHOLD });
    const { queryByTestId } = render(<SendMyTermsCard />);
    expect(queryByTestId('send-my-terms-card')).toBeNull();
  });

  it('renders nothing when the active household IS the draft', () => {
    setActiveHousehold({
      households: [DRAFT_HOUSEHOLD],
      household: DRAFT_HOUSEHOLD,
    });
    const { queryByTestId } = render(<SendMyTermsCard />);
    expect(queryByTestId('send-my-terms-card')).toBeNull();
  });

  it('renders nothing when she is a parent', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'parent',
      isPastMember: false,
    }));
    const { queryByTestId } = render(<SendMyTermsCard />);
    expect(queryByTestId('send-my-terms-card')).toBeNull();
  });

  it('renders nothing when she is a past member of the active household', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'nanny',
      isPastMember: true,
    }));
    const { queryByTestId } = render(<SendMyTermsCard />);
    expect(queryByTestId('send-my-terms-card')).toBeNull();
  });

  it('renders nothing when the draft proposal is null', () => {
    mockUseDraftProposal.mockImplementation(() => ({ data: null }));
    const { queryByTestId } = render(<SendMyTermsCard />);
    expect(queryByTestId('send-my-terms-card')).toBeNull();
  });

  it('renders nothing once dismissed for this (draft, live) pair', () => {
    mockIsDismissed.mockImplementation(() => true);
    const { queryByTestId } = render(<SendMyTermsCard />);
    expect(queryByTestId('send-my-terms-card')).toBeNull();
  });
});

describe('SendMyTermsCard — first round vs counter', () => {
  it('offers "Send my terms" when no proposal is open in the live household', () => {
    const { getByText } = render(<SendMyTermsCard />);
    expect(getByText('sendTerms.button')).toBeTruthy();
  });

  it('offers "Counter with my terms" when an open proposal already exists', () => {
    mockUseTermsProposals.mockImplementation(() => ({
      data: [{ id: 'open-1', status: 'proposed' }],
      isLoading: false,
    }));
    const { getByText } = render(<SendMyTermsCard />);
    expect(getByText('sendTerms.counterButton')).toBeTruthy();
  });

  it('submits without supersedes_id for a plain first round', () => {
    const { getByTestId } = render(<SendMyTermsCard />);
    fireEvent.press(getByTestId('send-my-terms-cta'));
    fireEvent.press(getByTestId('stub-sheet-submit'));

    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    const call = mockMutateAsync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.supersedes_id).toBeUndefined();
  });

  it('submits with supersedes_id set to the open proposal when countering', () => {
    mockUseTermsProposals.mockImplementation(() => ({
      data: [{ id: 'open-1', status: 'proposed' }],
      isLoading: false,
    }));
    const { getByTestId } = render(<SendMyTermsCard />);
    fireEvent.press(getByTestId('send-my-terms-cta'));
    fireEvent.press(getByTestId('stub-sheet-submit'));

    const call = mockMutateAsync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.supersedes_id).toBe('open-1');
  });
});

describe('SendMyTermsCard — seeding and confirmation', () => {
  it('resets valid_from to the ACTIVE household local today, not the draft date', () => {
    render(<SendMyTermsCard />);
    const props = lastSheetProps as {
      currentArrangement: { valid_from: string };
      todayISO: string;
    };
    expect(props.currentArrangement.valid_from).not.toBe('2026-08-17');
    expect(props.currentArrangement.valid_from).toBe(props.todayISO);
  });

  it('does not pass initialEffectiveDateISO (would re-carry the stale date)', () => {
    render(<SendMyTermsCard />);
    expect(
      (lastSheetProps as Record<string, unknown>).initialEffectiveDateISO
    ).toBeUndefined();
  });

  it('never submits without her confirming inside the sheet', () => {
    render(<SendMyTermsCard />);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('"Not now" dismisses without submitting anything', () => {
    const { getByTestId } = render(<SendMyTermsCard />);
    fireEvent.press(getByTestId('send-my-terms-not-now'));

    expect(mockDismiss).toHaveBeenCalledWith(
      `sendTerms:${DRAFT_HOUSEHOLD_ID}:${LIVE_HOUSEHOLD_ID}`
    );
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });
});
