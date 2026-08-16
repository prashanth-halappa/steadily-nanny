/**
 * @module domains/timesheet/__tests__/PaymentRow.test
 *
 * The ledger row is L4 and nothing higher: a record. These tests pin the
 * one thing stream P5 adds — a leading avatar when the screen names a
 * person — without letting that avatar promote the row into a tone, a
 * border, or apricot. Amounts stay in the right-hand group; the avatar
 * only ever leads.
 */
import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react-native';
import { liveCardBackground } from '~/lib/design-tokens/elevation';
import { palette } from '~/lib/design-tokens/palette';
import { PaymentRow, type PaymentRowData } from '../components/PaymentRow';

const SURFACE_LIVE = liveCardBackground('light');
const APRICOT_HEX = palette.light.highlight.hex;

function makeRow(overrides: Partial<PaymentRowData> = {}): PaymentRowData {
  return {
    id: 'p-1',
    dateLabel: 'Sun 16 Aug',
    amountLabel: '£624.00',
    weekLabel: 'Week of 10–16 Aug',
    metaLabel: 'Bank transfer',
    enteredLateLabel: null,
    person: null,
    ...overrides,
  };
}

describe('PaymentRow — leading person', () => {
  it('renders a leading avatar when the row names a person', () => {
    const { getByTestId, getByText } = render(
      <PaymentRow
        row={makeRow({ person: { name: 'The Halappas' } })}
        onPress={() => {}}
      />
    );

    const avatar = getByTestId('payments-row-p-1-avatar');
    expect(avatar).toBeTruthy();
    expect(avatar.props.accessibilityLabel).toBe('The Halappas');
    expect(getByText('T')).toBeTruthy();
    // Amount column is still the right-hand figure — avatar must not
    // displace it.
    expect(getByTestId('payments-row-p-1-amount').props.children).toBe(
      '£624.00'
    );
  });

  it('renders no avatar otherwise', () => {
    const { getByTestId, queryByTestId } = render(
      <PaymentRow row={makeRow()} onPress={() => {}} />
    );

    expect(getByTestId('payments-row-p-1')).toBeTruthy();
    expect(queryByTestId('payments-row-p-1-avatar')).toBeNull();
    expect(getByTestId('payments-row-p-1-amount').props.children).toBe(
      '£624.00'
    );
  });

  it('keeps the L4 rule — no tone background on the row', () => {
    const { getByTestId } = render(
      <PaymentRow
        row={makeRow({ person: { name: 'The Halappas' } })}
        onPress={() => {}}
      />
    );

    const row = getByTestId('payments-row-p-1');
    expect(row.props.className).toContain('bg-card');
    expect(row.props.className).not.toContain('border');
    const styles = [row.props.style].flat().filter(Boolean) as Array<{
      backgroundColor?: string;
    }>;
    const backgroundColors = styles.map(s => s.backgroundColor).filter(Boolean);
    expect(backgroundColors).toHaveLength(0);
    expect(backgroundColors).not.toContain(SURFACE_LIVE);
    expect(backgroundColors).not.toContain(APRICOT_HEX);
  });
});
