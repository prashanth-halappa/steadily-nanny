/**
 * @module domains/pay/components/__tests__/ProposalTermsDocument
 *
 * §7.2's review body. Uses an INTERPOLATING `t` (overriding the preload's
 * key-echo mock) rather than the usual key assertions, because the single
 * most important thing on this screen is a NUMBER: the weekly line must be
 * the server's `weekly_equivalent_minor`, and a key-echo test cannot tell
 * $1,540.00 from the $1,400.00 a client-side `rate × hours` prints (§17, D23).
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { render } from '@testing-library/react-native';

let ProposalTermsDocument: typeof import('../ProposalTermsDocument').ProposalTermsDocument;

beforeAll(async () => {
  mock.module('react-i18next', () => ({
    useTranslation: mock(() => ({
      t: (key: string, params?: Record<string, unknown>) =>
        params === undefined ? key : `${key}|${JSON.stringify(params)}`,
      i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
    })),
    Trans: ({ children }: { children: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  ({ ProposalTermsDocument } = await import('../ProposalTermsDocument'));
});

const PARENT = 'parent-1';
const NANNY = 'carer-1';

const round1: TermsProposal = {
  id: 'prop-1',
  household_id: 'hh-1',
  carer_id: NANNY,
  proposed_by: NANNY,
  direction: 'carer',
  status: 'proposed',
  terms: {
    rate_minor: 2800,
    currency: 'GBP',
    overtime_threshold_minutes: 2400,
    overtime_multiplier: 1.5,
    overtime_daily_threshold_minutes: 480,
    guaranteed_minutes_per_week: 3000,
    valid_from: '2026-08-17',
  },
  note: 'Happy to talk it through.',
  supersedes_id: null,
  from_invite_id: 'inv-1',
  carer_display_name: 'Marisol',
  // 40 × 28 + 10 × 42 = £1,540.00. A naive multiply prints £1,400.00.
  weekly_equivalent_minor: 154000,
  viewed_at: null,
  responded_at: null,
  accepted_by: null,
  accepted_arrangement_id: null,
  responsibility_confirmed: false,
  created_at: '2026-08-10T15:00:00.000Z',
  updated_at: '2026-08-10T15:00:00.000Z',
};

const round2: TermsProposal = {
  ...round1,
  id: 'prop-2',
  proposed_by: PARENT,
  direction: 'parent',
  supersedes_id: 'prop-1',
  terms: {
    ...round1.terms,
    rate_minor: 2600,
    guaranteed_minutes_per_week: 2400,
  },
  weekly_equivalent_minor: 104000,
  created_at: '2026-08-11T09:00:00.000Z',
};

function renderDocument(
  proposal: TermsProposal,
  chain: TermsProposal[] = [proposal],
  viewerId = PARENT
) {
  return render(
    <ProposalTermsDocument
      proposal={proposal}
      chain={chain}
      viewerId={viewerId}
      counterpartyName="Marisol"
      timezone="UTC"
    />
  );
}

describe('ProposalTermsDocument', () => {
  it('shows the SERVER weekly equivalent, never rate × hours', () => {
    const { getByTestId } = renderDocument(round1);
    const line = getByTestId('proposal-weekly-equivalent').props.children;
    expect(line).toContain('£1,540.00');
    expect(line).not.toContain('£1,400.00');
    expect(line).toContain('"hours":50');
  });

  it('renders no weekly line at all when either half of it is missing', () => {
    expect(
      renderDocument({
        ...round1,
        weekly_equivalent_minor: null,
      }).queryByTestId('proposal-weekly-equivalent')
    ).toBeNull();
    expect(
      renderDocument({
        ...round1,
        terms: { ...round1.terms, guaranteed_minutes_per_week: null },
      }).queryByTestId('proposal-weekly-equivalent')
    ).toBeNull();
  });

  it('carries the even-spread caveat only when daily overtime is set', () => {
    expect(
      renderDocument(round1).getByTestId('proposal-weekly-caveat')
    ).toBeTruthy();
    expect(
      renderDocument({
        ...round1,
        terms: { ...round1.terms, overtime_daily_threshold_minutes: null },
      }).queryByTestId('proposal-weekly-caveat')
    ).toBeNull();
  });

  it('states the word WITH a date beside the figure, and names the author', () => {
    const { getByTestId } = renderDocument(round1);
    expect(getByTestId('proposal-state-pill-label').props.children).toBe(
      'proposal.state.proposed|{"date":"Aug 10"}'
    );
    expect(getByTestId('proposal-by-pill-label').props.children).toBe(
      'proposal.by|{"name":"Marisol"}'
    );
  });

  it('renders the whole §3 inventory, not a subset', () => {
    const { getByTestId } = renderDocument(round1);
    for (const key of [
      'overtime',
      'dailyOvertime',
      'doubletime',
      'seventhDay',
      'guaranteedHours',
      'pto',
      'workedHolidayPremium',
      'cancellations',
      'mileage',
      'paySchedule',
      'outsideWages',
      'inWriting',
    ]) {
      expect(getByTestId(`proposal-term-${key}`)).toBeTruthy();
    }
  });

  it('says when the terms start, and shows her note when she wrote one', () => {
    const { getByTestId, queryByTestId } = renderDocument(round1);
    expect(getByTestId('proposal-starts-value').props.children).toContain(
      'Aug 17'
    );
    expect(getByTestId('proposal-note').props.children).toBe(
      'Happy to talk it through.'
    );
    expect(
      renderDocument({ ...round1, note: null }).queryByTestId('proposal-note')
    ).toBeNull();
    expect(queryByTestId('proposal-history')).toBeNull();
  });

  describe('a counter (§7.6)', () => {
    it('puts "was …" under each CHANGED row and under nothing else', () => {
      const { getByTestId, queryByTestId } = renderDocument(round2, [
        round2,
        round1,
      ]);
      expect(
        getByTestId('proposal-term-guaranteedHours-subline').props.children
      ).toBe(
        'proposal.was|{"value":"terms.guaranteedHoursValue|{\\"hours\\":50}"}'
      );
      expect(getByTestId('proposal-rate-was').props.children).toBe(
        'proposal.wasRate|{"value":"£28.00"}'
      );
      // Unchanged between the two rounds.
      expect(queryByTestId('proposal-term-overtime-subline')).toBeNull();
      expect(queryByTestId('proposal-term-cancellations-subline')).toBeNull();
    });

    it('a first-round proposal has no diff lines at all', () => {
      const { queryByTestId } = renderDocument(round1);
      expect(queryByTestId('proposal-rate-was')).toBeNull();
      expect(queryByTestId('proposal-term-guaranteedHours-subline')).toBeNull();
    });

    it('"How we got here" names the actor on every round — never colour alone', () => {
      const { getByTestId } = renderDocument(round2, [round2, round1]);
      expect(getByTestId('proposal-history-row-prop-2').props.children).toBe(
        'proposal.state.counteredBy|{"name":"proposal.you","date":"Aug 11"}'
      );
      expect(getByTestId('proposal-history-row-prop-1').props.children).toBe(
        'proposal.state.proposedBy|{"name":"Marisol","date":"Aug 10"}'
      );
    });
  });
});
