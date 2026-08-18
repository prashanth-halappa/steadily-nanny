/**
 * @module domains/schedule/__tests__/AgendaView.uncoveredTiers.test
 *
 * L1 attaches to a GROUP, never to every uncovered item in it (docs/design/01-LAWS.md  * §3.1). A multi-gap week must keep exactly ONE uncovered row on the loud
 * surfaceAttention + cardProminent ground — the chronologically-earliest one
 * — with every other uncovered row on the quiet pill-warning ground instead.
 * All three actions (ask / I've got it / hours wrong) still render on every
 * row regardless of tier, and the pill stays `uncovered`, never `pending`.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { uncoveredKey } from '@steadily-nanny/shared-types/uncoveredCare';
import { render } from '@testing-library/react-native';
import type { UncoveredWindowDisplay } from '@/src/domains/schedule/utils/uncoveredDisplay';
import { palette } from '~/lib/design-tokens/palette';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMMITMENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const scheduleEn = JSON.parse(
  readFileSync(
    join(import.meta.dir, '../../../i18n/locales/en/schedule.json'),
    'utf8'
  )
) as Record<string, unknown>;

function getNested(obj: Record<string, unknown>, path: string): string {
  const value = path.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object') {
      return (node as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
  return typeof value === 'string' ? value : path;
}

beforeAll(async () => {
  mock.module('react-i18next', () => ({
    useTranslation: (ns?: string) => ({
      t: (key: string, vars?: Record<string, unknown>) => {
        if (ns === 'today') return key;
        const template = getNested(scheduleEn, key);
        return vars
          ? template.replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
              String(vars[k] ?? `{{${k}}}`)
            )
          : template;
      },
      i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
    }),
    Trans: ({ children }: { children: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: () => {} }),
    router: { push: () => {}, replace: () => {}, back: () => {} },
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: () => ({ data: [] }),
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({
      data: [{ id: CHILD_ID, name: 'Mia' }],
      isLoading: false,
    }),
  }));
  mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
    useHouseholdCarers: () => ({ data: [] }),
  }));
  mock.module('@/src/hooks/mutations/useCreateParentCover', () => ({
    useCreateParentCover: () => ({
      mutateAsync: async () => {},
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useRemoveParentCover', () => ({
    useRemoveParentCover: () => ({
      mutateAsync: async () => {},
      isPending: false,
    }),
  }));
});

let AgendaView: typeof import('../components/AgendaView').AgendaView;

beforeAll(async () => {
  AgendaView = (await import('../components/AgendaView')).AgendaView;
});

function makeWindow(startsAt: string, endsAt: string): UncoveredWindowDisplay {
  return {
    childId: CHILD_ID,
    commitmentId: COMMITMENT_ID,
    startsAt,
    endsAt,
    cause: 'nothingScheduled',
  };
}

/** Flattens the RN style array [elevation, { backgroundColor, ... }] into one object. */
function flattenStyle(style: unknown): Record<string, unknown> {
  const styles = Array.isArray(style) ? style : [style];
  return Object.assign({}, ...styles) as Record<string, unknown>;
}

describe('AgendaView uncovered row tiers (L1 attaches to the group)', () => {
  it('exactly one row — the earliest — carries the loud ground; the rest carry the quiet ground', () => {
    const dayOneEarly = makeWindow(
      '2026-08-03T13:00:00.000Z',
      '2026-08-03T17:00:00.000Z'
    );
    const dayOneLate = makeWindow(
      '2026-08-03T20:00:00.000Z',
      '2026-08-03T22:00:00.000Z'
    );
    const dayTwo = makeWindow(
      '2026-08-04T13:00:00.000Z',
      '2026-08-04T17:00:00.000Z'
    );

    const { getByTestId } = render(
      <AgendaView
        shifts={[]}
        householdId={HOUSEHOLD_ID}
        weekDates={['2026-08-03', '2026-08-04']}
        uncoveredByDay={{
          '2026-08-03': [dayOneEarly, dayOneLate],
          '2026-08-04': [dayTwo],
        }}
        showUncoveredActions
      />
    );

    const styleFor = (w: UncoveredWindowDisplay) =>
      flattenStyle(
        getByTestId(`schedule-uncovered-${uncoveredKey(w)}`).props.style
      );
    const earlyStyle = styleFor(dayOneEarly);
    const lateStyle = styleFor(dayOneLate);
    const dayTwoStyle = styleFor(dayTwo);

    expect(earlyStyle.backgroundColor).toBe(palette.light.surfaceAttention.hex);
    expect(lateStyle.backgroundColor).toBe(palette.light.card.hex);
    expect(dayTwoStyle.backgroundColor).toBe(palette.light.card.hex);

    // Only the primary row's boxShadow is the prominent (2-layer) one.
    const shadowLayers = (s: Record<string, unknown>) =>
      Array.isArray(s.boxShadow) ? s.boxShadow.length : 0;
    expect(shadowLayers(earlyStyle)).toBe(2);
    expect(shadowLayers(lateStyle)).toBe(1);
    expect(shadowLayers(dayTwoStyle)).toBe(1);
  });

  it('every uncovered row — primary or quiet — still renders all three actions', () => {
    const early = makeWindow(
      '2026-08-03T13:00:00.000Z',
      '2026-08-03T17:00:00.000Z'
    );
    const later = makeWindow(
      '2026-08-03T20:00:00.000Z',
      '2026-08-03T22:00:00.000Z'
    );

    const { getByTestId } = render(
      <AgendaView
        shifts={[]}
        householdId={HOUSEHOLD_ID}
        weekDates={['2026-08-03']}
        uncoveredByDay={{ '2026-08-03': [early, later] }}
        showUncoveredActions
      />
    );

    for (const w of [early, later]) {
      const key = uncoveredKey(w);
      expect(getByTestId(`schedule-uncovered-ask-${key}`)).toBeTruthy();
      expect(getByTestId(`schedule-uncovered-cover-${key}`)).toBeTruthy();
      expect(getByTestId(`schedule-uncovered-hours-${key}`)).toBeTruthy();
    }
  });

  it('showActions=false hides the buttons on both the primary and quiet rows alike', () => {
    const early = makeWindow(
      '2026-08-03T13:00:00.000Z',
      '2026-08-03T17:00:00.000Z'
    );
    const later = makeWindow(
      '2026-08-03T20:00:00.000Z',
      '2026-08-03T22:00:00.000Z'
    );

    const { queryByTestId } = render(
      <AgendaView
        shifts={[]}
        householdId={HOUSEHOLD_ID}
        weekDates={['2026-08-03']}
        uncoveredByDay={{ '2026-08-03': [early, later] }}
      />
    );

    for (const w of [early, later]) {
      const key = uncoveredKey(w);
      expect(queryByTestId(`schedule-uncovered-ask-${key}`)).toBeNull();
      expect(queryByTestId(`schedule-uncovered-cover-${key}`)).toBeNull();
      expect(queryByTestId(`schedule-uncovered-hours-${key}`)).toBeNull();
    }
  });

  it('a single uncovered row in the week keeps the loud treatment', () => {
    const onlyWindow = makeWindow(
      '2026-08-03T13:00:00.000Z',
      '2026-08-03T17:00:00.000Z'
    );

    const { getByTestId } = render(
      <AgendaView
        shifts={[]}
        householdId={HOUSEHOLD_ID}
        weekDates={['2026-08-03']}
        uncoveredByDay={{ '2026-08-03': [onlyWindow] }}
        showUncoveredActions
      />
    );

    const style = flattenStyle(
      getByTestId(`schedule-uncovered-${uncoveredKey(onlyWindow)}`).props.style
    );
    expect(style.backgroundColor).toBe(palette.light.surfaceAttention.hex);
  });
});
