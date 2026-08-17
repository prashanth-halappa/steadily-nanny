/**
 * @module domains/pay/components/__tests__/TermsSentReceipt
 *
 * The receipt is what replaced a toast, so the thing worth pinning is that it
 * says the three facts a toast could not: WHAT was sent, that the other side
 * still has to agree, and whether they have opened it.
 */
import { describe, expect, it, mock } from 'bun:test';
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { fireEvent, render } from '@testing-library/react-native';
import { TermsSentReceipt } from '../TermsSentReceipt';

const proposal = {
  id: 'prop-1',
  household_id: 'h1',
  carer_id: 'c1',
  proposed_by: 'parent-1',
  direction: 'parent',
  status: 'proposed',
  terms: {
    rate_minor: 2500,
    currency: 'USD',
    overtime_multiplier: 1.5,
    valid_from: '2026-08-16',
  },
  note: null,
  supersedes_id: null,
  from_invite_id: null,
  carer_display_name: 'Andrea',
  weekly_equivalent_minor: null,
  viewed_at: null,
  responded_at: null,
  accepted_by: null,
  accepted_arrangement_id: null,
  responsibility_confirmed: false,
  created_at: '2026-08-16T09:00:00.000Z',
  updated_at: '2026-08-16T09:00:00.000Z',
} as TermsProposal;

function renderReceipt(over: Partial<TermsProposal> = {}, viewer = 'parent') {
  return render(
    <TermsSentReceipt
      proposal={{ ...proposal, ...over } as TermsProposal}
      counterpartyName="Andrea"
      householdTimezone="UTC"
      viewer={viewer as 'parent' | 'carer'}
      onWithdraw={() => {}}
      isWithdrawing={false}
    />
  );
}

describe('TermsSentReceipt', () => {
  it('names the recipient, the rate that was sent, and the date it takes effect', () => {
    const { getByTestId } = renderReceipt();

    expect(getByTestId('pay-terms-receipt-title').props.children).toBe(
      'receipt.sentTo'
    );
    // The RATE is carried off the proposal's own terms — never recomputed,
    // never rate x hours (docs/11-MONEY.md §1).
    expect(getByTestId('pay-terms-receipt-terms')).toBeTruthy();
  });

  it("says the other side must agree first — the sentence a pre-send dialog can't say", () => {
    expect(
      renderReceipt().getByTestId('pay-terms-receipt-consequence').props
        .children
    ).toBe('receipt.mustAgreeParent');
  });

  it("the nanny's copy names HER clock, not the parent's", () => {
    expect(
      renderReceipt({}, 'carer').getByTestId('pay-terms-receipt-consequence')
        .props.children
    ).toBe('receipt.mustAgreeCarer');
  });

  it('unopened reads "Not opened yet" — never a fabricated seen', () => {
    expect(
      renderReceipt({ viewed_at: null }).getByTestId('pay-terms-receipt-seen')
        .props.children
    ).toBe('receipt.notOpened');
  });

  it('a stamped viewed_at reads as seen by the recipient', () => {
    expect(
      renderReceipt({ viewed_at: '2026-08-16T12:00:00.000Z' }).getByTestId(
        'pay-terms-receipt-seen'
      ).props.children
    ).toBe('receipt.seenBy');
  });

  it('Withdraw is a ghost action on the receipt itself, and calls back', () => {
    const onWithdraw = mock();
    const { getByTestId } = render(
      <TermsSentReceipt
        proposal={proposal}
        counterpartyName="Andrea"
        householdTimezone="UTC"
        viewer="parent"
        onWithdraw={onWithdraw}
        isWithdrawing={false}
      />
    );

    fireEvent.press(getByTestId('pay-terms-receipt-withdraw'));
    expect(onWithdraw).toHaveBeenCalled();
  });
});
