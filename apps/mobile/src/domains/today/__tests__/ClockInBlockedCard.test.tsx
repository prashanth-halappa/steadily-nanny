/**
 * @module domains/today/__tests__/ClockInBlockedCard.test
 *
 * A1/§3's card. It occupies the same slot, at the same size, as the clock
 * she expected to find there — the body becomes the reason, the owner, and
 * her one action.
 *
 * THREE THINGS THIS FILE EXISTS TO PIN:
 *
 *  1. The tone is `attention` and NEVER `live`. Apricot means the clock is
 *     running; this card is its exact opposite, and a blocked clock wearing
 *     the running clock's colour is the worst possible misread.
 *  2. Every variant names WHO OWES THE MOVE. A blocked state that does not
 *     reads as the app blaming the nanny.
 *  3. The footnote shows in ALL THREE variants. It is the only warning she
 *     gets before working nine unclockable hours, and the only pointer to
 *     the recovery path afterwards.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Household } from '@steadily-nanny/shared-types/schemas/household.schema';
import { fireEvent, render } from '@testing-library/react-native';
import { liveCardBackground } from '~/lib/design-tokens/elevation';
import { palette } from '~/lib/design-tokens/palette';
import { typography } from '~/lib/design-tokens/typography';

const SURFACE_ATTENTION = palette.light.surfaceAttention.hex;
/** The apricot ground `tone="live"` paints — the one this card may never wear. */
const SURFACE_LIVE = liveCardBackground('light');

const HOUSEHOLD = {
  id: 'household-blocked-1',
  name: 'Okafor family',
  timezone: 'UTC',
  currency: 'GBP',
  cancellation_paid_within_hours: 24,
  week_starts_on: 1,
  state: 'live',
} as unknown as Household;
const ME = 'carer-blocked-1';

const PROPOSAL: {
  id: string;
  direction: 'parent' | 'carer';
  status: string;
  created_at: string;
} = {
  id: 'proposal-blocked-1',
  direction: 'parent',
  status: 'proposed',
  created_at: '2026-08-12T09:00:00.000Z',
};

/** Her first day with this family — before "today", so it is backdatable. */
const JOINED_AT = '2026-08-01T10:00:00.000Z';
const TODAY_ISO = new Date().toISOString().slice(0, 10);

let ClockInBlockedCard: typeof import('../components/ClockInBlockedCard').ClockInBlockedCard;
let mockUseTermsGate: ReturnType<typeof mock>;
let mockUseHouseholdMembers: ReturnType<typeof mock>;
let mockPush: ReturnType<typeof mock>;
let mockMutateAsync: ReturnType<typeof mock>;
let lastSheetProps: Record<string, unknown> | null = null;

function blocked(
  variant: 'familySent' | 'youSent' | 'nothingSent',
  proposal: typeof PROPOSAL | null = PROPOSAL
) {
  return {
    status: 'blocked' as const,
    variant,
    proposal,
    familyName: 'Okafor family',
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

  mockPush = mock();
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush, back: mock() }),
  }));

  mockUseTermsGate = mock(() => blocked('familySent'));
  mock.module('../hooks/useTermsGate', () => ({
    useTermsGate: mockUseTermsGate,
  }));

  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ session: { user: { id: ME } } }),
  }));

  // Already fetched by TodayScreen for this household, so the card's own call
  // is a cache read, not a second request. A nanny may read it: the members
  // route gates on `authWithOwnership` — any ACTIVE member, role unchecked.
  mockUseHouseholdMembers = mock(() => ({
    data: [
      { user_id: 'someone-else', joined_at: '2026-07-01T10:00:00.000Z' },
      { user_id: ME, joined_at: JOINED_AT },
    ],
    isLoading: false,
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: mockUseHouseholdMembers,
  }));

  mockMutateAsync = mock(() => Promise.resolve());
  mock.module('@/src/hooks/mutations/useProposeTerms', () => ({
    useProposeTerms: mock(() => ({
      mutateAsync: mockMutateAsync,
      isPending: false,
      isError: false,
    })),
  }));

  // Its own file owns the sheet's internals; this file owns whether the card
  // opens it, in which mode, and with what seed.
  mock.module('@/src/domains/pay/components/PayChangeSheet', () => {
    const React = require('react');
    const { Pressable } = require('react-native');
    return {
      PayChangeSheet: (props: Record<string, unknown>) => {
        lastSheetProps = props;
        if (!props.visible) return null;
        return React.createElement(Pressable, {
          testID: 'stub-sheet-submit',
          onPress: () =>
            (props.onSubmit as (r: unknown) => void)({
              rate_minor: 1850,
              currency: 'GBP',
            }),
        });
      },
    };
  });

  const mod = await import('../components/ClockInBlockedCard');
  ClockInBlockedCard = mod.ClockInBlockedCard;
});

beforeEach(() => {
  lastSheetProps = null;
  mockPush.mockClear();
  mockMutateAsync.mockClear();
  mockUseTermsGate.mockImplementation(() => blocked('familySent'));
  mockUseHouseholdMembers.mockImplementation(() => ({
    data: [
      { user_id: 'someone-else', joined_at: '2026-07-01T10:00:00.000Z' },
      { user_id: ME, joined_at: JOINED_AT },
    ],
    isLoading: false,
  }));
});

function renderCard() {
  return render(<ClockInBlockedCard household={HOUSEHOLD} />);
}

/** The colour the card actually paints, read off the rendered style array —
 * `tone` is not a DOM prop, it resolves to a background inside `Card`. */
function surfaceOf(card: { props: { style?: unknown } }): unknown {
  return [card.props.style]
    .flat()
    .find(
      (s): s is { backgroundColor: unknown } =>
        !!s && typeof s === 'object' && 'backgroundColor' in s
    )?.backgroundColor;
}

describe('ClockInBlockedCard — tone', () => {
  // The single most important assertion in this file: this card paints the
  // attention surface, and never the apricot one that means "the clock is
  // running". Asserted against the real palette, not against a prop name, so
  // it stays true if `Card`'s internals move.
  it('is attention-toned and never wears the running clock’s apricot', () => {
    const card = renderCard().getByTestId('today-clock-in-blocked-card');

    expect(surfaceOf(card)).toBe(SURFACE_ATTENTION);
    expect(surfaceOf(card)).not.toBe(SURFACE_LIVE);
  });

  it('keeps that tone in every variant — this card is never quiet', () => {
    for (const variant of ['familySent', 'youSent', 'nothingSent'] as const) {
      mockUseTermsGate.mockImplementation(() => blocked(variant));
      const card = renderCard().getByTestId('today-clock-in-blocked-card');
      expect(surfaceOf(card)).toBe(SURFACE_ATTENTION);
      expect(surfaceOf(card)).not.toBe(SURFACE_LIVE);
    }
  });

  // Positional tone is right for every OTHER card on Today; it is wrong for
  // this one. There is no quiet, in-feed version of "you cannot start work",
  // so the tone must not follow the slot.
  it('does not borrow its tone from the slot — it shouts wherever it mounts', () => {
    const inFeed = render(<ClockInBlockedCard household={HOUSEHOLD} />);
    expect(surfaceOf(inFeed.getByTestId('today-clock-in-blocked-card'))).toBe(
      SURFACE_ATTENTION
    );
  });
});

describe('ClockInBlockedCard — one title, three owners', () => {
  // 1.5: the title leads with the STATE, not the refusal. One unconditional
  // "Clock-in opens when terms are agreed" made the card a rule notice; three
  // titles make it a status. Literal `t()` per branch, never a ternary inside
  // `t(...)` — the second key is invisible to the locale-key guard that way.
  it('titles each variant with its own state, not one shared refusal', () => {
    const expected = {
      familySent:
        'clockInBlocked.titleFamilySent({"familyName":"Okafor family"})',
      youSent: 'clockInBlocked.titleYouSent({"familyName":"Okafor family"})',
      nothingSent: 'clockInBlocked.titleNothingSent',
    } as const;

    for (const variant of ['familySent', 'youSent', 'nothingSent'] as const) {
      mockUseTermsGate.mockImplementation(() => blocked(variant));
      const title = renderCard().getByTestId('today-clock-in-blocked-title');
      expect(title.props.children).toBe(expected[variant]);
    }
  });

  it('names the family, the date and the one-tap unblock when THEY sent', () => {
    const tree = renderCard();

    expect(tree.getByTestId('today-clock-in-blocked-body').props.children).toBe(
      'clockInBlocked.bodyFamilySent({"familyName":"Okafor family","date":"12 Aug"})'
    );
    expect(
      tree.getByTestId('today-clock-in-blocked-cta-label').props.children
    ).toBe('clockInBlocked.ctaFamilySent');
    // She owes THEM a reply on this branch — the filled button's "you owe
    // someone this" grammar is correct here.
    expect(tree.getByTestId('today-clock-in-blocked-cta').props.variant).toBe(
      'default'
    );
  });

  it('names who has not answered when SHE sent', () => {
    mockUseTermsGate.mockImplementation(() =>
      blocked('youSent', { ...PROPOSAL, direction: 'carer' })
    );

    const tree = renderCard();

    expect(tree.getByTestId('today-clock-in-blocked-body').props.children).toBe(
      'clockInBlocked.bodyYouSent({"date":"12 Aug","familyName":"Okafor family"})'
    );
    expect(
      tree.getByTestId('today-clock-in-blocked-cta-label').props.children
    ).toBe('clockInBlocked.ctaYouSent');
    expect(tree.getByTestId('today-clock-in-blocked-cta').props.variant).toBe(
      'default'
    );
  });

  it('offers the first move when nobody has sent anything', () => {
    mockUseTermsGate.mockImplementation(() => blocked('nothingSent', null));

    const tree = renderCard();

    expect(tree.getByTestId('today-clock-in-blocked-body').props.children).toBe(
      'clockInBlocked.bodyNothingSent({"familyName":"Okafor family"})'
    );
    expect(
      tree.getByTestId('today-clock-in-blocked-cta-label').props.children
    ).toBe('clockInBlocked.ctaNothingSent');
    // Nobody is owed anything on this branch — neither side has sent terms
    // yet — so the filled button's "you owe someone this" grammar is wrong
    // here; it declines to ghost.
    expect(tree.getByTestId('today-clock-in-blocked-cta').props.variant).toBe(
      'ghost'
    );
  });
});

describe('ClockInBlockedCard — the recovery line is the warning', () => {
  it('shows in all three variants, because she can work anyway in all three', () => {
    for (const [variant, proposal] of [
      ['familySent', PROPOSAL],
      ['youSent', { ...PROPOSAL, direction: 'carer' as const }],
      ['nothingSent', null],
    ] as const) {
      mockUseTermsGate.mockImplementation(() => blocked(variant, proposal));
      const footnote = renderCard().getByTestId(
        'today-clock-in-blocked-footnote'
      );
      expect(footnote.props.children).toBe('clockInBlocked.footnote');
    }
  });

  // 1.5: PROMOTED off the smallest rung on the card. This sentence is what
  // turns a lockout into a delay — at `Caption`/`text-muted-foreground` it
  // read as legal small print under the refusal it exists to soften.
  it('renders at the Body rung, not Caption — asserted on the emitted size', () => {
    const line = renderCard().getByTestId('today-clock-in-blocked-footnote');
    const style = [line.props.style]
      .flat()
      .find(
        (s): s is { fontSize?: number } =>
          !!s && typeof s === 'object' && 'fontSize' in s
      );

    expect(style?.fontSize).toBe(typography.body.size);
    expect(style?.fontSize).not.toBe(typography.caption.size);
  });

  it('is muted-STRONG, not the faintest foreground on the card', () => {
    const line = renderCard().getByTestId('today-clock-in-blocked-footnote');

    expect(line.props.className).toContain('text-muted-strong');
    expect(line.props.className).not.toContain('text-muted-foreground');
  });

  // The component test above can only see the key (`t` is stubbed to echo),
  // so the INVERSION — recovery offered first, prohibition never led with —
  // is pinned against the shipped copy itself.
  it('leads with the recovery, not the prohibition', () => {
    const en = JSON.parse(
      readFileSync(
        join(__dirname, '../../../i18n/locales/en/today.json'),
        'utf8'
      )
    ) as { clockInBlocked: { footnote: string } };
    const es = JSON.parse(
      readFileSync(
        join(__dirname, '../../../i18n/locales/es/today.json'),
        'utf8'
      )
    ) as { clockInBlocked: { footnote: string } };

    expect(en.clockInBlocked.footnote).toBe(
      "Work today anyway? Keep a note of your hours — you'll be able to add them here once the terms are agreed."
    );
    expect(en.clockInBlocked.footnote).not.toStartWith('Hours worked before');
    expect(es.clockInBlocked.footnote).not.toStartWith('Las horas trabajadas');
    expect(es.clockInBlocked.footnote.length).toBeGreaterThan(0);
  });
});

// 1.6: she has no arrangement — that IS the block — so `PayChangeSheet` takes
// its blank branch, which seeds today. Her first day is the honest default:
// losing Monday and Tuesday hurts most in exactly this flow.
describe('ClockInBlockedCard — her own terms start on her first day', () => {
  function openPropose() {
    mockUseTermsGate.mockImplementation(() => blocked('nothingSent', null));
    const tree = renderCard();
    fireEvent.press(tree.getByTestId('today-clock-in-blocked-cta'));
    return tree;
  }

  it('seeds the sheet from her own joined_at, in the household zone', () => {
    openPropose();

    expect(lastSheetProps?.initialEffectiveDateISO).toBe('2026-08-01');
  });

  it('leaves the seed alone when she joined today — nothing to backdate', () => {
    mockUseHouseholdMembers.mockImplementation(() => ({
      data: [{ user_id: ME, joined_at: `${TODAY_ISO}T08:00:00.000Z` }],
      isLoading: false,
    }));

    openPropose();

    expect(lastSheetProps?.initialEffectiveDateISO).toBeUndefined();
  });

  it('leaves the seed alone when her membership row has not loaded', () => {
    mockUseHouseholdMembers.mockImplementation(() => ({
      data: [],
      isLoading: true,
    }));

    openPropose();

    expect(lastSheetProps?.initialEffectiveDateISO).toBeUndefined();
  });
});

describe('ClockInBlockedCard — the CTA is the actual unblock path', () => {
  it('pushes the review screen for terms the family sent', () => {
    fireEvent.press(renderCard().getByTestId('today-clock-in-blocked-cta'));

    expect(mockPush).toHaveBeenCalledWith(
      '/(private)/pay/proposal/proposal-blocked-1'
    );
  });

  it('pushes the same screen for terms she sent — it is where both live', () => {
    mockUseTermsGate.mockImplementation(() =>
      blocked('youSent', { ...PROPOSAL, direction: 'carer' })
    );

    fireEvent.press(renderCard().getByTestId('today-clock-in-blocked-cta'));

    expect(mockPush).toHaveBeenCalledWith(
      '/(private)/pay/proposal/proposal-blocked-1'
    );
  });

  it('opens the propose sheet, seeded blank, when nothing has been sent', () => {
    mockUseTermsGate.mockImplementation(() => blocked('nothingSent', null));

    const tree = renderCard();
    fireEvent.press(tree.getByTestId('today-clock-in-blocked-cta'));

    expect(mockPush).not.toHaveBeenCalled();
    expect(lastSheetProps?.mode).toBe('propose');
    expect(lastSheetProps?.visible).toBe(true);
    // No arrangement exists — that is the whole reason she is blocked — so
    // the form has nothing to seed FROM and takes the household's currency.
    expect(lastSheetProps?.currentArrangement).toBeUndefined();
    expect(lastSheetProps?.defaultCurrency).toBe('GBP');
  });

  it('submits her terms through useProposeTerms', () => {
    mockUseTermsGate.mockImplementation(() => blocked('nothingSent', null));

    const tree = renderCard();
    fireEvent.press(tree.getByTestId('today-clock-in-blocked-cta'));
    fireEvent.press(tree.getByTestId('stub-sheet-submit'));

    expect(mockMutateAsync).toHaveBeenCalledWith({
      terms: { rate_minor: 1850, currency: 'GBP' },
    });
  });
});

describe('ClockInBlockedCard — when it is not the answer', () => {
  it('renders nothing while the gate is still loading', () => {
    mockUseTermsGate.mockImplementation(() => ({
      status: 'loading',
      proposal: null,
      familyName: '',
    }));

    expect(
      renderCard().queryByTestId('today-clock-in-blocked-card')
    ).toBeNull();
  });

  it('renders nothing once terms are agreed', () => {
    mockUseTermsGate.mockImplementation(() => ({
      status: 'open',
      proposal: null,
      familyName: 'Okafor family',
    }));

    expect(
      renderCard().queryByTestId('today-clock-in-blocked-card')
    ).toBeNull();
  });
});
