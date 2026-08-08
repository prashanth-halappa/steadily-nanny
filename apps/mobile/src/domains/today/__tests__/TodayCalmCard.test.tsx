/**
 * @module domains/today/__tests__/TodayCalmCard.test
 *
 * "Parent at ease" (plan's Emotional register): when the inbox is empty,
 * nothing is live, AND there is cover today, Today shows one T3
 * `tone="positive"` card naming who's covering and until when. No action,
 * no chevron — reassurance is the whole point, not another CTA.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';

let TodayCalmCard: typeof import('../components/TodayCalmCard').TodayCalmCard;
let mockUseInboxItems: ReturnType<typeof mock>;
let mockUseTodayCoverRows: ReturnType<typeof mock>;

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

beforeAll(async () => {
  // Re-mocked (same technique as NannyLiveStatusCard.render.test.tsx) so
  // interpolated params are visible in the rendered text — otherwise the
  // global bun.setup.ts mock drops them and the two candidate rows would
  // render identically.
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) =>
        options ? `${key}::${JSON.stringify(options)}` : key,
      i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
    }),
    Trans: ({ children }: { children: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  mockUseInboxItems = mock(() => ({ items: [], isLoading: false }));
  mock.module('@/src/domains/inbox/hooks/useInboxItems', () => ({
    useInboxItems: mockUseInboxItems,
  }));
  mockUseTodayCoverRows = mock(() => ({ rows: [], isLoading: false }));
  mock.module('../hooks/useTodayCoverRows', () => ({
    useTodayCoverRows: mockUseTodayCoverRows,
  }));

  const mod = await import('../components/TodayCalmCard');
  TodayCalmCard = mod.TodayCalmCard;
});

beforeEach(() => {
  mockUseInboxItems.mockReturnValue({ items: [], isLoading: false });
  mockUseTodayCoverRows.mockReturnValue({ rows: [], isLoading: false });
});

const scheduledRow = {
  key: 'shift-carer-1',
  name: 'Amara',
  kind: 'scheduled' as const,
  detail: 'stateScheduled::{"start":"9:00 AM","end":"5:00 PM"}',
};

describe('TodayCalmCard', () => {
  it('renders nothing when the inbox has pending items', () => {
    mockUseInboxItems.mockReturnValue({
      items: [{ kind: 'pending_pattern' }],
      isLoading: false,
    });
    mockUseTodayCoverRows.mockReturnValue({
      rows: [scheduledRow],
      isLoading: false,
    });

    const { queryByTestId } = render(
      <TodayCalmCard householdId={HOUSEHOLD_ID} timeZone="UTC" isLive={false} />
    );

    expect(queryByTestId('today-calm-card')).toBeNull();
  });

  it('renders nothing while something is live', () => {
    mockUseTodayCoverRows.mockReturnValue({
      rows: [scheduledRow],
      isLoading: false,
    });

    const { queryByTestId } = render(
      <TodayCalmCard householdId={HOUSEHOLD_ID} timeZone="UTC" isLive={true} />
    );

    expect(queryByTestId('today-calm-card')).toBeNull();
  });

  it('renders nothing when there is no scheduled/arriving cover today', () => {
    // Only a `finished` row — the day's cover is already over, not ongoing.
    mockUseTodayCoverRows.mockReturnValue({
      rows: [{ ...scheduledRow, kind: 'finished' }],
      isLoading: false,
    });

    const { queryByTestId } = render(
      <TodayCalmCard householdId={HOUSEHOLD_ID} timeZone="UTC" isLive={false} />
    );

    expect(queryByTestId('today-calm-card')).toBeNull();
  });

  it('renders nothing while inbox or cover data is still loading', () => {
    mockUseInboxItems.mockReturnValue({ items: [], isLoading: true });
    mockUseTodayCoverRows.mockReturnValue({
      rows: [scheduledRow],
      isLoading: false,
    });

    const { queryByTestId } = render(
      <TodayCalmCard householdId={HOUSEHOLD_ID} timeZone="UTC" isLive={false} />
    );

    expect(queryByTestId('today-calm-card')).toBeNull();
  });

  it('renders the calm card when the inbox is empty, nothing is live, and someone is covering today', () => {
    mockUseTodayCoverRows.mockReturnValue({
      rows: [scheduledRow],
      isLoading: false,
    });

    const { getByTestId, getByText, queryByTestId } = render(
      <TodayCalmCard householdId={HOUSEHOLD_ID} timeZone="UTC" isLive={false} />
    );

    expect(getByTestId('today-calm-card')).toBeTruthy();
    expect(getByText('calm.title')).toBeTruthy();
    // No action, no chevron — it is not a Pressable.
    expect(queryByTestId('today-calm-card-cta')).toBeNull();
  });

  it('prefers an arriving row over a scheduled one when both exist', () => {
    mockUseTodayCoverRows.mockReturnValue({
      rows: [
        { ...scheduledRow, key: 'shift-b', name: 'Bea', kind: 'arriving' },
        scheduledRow,
      ],
      isLoading: false,
    });

    const { getByText } = render(
      <TodayCalmCard householdId={HOUSEHOLD_ID} timeZone="UTC" isLive={false} />
    );

    expect(getByText(/"name":"Bea"/)).toBeTruthy();
  });
});
