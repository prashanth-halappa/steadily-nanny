/**
 * @module domains/draft/__tests__/InviteRow
 *
 * §5.2's per-row overflow and §5.3's pill.
 *
 * Per-invite revoke is not a convenience. §6.2's entire privacy argument for
 * putting her RATE on a public web page rests on three conditions (D-51), and
 * "she can turn this one off" is one of them. Without it the only revoke
 * affordance is Archive, which kills every link at once — and the honest
 * version of the argument becomes "she can withdraw from all her interviews
 * simultaneously".
 */
import { describe, expect, it, mock } from 'bun:test';
import { fireEvent } from '@testing-library/react-native';
import { renderWithProviders } from '@/src/test-utils';
import { InviteRow } from '../components/InviteRow';
import { makeInvite } from './fixtures';

const NOW = new Date('2026-08-11T12:00:00.000Z');

function renderRow(
  overrides: Partial<React.ComponentProps<typeof InviteRow>> = {}
) {
  const props = {
    invite: makeInvite(),
    viewedAt: null,
    now: NOW,
    onCopyCode: mock(),
    onShareAgain: mock(),
    onRevoke: mock(),
    isRevoking: false,
    isRevokeError: false,
    ...overrides,
  };
  return { ...renderWithProviders(<InviteRow {...props} />), props };
}

describe('InviteRow', () => {
  it('labels the row with her private name for the recipient', () => {
    const { getByTestId } = renderRow();
    expect(getByTestId('draft-invite-name').props.children).toBe('The Bakers');
  });

  it('falls back to a neutral label rather than printing nothing', () => {
    const { getByTestId } = renderRow({ invite: makeInvite({ label: null }) });
    expect(getByTestId('draft-invite-name').props.children).toBeTruthy();
  });

  it('renders one filled pill for the current state', () => {
    const { getByTestId } = renderRow({
      invite: makeInvite({ opened_at: '2026-08-11T08:00:00.000Z' }),
    });
    expect(getByTestId('draft-invite-pill-label').props.children).toBe(
      'sentTo.state.opened'
    );
  });

  it('uses the cancelled variant for a revoked link — no new pill variants', () => {
    const { getByTestId } = renderRow({
      invite: makeInvite({ status: 'revoked' }),
    });
    expect(getByTestId('draft-invite-pill-label').props.children).toBe(
      'sentTo.state.revoked'
    );
  });

  it('keeps both dates on the sub-line so the row is a timeline', () => {
    const { getByTestId } = renderRow({
      invite: makeInvite({ opened_at: '2026-08-11T08:00:00.000Z' }),
    });

    const subLine = String(getByTestId('draft-invite-timeline').props.children);
    expect(subLine).toContain('sentTo.timeline.sent');
    expect(subLine).toContain('sentTo.timeline.opened');
  });

  it('opens the overflow sheet from a 44pt button', () => {
    const { getByTestId } = renderRow();

    // Sheets stay mounted and flip `visible` (the PayChangeSheet convention),
    // so the closed state is asserted on the prop, not on absence. That prop
    // lives on the `-modal` node — the bare testID sits on the sheet card,
    // which is the only one an iOS accessibility tree can see.
    expect(getByTestId('draft-invite-menu-sheet-modal').props.visible).toBe(
      false
    );
    const more = getByTestId('draft-invite-more');
    expect(more.props.hitSlop).toBeTruthy();

    fireEvent.press(more);
    expect(getByTestId('draft-invite-menu-sheet-modal').props.visible).toBe(
      true
    );
  });

  it('offers copy, share again and stop this link', () => {
    const { getByTestId } = renderRow();
    fireEvent.press(getByTestId('draft-invite-more'));

    expect(getByTestId('draft-invite-copy')).toBeTruthy();
    expect(getByTestId('draft-invite-share-again')).toBeTruthy();
    expect(getByTestId('draft-invite-stop')).toBeTruthy();
  });

  it('confirms before stopping the link, naming the family', () => {
    const { getByTestId, props } = renderRow();
    fireEvent.press(getByTestId('draft-invite-more'));
    fireEvent.press(getByTestId('draft-invite-stop'));

    expect(props.onRevoke).not.toHaveBeenCalled();
    expect(
      getByTestId('draft-invite-stop-confirm-sheet-modal').props.visible
    ).toBe(true);
    // One sheet at a time — BottomSheetBase enforces mutual exclusion, and
    // two open sheets would fight over the store's activeSheetId.
    expect(getByTestId('draft-invite-menu-sheet-modal').props.visible).toBe(
      false
    );

    fireEvent.press(getByTestId('draft-invite-stop-confirm'));
    expect(props.onRevoke).toHaveBeenCalledTimes(1);
  });

  it('renders a revoke failure inline in the sheet, never as a toast', () => {
    const { getByTestId } = renderRow({ isRevokeError: true });
    fireEvent.press(getByTestId('draft-invite-more'));
    fireEvent.press(getByTestId('draft-invite-stop'));

    expect(getByTestId('draft-invite-stop-error')).toBeTruthy();
  });

  it('offers no way to stop a link that is already finished', () => {
    const { getByTestId, queryByTestId } = renderRow({
      invite: makeInvite({ status: 'revoked' }),
    });
    fireEvent.press(getByTestId('draft-invite-more'));

    expect(queryByTestId('draft-invite-stop')).toBeNull();
    // Copying the code is still meaningful — it is hers, and she may want it.
    expect(getByTestId('draft-invite-copy')).toBeTruthy();
  });
});
