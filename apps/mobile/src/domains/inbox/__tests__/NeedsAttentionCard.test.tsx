/**
 * @module domains/inbox/__tests__/NeedsAttentionCard.test
 *
 * Behavioural companion to NeedsAttentionCard.source.test.ts, which only
 * greps the component's source text — deleting the `items.length === 0`
 * early return still leaves that string in the file's comments, so the
 * source scan stays green on a gutted component. This file RENDERS the card:
 * invisible-when-idle, count flows through, press deep-links to /inbox.
 *
 * The global preload's `react-i18next` mock echoes the key and drops
 * interpolation, so it is re-mocked here to splice `{{count}}` in — the count
 * reaching the rendered text is the thing under test.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import type { InboxItem } from '../utils/buildInboxItems';

const ITEM: InboxItem = {
  kind: 'change_request',
  id: 'cr-1',
  shiftId: 'shift-1',
  requestKind: 'time_change',
};

let NeedsAttentionCard: typeof import('../components/NeedsAttentionCard').NeedsAttentionCard;
let mockUseInboxItems: ReturnType<typeof mock>;
let mockPush: ReturnType<typeof mock>;

beforeAll(async () => {
  mockUseInboxItems = mock(() => ({
    items: [] as InboxItem[],
    isLoading: false,
    isError: false,
    refetch: mock(),
  }));
  mockPush = mock();

  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, opts?: { count?: number }) =>
        opts?.count === undefined ? key : `${key}(${opts.count})`,
      i18n: { language: 'en', changeLanguage: mock() },
    }),
  }));
  mock.module('@/src/domains/inbox/hooks/useInboxItems', () => ({
    useInboxItems: mockUseInboxItems,
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush, back: mock() }),
  }));

  const mod = await import('../components/NeedsAttentionCard');
  NeedsAttentionCard = mod.NeedsAttentionCard;
});

beforeEach(() => {
  mockPush.mockClear?.();
  mockUseInboxItems.mockImplementation(() => ({
    items: [] as InboxItem[],
    isLoading: false,
    isError: false,
    refetch: mock(),
  }));
});

describe('NeedsAttentionCard', () => {
  it('renders nothing when there is no pending work', () => {
    const { queryByTestId } = render(<NeedsAttentionCard />);

    expect(queryByTestId('today-needs-attention-card')).toBeNull();
  });

  it('renders with the pending count once there is work', () => {
    mockUseInboxItems.mockImplementation(() => ({
      items: [ITEM, { ...ITEM, id: 'cr-2' }, { ...ITEM, id: 'cr-3' }],
      isLoading: false,
      isError: false,
      refetch: mock(),
    }));

    const { getByTestId, getByText } = render(<NeedsAttentionCard />);

    expect(getByTestId('today-needs-attention-card')).toBeTruthy();
    expect(getByText('today:needsAttention.title(3)')).toBeTruthy();
  });

  it('deep-links to the inbox on press', () => {
    mockUseInboxItems.mockImplementation(() => ({
      items: [ITEM],
      isLoading: false,
      isError: false,
      refetch: mock(),
    }));

    const { getByTestId } = render(<NeedsAttentionCard />);
    fireEvent.press(getByTestId('today-needs-attention-card'));

    expect(mockPush).toHaveBeenCalledWith('/inbox');
  });
});
