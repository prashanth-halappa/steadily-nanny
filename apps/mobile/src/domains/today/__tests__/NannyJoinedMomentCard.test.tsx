/**
 * @module domains/today/__tests__/NannyJoinedMomentCard.test
 *
 * 1.4 — the joined card stops lying. "…and she can clock in from her first
 * shift" is true only once terms are agreed; post-P1 an arrangement exists
 * ⇔ someone tapped Agree, so on day one it is usually FALSE.
 *
 * THE INVARIANT THIS FILE EXISTS FOR: the FIRST sentence is byte-identical in
 * all three variants. The celebration is what the card is for, and it must
 * not evaporate because the pay terms happen to be outstanding — only the
 * second sentence, and the route out, change.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react-native';

const HOUSEHOLD_ID = 'household-joined-1';
const CARER_ID = 'carer-joined-1';
const PROPOSAL_ID = 'proposal-joined-1';

let NannyJoinedMomentCard: typeof import('../components/NannyJoinedMomentCard').NannyJoinedMomentCard;
let mockArrangement: ReturnType<typeof mock>;
let mockProposals: ReturnType<typeof mock>;
let mockPush: ReturnType<typeof mock>;
let lastMomentProps: Record<string, unknown> | null = null;

function settled(data: unknown) {
  return { data, isSuccess: true, isError: false, isPending: false };
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

  mockPush = mock();
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush, back: mock() }),
  }));

  mock.module('@/src/components/ui/moment-card', () => {
    const React = require('react');
    return {
      MomentCard: (props: Record<string, unknown>) => {
        lastMomentProps = props;
        return React.createElement('View', { testID: props.testID });
      },
    };
  });

  mockArrangement = mock(() => settled(null));
  mock.module('@/src/hooks/queries/useCurrentPayArrangement', () => ({
    useCurrentPayArrangement: mockArrangement,
  }));

  mockProposals = mock(() => settled([]));
  mock.module('@/src/hooks/queries/useTermsProposals', () => {
    const {
      OPEN_TERMS_PROPOSAL_STATUSES,
    } = require('@steadily-nanny/shared-types/schemas/termsProposal.schema');
    return {
      useTermsProposals: mockProposals,
      findOpenTermsProposal: (rows: Array<{ status: string }> | undefined) =>
        (rows ?? []).find(row =>
          (OPEN_TERMS_PROPOSAL_STATUSES as readonly string[]).includes(
            row.status
          )
        ),
    };
  });

  NannyJoinedMomentCard = (await import('../components/NannyJoinedMomentCard'))
    .NannyJoinedMomentCard;
});

beforeEach(() => {
  lastMomentProps = null;
  mockPush.mockClear();
  mockArrangement.mockImplementation(() => settled(null));
  mockProposals.mockImplementation(() => settled([]));
});

function renderCard() {
  return render(
    <NannyJoinedMomentCard
      householdId={HOUSEHOLD_ID}
      name="Andrea"
      family="Okafor family"
      carerId={CARER_ID}
      momentKey="moment-joined"
    />
  );
}

describe('NannyJoinedMomentCard — three bodies, one celebration', () => {
  it('promises the clock only when an arrangement actually exists', () => {
    mockArrangement.mockImplementation(() =>
      settled({ id: 'arr-1', valid_from: '2026-08-01' })
    );

    renderCard();

    expect(lastMomentProps?.body).toBe(
      'moments.nannyJoined.bodyAgreed({"name":"Andrea"})'
    );
    expect(lastMomentProps?.secondaryAction).toBeUndefined();
  });

  it('routes to pay setup when nobody has sent terms', () => {
    renderCard();

    expect(lastMomentProps?.body).toBe(
      'moments.nannyJoined.bodyNothingSent({"name":"Andrea"})'
    );
    const secondary = lastMomentProps?.secondaryAction as {
      label: string;
      onPress: () => void;
    };
    expect(secondary.label).toBe('moments.nannyJoined.ctaSetTerms');
    secondary.onPress();
    expect(mockPush).toHaveBeenCalledWith(
      `/(private)/settings/pay/setup/${CARER_ID}`
    );
  });

  it('routes to the open round when HE has already sent terms', () => {
    mockProposals.mockImplementation(() =>
      settled([{ id: PROPOSAL_ID, direction: 'parent', status: 'proposed' }])
    );

    renderCard();

    expect(lastMomentProps?.body).toBe(
      'moments.nannyJoined.bodyYouSent({"name":"Andrea"})'
    );
    const secondary = lastMomentProps?.secondaryAction as {
      label: string;
      onPress: () => void;
    };
    expect(secondary.label).toBe('moments.nannyJoined.ctaSeeTerms');
    secondary.onPress();
    expect(mockPush).toHaveBeenCalledWith(
      `/(private)/pay/proposal/${PROPOSAL_ID}`
    );
  });

  // Her own counter is not "the terms you sent" — it is hers, and the parent
  // owes an answer. Falls back to the nothing-sent route rather than
  // mislabelling a round he did not write.
  it('does not call HER counter-proposal "the terms you sent"', () => {
    mockProposals.mockImplementation(() =>
      settled([{ id: PROPOSAL_ID, direction: 'carer', status: 'proposed' }])
    );

    renderCard();

    expect(lastMomentProps?.body).toBe(
      'moments.nannyJoined.bodyNothingSent({"name":"Andrea"})'
    );
  });

  it('keeps the celebration primary action in every variant', () => {
    for (const arrangement of [null, { id: 'arr-1' }]) {
      mockArrangement.mockImplementation(() => settled(arrangement));
      renderCard();
      const action = lastMomentProps?.action as {
        label: string;
        onPress: () => void;
      };
      expect(action.label).toBe('moments.nannyJoined.cta({"name":"Andrea"})');
      expect(lastMomentProps?.title).toBe(
        'moments.nannyJoined.title({"name":"Andrea","family":"Okafor family"})'
      );
    }
  });

  // A moment card that guesses is worse than one that waits a tick: the
  // wrong guess either revokes a clock she has or promises one she has not.
  it('renders nothing until both terms queries have settled', () => {
    mockArrangement.mockImplementation(() => ({
      data: undefined,
      isSuccess: false,
      isError: false,
      isPending: true,
    }));

    expect(renderCard().queryByTestId('today-nanny-joined-moment')).toBeNull();
  });
});

describe('NannyJoinedMomentCard — the shipped copy', () => {
  function bodies(locale: 'en' | 'es') {
    const ns = JSON.parse(
      readFileSync(
        join(import.meta.dir, `../../../i18n/locales/${locale}/today.json`),
        'utf8'
      )
    ) as {
      moments: {
        nannyJoined: {
          bodyAgreed: string;
          bodyNothingSent: string;
          bodyYouSent: string;
          ctaSetTerms: string;
          ctaSeeTerms: string;
        };
      };
    };
    return ns.moments.nannyJoined;
  }

  for (const locale of ['en', 'es'] as const) {
    it(`opens all three ${locale} bodies with the identical first sentence`, () => {
      const b = bodies(locale);
      const firstSentence = (s: string) => `${s.split('. ')[0]}.`;

      expect(firstSentence(b.bodyNothingSent)).toBe(
        firstSentence(b.bodyAgreed)
      );
      expect(firstSentence(b.bodyYouSent)).toBe(firstSentence(b.bodyAgreed));
      expect(b.ctaSetTerms.length).toBeGreaterThan(0);
      expect(b.ctaSeeTerms.length).toBeGreaterThan(0);
    });
  }

  it('no longer promises the clock unconditionally', () => {
    expect(bodies('en').bodyNothingSent).not.toContain(
      'clock in from her first shift'
    );
    expect(bodies('en').bodyYouSent).not.toContain(
      'clock in from her first shift'
    );
  });
});
