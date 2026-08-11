/**
 * @module domains/pay/components/__tests__/CurrencySelect.test
 * T13 — a search field over the curated currency list (§playbook T13). The
 * list stays curated (ponytail, `CurrencySelect.tsx`'s own header comment);
 * search only narrows what's already there, it does not add codes.
 */
import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { CurrencySelect } from '../CurrencySelect';

describe('CurrencySelect — search (T13)', () => {
  it('shows a search field only once the list is expanded', () => {
    const { getByTestId, queryByTestId } = render(
      <CurrencySelect value="USD" onChange={() => {}} testIDPrefix="test" />
    );
    expect(queryByTestId('test-currency-search')).toBeNull();
    fireEvent.press(getByTestId('test-currency-trigger'));
    expect(getByTestId('test-currency-search')).toBeTruthy();
  });

  it('filters the list by currency code, case-insensitively', () => {
    const { getByTestId, queryByTestId } = render(
      <CurrencySelect value="USD" onChange={() => {}} testIDPrefix="test" />
    );
    fireEvent.press(getByTestId('test-currency-trigger'));
    expect(getByTestId('test-currency-EUR')).toBeTruthy();

    fireEvent.changeText(getByTestId('test-currency-search'), 'eur');

    expect(getByTestId('test-currency-EUR')).toBeTruthy();
    expect(queryByTestId('test-currency-GBP')).toBeNull();
  });

  it('filters the list by currency NAME, not just code', () => {
    const { getByTestId, queryByTestId } = render(
      <CurrencySelect value="USD" onChange={() => {}} testIDPrefix="test" />
    );
    fireEvent.press(getByTestId('test-currency-trigger'));

    fireEvent.changeText(getByTestId('test-currency-search'), 'dollar');

    // Every dollar-named currency in the curated list survives...
    expect(getByTestId('test-currency-AUD')).toBeTruthy();
    expect(getByTestId('test-currency-CAD')).toBeTruthy();
    // ...and a currency whose name has nothing to do with "dollar" is gone.
    expect(queryByTestId('test-currency-EUR')).toBeNull();
  });

  it('shows an empty-result caption rather than a blank list', () => {
    const { getByTestId, getByText } = render(
      <CurrencySelect value="USD" onChange={() => {}} testIDPrefix="test" />
    );
    fireEvent.press(getByTestId('test-currency-trigger'));

    fireEvent.changeText(getByTestId('test-currency-search'), 'zzzzz');

    expect(getByText('currencySearchEmpty')).toBeTruthy();
  });

  it('closing and reopening the list clears the previous search', () => {
    const { getByTestId, queryByTestId } = render(
      <CurrencySelect value="USD" onChange={() => {}} testIDPrefix="test" />
    );
    fireEvent.press(getByTestId('test-currency-trigger'));
    fireEvent.changeText(getByTestId('test-currency-search'), 'eur');
    fireEvent.press(getByTestId('test-currency-trigger')); // close
    fireEvent.press(getByTestId('test-currency-trigger')); // reopen

    expect(queryByTestId('test-currency-GBP')).toBeTruthy();
  });

  it('selecting a filtered result still calls onChange and closes the list', () => {
    const onChange = mock((_code: string) => {});
    const { getByTestId, queryByTestId } = render(
      <CurrencySelect value="USD" onChange={onChange} testIDPrefix="test" />
    );
    fireEvent.press(getByTestId('test-currency-trigger'));
    fireEvent.changeText(getByTestId('test-currency-search'), 'eur');
    fireEvent.press(getByTestId('test-currency-EUR'));

    expect(onChange).toHaveBeenCalledWith('EUR');
    expect(queryByTestId('test-currency-list')).toBeNull();
  });
});
