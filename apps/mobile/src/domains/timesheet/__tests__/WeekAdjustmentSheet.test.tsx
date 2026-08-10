/**
 * @module domains/timesheet/__tests__/WeekAdjustmentSheet.test
 *
 * The parent's approval-time adjustment sheet. Four things this pins, all of
 * them money-safety rather than layout: the CHIPS carry the sign (the field
 * only ever holds an absolute value, because `parseMajorToMinor` refuses a
 * negative by design), an unparseable amount is REFUSED rather than guessed
 * at, a deduction bigger than the week is refused INLINE with the ceiling
 * named (a toast is invisible over an open sheet — GOLDEN-FIXES #40), and
 * the reason is genuinely required before anything can be submitted.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import type React from 'react';

mock.module('@/src/components/custom/BottomSheetBase', () => {
  const R = require('react');
  return {
    BottomSheetBase: ({
      visible,
      children,
      testID,
    }: {
      visible: boolean;
      children: React.ReactNode;
      testID?: string;
    }) => (visible ? R.createElement('View', { testID }, children) : null),
  };
});

let WeekAdjustmentSheet: typeof import('../components/WeekAdjustmentSheet').WeekAdjustmentSheet;

beforeAll(async () => {
  WeekAdjustmentSheet = (await import('../components/WeekAdjustmentSheet'))
    .WeekAdjustmentSheet;
});

const onSubmit = mock((_input: unknown) => {});
const onDismiss = mock(() => {});
const onRemove = mock(() => {});

beforeEach(() => {
  onSubmit.mockClear();
  onDismiss.mockClear();
  onRemove.mockClear();
});

const ID = 'hours-week-adjustment';

function renderSheet(
  props: Partial<React.ComponentProps<typeof WeekAdjustmentSheet>> = {}
) {
  return render(
    <WeekAdjustmentSheet
      visible
      onDismiss={onDismiss}
      onSubmit={onSubmit}
      computedGrossMinor={23612}
      currency="GBP"
      carerName="Amara"
      weekRangeLabel="3 Aug – 9 Aug"
      {...props}
    />
  );
}

describe('WeekAdjustmentSheet — the chips carry the sign', () => {
  it('submits a POSITIVE amount under the default "Add" chip', () => {
    const { getByTestId } = renderSheet();

    fireEvent.changeText(getByTestId(`${ID}-amount-input`), '15');
    fireEvent.changeText(getByTestId(`${ID}-note-input`), '  Birthday bonus  ');
    fireEvent.press(getByTestId(`${ID}-submit`));

    expect(onSubmit).toHaveBeenCalledWith({
      amount_minor: 1500,
      note: 'Birthday bonus',
    });
  });

  it('submits a NEGATIVE amount once "Take off" is chosen — the field stays absolute', () => {
    const { getByTestId } = renderSheet();

    fireEvent.press(getByTestId(`${ID}-direction-deduct`));
    fireEvent.changeText(getByTestId(`${ID}-amount-input`), '20');
    fireEvent.changeText(getByTestId(`${ID}-note-input`), 'Advance on Friday');

    // The typed text never carries a minus — only the payload does.
    expect(getByTestId(`${ID}-amount-input`).props.value).toBe('20');
    fireEvent.press(getByTestId(`${ID}-submit`));

    expect(onSubmit).toHaveBeenCalledWith({
      amount_minor: -2000,
      note: 'Advance on Friday',
    });
  });

  it('prefills the chip, the ABSOLUTE amount and the note when editing a staged deduction', () => {
    const { getByTestId } = renderSheet({
      initialAdjustment: { amount_minor: -2000, note: 'Advance on Friday' },
    });

    expect(getByTestId(`${ID}-amount-input`).props.value).toBe('20.00');
    expect(getByTestId(`${ID}-note-input`).props.value).toBe(
      'Advance on Friday'
    );
    // Still a deduction on re-submit — the chip was seeded from the sign.
    fireEvent.press(getByTestId(`${ID}-submit`));
    expect(onSubmit).toHaveBeenCalledWith({
      amount_minor: -2000,
      note: 'Advance on Friday',
    });
  });
});

describe('WeekAdjustmentSheet — refusals are inline, never guesses', () => {
  it('refuses an unparseable amount rather than reading ".45" as 45p or £45', () => {
    const { getByTestId } = renderSheet();

    fireEvent.changeText(getByTestId(`${ID}-amount-input`), '.45');
    fireEvent.changeText(getByTestId(`${ID}-note-input`), 'Taxi');

    expect(getByTestId(`${ID}-amount-error`)).toBeTruthy();
    fireEvent.press(getByTestId(`${ID}-submit`));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses a zero adjustment — an adjustment of nothing is not an adjustment', () => {
    const { getByTestId } = renderSheet();

    fireEvent.changeText(getByTestId(`${ID}-amount-input`), '0');
    fireEvent.changeText(getByTestId(`${ID}-note-input`), 'Nothing really');
    fireEvent.press(getByTestId(`${ID}-submit`));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(getByTestId(`${ID}-amount-error`)).toBeTruthy();
  });

  it('refuses an amount past the £999,999.99 ceiling through the same arm', () => {
    const { getByTestId } = renderSheet();

    fireEvent.changeText(getByTestId(`${ID}-amount-input`), '1000000');
    fireEvent.changeText(getByTestId(`${ID}-note-input`), 'Typo');

    expect(getByTestId(`${ID}-amount-error`)).toBeTruthy();
    fireEvent.press(getByTestId(`${ID}-submit`));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('names the ceiling INLINE when a deduction is bigger than the week', () => {
    const { getByTestId, queryByTestId } = renderSheet();

    fireEvent.press(getByTestId(`${ID}-direction-deduct`));
    fireEvent.changeText(getByTestId(`${ID}-amount-input`), '300');
    fireEvent.changeText(getByTestId(`${ID}-note-input`), 'Too much');

    expect(getByTestId(`${ID}-exceeds-error`)).toBeTruthy();
    // Not the generic "enter a valid amount" — £300 IS a valid amount.
    expect(queryByTestId(`${ID}-amount-error`)).toBeNull();
    fireEvent.press(getByTestId(`${ID}-submit`));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('allows a deduction of EXACTLY the week — a zero gross is legal, a negative one is not', () => {
    const { getByTestId, queryByTestId } = renderSheet();

    fireEvent.press(getByTestId(`${ID}-direction-deduct`));
    fireEvent.changeText(getByTestId(`${ID}-amount-input`), '236.12');
    fireEvent.changeText(getByTestId(`${ID}-note-input`), 'Paid in full early');

    expect(queryByTestId(`${ID}-exceeds-error`)).toBeNull();
    fireEvent.press(getByTestId(`${ID}-submit`));
    expect(onSubmit).toHaveBeenCalledWith({
      amount_minor: -23612,
      note: 'Paid in full early',
    });
  });

  it('the same figure ADDED is never refused — the ceiling is a deduction rule', () => {
    const { getByTestId, queryByTestId } = renderSheet();

    fireEvent.changeText(getByTestId(`${ID}-amount-input`), '300');
    fireEvent.changeText(getByTestId(`${ID}-note-input`), 'Overtime bonus');

    expect(queryByTestId(`${ID}-exceeds-error`)).toBeNull();
    fireEvent.press(getByTestId(`${ID}-submit`));
    expect(onSubmit).toHaveBeenCalledWith({
      amount_minor: 30000,
      note: 'Overtime bonus',
    });
  });
});

describe('WeekAdjustmentSheet — the reason is required', () => {
  it('holds submit down until a reason is typed', () => {
    const { getByTestId } = renderSheet();

    fireEvent.changeText(getByTestId(`${ID}-amount-input`), '15');
    expect(getByTestId(`${ID}-submit`).props.disabled).toBe(true);
    fireEvent.press(getByTestId(`${ID}-submit`));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.changeText(getByTestId(`${ID}-note-input`), 'Bus fares');
    expect(getByTestId(`${ID}-submit`).props.disabled).toBe(false);
  });

  it('treats whitespace as no reason at all', () => {
    const { getByTestId } = renderSheet();

    fireEvent.changeText(getByTestId(`${ID}-amount-input`), '15');
    fireEvent.changeText(getByTestId(`${ID}-note-input`), '   ');
    fireEvent.press(getByTestId(`${ID}-submit`));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('caps the reason at the wire contract length', () => {
    const { getByTestId } = renderSheet();

    expect(getByTestId(`${ID}-note-input`).props.maxLength).toBe(200);
  });
});

describe('WeekAdjustmentSheet — preview and remove', () => {
  it('previews the resulting gross only once the amount parses', () => {
    const { getByTestId, queryByTestId } = renderSheet();

    expect(queryByTestId(`${ID}-preview`)).toBeNull();

    fireEvent.press(getByTestId(`${ID}-direction-deduct`));
    fireEvent.changeText(getByTestId(`${ID}-amount-input`), '20');

    expect(getByTestId(`${ID}-preview-value`).props.children).toBe('£216.12');
  });

  it('withholds the preview while the result would be negative', () => {
    const { getByTestId, queryByTestId } = renderSheet();

    fireEvent.press(getByTestId(`${ID}-direction-deduct`));
    fireEvent.changeText(getByTestId(`${ID}-amount-input`), '300');

    expect(queryByTestId(`${ID}-preview`)).toBeNull();
  });

  it('offers "Remove adjustment" only when one is already staged', () => {
    const { queryByTestId } = renderSheet();
    expect(queryByTestId(`${ID}-remove`)).toBeNull();

    const editing = renderSheet({
      initialAdjustment: { amount_minor: -2000, note: 'Advance' },
      onRemove,
    });
    fireEvent.press(editing.getByTestId(`${ID}-remove`));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('renders nothing at all while hidden', () => {
    const { queryByTestId } = renderSheet({ visible: false });

    expect(queryByTestId(`${ID}-submit`)).toBeNull();
  });
});
