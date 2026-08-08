/**
 * @module domains/timesheet/__tests__/WeekTotal.test
 *
 * D15: previous/next week navigation lives on `WeekTotal` — it already
 * shows the week-range label, so the nav controls that change which week is
 * shown sit right next to it. No `AlertDialog`/`BottomSheetBase`/FlashList
 * here, so this renders cleanly under `@testing-library/react-native`,
 * unlike `HoursScreen`/`ParentWeekView` (see `HoursScreens.test.ts`'s
 * source-inspection rationale).
 */
import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { palette } from '~/lib/design-tokens/palette';
import { WeekTotal } from '../components/WeekTotal';

const SURFACE_ATTENTION = palette.light.surfaceAttention.hex;
const SURFACE_POSITIVE = palette.light.surfacePositive.hex;

describe('WeekTotal', () => {
  it('renders the total and week range label without nav props (backwards compatible)', () => {
    const { getByTestId, queryByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        weekRangeLabel="27 Jul – 2 Aug"
        totalLabel="9h 14m"
        overtimeLabel={null}
      />
    );

    expect(getByTestId('hours-week-total')).toBeTruthy();
    expect(getByTestId('hours-total')).toBeTruthy();
    expect(queryByTestId('hours-week-prev')).toBeNull();
    expect(queryByTestId('hours-week-next')).toBeNull();
  });

  it('renders previous/next controls when nav callbacks are provided, with a clear week-label testID', () => {
    const onPreviousWeek = mock(() => {});
    const onNextWeek = mock(() => {});

    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        weekRangeLabel="27 Jul – 2 Aug"
        totalLabel="9h 14m"
        overtimeLabel={null}
        onPreviousWeek={onPreviousWeek}
        onNextWeek={onNextWeek}
        isNextDisabled={false}
      />
    );

    expect(getByTestId('hours-week-prev')).toBeTruthy();
    expect(getByTestId('hours-week-next')).toBeTruthy();
    expect(getByTestId('hours-week-label')).toBeTruthy();
  });

  it('tapping previous/next fires the respective callback', () => {
    const onPreviousWeek = mock(() => {});
    const onNextWeek = mock(() => {});

    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        weekRangeLabel="27 Jul – 2 Aug"
        totalLabel="9h 14m"
        overtimeLabel={null}
        onPreviousWeek={onPreviousWeek}
        onNextWeek={onNextWeek}
        isNextDisabled={false}
      />
    );

    getByTestId('hours-week-prev').props.onPress?.();
    getByTestId('hours-week-next').props.onPress?.();

    expect(onPreviousWeek).toHaveBeenCalledTimes(1);
    expect(onNextWeek).toHaveBeenCalledTimes(1);
  });

  it('disables the next-week control when isNextDisabled is true — never lets navigation reach the future', () => {
    const onNextWeek = mock(() => {});

    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        weekRangeLabel="3 Aug – 9 Aug"
        totalLabel="0h 0m"
        overtimeLabel={null}
        onPreviousWeek={() => {}}
        onNextWeek={onNextWeek}
        isNextDisabled
      />
    );

    const nextButton = getByTestId('hours-week-next');
    expect(nextButton.props.disabled).toBe(true);
    expect(nextButton.props.accessibilityState?.disabled).toBe(true);
  });

  it('disables the previous-week control when isPreviousDisabled is true — bounds how far back navigation can page', () => {
    const onPreviousWeek = mock(() => {});

    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        weekRangeLabel="27 Jul – 2 Aug"
        totalLabel="0h 0m"
        overtimeLabel={null}
        onPreviousWeek={onPreviousWeek}
        onNextWeek={() => {}}
        isPreviousDisabled
      />
    );

    const prevButton = getByTestId('hours-week-prev');
    expect(prevButton.props.disabled).toBe(true);
    expect(prevButton.props.accessibilityState?.disabled).toBe(true);
  });

  it('does not render a money line when earnings is omitted (undefined)', () => {
    const { queryByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        weekRangeLabel="3 Aug – 9 Aug"
        totalLabel="9h 14m"
        overtimeLabel={null}
      />
    );
    expect(queryByTestId('hours-earnings-line')).toBeNull();
  });

  it('wires earnings through to WeekEarningsLine when earnings is provided', () => {
    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        weekRangeLabel="3 Aug – 9 Aug"
        totalLabel="41h 0m"
        overtimeLabel={null}
        totalMinutes={2460}
        timesheetStatus="submitted"
        earningsRole="parent"
        earningsCarerId="carer-1"
        earnings={{
          status: 'ok',
          week_start: '2026-08-03',
          currency: 'GBP',
          lines: [],
          gross_minor: 23612,
          reimbursements_minor: 0,
          worked_minutes: 2460,
          payable_minutes: 2460,
          guaranteed_minutes_per_week: null,
        }}
      />
    );
    expect(getByTestId('hours-earnings-line')).toBeTruthy();
    expect(getByTestId('hours-earnings-line-amount').props.children).toBe(
      '£236.12'
    );
  });

  it('renders carer name and timesheet status pill above the total', () => {
    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        weekRangeLabel="3 Aug – 9 Aug"
        totalLabel="5h 34m"
        overtimeLabel={null}
        carerName="Maria Lopez"
        timesheetStatus="submitted"
        showPayBoundary
      />
    );

    expect(getByTestId('hours-carer-name')).toBeTruthy();
    expect(getByTestId('hours-timesheet-status')).toBeTruthy();
    expect(getByTestId('hours-pay-boundary')).toBeTruthy();
  });

  // Declutter pass: the carer name is promoted to the primary color and
  // shares one row with the pill instead of stacking above it.
  describe('identity row declutter', () => {
    function flatStyle(node: { props: { style?: unknown } }) {
      const style = node.props.style;
      return Array.isArray(style)
        ? Object.assign({}, ...style.filter(Boolean))
        : (style ?? {});
    }

    it('promotes the carer name to semibold default-foreground text, single line, sharing a row with the pill', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="5h 34m"
          overtimeLabel={null}
          carerName="Maria Lopez"
          timesheetStatus="submitted"
        />
      );

      const name = getByTestId('hours-carer-name');
      expect(flatStyle(name).fontWeight).toBe('600');
      expect(name.props.numberOfLines).toBe(1);
      expect(name.props.className).not.toContain('text-muted-foreground');
      expect(getByTestId('hours-timesheet-status')).toBeTruthy();
    });

    it('renders the over-scheduled delta as a caption beneath the figure, not beside it', () => {
      const { getByText } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="9h 14m"
          overtimeLabel="14m over scheduled"
        />
      );

      const node = getByText('14m over scheduled');
      expect(flatStyle(node).fontSize).toBe(13);
    });

    it('renders the total hours figure in SignatureHeroBold (40/600 tabular)', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="9h 14m"
          overtimeLabel={null}
        />
      );

      const total = getByTestId('hours-total');
      expect(flatStyle(total).fontSize).toBe(40);
      expect(flatStyle(total).fontWeight).toBe('600');
    });

    it('renders a 0m total in muted foreground so an empty week does not shout', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="0m"
          overtimeLabel={null}
        />
      );

      expect(getByTestId('hours-total').props.className).toContain(
        'text-muted-foreground'
      );
    });

    it('demotes the payBoundary explainer to MetadataLabel with more top margin', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="5h 34m"
          overtimeLabel={null}
          showPayBoundary
        />
      );

      const node = getByTestId('hours-pay-boundary');
      expect(node.props.className).toContain('mt-3');
      expect(flatStyle(node).fontSize).toBe(13);
    });

    it('folds the carer name into the money row accessibilityLabel, never the visible label', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          totalMinutes={2460}
          timesheetStatus="submitted"
          carerName="Maria Lopez"
          earningsRole="parent"
          earningsCarerId="carer-1"
          earnings={{
            status: 'ok',
            week_start: '2026-08-03',
            currency: 'GBP',
            lines: [],
            gross_minor: 23612,
            reimbursements_minor: 0,
            worked_minutes: 2460,
            payable_minutes: 2460,
            guaranteed_minutes_per_week: null,
          }}
        />
      );

      expect(
        getByTestId('hours-earnings-line-pressable').props.accessibilityLabel
      ).toBe('Maria Lopez: earningsEstimatedGross £236.12');
      // The visible label itself must not carry the carer name.
      expect(getByTestId('hours-earnings-line-amount').props.children).toBe(
        '£236.12'
      );
    });
  });

  // Walkthrough fix 1: the reopen affordance was buried in the FlashList
  // footer, below the day rows and reimbursements card — invisible on
  // first load for an approved week. It now lives in the summary card
  // itself, next to the status pill and gross, so a parent who doubts an
  // approved total sees it immediately.
  describe('reopen affordance', () => {
    it('renders hours-reopen-button in the summary card on an approved week when onReopenPress is supplied', () => {
      const onReopenPress = mock(() => {});
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          timesheetStatus="approved"
          onReopenPress={onReopenPress}
        />
      );

      const button = getByTestId('hours-reopen-button');
      expect(button).toBeTruthy();
      button.props.onPress?.();
      expect(onReopenPress).toHaveBeenCalledTimes(1);
    });

    it('gives the reopen control more visual weight than a plain ghost button, so it reads as distinct from Query', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          timesheetStatus="approved"
          onReopenPress={() => {}}
        />
      );

      // The trigger is bordered and distinct from Query's ghost; the
      // destructive treatment now lives in ReopenWeekDialog.
      const button = getByTestId('hours-reopen-button');
      expect(button.props.variant).toBe('outline');
      expect(button.props.variant).not.toBe('ghost');
    });

    it('does not render the reopen control when the week is not approved, even if a handler is supplied', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          timesheetStatus="submitted"
          onReopenPress={() => {}}
        />
      );

      expect(queryByTestId('hours-reopen-button')).toBeNull();
    });

    it('does not render the reopen control when no handler is supplied (helper/read-only view)', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          timesheetStatus="approved"
        />
      );

      expect(queryByTestId('hours-reopen-button')).toBeNull();
    });

    it('disables the reopen control while a reopen is already in flight', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          timesheetStatus="approved"
          onReopenPress={() => {}}
          isReopenPending
        />
      );

      expect(getByTestId('hours-reopen-button').props.disabled).toBe(true);
    });
  });

  // Cold-mount reopen reason — wire `earningsReopenReason` through to the
  // existing `-reopened-note` slot (no ephemeral transition needed).
  describe('earningsReopenReason', () => {
    const earnings = {
      status: 'ok' as const,
      week_start: '2026-08-03',
      currency: 'GBP',
      lines: [],
      gross_minor: 23612,
      reimbursements_minor: 0,
      worked_minutes: 2460,
      payable_minutes: 2460,
      guaranteed_minutes_per_week: null,
    };

    it('shows the reopened note from a wire reason on a non-approved week', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          totalMinutes={2460}
          timesheetStatus="submitted"
          earnings={earnings}
          earningsReopenReason="Thursday hours were wrong"
        />
      );
      expect(getByTestId('hours-earnings-line-reopened-note')).toBeTruthy();
    });

    it('does not show a stale wire reason on an approved week', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          totalMinutes={2460}
          timesheetStatus="approved"
          earnings={earnings}
          earningsReopenReason="Thursday hours were wrong"
        />
      );
      expect(queryByTestId('hours-earnings-line-reopened-note')).toBeNull();
    });

    // The reason is a timesheet-status fact, not an earnings fact — it must
    // survive every early return inside WeekEarningsLine (no arrangement,
    // hours-only, zero-hours, earnings null). These cases failed when the
    // note lived only in the `ok` earnings arm.
    it('shows the wire reason on a no_arrangement week (earnings arm never reaches ok)', () => {
      const { getByTestId, getByText } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          totalMinutes={2460}
          timesheetStatus="submitted"
          earnings={{
            status: 'no_arrangement',
            week_start: '2026-08-03',
            unpriced_dates: ['2026-08-03'],
          }}
          earningsRole="parent"
          earningsCarerId="carer-1"
          earningsReopenReason="Thursday hours were wrong"
        />
      );
      expect(getByText('earningsNoArrangementParent')).toBeTruthy();
      expect(getByTestId('hours-earnings-line-reopened-note')).toBeTruthy();
    });

    it('shows the wire reason on a zero-hours week (earnings line itself is omitted)', () => {
      const { getByTestId, queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="0m"
          overtimeLabel={null}
          totalMinutes={0}
          timesheetStatus="submitted"
          earnings={{
            ...earnings,
            gross_minor: 0,
            worked_minutes: 0,
            payable_minutes: 0,
          }}
          earningsReopenReason="Thursday hours were wrong"
        />
      );
      expect(queryByTestId('hours-earnings-line')).toBeNull();
      expect(getByTestId('hours-earnings-line-reopened-note')).toBeTruthy();
    });
  });

  // Approved week is locked for carers — one caption at the week-card level
  // (not per entry row). Parents who can reopen themselves get the button
  // instead; the caption would be noise next to it.
  describe('approved lock note', () => {
    it('renders the lock caption on an approved week when no onReopenPress is supplied', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          timesheetStatus="approved"
        />
      );

      expect(getByTestId('hours-approved-lock-note')).toBeTruthy();
    });

    it('does not render the lock caption when onReopenPress is supplied (parent case)', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          timesheetStatus="approved"
          onReopenPress={() => {}}
        />
      );

      expect(queryByTestId('hours-approved-lock-note')).toBeNull();
    });

    it.each([
      'submitted',
      'queried',
    ] as const)('does not render the lock caption when timesheetStatus is %s', timesheetStatus => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          timesheetStatus={timesheetStatus}
        />
      );

      expect(queryByTestId('hours-approved-lock-note')).toBeNull();
    });

    it.each([
      null,
      undefined,
    ] as const)('does not render the lock caption when timesheetStatus is %s', timesheetStatus => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          timesheetStatus={timesheetStatus}
        />
      );

      expect(queryByTestId('hours-approved-lock-note')).toBeNull();
    });
  });

  // Daylight P0-3: the card itself carries the T1/T2 prominence ladder — a
  // tinted ground — derived from timesheet status crossed with the viewer
  // (`earningsRole` doubles as "who is looking at this card", already
  // passed by both ParentWeekView and NannyWeekView). No accent bar — removed
  // after on-device user feedback ("you don't need the left border") and a
  // genuine rendering defect (a 4px-wide element can't carry a 20px radius).
  describe('T1/positive tone (Daylight prominence ladder)', () => {
    function toneBackground(node: { props: { style?: unknown } }) {
      const styles = [node.props.style].flat(Infinity);
      const bg = styles.find(
        (s): s is { backgroundColor: string } =>
          !!s && typeof s === 'object' && 'backgroundColor' in s
      );
      return bg?.backgroundColor;
    }

    it('is attention-toned when submitted and the viewer is the parent', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="9h 14m"
          overtimeLabel={null}
          timesheetStatus="submitted"
          earningsRole="parent"
        />
      );

      expect(toneBackground(getByTestId('hours-week-total'))).toBe(
        SURFACE_ATTENTION
      );
    });

    it('stays default (no tint) when submitted and the viewer is the nanny — not her obligation', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="9h 14m"
          overtimeLabel={null}
          timesheetStatus="submitted"
          earningsRole="nanny"
        />
      );

      expect(toneBackground(getByTestId('hours-week-total'))).toBeUndefined();
    });

    it('is attention-toned when queried, for either viewer', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="9h 14m"
          overtimeLabel={null}
          timesheetStatus="queried"
          earningsRole="nanny"
        />
      );

      expect(toneBackground(getByTestId('hours-week-total'))).toBe(
        SURFACE_ATTENTION
      );
    });

    it('is positive-toned once approved', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          timesheetStatus="approved"
        />
      );

      expect(toneBackground(getByTestId('hours-week-total'))).toBe(
        SURFACE_POSITIVE
      );
    });

    it('stays default with no tint when the week is still open', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="0m"
          overtimeLabel={null}
          timesheetStatus="open"
        />
      );

      expect(toneBackground(getByTestId('hours-week-total'))).toBeUndefined();
    });
  });

  // Daylight P0-3: "Ready for your approval" — the reason the parent opened
  // the screen — is a headline directly above the figure, not a 12px pill.
  // Pills annotate rows; the anchor card of a screen gets a headline.
  describe('parent headline replaces the StatusPill', () => {
    it('renders a MetadataLabel headline above the total instead of a StatusPill, for the parent viewer', () => {
      const { getByTestId, queryByTestId, getByText } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="9h 14m"
          overtimeLabel={null}
          timesheetStatus="submitted"
          earningsRole="parent"
        />
      );

      expect(getByTestId('hours-status-headline')).toBeTruthy();
      expect(getByText('statusSubmitted')).toBeTruthy();
      expect(queryByTestId('hours-timesheet-status')).toBeNull();
    });

    it('reads "Approved on {date}" once approved and a date is known', () => {
      const { getByText } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          timesheetStatus="approved"
          earningsRole="parent"
          approvedDateLabel="6 August"
        />
      );

      expect(getByText('approvedOnDate')).toBeTruthy();
    });

    it('falls back to the plain approved label when no date is known', () => {
      const { getByText } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          timesheetStatus="approved"
          earningsRole="parent"
        />
      );

      expect(getByText('statusApproved')).toBeTruthy();
    });

    it('promotes the query note into the card, directly under the headline, when queried', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="9h 14m"
          overtimeLabel={null}
          timesheetStatus="queried"
          earningsRole="parent"
          queryNote="Thursday looks longer than expected"
        />
      );

      expect(getByTestId('hours-query-note')).toBeTruthy();
    });

    it('never shows the query note when status is not queried, even if one is supplied', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="9h 14m"
          overtimeLabel={null}
          timesheetStatus="submitted"
          earningsRole="parent"
          queryNote="Stale note"
        />
      );

      expect(queryByTestId('hours-query-note')).toBeNull();
    });
  });

  // Daylight P0-5: the person whose pay it is could not see whether her week
  // was open, submitted, queried or approved. Same StatusPill the parent
  // used to see, forked to carer-side wording.
  describe('nanny StatusPill — carer-side wording (P0-5)', () => {
    it.each([
      ['open', 'stillOpen'],
      ['submitted', 'withTheFamily'],
      ['queried', 'theFamilyAsked'],
      ['approved', 'approved'],
    ] as const)('labels the pill for nanny status %s', (status, _label) => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="9h 14m"
          overtimeLabel={null}
          timesheetStatus={status}
          earningsRole="nanny"
        />
      );

      expect(getByTestId('hours-timesheet-status')).toBeTruthy();
    });

    // Regression pairing (with the parent test above): the pill and the
    // headline are each other's replacement for their respective viewer,
    // never both at once for either.
    it('never shows the parent headline alongside the nanny pill', () => {
      const { getByTestId, queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="9h 14m"
          overtimeLabel={null}
          timesheetStatus="submitted"
          earningsRole="nanny"
        />
      );

      expect(getByTestId('hours-timesheet-status')).toBeTruthy();
      expect(queryByTestId('hours-status-headline')).toBeNull();
    });

    it('reads "Still open" for a nanny whose week has not been submitted yet', () => {
      const { getByText } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="9h 14m"
          overtimeLabel={null}
          timesheetStatus="open"
          earningsRole="nanny"
        />
      );

      expect(getByText('nannyStatusNotSubmitted')).toBeTruthy();
    });

    it('reads "With the family" for a nanny whose week is submitted', () => {
      const { getByText } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="9h 14m"
          overtimeLabel={null}
          timesheetStatus="submitted"
          earningsRole="nanny"
        />
      );

      expect(getByText('nannyStatusSubmitted')).toBeTruthy();
    });

    it('reads "The family asked a question" for a nanny whose week is queried', () => {
      const { getByText } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="9h 14m"
          overtimeLabel={null}
          timesheetStatus="queried"
          earningsRole="nanny"
        />
      );

      expect(getByText('nannyStatusQueried')).toBeTruthy();
    });

    const okEarnings = {
      status: 'ok' as const,
      week_start: '2026-08-03',
      currency: 'GBP',
      lines: [],
      gross_minor: 35208,
      reimbursements_minor: 0,
      worked_minutes: 2460,
      payable_minutes: 2460,
      guaranteed_minutes_per_week: null,
    };

    it('shows an appreciation line with the household, date and gross once approved', () => {
      const { getByTestId, getByText } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          timesheetStatus="approved"
          earningsRole="nanny"
          approvedDateLabel="6 August"
          householdName="the Smiths"
          earnings={okEarnings}
        />
      );

      expect(getByTestId('hours-approved-by-note')).toBeTruthy();
      expect(getByText('approvedByHouseholdWithGross')).toBeTruthy();
      // Rule B (docs/07-MOBILE-UI-SYSTEM.md): on the tinted `positive`
      // ground, the primary sentence is `foreground`, not muted — this
      // line IS the tier's message (the P0-5 appreciation moment), not a
      // supporting caption.
      expect(
        getByTestId('hours-approved-by-note').props.className
      ).not.toContain('text-muted-foreground');
    });

    it('omits the money clause when the gross is unknown, rather than inventing a figure', () => {
      const { getByText, queryByText } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          timesheetStatus="approved"
          earningsRole="nanny"
          approvedDateLabel="6 August"
          householdName="the Smiths"
          earnings={{
            status: 'no_arrangement',
            week_start: '2026-08-03',
            unpriced_dates: [],
          }}
        />
      );

      expect(getByText('approvedByHousehold')).toBeTruthy();
      expect(queryByText('approvedByHouseholdWithGross')).toBeNull();
    });

    it('does not render the appreciation line for a non-approved status', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="9h 14m"
          overtimeLabel={null}
          timesheetStatus="submitted"
          earningsRole="nanny"
          approvedDateLabel="6 August"
          householdName="the Smiths"
        />
      );

      expect(queryByTestId('hours-approved-by-note')).toBeNull();
    });
  });

  // Daylight P0-3: Approve moves from the FlashList footer, several screens
  // below every day row, into the anchor card itself, next to the figure it
  // approves. WeekTotal stays presentational — the caller owns the handlers.
  describe('primary/secondary action slots', () => {
    it('renders the primary action as a full-width default button', () => {
      const onPress = mock(() => {});
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="9h 14m"
          overtimeLabel={null}
          primaryAction={{
            testID: 'hours-approve-button',
            label: 'Approve the week',
            onPress,
          }}
        />
      );

      const button = getByTestId('hours-approve-button');
      expect(button.props.variant).toBeUndefined();
      button.props.onPress?.();
      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('renders the secondary action as a ghost button beneath the primary, in destructive text when marked', () => {
      const { getByTestId, getByText } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="9h 14m"
          overtimeLabel={null}
          primaryAction={{
            testID: 'hours-approve-button',
            label: 'Approve the week',
            onPress: () => {},
          }}
          secondaryAction={{
            testID: 'hours-query-button',
            label: 'Query',
            onPress: () => {},
            destructive: true,
          }}
        />
      );

      const button = getByTestId('hours-query-button');
      expect(button.props.variant).toBe('ghost');
      expect(getByText('Query').props.className).toContain('text-destructive');
    });

    it('renders an actionsNote above the actions when supplied', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="9h 14m"
          overtimeLabel={null}
          actionsNote="Approve unlocks once your carer has logged hours this week."
        />
      );

      expect(getByTestId('hours-approve-waiting')).toBeTruthy();
    });

    it('renders neither action when both are omitted', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="9h 14m"
          overtimeLabel={null}
        />
      );

      expect(queryByTestId('hours-approve-button')).toBeNull();
      expect(queryByTestId('hours-query-button')).toBeNull();
    });
  });
});
