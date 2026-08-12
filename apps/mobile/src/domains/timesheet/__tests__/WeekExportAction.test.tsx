/**
 * @module domains/timesheet/__tests__/WeekExportAction.test
 *
 * "Export week" — approved weeks only, both roles. Two routes out of the
 * same sheet and they are deliberately different in kind: the CSV is the
 * SERVER's document (fetched and shared verbatim), the PDF is built from the
 * week payload already on screen, so it costs no second round trip and can
 * never disagree with what the user is looking at.
 *
 * `utils/weekExport` is the only native seam (expo-print / expo-sharing /
 * expo-file-system) and is mocked here as ONE module — that is exactly why
 * it exists as its own module.
 */
// Imported at module scope, NOT `require()`d inside the mock factories below.
// A `require()` of an ES module from inside a factory races on whether that
// module has finished evaluating: when it hasn't, Bun throws
// "require() async module ... is unsupported" and the whole file fails at
// load with 0 tests run. It is timing-dependent, so it surfaced as an
// intermittent gate failure that passed on re-run.

import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as timesheetSchemaModule from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
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

const exportCsvMock = mock((_id: string) =>
  Promise.resolve('date,amount_minor\n2026-08-03,23612\n')
);
mock.module('@/src/api/endpoints/timesheets', () => {
  const shared = timesheetSchemaModule;
  return { ...shared, timesheetApi: { exportCsv: exportCsvMock } };
});

class FakeExportUnavailableError extends Error {}
const shareCsvMock = mock((_name: string, _contents: string, _title: string) =>
  Promise.resolve()
);
const sharePdfMock = mock((_html: string, _title: string) => Promise.resolve());
mock.module('../utils/weekExport', () => ({
  ExportUnavailableError: FakeExportUnavailableError,
  weekExportFileName: (carer: string, week: string, ext: string) =>
    `${carer}-${week}.${ext}`,
  shareCsv: shareCsvMock,
  sharePdfFromHtml: sharePdfMock,
}));

const showErrorToastMock = mock((_message: string) => {});
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
  showSuccessToast: mock(() => {}),
}));

let WeekExportAction: typeof import('../components/WeekExportAction').WeekExportAction;

beforeAll(async () => {
  WeekExportAction = (await import('../components/WeekExportAction'))
    .WeekExportAction;
});

const okEarnings = {
  status: 'ok' as const,
  week_start: '2026-08-03',
  currency: 'GBP',
  lines: [
    {
      kind: 'regular' as const,
      minutes: 2460,
      rate_minor: 1850,
      multiplier: null,
      amount_minor: 23612,
      from_date: '2026-08-03',
      to_date: '2026-08-09',
      arrangement_id: 'arr-1',
    },
  ],
  gross_minor: 23612,
  reimbursements_minor: 0,
  worked_minutes: 2460,
  payable_minutes: 2460,
  guaranteed_minutes_per_week: null,
};

function renderAction(
  props: Partial<React.ComponentProps<typeof WeekExportAction>> = {}
) {
  return render(
    <WeekExportAction
      timesheetId="ts-1"
      weekStartISO="2026-08-03"
      weekRangeLabel="3 Aug – 9 Aug"
      carerName="Amara"
      earnings={okEarnings}
      paidState={{
        status: 'partial',
        paidMinor: 12000,
        grossMinor: 23612,
        balanceMinor: 11612,
      }}
      {...props}
    />
  );
}

beforeEach(() => {
  exportCsvMock.mockClear();
  shareCsvMock.mockClear();
  sharePdfMock.mockClear();
  showErrorToastMock.mockClear();
  exportCsvMock.mockImplementation(() =>
    Promise.resolve('date,amount_minor\n2026-08-03,23612\n')
  );
  shareCsvMock.mockImplementation(() => Promise.resolve());
  sharePdfMock.mockImplementation(() => Promise.resolve());
});

describe('WeekExportAction — the sheet', () => {
  it('opens the two export options from the week action', () => {
    const { getByTestId, queryByTestId } = renderAction();

    expect(queryByTestId('hours-export-sheet')).toBeNull();
    fireEvent.press(getByTestId('hours-export-button'));
    expect(getByTestId('hours-export-csv')).toBeTruthy();
    expect(getByTestId('hours-export-pdf')).toBeTruthy();
  });
});

describe('WeekExportAction — Share CSV', () => {
  it('fetches the server CSV and shares it verbatim under a recognisable filename', async () => {
    const { getByTestId } = renderAction();
    fireEvent.press(getByTestId('hours-export-button'));
    fireEvent.press(getByTestId('hours-export-csv'));

    await waitFor(() => expect(shareCsvMock).toHaveBeenCalled());
    expect(exportCsvMock).toHaveBeenCalledWith('ts-1');
    expect(shareCsvMock.mock.calls[0]?.[0]).toBe('Amara-2026-08-03.csv');
    expect(shareCsvMock.mock.calls[0]?.[1]).toBe(
      'date,amount_minor\n2026-08-03,23612\n'
    );
  });

  it('names the "this device cannot share" case rather than blaming the export', async () => {
    shareCsvMock.mockImplementation(() =>
      Promise.reject(new FakeExportUnavailableError())
    );

    const { getByTestId } = renderAction();
    fireEvent.press(getByTestId('hours-export-button'));
    fireEvent.press(getByTestId('hours-export-csv'));

    await waitFor(() => expect(showErrorToastMock).toHaveBeenCalled());
    expect(showErrorToastMock).toHaveBeenCalledWith('export.unavailable');
  });

  it('surfaces a failed fetch as a retryable export failure, not silence', async () => {
    exportCsvMock.mockImplementation(() =>
      Promise.reject(new Error('network'))
    );

    const { getByTestId } = renderAction();
    fireEvent.press(getByTestId('hours-export-button'));
    fireEvent.press(getByTestId('hours-export-csv'));

    await waitFor(() => expect(showErrorToastMock).toHaveBeenCalled());
    expect(showErrorToastMock).toHaveBeenCalledWith('export.failed');
    expect(shareCsvMock).not.toHaveBeenCalled();
  });
});

describe('WeekExportAction — Share PDF', () => {
  it('builds the receipt from the week payload already on screen — no second fetch', async () => {
    const { getByTestId } = renderAction();
    fireEvent.press(getByTestId('hours-export-button'));
    fireEvent.press(getByTestId('hours-export-pdf'));

    await waitFor(() => expect(sharePdfMock).toHaveBeenCalled());
    expect(exportCsvMock).not.toHaveBeenCalled();

    const html = sharePdfMock.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('Amara');
    expect(html).toContain('3 Aug – 9 Aug');
    // Gross, paid to date, balance due — the three figures a receipt exists
    // to state, all formatted by lib/money and not re-derived here.
    expect(html).toContain('£236.12');
    expect(html).toContain('£120.00');
    expect(html).toContain('£116.12');
  });

  it('prints a row for a line kind this build does not know — the rows must still sum to the total', async () => {
    // Dropping the row would print a receipt whose lines add up to less than
    // the gross beside them, which is worse than an unfamiliar label.
    const { getByTestId } = renderAction({
      earnings: {
        ...okEarnings,
        lines: [
          ...okEarnings.lines,
          {
            kind: 'night_differential',
            minutes: 120,
            rate_minor: 2000,
            multiplier: null,
            amount_minor: 4000,
            from_date: '2026-08-08',
            to_date: '2026-08-08',
            arrangement_id: 'arr-1',
          },
        ],
        gross_minor: 27612,
      },
      paidState: {
        status: 'partial',
        paidMinor: 12000,
        grossMinor: 27612,
        balanceMinor: 15612,
      },
    });
    fireEvent.press(getByTestId('hours-export-button'));
    fireEvent.press(getByTestId('hours-export-pdf'));

    await waitFor(() => expect(sharePdfMock).toHaveBeenCalled());
    const html = sharePdfMock.mock.calls[0]?.[0] ?? '';
    // Humanized in place — there is no copy key for a kind this build has
    // never seen.
    expect(html).toContain('Night differential');
    expect(html).toContain('£40.00');
    // £236.12 + £40.00 === the £276.12 gross printed below them.
    expect(html).toContain('£276.12');
  });

  it('prints the double-time row under its own copy key, not the humanized fallback', async () => {
    const { getByTestId } = renderAction({
      earnings: {
        ...okEarnings,
        lines: [
          ...okEarnings.lines,
          {
            kind: 'doubletime',
            minutes: 120,
            rate_minor: 3700,
            multiplier: 2,
            amount_minor: 7400,
            from_date: '2026-08-08',
            to_date: '2026-08-08',
            arrangement_id: 'arr-1',
          },
        ],
        gross_minor: 31012,
      },
      paidState: {
        status: 'partial',
        paidMinor: 12000,
        grossMinor: 31012,
        balanceMinor: 19012,
      },
    });
    fireEvent.press(getByTestId('hours-export-button'));
    fireEvent.press(getByTestId('hours-export-pdf'));

    await waitFor(() => expect(sharePdfMock).toHaveBeenCalled());
    const html = sharePdfMock.mock.calls[0]?.[0] ?? '';
    // Key-echo `t` (bun.setup.ts): the KEY in the label cell proves the copy
    // map resolved it; the humanized "Doubletime" in that same cell would
    // prove it did not. Matched with the cell prefix because the key itself
    // ends in the fallback's spelling.
    expect(html).toContain('label">earningsLineDoubletime<');
    expect(html).not.toContain('label">Doubletime<');
    expect(html).toContain('£74.00');
  });

  it('prints the holiday premium row under its own copy key, not the humanized fallback', async () => {
    const { getByTestId } = renderAction({
      earnings: {
        ...okEarnings,
        lines: [
          ...okEarnings.lines,
          {
            // An increment, not a re-pricing: these 480 minutes are already
            // on a line above, and this row carries the premium alone.
            kind: 'holiday_premium',
            minutes: 480,
            rate_minor: 1400,
            multiplier: 1.5,
            amount_minor: 11200,
            from_date: '2026-08-03',
            to_date: '2026-08-03',
            arrangement_id: 'arr-1',
          },
        ],
        gross_minor: 34812,
      },
      paidState: {
        status: 'partial',
        paidMinor: 12000,
        grossMinor: 34812,
        balanceMinor: 22812,
      },
    });
    fireEvent.press(getByTestId('hours-export-button'));
    fireEvent.press(getByTestId('hours-export-pdf'));

    await waitFor(() => expect(sharePdfMock).toHaveBeenCalled());
    const html = sharePdfMock.mock.calls[0]?.[0] ?? '';
    // Key-echo `t` (bun.setup.ts): the KEY in the label cell proves the copy
    // map resolved it; the humanized "Holiday premium" in that same cell
    // would prove it did not.
    expect(html).toContain('label">earningsLineHolidayPremium<');
    expect(html).not.toContain('label">Holiday premium<');
    expect(html).toContain('£112.00');
  });

  it('prints the paid holiday row under its own copy key, not the humanized fallback', async () => {
    const { getByTestId } = renderAction({
      earnings: {
        ...okEarnings,
        lines: [
          ...okEarnings.lines,
          {
            kind: 'paid_holiday',
            minutes: 480,
            rate_minor: 2800,
            multiplier: null,
            amount_minor: 22_400,
            from_date: '2026-08-04',
            to_date: '2026-08-04',
            arrangement_id: 'arr-1',
          },
        ],
        gross_minor: 45_812,
      },
      paidState: {
        status: 'partial',
        paidMinor: 12000,
        grossMinor: 45_812,
        balanceMinor: 33_812,
      },
    });
    fireEvent.press(getByTestId('hours-export-button'));
    fireEvent.press(getByTestId('hours-export-pdf'));

    await waitFor(() => expect(sharePdfMock).toHaveBeenCalled());
    const html = sharePdfMock.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('label">earningsLinePaidHoliday<');
    expect(html).not.toContain('label">Paid holiday<');
    expect(html).toContain('£224.00');
  });

  it('still produces a receipt for a week with no priced lines', async () => {
    const { getByTestId } = renderAction({
      earnings: null,
      paidState: null,
    });
    fireEvent.press(getByTestId('hours-export-button'));
    fireEvent.press(getByTestId('hours-export-pdf'));

    await waitFor(() => expect(sharePdfMock).toHaveBeenCalled());
    const html = sharePdfMock.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('Amara');
    // No fabricated zero for a week whose total is unknown.
    expect(html).not.toContain('£0.00');
  });
});
