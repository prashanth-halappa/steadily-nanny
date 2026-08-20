/**
 * @module domains/timesheet/__tests__/ApproveWeekDialog.test
 * TIER0-CX-SPEC.md §4.3.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';

// Same key-echo contract as the global `bun.setup.ts` mock (every existing
// assertion below still reads a bare key), plus a capture of the
// INTERPOLATION ARGUMENTS — which is the only way to see that the dialog
// echoes the ADJUSTED gross and an UNSIGNED `{{adjustment}}`, since the echo
// mock drops options entirely. Same technique as
// `EarningsBreakdownSheet.i18n.test.tsx`.
const capturedTCalls: Array<{
  key: string;
  options?: Record<string, unknown>;
}> = [];

mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      capturedTCalls.push({ key, options });
      return key;
    },
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children: unknown }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

// Same stand-in as ManageHouseholdScreen.test / TimeOffScreen.test —
// @rn-primitives/alert-dialog's .mjs distribution isn't pre-compiled for
// bun:test.
mock.module('@rn-primitives/alert-dialog', () => {
  const React = require('react');
  const Ctx = React.createContext({
    open: false,
    setOpen: (_open: boolean) => {},
  });

  return {
    Root: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) => {
      const setOpen = (next: boolean) => onOpenChange?.(next);
      return React.createElement(
        Ctx.Provider,
        { value: { open: open ?? false, setOpen } },
        children
      );
    },
    Trigger: ({ children }: { children: React.ReactNode }) => children,
    Portal: ({ children }: { children: React.ReactNode }) => children,
    Overlay: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => {
      const { open } = React.useContext(Ctx);
      return open ? React.createElement('View', props, children) : null;
    },
    Content: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('View', props, children),
    Title: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('Text', props, children),
    Description: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('Text', props, children),
    Cancel: ({
      children,
      onPress,
      ...props
    }: {
      children?: React.ReactNode;
      onPress?: (e: unknown) => void;
      [key: string]: unknown;
    }) => {
      const { setOpen } = React.useContext(Ctx);
      return React.createElement(
        'Pressable',
        {
          ...props,
          onPress: (e: unknown) => {
            onPress?.(e);
            setOpen(false);
          },
        },
        children
      );
    },
    Action: ({
      children,
      onPress,
      disabled,
      ...props
    }: {
      children?: React.ReactNode;
      onPress?: (e: unknown) => void;
      disabled?: boolean;
      [key: string]: unknown;
    }) => {
      const { setOpen } = React.useContext(Ctx);
      return React.createElement(
        'Pressable',
        {
          ...props,
          disabled,
          onPress: (e: unknown) => {
            if (disabled) return;
            onPress?.(e);
            setOpen(false);
          },
        },
        children
      );
    },
    useRootContext: () => React.useContext(Ctx),
  };
});

let ApproveWeekDialog: typeof import('../components/ApproveWeekDialog').ApproveWeekDialog;

beforeAll(async () => {
  ApproveWeekDialog = (await import('../components/ApproveWeekDialog'))
    .ApproveWeekDialog;
});

beforeEach(() => {
  capturedTCalls.length = 0;
});

type DialogProps = Parameters<
  typeof import('../components/ApproveWeekDialog').ApproveWeekDialog
>[0];

const BASE_PROPS: DialogProps = {
  open: true,
  onOpenChange: () => {},
  onConfirm: () => {},
  isSubmitting: false,
  weekRangeLabel: '3 – 9 August',
  hoursLabel: '41h 00m',
  grossLabel: '£236.12',
  earningsStatus: 'ok',
  carerName: 'Amara',
  adjustmentLabel: null,
};

function renderDialog(overrides: Partial<DialogProps> = {}) {
  return render(<ApproveWeekDialog {...BASE_PROPS} {...overrides} />);
}

function tCall(key: string) {
  return capturedTCalls.find(c => c.key === key);
}

describe('ApproveWeekDialog', () => {
  it('titles the dialog with the carer name and her hours', () => {
    renderDialog();

    const call = tCall('approveDialog.title');
    expect(call).toBeDefined();
    expect(call?.options).toEqual(
      expect.objectContaining({
        name: 'Amara',
        hours: '41h 00m',
      })
    );
  });

  it.each([
    {
      variant: 'plain',
      overrides: {},
      key: 'approveDialog.body',
      present: { range: '3 – 9 August' },
      absent: ['gross', 'adjustment'] as const,
    },
    {
      variant: 'nothingUnusual',
      overrides: { nothingUnusual: true },
      key: 'approveDialog.bodyNothingUnusual',
      present: { range: '3 – 9 August' },
      absent: ['gross', 'adjustment'] as const,
    },
    {
      variant: 'noArrangement',
      overrides: {
        grossLabel: null,
        earningsStatus: 'no_arrangement' as const,
      },
      key: 'approveDialog.bodyNoArrangement',
      present: { range: '3 – 9 August' },
      absent: ['gross', 'adjustment'] as const,
    },
    {
      variant: 'currencyChange',
      overrides: {
        grossLabel: null,
        earningsStatus: 'currency_change' as const,
      },
      key: 'approveDialog.bodyCurrencyChange',
      present: { range: '3 – 9 August' },
      absent: ['gross', 'adjustment'] as const,
    },
    {
      variant: 'adjustmentAdded',
      overrides: {
        grossLabel: '£251.12',
        adjustmentLabel: '£15.00',
        adjustmentDirection: 'added' as const,
      },
      key: 'approveDialog.bodyAdjustmentAdded',
      present: {
        range: '3 – 9 August',
        adjustment: '£15.00',
      },
      absent: ['gross'] as const,
    },
    {
      variant: 'adjustmentDeducted',
      overrides: {
        grossLabel: '£216.12',
        adjustmentLabel: '£20.00',
        adjustmentDirection: 'deducted' as const,
      },
      key: 'approveDialog.bodyAdjustmentDeducted',
      present: {
        range: '3 – 9 August',
        adjustment: '£20.00',
      },
      absent: ['gross'] as const,
    },
  ])('$variant body uses $key with range plus adjustment where it belongs — never gross, which is hoisted into its own Figure28', ({
    overrides,
    key,
    present,
    absent,
  }) => {
    renderDialog(overrides);

    const call = tCall(key);
    expect(call).toBeDefined();
    expect(call?.options).toEqual(expect.objectContaining(present));
    for (const field of absent) {
      expect(call?.options?.[field]).toBeUndefined();
    }
  });

  // The gross figure is the number the parent is permanently committing to
  // (docs from `ApproveWeekDialog`'s own module comment) — it gets its own
  // Figure28 tabular line, hoisted out of the body sentence, under the
  // title.
  it('renders the gross as its own Figure28 tabular line, using the grossFigure key', () => {
    const { getByTestId } = renderDialog();

    const figure = getByTestId('hours-approve-dialog-gross');
    expect(figure.props.children).toBe('approveDialog.grossFigure');
    // Figure28 is always tabular by construction (factory.tsx) — no prop
    // needed on the call site to get tabular-nums here.

    const call = tCall('approveDialog.grossFigure');
    expect(call?.options).toEqual(
      expect.objectContaining({ gross: '£236.12' })
    );
  });

  it('omits the gross Figure28 line when there is no computable gross', () => {
    const { queryByTestId } = renderDialog({
      grossLabel: null,
      earningsStatus: 'no_arrangement',
    });

    expect(queryByTestId('hours-approve-dialog-gross')).toBeNull();
  });

  it('uses the nested cancel and confirm keys', () => {
    renderDialog();

    expect(tCall('approveDialog.cancel')).toBeDefined();
    expect(tCall('approveDialog.confirm')).toBeDefined();
  });

  it('shows hours + gross as text in the body when an arrangement exists', () => {
    const { getByTestId } = render(
      <ApproveWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        grossLabel="£236.12"
        earningsStatus="ok"
        carerName="Amara"
        adjustmentLabel={null}
      />
    );

    expect(getByTestId('hours-approve-dialog-title').props.children).toBe(
      'approveDialog.title'
    );
    const body = getByTestId('hours-approve-dialog-body').props.children;
    expect(body).toBe('approveDialog.body');
  });

  it('renders the no-arrangement body variant when grossLabel is null', () => {
    const { getByTestId } = render(
      <ApproveWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        grossLabel={null}
        earningsStatus="no_arrangement"
        carerName="Amara"
        adjustmentLabel={null}
      />
    );

    expect(getByTestId('hours-approve-dialog-body').props.children).toBe(
      'approveDialog.bodyNoArrangement'
    );
  });

  it('renders the currency-change body variant when earnings span two currencies', () => {
    const { getByTestId } = render(
      <ApproveWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        grossLabel={null}
        earningsStatus="currency_change"
        carerName="Amara"
        adjustmentLabel={null}
      />
    );

    expect(getByTestId('hours-approve-dialog-body').props.children).toBe(
      'approveDialog.bodyCurrencyChange'
    );
  });

  it('cancel is "Not yet" and confirm is "Approve the week" — and confirm fires onConfirm', () => {
    const onConfirm = mock();
    const { getByTestId, getByText } = render(
      <ApproveWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={onConfirm}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        grossLabel="£236.12"
        earningsStatus="ok"
        carerName="Amara"
        adjustmentLabel={null}
      />
    );

    expect(getByText('approveDialog.cancel')).toBeTruthy();
    expect(getByText('approveDialog.confirm')).toBeTruthy();

    fireEvent.press(getByTestId('hours-approve-dialog-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables the confirm action while submitting', () => {
    const { getByTestId } = render(
      <ApproveWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        grossLabel="£236.12"
        earningsStatus="ok"
        carerName="Amara"
        adjustmentLabel={null}
      />
    );

    expect(getByTestId('hours-approve-dialog-confirm').props.disabled).toBe(
      true
    );
  });

  // §11.4 / D-5's fast path — refined by §11.1.1's owner-decided predicate.
  it('forks to the nothing-unusual body when the server says so', () => {
    const { getByTestId } = render(
      <ApproveWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        grossLabel="£236.12"
        earningsStatus="ok"
        carerName="Amara"
        adjustmentLabel={null}
        nothingUnusual
      />
    );

    expect(getByTestId('hours-approve-dialog-body').props.children).toBe(
      'approveDialog.bodyNothingUnusual'
    );
  });

  it('keeps the plain body when nothingUnusual is false or unset', () => {
    const { getByTestId } = render(
      <ApproveWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        grossLabel="£236.12"
        earningsStatus="ok"
        carerName="Amara"
        adjustmentLabel={null}
        nothingUnusual={false}
      />
    );

    expect(getByTestId('hours-approve-dialog-body').props.children).toBe(
      'approveDialog.body'
    );
  });

  it('never claims nothing-unusual on a week with a staged adjustment', () => {
    const { getByTestId } = render(
      <ApproveWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        grossLabel="£216.12"
        earningsStatus="ok"
        carerName="Amara"
        adjustmentLabel="£20.00"
        adjustmentDirection="deducted"
        nothingUnusual
      />
    );

    // The staged adjustment is decided THIS approval — the server's
    // nothing_unusual read predates it and cannot know about it.
    expect(getByTestId('hours-approve-dialog-body').props.children).toBe(
      'approveDialog.bodyAdjustmentDeducted'
    );
  });

  it('never claims nothing-unusual outside the ok earnings status', () => {
    const { getByTestId } = render(
      <ApproveWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        grossLabel={null}
        earningsStatus="no_arrangement"
        carerName="Amara"
        adjustmentLabel={null}
        nothingUnusual
      />
    );

    expect(getByTestId('hours-approve-dialog-body').props.children).toBe(
      'approveDialog.bodyNoArrangement'
    );
  });

  it('renders the structure line under the body when supplied and earnings are ok', () => {
    const { getByTestId } = render(
      <ApproveWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        grossLabel="£236.12"
        earningsStatus="ok"
        carerName="Amara"
        adjustmentLabel={null}
        structureLine="53h = 40 reg + 12 OT + 1 DT"
      />
    );

    expect(getByTestId('hours-approve-dialog-structure').props.children).toBe(
      '53h = 40 reg + 12 OT + 1 DT'
    );
  });

  it('omits the structure line when earnings are not ok', () => {
    const { queryByTestId } = render(
      <ApproveWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        grossLabel={null}
        earningsStatus="no_arrangement"
        carerName="Amara"
        adjustmentLabel={null}
        structureLine="53h = 40 reg + 12 OT + 1 DT"
      />
    );

    expect(queryByTestId('hours-approve-dialog-structure')).toBeNull();
  });

  it('omits the structure line when earnings span a currency change', () => {
    const { queryByTestId } = render(
      <ApproveWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        grossLabel={null}
        earningsStatus="currency_change"
        carerName="Amara"
        adjustmentLabel={null}
        structureLine="53h = 40 reg + 12 OT + 1 DT"
      />
    );

    expect(queryByTestId('hours-approve-dialog-structure')).toBeNull();
  });

  it('renders nothing (dialog closed) when open is false', () => {
    const { queryByTestId } = render(
      <ApproveWeekDialog
        open={false}
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        grossLabel="£236.12"
        earningsStatus="ok"
        carerName="Amara"
        adjustmentLabel={null}
      />
    );

    expect(queryByTestId('hours-approve-dialog-title')).toBeNull();
  });
});

// The parent's approval-time adjustment. What this confirmation exists to
// prevent is approving one figure while a different one gets frozen, so the
// gross echoed here is the ADJUSTED gross, and the sign lives in the verb —
// "after taking off £20.00", never "after adding −£20.00".
describe('ApproveWeekDialog — a staged adjustment', () => {
  type Props = Parameters<
    typeof import('../components/ApproveWeekDialog').ApproveWeekDialog
  >[0];

  function renderWithAdjustment(props: Partial<Props> = {}) {
    return render(
      <ApproveWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        hoursLabel="41h 00m"
        // Already adjusted by the caller: £236.12 − £20.00.
        grossLabel="£216.12"
        earningsStatus="ok"
        carerName="Amara"
        adjustmentLabel="£20.00"
        adjustmentDirection="deducted"
        {...props}
      />
    );
  }

  it('forks to the "taking off" body for a deduction', () => {
    const { getByTestId } = renderWithAdjustment();

    expect(getByTestId('hours-approve-dialog-body').props.children).toBe(
      'approveDialog.bodyAdjustmentDeducted'
    );
  });

  it('forks to the "adding" body for an addition', () => {
    const { getByTestId } = renderWithAdjustment({
      grossLabel: '£251.12',
      adjustmentLabel: '£15.00',
      adjustmentDirection: 'added',
    });

    expect(getByTestId('hours-approve-dialog-body').props.children).toBe(
      'approveDialog.bodyAdjustmentAdded'
    );
  });

  it('echoes the ADJUSTED gross in the Figure28 line, and an UNSIGNED adjustment figure in the body', () => {
    renderWithAdjustment();

    const grossCall = capturedTCalls.find(
      c => c.key === 'approveDialog.grossFigure'
    );
    expect(grossCall?.options?.gross).toBe('£216.12');

    const bodyCall = capturedTCalls.find(
      c => c.key === 'approveDialog.bodyAdjustmentDeducted'
    );
    // The verb carries the sign — a minus here would say it twice.
    expect(bodyCall?.options?.adjustment).toBe('£20.00');
    expect(String(bodyCall?.options?.adjustment)).not.toContain('-');
  });

  it('keeps the plain body when nothing is staged, and passes no adjustment — gross still echoes in its own Figure28', () => {
    const { getByTestId } = renderWithAdjustment({
      grossLabel: '£236.12',
      adjustmentLabel: null,
      adjustmentDirection: null,
    });

    expect(getByTestId('hours-approve-dialog-body').props.children).toBe(
      'approveDialog.body'
    );
    const bodyCall = capturedTCalls.find(c => c.key === 'approveDialog.body');
    expect(bodyCall?.options?.gross).toBeUndefined();
    expect(bodyCall?.options?.adjustment).toBeUndefined();

    const grossCall = capturedTCalls.find(
      c => c.key === 'approveDialog.grossFigure'
    );
    expect(grossCall?.options?.gross).toBe('£236.12');
  });

  it('never mentions an adjustment on a week with no computable gross', () => {
    const { getByTestId } = renderWithAdjustment({
      grossLabel: null,
      earningsStatus: 'no_arrangement',
    });

    expect(getByTestId('hours-approve-dialog-body').props.children).toBe(
      'approveDialog.bodyNoArrangement'
    );
  });
});

// D79. A week the roll-up quietly demoted is being approved for the SECOND
// time, and the parent has to be told that this replaces a total they already
// agreed. Rendered only when there is a previous total to name.
describe('ApproveWeekDialog — replacing an earlier approval', () => {
  it('says what it replaces when the week carries a previous approval', () => {
    const { getByTestId } = renderDialog({
      supersedesLine: 'This replaces the £236.12 you approved on 10 August.',
    });

    expect(getByTestId('hours-approve-dialog-supersedes').props.children).toBe(
      'This replaces the £236.12 you approved on 10 August.'
    );
  });

  it('says nothing on a week being approved for the first time', () => {
    const { queryByTestId } = renderDialog();

    expect(queryByTestId('hours-approve-dialog-supersedes')).toBeNull();
  });
});
