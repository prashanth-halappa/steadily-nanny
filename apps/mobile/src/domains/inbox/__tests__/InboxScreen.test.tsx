/**
 * @module domains/inbox/__tests__/InboxScreen.test
 *
 * Pattern B — empty state + each pending-work item type when `useInboxItems`
 * returns data. Error channel must surface ErrorState + retry (never the
 * empty-success copy). Pattern A markers live in InboxScreen.source.test.ts.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { join } from 'node:path';
import { fireEvent, render } from '@testing-library/react-native';
import type { InboxItem } from '../utils/buildInboxItems';

const EN_EMPTY_BODY =
  'Nothing needs you right now. Schedule changes, usual weeks and questions about hours all show up here.';

let InboxScreen: typeof import('../components/InboxScreen').InboxScreen;
let mockUseInboxItems: ReturnType<typeof mock>;
let mockPush: ReturnType<typeof mock>;
let mockRefetch: ReturnType<typeof mock>;

beforeAll(async () => {
  mockRefetch = mock(() => Promise.resolve());
  mockUseInboxItems = mock(() => ({
    items: [] as InboxItem[],
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  }));
  mockPush = mock();

  mock.module('@/src/domains/inbox/hooks/useInboxItems', () => ({
    useInboxItems: mockUseInboxItems,
  }));
  // Override the global key-echo mock: this file needs interpolated values
  // (a row's own formatted clock time) to reach the rendered text so the
  // per-household zone under test is actually observable.
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, string | number>) =>
        opts ? `${key}(${JSON.stringify(opts)})` : key,
      i18n: { language: 'en', changeLanguage: mock() },
    }),
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush, back: mock() }),
    // `SettingsHeaderButton` (the header icon that replaced the Settings
    // tab) reaches for the singleton, not the hook.
    router: { push: mockPush, back: mock() },
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: () => ({
      household: { id: 'hh-1', name: 'Household One', timezone: 'UTC' },
      householdId: 'hh-1',
      households: [
        { id: 'hh-1', name: 'Household One', timezone: 'UTC' },
        { id: 'hh-2', name: 'Household Two', timezone: 'America/New_York' },
      ],
      pastHouseholds: [],
      setActiveHouseholdId: mock(),
      isLoading: false,
      isError: false,
    }),
  }));
  mock.module('@/src/components/custom/ErrorState', () => {
    const React = require('react');
    const { Pressable, Text } = require('react-native');
    return {
      ErrorState: (props: { variant?: string; onRetry?: () => void }) =>
        React.createElement(
          Pressable,
          {
            testID: 'error-state',
            accessibilityRole: 'button',
            onPress: props.onRetry,
          },
          React.createElement(Text, null, 'error')
        ),
    };
  });

  const mod = await import('../components/InboxScreen');
  InboxScreen = mod.InboxScreen;
});

beforeEach(() => {
  mockUseInboxItems.mockClear?.();
  mockPush.mockClear?.();
  mockRefetch.mockClear?.();
  mockUseInboxItems.mockImplementation(() => ({
    items: [] as InboxItem[],
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  }));
});

/** Walk children in tree order; skip the node's own testID. */
function leadingTestId(node: {
  props: { children?: unknown };
}): string | undefined {
  const walk = (n: unknown): string | undefined => {
    if (!n || typeof n !== 'object') return undefined;
    const el = n as { props?: { testID?: string; children?: unknown } };
    if (el.props?.testID) return el.props.testID;
    const kids = Array.isArray(el.props?.children)
      ? el.props.children
      : el.props?.children != null
        ? [el.props.children]
        : [];
    for (const kid of kids) {
      const id = walk(kid);
      if (id) return id;
    }
    return undefined;
  };
  const kids = Array.isArray(node.props.children)
    ? node.props.children
    : node.props.children != null
      ? [node.props.children]
      : [];
  for (const kid of kids) {
    const id = walk(kid);
    if (id) return id;
  }
  return undefined;
}

async function inboxLocale(language: 'en' | 'es') {
  return Bun.file(
    join(__dirname, `../../../i18n/locales/${language}/inbox.json`)
  ).json() as Promise<{ emptyTitle: string; emptyBody: string }>;
}

describe('InboxScreen', () => {
  it('shows the empty state when there is nothing pending', () => {
    const { getByTestId, queryByTestId } = render(<InboxScreen />);

    expect(getByTestId('inbox-screen')).toBeTruthy();
    expect(getByTestId('inbox-empty')).toBeTruthy();
    expect(queryByTestId('inbox-list')).toBeNull();
    expect(queryByTestId('error-state')).toBeNull();
  });

  // WP-C: the inbox is a tab root now, so there is nothing to go back TO —
  // the back button is gone and the settings icon takes its place.
  it('carries the settings header icon and no back button', () => {
    const { getByTestId, queryByTestId } = render(<InboxScreen />);

    expect(queryByTestId('inbox-back')).toBeNull();
    expect(getByTestId('header-settings').props.accessibilityRole).toBe(
      'button'
    );
  });

  it('surfaces ErrorState + retry on query failure — never empty-success', () => {
    mockUseInboxItems.mockImplementation(() => ({
      items: [] as InboxItem[],
      isLoading: false,
      isError: true,
      refetch: mockRefetch,
    }));

    const { getByTestId, queryByTestId } = render(<InboxScreen />);

    expect(getByTestId('error-state')).toBeTruthy();
    expect(queryByTestId('inbox-empty')).toBeNull();
    fireEvent.press(getByTestId('error-state'));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('renders a change-request row that deep-links to shift detail', () => {
    mockUseInboxItems.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      items: [
        {
          kind: 'change_request',
          id: 'cr-1',
          shiftId: 'shift-1',
          requestKind: 'time_change',
          requestedAt: '2026-08-08T09:00:00.000Z',
          requesterName: null,
          shiftStartsAt: null,
        },
      ] satisfies InboxItem[],
    }));

    const { getByTestId, queryByTestId } = render(<InboxScreen />);

    expect(queryByTestId('inbox-empty')).toBeNull();
    const row = getByTestId('inbox-item-change_request-cr-1');
    expect(row).toBeTruthy();
    fireEvent.press(row);
    // Same destination the SHIFT_CHANGE_REQUESTED push resolves to — one
    // contract, both surfaces (WP-A2, §A).
    expect(mockPush).toHaveBeenCalledWith(
      '/(private)/schedule/shifts/shift-1?changeRequestId=cr-1'
    );
  });

  it('renders a pending-pattern row that deep-links to respond', () => {
    mockUseInboxItems.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      items: [
        {
          kind: 'pending_pattern',
          id: 'pat-1',
          householdId: 'hh-1',
          patternId: 'pat-1',
          dtstart: '2026-08-05',
        },
      ] satisfies InboxItem[],
    }));

    const { getByTestId } = render(<InboxScreen />);
    const row = getByTestId('inbox-item-pending_pattern-pat-1');
    fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith('/(private)/schedule/respond/pat-1');
  });

  it('renders a queried-week row that deep-links to Hours', () => {
    mockUseInboxItems.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      items: [
        {
          kind: 'queried_week',
          id: 'ts-1',
          householdId: 'hh-1',
          weekStart: '2026-07-28',
          queryNote: 'Break looks long',
          householdName: null,
        },
      ] satisfies InboxItem[],
    }));

    const { getByTestId } = render(<InboxScreen />);
    const row = getByTestId('inbox-item-queried_week-ts-1');
    fireEvent.press(row);
    // The Hours TAB can only show one household — the href carries the id
    // it has to switch to (WP-A2 HYBRID contract, §A).
    expect(mockPush).toHaveBeenCalledWith(
      '/(private)/(tabs)/hours?weekStart=2026-07-28&householdId=hh-1'
    );
  });

  // Pattern A (render-time): this list is deliberately cross-household —
  // each row's clock times must read in ITS OWN household's zone, never the
  // active one the switcher happens to have selected.
  it("formats a pending-shift row's times in its OWN household zone, not the active household's", () => {
    mockUseInboxItems.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      items: [
        {
          kind: 'pending_shift',
          id: 'shift-ask-1',
          householdId: 'hh-2',
          localDate: '2026-08-11',
          // Noon UTC — reads 8:00 AM in hh-2's own zone (America/New_York),
          // 12:00 PM in the active household's zone (UTC).
          startsAt: '2026-08-11T12:00:00.000Z',
          endsAt: '2026-08-11T18:00:00.000Z',
          createdAt: '2026-08-08T00:00:00.000Z',
          coverAskExpiresAt: null,
        },
      ] satisfies InboxItem[],
    }));

    const { getByText, queryByText } = render(<InboxScreen />);

    expect(getByText(/8:00 AM/)).toBeTruthy();
    expect(queryByText(/12:00 PM/)).toBeNull();
  });

  it('renders a submitted-week row that deep-links to Hours', () => {
    mockUseInboxItems.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      items: [
        {
          kind: 'submitted_week',
          id: 'ts-2',
          householdId: 'hh-1',
          weekStart: '2026-08-04',
          carerDisplayName: 'Jamie Carer',
          totalMinutes: 2310,
        },
      ] satisfies InboxItem[],
    }));

    const { getByTestId } = render(<InboxScreen />);
    const row = getByTestId('inbox-item-submitted_week-ts-2');
    fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith(
      '/(private)/(tabs)/hours?weekStart=2026-08-04&householdId=hh-1'
    );
  });

  it('renders the lead line with the item count', () => {
    mockUseInboxItems.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      items: [
        {
          kind: 'change_request',
          id: 'cr-1',
          shiftId: 'shift-1',
          requestKind: 'time_change',
          requestedAt: '2026-08-08T09:00:00.000Z',
          requesterName: null,
          shiftStartsAt: null,
        },
        {
          kind: 'submitted_week',
          id: 'ts-2',
          householdId: 'hh-1',
          weekStart: '2026-08-04',
          carerDisplayName: 'Jamie Carer',
          totalMinutes: 2310,
        },
      ] satisfies InboxItem[],
    }));

    const { getByTestId, queryByTestId } = render(<InboxScreen />);

    expect(queryByTestId('inbox-empty')).toBeNull();
    expect(getByTestId('inbox-lead')).toBeTruthy();
  });

  it('renders a kind eyebrow on each row', () => {
    mockUseInboxItems.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      items: [
        {
          kind: 'change_request',
          id: 'cr-1',
          shiftId: 'shift-1',
          requestKind: 'time_change',
          requestedAt: '2026-08-08T09:00:00.000Z',
          requesterName: null,
          shiftStartsAt: null,
        },
        {
          kind: 'pending_pattern',
          id: 'pat-1',
          householdId: 'hh-1',
          patternId: 'pat-1',
          dtstart: '2026-08-05',
        },
        {
          kind: 'queried_week',
          id: 'ts-1',
          householdId: 'hh-1',
          weekStart: '2026-07-28',
          queryNote: 'Break looks long',
          householdName: null,
        },
      ] satisfies InboxItem[],
    }));

    const { getByTestId } = render(<InboxScreen />);

    expect(getByTestId('inbox-item-kind-change_request')).toBeTruthy();
    expect(getByTestId('inbox-item-kind-pending_pattern')).toBeTruthy();
    expect(getByTestId('inbox-item-kind-queried_week')).toBeTruthy();
  });

  it('leads a row with the person avatar when the item names one', () => {
    mockUseInboxItems.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      items: [
        {
          kind: 'submitted_week',
          id: 'ts-2',
          householdId: 'hh-1',
          weekStart: '2026-08-04',
          carerDisplayName: 'Jamie Carer',
          totalMinutes: 2310,
        },
      ] satisfies InboxItem[],
    }));

    const { getByTestId } = render(<InboxScreen />);
    const row = getByTestId('inbox-item-submitted_week-ts-2');
    const avatar = getByTestId('inbox-item-avatar-ts-2');

    expect(leadingTestId(row)).toBe('inbox-item-avatar-ts-2');
    expect(avatar.props.accessibilityLabel).toBe('Jamie Carer');
    expect(getByTestId('inbox-item-kind-submitted_week')).toBeTruthy();
  });

  it('renders no lead line when the inbox is empty', () => {
    const { getByTestId, queryByTestId } = render(<InboxScreen />);

    expect(getByTestId('inbox-empty')).toBeTruthy();
    expect(queryByTestId('inbox-lead')).toBeNull();
  });

  // Between-us tab: the header contextLine must not contradict the empty
  // state. react-i18next is key-echo mocked — assert keys / node presence.
  it('omits screenSubtitle contextLine when there are no items', () => {
    const { getByTestId, queryByTestId, getByText } = render(<InboxScreen />);

    expect(getByTestId('inbox-empty')).toBeTruthy();
    expect(getByText('emptyTitle')).toBeTruthy();
    expect(getByText('emptyBody')).toBeTruthy();
    expect(queryByTestId('inbox-header-context')).toBeNull();
    expect(queryByTestId('inbox-lead')).toBeNull();
  });

  it('keeps screenSubtitle contextLine and the lead when there are items', () => {
    mockUseInboxItems.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      items: [
        {
          kind: 'change_request',
          id: 'cr-1',
          shiftId: 'shift-1',
          requestKind: 'time_change',
          requestedAt: '2026-08-08T09:00:00.000Z',
          requesterName: null,
          shiftStartsAt: null,
        },
      ] satisfies InboxItem[],
    }));

    const { getByTestId, queryByTestId, getByText } = render(<InboxScreen />);

    expect(queryByTestId('inbox-empty')).toBeNull();
    expect(getByTestId('inbox-header-context')).toBeTruthy();
    expect(getByText('screenSubtitle')).toBeTruthy();
    expect(getByTestId('inbox-lead')).toBeTruthy();
  });

  // Locale sentence values are asserted against the JSON files — emptyBody
  // must name what the surface holds without jargon.
  it('names what the surface holds without jargon, in en and es', async () => {
    const en = await inboxLocale('en');
    const es = await inboxLocale('es');

    expect(en.emptyTitle).toBe("You're all caught up");
    expect(en.emptyBody).toBe(EN_EMPTY_BODY);
    expect(en.emptyBody).not.toContain('!');
    expect(en.emptyBody.toLowerCase()).not.toContain('patterns');
    expect(en.emptyBody.toLowerCase()).not.toContain('queried');

    expect(es.emptyTitle.length).toBeGreaterThan(0);
    expect(es.emptyBody.length).toBeGreaterThan(0);
    expect(es.emptyBody).not.toContain('!');
    // Must not keep the old jargon framing.
    expect(es.emptyBody.toLowerCase()).not.toContain('patrones');
    expect(es.emptyBody.toLowerCase()).not.toContain('consultadas');
  });
});
