/**
 * InboxRow — one triage row inside the Inbox group card.
 *
 * Extracted from `InboxScreen`'s inline map so the row has coverage of its
 * own. The two behaviours worth pinning are the ones that were easy to lose
 * in an inline map: the first row carries no top hairline (the group card
 * already owns its own edge), and each row formats in ITS OWN household's
 * time zone rather than one zone applied across a cross-household list.
 *
 * @module domains/inbox/components/__tests__/InboxRow.test
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import type { InboxItem } from '@/src/domains/inbox/utils/buildInboxItems';

let InboxRow: typeof import('../InboxRow').InboxRow;

beforeAll(async () => {
  // Echo the zone back through the copy helpers so "did this row format in
  // its own household's zone?" is actually assertable.
  mock.module('@/src/domains/inbox/utils/inboxItemCopy', () => ({
    titleForItem: (_item: InboxItem, _t: unknown, tz: string) => `title:${tz}`,
    subtitleForItem: (_item: InboxItem, _t: unknown, tz: string) =>
      `subtitle:${tz}`,
  }));

  InboxRow = (await import('../InboxRow')).InboxRow;
});

const ITEM: InboxItem = {
  kind: 'pending_pattern',
  id: 'pattern-1',
  householdId: 'household-1',
  patternId: 'p-1',
  dtstart: '2026-08-24',
};

function renderRow(overrides: Record<string, unknown> = {}) {
  return render(
    <InboxRow
      item={ITEM}
      isFirst={true}
      timeZone="Europe/London"
      onPress={() => {}}
      {...overrides}
    />
  );
}

describe('InboxRow', () => {
  it('keeps the row testID the screen and its tests already address', () => {
    const { getByTestId } = renderRow();

    expect(getByTestId('inbox-item-pending_pattern-pattern-1')).toBeTruthy();
    expect(getByTestId('inbox-item-kind-pending_pattern')).toBeTruthy();
  });

  it('calls onPress when the row is tapped', () => {
    const onPress = mock();
    const { getByTestId } = renderRow({ onPress });

    fireEvent.press(getByTestId('inbox-item-pending_pattern-pattern-1'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  // The group card owns the outer edge, so the first row must not draw a
  // hairline on top of it — every later row must.
  it('omits the top hairline on the first row only', () => {
    const first = renderRow({ isFirst: true });
    expect(
      first.getByTestId('inbox-item-pending_pattern-pattern-1').props.className
    ).not.toContain('border-t');

    const later = renderRow({ isFirst: false });
    expect(
      later.getByTestId('inbox-item-pending_pattern-pattern-1').props.className
    ).toContain('border-t');
  });

  it('formats in the household time zone it is given', () => {
    const { getByText } = renderRow({ timeZone: 'America/New_York' });

    expect(getByText('title:America/New_York')).toBeTruthy();
    expect(getByText('subtitle:America/New_York')).toBeTruthy();
  });

  it('renders no avatar for an item with nobody attached to it', () => {
    const { queryByTestId } = renderRow();

    expect(queryByTestId('inbox-item-avatar-pattern-1')).toBeNull();
  });
});
