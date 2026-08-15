/**
 * @module domains/pay/components/__tests__/PaySetupPromptCard
 *
 * B2: the "Finish setting up {name}" card on Manage household must not
 * invite a parent to write an arrangement over a live open terms proposal.
 * Renders nothing while one is open; otherwise keeps today's behaviour.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';

let PaySetupPromptCard: typeof import('../PaySetupPromptCard').PaySetupPromptCard;

const HOUSEHOLD_ID = 'household-1';
const CARER_ID = 'nanny-a';
const now = '2026-08-01T00:00:00.000Z';

let currentArrangement: unknown = null;
let currentPending = false;
let proposalRows: unknown[] = [];

const routerPush = mock();

mock.module('expo-router', () => ({
  useRouter: () => ({
    push: routerPush,
    replace: mock(),
    back: mock(),
    navigate: mock(),
  }),
  useLocalSearchParams: () => ({}),
  useSegments: mock(() => []),
  usePathname: mock(() => ''),
  useFocusEffect: mock(() => {}),
  Link: 'Link',
  Redirect: 'Redirect',
  Stack: { Screen: 'StackScreen' },
  Tabs: { Screen: 'TabsScreen' },
}));

mock.module('@/src/hooks/queries/useCurrentPayArrangement', () => ({
  useCurrentPayArrangement: () => ({
    data: currentArrangement,
    isPending: currentPending,
    isError: false,
  }),
}));

mock.module('@/src/hooks/queries/useTermsProposals', () => ({
  useTermsProposals: () => ({ data: proposalRows }),
  findOpenTermsProposal: (
    proposals: readonly { status: string }[] | null | undefined
  ) => (proposals ?? []).find(row => row.status === 'proposed'),
}));

const openProposalRow = {
  id: 'prop-open-1',
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
  proposed_by: CARER_ID,
  direction: 'carer',
  status: 'proposed',
  terms: {
    rate_minor: 2000,
    currency: 'GBP',
    overtime_multiplier: 1.5,
    valid_from: '2026-09-01',
  },
  note: null,
  supersedes_id: null,
  from_invite_id: null,
  carer_display_name: 'Priya',
  weekly_equivalent_minor: null,
  viewed_at: null,
  responded_at: null,
  accepted_by: null,
  accepted_arrangement_id: null,
  responsibility_confirmed: false,
  created_at: now,
  updated_at: now,
};

beforeAll(async () => {
  PaySetupPromptCard = (await import('../PaySetupPromptCard'))
    .PaySetupPromptCard;
});

beforeEach(() => {
  currentArrangement = null;
  currentPending = false;
  proposalRows = [];
  routerPush.mockClear();
});

describe('PaySetupPromptCard', () => {
  it('renders nothing while an open proposal exists for that carer', () => {
    proposalRows = [openProposalRow];
    currentArrangement = null;

    const { queryByTestId } = render(
      <PaySetupPromptCard
        householdId={HOUSEHOLD_ID}
        carerId={CARER_ID}
        carerName="Priya"
      />
    );

    expect(queryByTestId(`pay-setup-prompt-${CARER_ID}`)).toBeNull();
  });

  it('renders normally when there is no proposal and no arrangement', () => {
    const { getByTestId } = render(
      <PaySetupPromptCard
        householdId={HOUSEHOLD_ID}
        carerId={CARER_ID}
        carerName="Priya"
      />
    );

    expect(getByTestId(`pay-setup-prompt-${CARER_ID}`)).toBeTruthy();
    expect(getByTestId(`pay-setup-prompt-${CARER_ID}-cta`)).toBeTruthy();
  });
});
