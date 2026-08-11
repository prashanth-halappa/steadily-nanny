/**
 * @module domains/pay/components/__tests__/AcceptTermsSheet
 *
 * §7.3, the binding act. Everything asserted here is a thing that goes wrong
 * quietly: a one-tap agree, a nanny told the terms must suit "our family",
 * an acceptance queued offline, a failure that vanishes as a toast.
 */
import { describe, expect, it, mock } from 'bun:test';
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { fireEvent, render } from '@testing-library/react-native';
import { AcceptTermsSheet } from '../AcceptTermsSheet';

const proposal: TermsProposal = {
  id: 'prop-1',
  household_id: 'hh-1',
  carer_id: 'carer-1',
  proposed_by: 'carer-1',
  direction: 'carer',
  status: 'proposed',
  terms: {
    rate_minor: 2800,
    currency: 'GBP',
    overtime_multiplier: 1.5,
    overtime_threshold_minutes: 2400,
    guaranteed_minutes_per_week: 3000,
    valid_from: '2026-08-17',
  },
  note: null,
  supersedes_id: null,
  from_invite_id: null,
  carer_display_name: 'Marisol',
  weekly_equivalent_minor: 154000,
  viewed_at: null,
  responded_at: null,
  accepted_by: null,
  accepted_arrangement_id: null,
  responsibility_confirmed: false,
  created_at: '2026-08-10T15:00:00.000Z',
  updated_at: '2026-08-10T15:00:00.000Z',
};

function renderSheet(
  overrides: Partial<React.ComponentProps<typeof AcceptTermsSheet>> = {}
) {
  const onAgree = mock();
  const onDismiss = mock();
  const utils = render(
    <AcceptTermsSheet
      visible
      proposal={proposal}
      accepterRole="parent"
      isSubmitting={false}
      isError={false}
      isOnline
      onAgree={onAgree}
      onDismiss={onDismiss}
      {...overrides}
    />
  );
  return { ...utils, onAgree, onDismiss };
}

describe('AcceptTermsSheet', () => {
  it('is a sheet with a checkbox, not a one-tap button — Agree does nothing until it is checked', () => {
    const { getByTestId, onAgree } = renderSheet();
    const agree = getByTestId('proposal-accept-confirm');
    expect(agree.props.disabled).toBe(true);
    fireEvent.press(agree);
    expect(onAgree).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('proposal-accept-checkbox'));
    expect(getByTestId('proposal-accept-confirm').props.disabled).toBe(false);
    fireEvent.press(getByTestId('proposal-accept-confirm'));
    expect(onAgree).toHaveBeenCalledTimes(1);
  });

  it('the liability line is TWO strings — a nanny is never told the terms must suit "our family" (D27)', () => {
    expect(
      renderSheet().getByTestId('proposal-accept-checkbox-label').props.children
    ).toBe('proposal.accept.responsibilityParent');
    expect(
      renderSheet({ accepterRole: 'carer' }).getByTestId(
        'proposal-accept-checkbox-label'
      ).props.children
    ).toBe('proposal.accept.responsibilityCarer');
  });

  it('states the figure and the start date, and nothing about classification (§4.1.1 cut the duties question)', () => {
    const { getByTestId, queryByTestId } = renderSheet();
    expect(getByTestId('proposal-accept-figure')).toBeTruthy();
    expect(getByTestId('proposal-accept-summary')).toBeTruthy();
    expect(queryByTestId('proposal-accept-classification')).toBeNull();
  });

  it('makes the same append-only promise the pay screens make', () => {
    expect(
      renderSheet().getByTestId('proposal-accept-append-only').props.children
    ).toBe('appendOnlyNote');
  });

  it('refuses offline — an acceptance is a binding write and is never queued', () => {
    const { getByTestId, onAgree } = renderSheet({ isOnline: false });
    fireEvent.press(getByTestId('proposal-accept-checkbox'));
    const agree = getByTestId('proposal-accept-confirm');
    expect(agree.props.disabled).toBe(true);
    fireEvent.press(agree);
    expect(onAgree).not.toHaveBeenCalled();
    expect(getByTestId('proposal-accept-offline')).toBeTruthy();
  });

  it('renders failure INLINE and keeps the box checked so retry is one tap (GOLDEN-FIXES #40)', () => {
    const { getByTestId, rerender, onAgree } = renderSheet();
    fireEvent.press(getByTestId('proposal-accept-checkbox'));
    fireEvent.press(getByTestId('proposal-accept-confirm'));

    rerender(
      <AcceptTermsSheet
        visible
        proposal={proposal}
        accepterRole="parent"
        isSubmitting={false}
        isError
        isOnline
        onAgree={onAgree}
        onDismiss={mock()}
      />
    );
    expect(getByTestId('proposal-accept-error')).toBeTruthy();
    expect(
      getByTestId('proposal-accept-checkbox').props.accessibilityState?.checked
    ).toBe(true);
    fireEvent.press(getByTestId('proposal-accept-confirm'));
    expect(onAgree).toHaveBeenCalledTimes(2);
  });

  it('Cancel leaves without agreeing', () => {
    const { getByTestId, onAgree, onDismiss } = renderSheet();
    fireEvent.press(getByTestId('proposal-accept-cancel'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onAgree).not.toHaveBeenCalled();
  });
});
