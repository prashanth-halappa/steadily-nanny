/**
 * @module domains/today/__tests__/NannyJoinedMomentCard.test
 *
 * 1.4 — the joined card stops lying. "…and she can clock in from her first
 * shift" is true only once terms are agreed; post-P1 an arrangement exists
 * ⇔ someone tapped Agree, so on day one it is usually FALSE.
 *
 * THE INVARIANT THIS FILE EXISTS FOR: the FIRST sentence is byte-identical in
 * all four variants. The celebration is what the card is for, and it must
 * not evaporate because the pay terms happen to be outstanding — only the
 * second sentence, and the route out, change.
 *
 * The fourth variant is the second lie the same card told: "she can clock in
 * from her first shift" also needs a shift, and on day one there is no usual
 * week either. Agreed terms plus no `pending`/`accepted` pattern points her
 * at the builder instead of describing a calendar that is empty.
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
let mockPatterns: ReturnType<typeof mock>;
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

  mockPatterns = mock(() => settled([]));
  mock.module('@/src/hooks/queries/useSchedulePatterns', () => ({
    useSchedulePatterns: mockPatterns,
  }));

  NannyJoinedMomentCard = (await import('../components/NannyJoinedMomentCard'))
    .NannyJoinedMomentCard;
});

beforeEach(() => {
  lastMomentProps = null;
  mockPush.mockClear();
  mockArrangement.mockImplementation(() => settled(null));
  mockProposals.mockImplementation(() => settled([]));
  mockPatterns.mockImplementation(() => settled([]));
});

function pattern(over: Record<string, unknown> = {}) {
  return {
    id: 'pattern-joined-1',
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    status: 'pending',
    ...over,
  };
}

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

describe('NannyJoinedMomentCard — four bodies, one celebration', () => {
  it('promises the clock only when an arrangement actually exists', () => {
    mockArrangement.mockImplementation(() =>
      settled({ id: 'arr-1', valid_from: '2026-08-01' })
    );
    mockPatterns.mockImplementation(() => settled([pattern()]));

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

  it('routes to the open round when SHE has sent terms', () => {
    mockProposals.mockImplementation(() =>
      settled([{ id: PROPOSAL_ID, direction: 'carer', status: 'proposed' }])
    );

    renderCard();

    expect(lastMomentProps?.body).toBe(
      'moments.nannyJoined.bodyTheySent({"name":"Andrea"})'
    );
    const secondary = lastMomentProps?.secondaryAction as {
      label: string;
      onPress: () => void;
    };
    expect(secondary.label).toBe('moments.nannyJoined.ctaReviewTerms');
    secondary.onPress();
    expect(mockPush).toHaveBeenCalledWith(
      `/(private)/pay/proposal/${PROPOSAL_ID}`
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

  it('renders nothing until the pattern query has settled either', () => {
    mockArrangement.mockImplementation(() => settled({ id: 'arr-1' }));
    mockPatterns.mockImplementation(() => ({
      data: undefined,
      isSuccess: false,
      isError: false,
      isPending: true,
    }));

    expect(renderCard().queryByTestId('today-nanny-joined-moment')).toBeNull();
  });
});

describe('NannyJoinedMomentCard — agreed terms, but still no week', () => {
  function withAgreedTerms() {
    mockArrangement.mockImplementation(() =>
      settled({ id: 'arr-1', valid_from: '2026-08-01' })
    );
  }

  // The old copy said "she can see the week now" when there was no week.
  it('points at the builder when no week has been sent', () => {
    withAgreedTerms();

    renderCard();

    expect(lastMomentProps?.body).toBe(
      'moments.nannyJoined.bodyAgreedNoWeek({"name":"Andrea"})'
    );
    const secondary = lastMomentProps?.secondaryAction as {
      label: string;
      onPress: () => void;
    };
    expect(secondary.label).toBe(
      'moments.nannyJoined.ctaSetWeek({"name":"Andrea"})'
    );
    secondary.onPress();
    expect(mockPush).toHaveBeenCalledWith('/(private)/schedule/build');
  });

  it('keeps the original body once a week is with her', () => {
    withAgreedTerms();
    mockPatterns.mockImplementation(() =>
      settled([pattern({ status: 'pending' })])
    );

    renderCard();

    expect(lastMomentProps?.body).toBe(
      'moments.nannyJoined.bodyAgreed({"name":"Andrea"})'
    );
    expect(lastMomentProps?.secondaryAction).toBeUndefined();
  });

  it('keeps the original body once she has accepted a week', () => {
    withAgreedTerms();
    mockPatterns.mockImplementation(() =>
      settled([pattern({ status: 'accepted' })])
    );

    renderCard();

    expect(lastMomentProps?.body).toBe(
      'moments.nannyJoined.bodyAgreed({"name":"Andrea"})'
    );
  });

  // An unsent draft is not a week she can see.
  for (const status of ['draft', 'declined', 'withdrawn', 'ended'] as const) {
    it(`still offers the builder when the only pattern is ${status}`, () => {
      withAgreedTerms();
      mockPatterns.mockImplementation(() => settled([pattern({ status })]));

      renderCard();

      expect(lastMomentProps?.body).toBe(
        'moments.nannyJoined.bodyAgreedNoWeek({"name":"Andrea"})'
      );
    });
  }

  // A week sent to the OTHER nanny in the household says nothing about this
  // relationship.
  it('ignores a live pattern belonging to a different carer', () => {
    withAgreedTerms();
    mockPatterns.mockImplementation(() =>
      settled([pattern({ carer_id: 'someone-else' })])
    );

    renderCard();

    expect(lastMomentProps?.body).toBe(
      'moments.nannyJoined.bodyAgreedNoWeek({"name":"Andrea"})'
    );
  });

  // The pattern only ever changes the AGREED branch — an unagreed household
  // still owes terms before anything else.
  it('leaves the unagreed branches alone', () => {
    mockPatterns.mockImplementation(() => settled([]));

    renderCard();

    expect(lastMomentProps?.body).toBe(
      'moments.nannyJoined.bodyNothingSent({"name":"Andrea"})'
    );
    expect((lastMomentProps?.secondaryAction as { label: string }).label).toBe(
      'moments.nannyJoined.ctaSetTerms'
    );
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
          bodyAgreedNoWeek: string;
          bodyNothingSent: string;
          bodyYouSent: string;
          bodyTheySent: string;
          ctaSetTerms: string;
          ctaSeeTerms: string;
          ctaReviewTerms: string;
          ctaSetWeek: string;
        };
      };
    };
    return ns.moments.nannyJoined;
  }

  for (const locale of ['en', 'es'] as const) {
    it(`opens all five ${locale} bodies with the identical first sentence`, () => {
      const b = bodies(locale);
      const firstSentence = (s: string) => `${s.split('. ')[0]}.`;

      expect(firstSentence(b.bodyNothingSent)).toBe(
        firstSentence(b.bodyAgreed)
      );
      expect(firstSentence(b.bodyYouSent)).toBe(firstSentence(b.bodyAgreed));
      expect(firstSentence(b.bodyTheySent)).toBe(firstSentence(b.bodyAgreed));
      expect(firstSentence(b.bodyAgreedNoWeek)).toBe(
        firstSentence(b.bodyAgreed)
      );
      expect(b.ctaSetTerms.length).toBeGreaterThan(0);
      expect(b.ctaSeeTerms.length).toBeGreaterThan(0);
      expect(b.ctaReviewTerms.length).toBeGreaterThan(0);
      expect(b.ctaSetWeek.length).toBeGreaterThan(0);
    });
  }

  // The whole point of the fourth branch: it must not describe a shift.
  it('does not promise a first shift when there is no week', () => {
    expect(bodies('en').bodyAgreedNoWeek).not.toContain(
      'clock in from her first shift'
    );
  });

  it('no longer promises the clock unconditionally', () => {
    expect(bodies('en').bodyNothingSent).not.toContain(
      'clock in from her first shift'
    );
    expect(bodies('en').bodyYouSent).not.toContain(
      'clock in from her first shift'
    );
    expect(bodies('en').bodyTheySent).not.toContain(
      'clock in from her first shift'
    );
  });
});
