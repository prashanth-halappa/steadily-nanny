/**
 * @module domains/timesheet/__tests__/WeekTotal.test
 *
 * Daylight v2: `WeekTotal` is now the Hours statement's STATUS CARD only.
 * The week figure, week nav, carer name and empty-week note moved to
 * `HoursHeroBand`; the money line and paid state moved to `WeekMoneyCard`.
 * The tests that used to exercise those props survive here as negative
 * assertions ("no longer this component's job") in the `moved out of
 * WeekTotal` block — the positive coverage lives in the owning components'
 * own test files.
 *
 * No `AlertDialog`/`BottomSheetBase`/FlashList here, so this renders cleanly
 * under `@testing-library/react-native`, unlike `HoursScreen`/`ParentWeekView`
 * (see `HoursScreens.test.ts`'s source-inspection rationale).
 */
import { describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react-native';
import { palette } from '~/lib/design-tokens/palette';
import { WeekTotal } from '../components/WeekTotal';

const SURFACE_ATTENTION = palette.light.surfaceAttention.hex;
const SURFACE_POSITIVE = palette.light.surfacePositive.hex;

function flatStyle(node: { props: { style?: unknown } }) {
  const style = node.props.style;
  return Array.isArray(style)
    ? Object.assign({}, ...style.flat(Number.POSITIVE_INFINITY).filter(Boolean))
    : (style ?? {});
}

const okEarnings = {
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

describe('WeekTotal', () => {
  it('renders the status card for a week that has a status', () => {
    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        timesheetStatus="submitted"
        earningsRole="parent"
      />
    );

    expect(getByTestId('hours-week-total')).toBeTruthy();
  });

  it('renders nothing at all when it has nothing to say about the agreement', () => {
    const { queryByTestId } = render(<WeekTotal testID="hours-week-total" />);

    expect(queryByTestId('hours-week-total')).toBeNull();
  });

  // These behaviours did NOT disappear — they moved. `hours-total`, the week
  // nav, the carer name and the empty-week note are `HoursHeroBand`'s; the
  // money line and its carer-name accessibilityLabel are `WeekMoneyCard`'s.
  // Asserting their absence here is the regression guard against the card
  // quietly growing back into the whole screen.
  describe('moved out of WeekTotal (hero band / money card own these now)', () => {
    it('never renders the week figure, its overtime caption or the empty-week note', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earningsRole="parent"
        />
      );

      expect(queryByTestId('hours-total')).toBeNull();
      expect(queryByTestId('hours-overtime')).toBeNull();
      expect(queryByTestId('hours-empty-week')).toBeNull();
    });

    it('never renders week navigation — no prev/next/label controls', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earningsRole="parent"
        />
      );

      expect(queryByTestId('hours-week-prev')).toBeNull();
      expect(queryByTestId('hours-week-next')).toBeNull();
      expect(queryByTestId('hours-week-label')).toBeNull();
    });

    it('never renders the carer name', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earningsRole="parent"
        />
      );

      expect(queryByTestId('hours-carer-name')).toBeNull();
    });

    it('never renders the money line, even when priced earnings are supplied', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earningsRole="parent"
          earnings={okEarnings}
        />
      );

      expect(queryByTestId('hours-earnings-line')).toBeNull();
      expect(queryByTestId('hours-earnings-line-amount')).toBeNull();
      expect(queryByTestId('hours-earnings-line-pressable')).toBeNull();
    });

    it('never renders the money card', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="approved"
          earningsRole="nanny"
          earnings={okEarnings}
        />
      );

      expect(queryByTestId('hours-money-card')).toBeNull();
    });
  });

  it('renders the timesheet status headline and the pay-boundary line', () => {
    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        timesheetStatus="queried"
        showPayBoundary
      />
    );

    expect(getByTestId('hours-status-headline')).toBeTruthy();
    expect(getByTestId('hours-pay-boundary')).toBeTruthy();
  });

  // The explainer stays a 13px muted MetadataLabel; its old `mt-3` is gone
  // because `CardContent`'s single `gap-3` now spaces every card row.
  it('keeps the payBoundary explainer a muted MetadataLabel', () => {
    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        timesheetStatus="submitted"
        showPayBoundary
      />
    );

    const node = getByTestId('hours-pay-boundary');
    expect(flatStyle(node).fontSize).toBe(13);
    expect(node.props.className).toContain('text-muted-foreground');
  });

  // Walkthrough fix 1: the reopen affordance was buried in the FlashList
  // footer, below the day rows and reimbursements card — invisible on
  // first load for an approved week. It now lives in the status card
  // itself, so a parent who doubts an approved total sees it immediately.
  describe('reopen affordance', () => {
    it('renders hours-reopen-button in the status card on an approved week when onReopenPress is supplied', () => {
      const onReopenPress = mock(() => {});
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
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
          timesheetStatus="submitted"
          onReopenPress={() => {}}
        />
      );

      expect(queryByTestId('hours-reopen-button')).toBeNull();
    });

    it('does not render the reopen control when no handler is supplied (helper/read-only view)', () => {
      const { queryByTestId } = render(
        <WeekTotal testID="hours-week-total" timesheetStatus="approved" />
      );

      expect(queryByTestId('hours-reopen-button')).toBeNull();
    });

    it('disables the reopen control while a reopen is already in flight', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="approved"
          onReopenPress={() => {}}
          isReopenPending
        />
      );

      expect(getByTestId('hours-reopen-button').props.disabled).toBe(true);
    });
  });

  // Cold-mount reopen reason — a timesheet-status fact, so it must survive
  // every earnings shape (no arrangement, zero hours, no earnings at all).
  // These cases failed when the note lived inside WeekEarningsLine's `ok` arm.
  describe('earningsReopenReason', () => {
    it('shows the reopened note from a wire reason on a non-approved week', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earnings={okEarnings}
          earningsReopenReason="Thursday hours were wrong"
        />
      );
      expect(getByTestId('hours-earnings-line-reopened-note')).toBeTruthy();
    });

    it('does not show a stale wire reason on an approved week', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="approved"
          earnings={okEarnings}
          earningsReopenReason="Thursday hours were wrong"
        />
      );
      expect(queryByTestId('hours-earnings-line-reopened-note')).toBeNull();
    });

    it('shows the wire reason on a no_arrangement week (earnings never reach ok)', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earnings={{
            status: 'no_arrangement',
            week_start: '2026-08-03',
            unpriced_dates: ['2026-08-03'],
          }}
          earningsRole="parent"
          earningsReopenReason="Thursday hours were wrong"
        />
      );
      expect(getByTestId('hours-earnings-line-reopened-note')).toBeTruthy();
    });

    it('shows the wire reason on a zero-hours week', () => {
      const { getByTestId, queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earnings={{
            ...okEarnings,
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

    it('shows the wire reason with no earnings at all', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earningsReopenReason="Thursday hours were wrong"
        />
      );
      expect(getByTestId('hours-earnings-line-reopened-note')).toBeTruthy();
    });
  });

  // Approved week is locked for carers — one caption at the week-card level
  // (not per entry row). Parents who can reopen themselves get the button
  // instead; the caption would be noise next to it.
  describe('approved lock note', () => {
    it('renders the lock caption on an approved week when no onReopenPress is supplied', () => {
      const { getByTestId } = render(
        <WeekTotal testID="hours-week-total" timesheetStatus="approved" />
      );

      expect(getByTestId('hours-approved-lock-note')).toBeTruthy();
    });

    it('does not render the lock caption when onReopenPress is supplied (parent case)', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
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
          timesheetStatus={timesheetStatus}
          showPayBoundary
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
      const styles = [node.props.style].flat(Number.POSITIVE_INFINITY);
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
        <WeekTotal testID="hours-week-total" timesheetStatus="approved" />
      );

      expect(toneBackground(getByTestId('hours-week-total'))).toBe(
        SURFACE_POSITIVE
      );
    });

    it('stays default with no tint when the week is still open', () => {
      const { getByTestId } = render(
        <WeekTotal testID="hours-week-total" timesheetStatus="open" />
      );

      expect(toneBackground(getByTestId('hours-week-total'))).toBeUndefined();
    });
  });

  // Daylight v2: "Ready for your approval" — the reason the parent opened
  // the screen — is an H3 headline in the title row, not a 12px pill and no
  // longer a 13px MetadataLabel. The IconChip is the third prominence
  // channel (ground, type, iconography) beside it. Both viewers share the
  // same headline slot now — the pill was the nanny's only, and it was the
  // smallest text on her money screen for a sentence with financial
  // consequences ("The family asked a question" == her money is on hold).
  describe('status headline replaces the StatusPill for both viewers', () => {
    it('renders an H3 headline instead of a StatusPill, for the parent viewer', () => {
      const { getByTestId, queryByTestId, getByText } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earningsRole="parent"
        />
      );

      const headline = getByTestId('hours-status-headline');
      expect(headline).toBeTruthy();
      // H3, asserted from what the element actually renders as — role and
      // heading level, plus the h3 token's 20/700 — not a snapshot.
      expect(headline.props.role).toBe('heading');
      expect(headline.props['aria-level']).toBe('3');
      expect(flatStyle(headline).fontSize).toBe(20);
      expect(flatStyle(headline).fontWeight).toBe('700');
      expect(getByText('statusSubmitted')).toBeTruthy();
      expect(queryByTestId('hours-timesheet-status')).toBeNull();
    });

    it('renders the status IconChip beside the headline', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earningsRole="parent"
        />
      );

      expect(getByTestId('hours-status-chip')).toBeTruthy();
    });

    it('renders an H3 headline instead of a StatusPill, for the nanny viewer too', () => {
      const { getByTestId, queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="queried"
          earningsRole="nanny"
        />
      );

      const headline = getByTestId('hours-status-headline');
      expect(headline).toBeTruthy();
      expect(headline.props.role).toBe('heading');
      expect(headline.props['aria-level']).toBe('3');
      expect(flatStyle(headline).fontSize).toBe(20);
      expect(flatStyle(headline).fontWeight).toBe('700');
      expect(getByTestId('hours-status-chip')).toBeTruthy();
      expect(queryByTestId('hours-timesheet-status')).toBeNull();
    });

    it('renders no title row at all — chip included — when there is no status', () => {
      const { queryByTestId } = render(
        <WeekTotal testID="hours-week-total" showPayBoundary />
      );

      expect(queryByTestId('hours-status-chip')).toBeNull();
      expect(queryByTestId('hours-status-headline')).toBeNull();
    });

    it('reads "Approved on {date}" once approved and a date is known', () => {
      const { getByText } = render(
        <WeekTotal
          testID="hours-week-total"
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
          timesheetStatus="approved"
          earningsRole="parent"
        />
      );

      expect(getByText('statusApproved')).toBeTruthy();
    });

    // §3: the promoted, parent-only `query_note` band is GONE. It was the
    // literal code that made P1 true (only the parent could read the
    // question), and `WeekQueryThread` now renders that same first message
    // to both sides. A second, parent-only rendering of it would be P1 back.
    it('never promotes a query note into the card — the thread owns that message now', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="queried"
          earningsRole="parent"
        />
      );

      expect(queryByTestId('hours-query-note')).toBeNull();
    });
  });

  // Daylight P0-5: the person whose pay it is could not see whether her week
  // was open, submitted, queried or approved. She now gets the same H3
  // headline slot the parent has (not the 12px StatusPill — the sentence
  // meaning "this nanny's money is on hold" earns headline weight, not a
  // capsule), labelled with her own carer-side wording.
  describe('nanny status headline — carer-side wording (P0-5)', () => {
    it.each([
      ['open', 'stillOpen'],
      ['queried', 'theFamilyAsked'],
      ['approved', 'approved'],
    ] as const)('labels the headline for nanny status %s', (status, _label) => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus={status}
          earningsRole="nanny"
        />
      );

      const headline = getByTestId('hours-status-headline');
      expect(headline).toBeTruthy();
      expect(flatStyle(headline).fontSize).toBe(20);
      expect(flatStyle(headline).fontWeight).toBe('700');
    });

    it('never renders the old StatusPill testID for the nanny viewer', () => {
      const { getByTestId, queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="queried"
          earningsRole="nanny"
        />
      );

      expect(getByTestId('hours-status-headline')).toBeTruthy();
      expect(queryByTestId('hours-timesheet-status')).toBeNull();
    });

    it('reads "Still open" for a nanny whose week has not been submitted yet', () => {
      const { getByText } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="open"
          earningsRole="nanny"
        />
      );

      expect(getByText('nannyStatusNotSubmitted')).toBeTruthy();
    });

    it('reads "The family asked a question" for a nanny whose week is queried', () => {
      const { getByText } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="queried"
          earningsRole="nanny"
        />
      );

      expect(getByText('nannyStatusQueried')).toBeTruthy();
    });

    const approvedEarnings = { ...okEarnings, gross_minor: 35208 };

    it('shows an appreciation line with the household and date, and the gross on its own Figure28 line, once approved', () => {
      const { getByTestId, getByText } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="approved"
          earningsRole="nanny"
          approvedDateLabel="6 August"
          householdName="the Smiths"
          earnings={approvedEarnings}
        />
      );

      expect(getByTestId('hours-approved-by-note')).toBeTruthy();
      // One sentence key for every case now — the gross is a separate
      // element, so `approvedByHouseholdWithGross` no longer exists.
      expect(getByText('approvedByHousehold')).toBeTruthy();
      const amount = getByTestId('hours-approved-by-amount');
      expect(amount.props.children).toBe('£352.08');
      expect(flatStyle(amount).fontSize).toBe(28);
      expect(flatStyle(amount).fontWeight).toBe('700');
      // Rule B (docs/design/01-LAWS.md): on the tinted `positive`
      // ground, the primary sentence is `foreground`, not muted — this
      // line IS the tier's message (the P0-5 appreciation moment), not a
      // supporting caption.
      expect(
        getByTestId('hours-approved-by-note').props.className
      ).not.toContain('text-muted-foreground');
    });

    it('omits the amount when the gross is unknown, rather than inventing a figure', () => {
      const { getByTestId, queryByTestId, getByText } = render(
        <WeekTotal
          testID="hours-week-total"
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

      expect(getByTestId('hours-approved-by-note')).toBeTruthy();
      expect(getByText('approvedByHousehold')).toBeTruthy();
      expect(queryByTestId('hours-approved-by-amount')).toBeNull();
    });

    it('omits the amount when there are no earnings at all', () => {
      const { getByTestId, queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="approved"
          earningsRole="nanny"
          approvedDateLabel="6 August"
          householdName="the Smiths"
        />
      );

      expect(getByTestId('hours-approved-by-note')).toBeTruthy();
      expect(queryByTestId('hours-approved-by-amount')).toBeNull();
    });

    it('does not render the appreciation line for a non-approved status', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earningsRole="nanny"
          approvedDateLabel="6 August"
          householdName="the Smiths"
        />
      );

      expect(queryByTestId('hours-approved-by-note')).toBeNull();
    });

    it('does not render the appreciation line for the parent viewer — it is the carer’s moment', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="approved"
          earningsRole="parent"
          approvedDateLabel="6 August"
          householdName="the Smiths"
          earnings={approvedEarnings}
        />
      );

      expect(queryByTestId('hours-approved-by-note')).toBeNull();
      expect(queryByTestId('hours-approved-by-amount')).toBeNull();
    });
  });

  describe('nanny status timeline', () => {
    it('renders hours-status-timeline and no status pill for a submitted week in the nanny view', () => {
      const { getByTestId, queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earningsRole="nanny"
        />
      );

      expect(getByTestId('hours-status-timeline')).toBeTruthy();
      expect(getByTestId('hours-timeline-logged')).toBeTruthy();
      expect(getByTestId('hours-timeline-opened')).toBeTruthy();
      expect(getByTestId('hours-timeline-waiting')).toBeTruthy();
      expect(queryByTestId('hours-timesheet-status')).toBeNull();
    });

    it('reads timeline.opened when parentViewedDateLabel is set and timeline.notOpened when it is null', () => {
      const opened = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earningsRole="nanny"
          parentViewedDateLabel="16 August"
          householdName="the Smiths"
        />
      );
      expect(opened.getByText('timeline.opened')).toBeTruthy();

      const notOpened = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earningsRole="nanny"
          parentViewedDateLabel={null}
          householdName="the Smiths"
        />
      );
      expect(notOpened.getByText('timeline.notOpened')).toBeTruthy();
    });

    it('keeps the existing headline for a queried week and the appreciation block for an approved week', () => {
      const queried = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="queried"
          earningsRole="nanny"
        />
      );
      expect(queried.getByTestId('hours-status-headline')).toBeTruthy();
      expect(queried.queryByTestId('hours-status-timeline')).toBeNull();

      const approved = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="approved"
          earningsRole="nanny"
          approvedDateLabel="6 August"
          householdName="the Smiths"
        />
      );
      expect(approved.getByTestId('hours-approved-by-note')).toBeTruthy();
      expect(approved.queryByTestId('hours-status-timeline')).toBeNull();
    });

    it('never renders the timeline for the parent viewer', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earningsRole="parent"
        />
      );

      expect(queryByTestId('hours-status-timeline')).toBeNull();
    });

    // P5 — a reopened-and-resubmitted week (status back to `submitted`,
    // `reopen_reason` non-null) must surface the reason IN the timeline
    // itself, not only in the separate `hours-earnings-line-reopened-note`
    // caption below the card.
    it('leads the timeline with the reopen reason on a resubmitted week', () => {
      const { getByTestId, getByText } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earningsRole="nanny"
          earningsReopenReason="Thursday hours were wrong"
        />
      );

      const timeline = getByTestId('hours-status-timeline');
      expect(getByTestId('hours-timeline-reopened')).toBeTruthy();
      expect(getByText('timeline.reopened')).toBeTruthy();
      // It is the lead step — first child of the timeline.
      const firstChild = timeline.children[0];
      const firstChildTestId =
        typeof firstChild === 'string' ? null : firstChild?.props.testID;
      expect(firstChildTestId).toBe('hours-timeline-reopened');
    });

    it('does not lead the timeline with a reopened step when there is no reason', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earningsRole="nanny"
        />
      );

      expect(queryByTestId('hours-timeline-reopened')).toBeNull();
    });
  });

  // P6(a) — `parent_viewed_at` also has to survive into an APPROVED week,
  // not just disappear along with the submitted-week timeline.
  describe('approved-week viewed note (P6a)', () => {
    const approvedEarnings = { ...okEarnings, gross_minor: 35208 };

    it('shows a viewed note alongside the appreciation line when the parent opened it', () => {
      const { getByTestId, getByText } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="approved"
          earningsRole="nanny"
          approvedDateLabel="6 August"
          householdName="the Smiths"
          parentViewedDateLabel="4 August"
          earnings={approvedEarnings}
        />
      );

      expect(getByTestId('hours-approved-viewed-note')).toBeTruthy();
      expect(getByText('timeline.opened')).toBeTruthy();
    });

    it('omits the viewed note when the week has never been opened', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="approved"
          earningsRole="nanny"
          approvedDateLabel="6 August"
          householdName="the Smiths"
          parentViewedDateLabel={null}
          earnings={approvedEarnings}
        />
      );

      expect(queryByTestId('hours-approved-viewed-note')).toBeNull();
    });

    it('never shows the viewed note for the parent viewer', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="approved"
          earningsRole="parent"
          approvedDateLabel="6 August"
          householdName="the Smiths"
          parentViewedDateLabel="4 August"
          earnings={approvedEarnings}
        />
      );

      expect(queryByTestId('hours-approved-viewed-note')).toBeNull();
    });
  });

  // P6(b) — the parent's own read receipt for their own view of the week.
  describe('parentViewedNote (P6b)', () => {
    it('renders the note for the parent viewer when supplied', () => {
      const { getByTestId, getByText } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earningsRole="parent"
          parentViewedNote="You viewed this on 4 August."
        />
      );

      expect(getByTestId('hours-parent-viewed-note')).toBeTruthy();
      expect(getByText('You viewed this on 4 August.')).toBeTruthy();
    });

    it('never renders the note for the nanny viewer', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earningsRole="nanny"
          parentViewedNote="You viewed this on 4 August."
        />
      );

      expect(queryByTestId('hours-parent-viewed-note')).toBeNull();
    });

    it('renders nothing when there is no note', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="submitted"
          earningsRole="parent"
        />
      );

      expect(queryByTestId('hours-parent-viewed-note')).toBeNull();
    });
  });

  // Daylight P0-3: Approve moves from the FlashList footer, several screens
  // below every day row, into the status card itself. WeekTotal stays
  // presentational — the caller owns the handlers.
  describe('primary/secondary action slots', () => {
    it('renders the primary action as a full-width default button', () => {
      const onPress = mock(() => {});
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
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
      expect(getByText('Query').props.className).toContain(
        'text-error-inline-text'
      );
    });

    it('renders an actionsNote above the actions when supplied', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          actionsNote="Approve unlocks once your carer has logged hours this week."
        />
      );

      expect(getByTestId('hours-approve-waiting')).toBeTruthy();
    });

    it('renders neither action when both are omitted', () => {
      const { queryByTestId } = render(
        <WeekTotal testID="hours-week-total" timesheetStatus="submitted" />
      );

      expect(queryByTestId('hours-approve-button')).toBeNull();
      expect(queryByTestId('hours-query-button')).toBeNull();
    });

    // D-19: the parent's exit from `queried` sits on the same action row as
    // Approve, as a third ghost slot — the same `WeekTotalAction` shape, not
    // a new mechanism.
    it('renders a tertiary ghost action beneath the secondary one', () => {
      const onPress = mock(() => {});
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="queried"
          earningsRole="parent"
          tertiaryAction={{
            testID: 'hours-withdraw-query-button',
            label: 'Withdraw the query',
            onPress,
          }}
        />
      );

      const button = getByTestId('hours-withdraw-query-button');
      expect(button.props.variant).toBe('ghost');
      button.props.onPress?.();
      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('renders no tertiary action when none is supplied', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="queried"
          earningsRole="parent"
        />
      );

      expect(queryByTestId('hours-withdraw-query-button')).toBeNull();
    });

    it('disables the tertiary action while its mutation is in flight', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          timesheetStatus="queried"
          earningsRole="parent"
          tertiaryAction={{
            testID: 'hours-withdraw-query-button',
            label: 'Withdraw the query',
            onPress: () => {},
            disabled: true,
          }}
        />
      );

      expect(getByTestId('hours-withdraw-query-button').props.disabled).toBe(
        true
      );
    });
  });
});

// D79. The card's half of the contract: the caller owns every string, and a
// null `amountLabel` omits the figure ENTIRELY rather than rendering an empty
// or zeroed one. This is the same discipline the appreciation block's gross
// line has, and it is what keeps a fabricated `£0.00` off a money screen
// (`docs/11-MONEY.md` §4).
describe('WeekTotal — the week changed after it was approved', () => {
  it('renders the headline, the figure and the detail when all three are given', () => {
    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        timesheetStatus="approved"
        earningsRole="parent"
        weekChanged={{
          headline: 'Amara logged more hours after this week was paid.',
          amountLabel: '£70.00',
          detail: '8h 00m on 12 August, not covered by the approved total.',
        }}
      />
    );

    expect(getByTestId('hours-week-changed')).toBeTruthy();
    expect(getByTestId('hours-week-changed-headline').props.children).toBe(
      'Amara logged more hours after this week was paid.'
    );
    expect(getByTestId('hours-week-changed-amount').props.children).toBe(
      '£70.00'
    );
    expect(getByTestId('hours-week-changed-detail').props.children).toBe(
      '8h 00m on 12 August, not covered by the approved total.'
    );
  });

  it('omits the figure entirely when the caller could not derive one', () => {
    const { getByTestId, queryByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        timesheetStatus="approved"
        earningsRole="parent"
        weekChanged={{
          headline: 'Amara logged more hours after this week was paid.',
          amountLabel: null,
          detail: "We can't work out what they come to for this week.",
        }}
      />
    );

    expect(getByTestId('hours-week-changed')).toBeTruthy();
    expect(queryByTestId('hours-week-changed-amount')).toBeNull();
  });

  it('renders nothing at all when the prop is absent', () => {
    const { queryByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        timesheetStatus="approved"
        earningsRole="parent"
      />
    );

    expect(queryByTestId('hours-week-changed')).toBeNull();
  });

  // The disappear-guard: `weekChanged` alone must keep the card on screen,
  // exactly as the string prop it replaced did. Without it, a week whose only
  // thing to say is "this changed" renders no card and says nothing.
  it('keeps the card on screen when it is the only thing to say', () => {
    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        weekChanged={{
          headline: 'This week changed.',
          amountLabel: null,
          detail: null,
        }}
      />
    );

    expect(getByTestId('hours-week-total')).toBeTruthy();
    expect(getByTestId('hours-week-changed')).toBeTruthy();
  });
});

// Rule M (docs/design/01-LAWS.md §4): on tinted Card grounds use
// `text-muted-strong`; on plain `default` keep `text-muted-foreground`.
// `smallToneClass` already computes the fork — these nodes must consume it.
describe('WeekTotal — Rule M smallToneClass on tinted vs default grounds', () => {
  it('uses muted-strong on the reopened note when the card is tinted (parent submitted → attention)', () => {
    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        timesheetStatus="submitted"
        earningsRole="parent"
        earningsReopenReason="Thursday hours were wrong"
      />
    );

    const note = getByTestId('hours-earnings-line-reopened-note');
    expect(note.props.className).toContain('text-muted-strong');
    expect(note.props.className).not.toContain('text-muted-foreground');
  });

  it('keeps muted-foreground on the reopened note on a plain default card (nanny submitted)', () => {
    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        timesheetStatus="submitted"
        earningsRole="nanny"
        earningsReopenReason="Thursday hours were wrong"
      />
    );

    const note = getByTestId('hours-earnings-line-reopened-note');
    expect(note.props.className).toContain('text-muted-foreground');
    expect(note.props.className).not.toContain('text-muted-strong');
  });

  it('uses muted-strong on the reopened note when queried (attention)', () => {
    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        timesheetStatus="queried"
        earningsRole="nanny"
        earningsReopenReason="Thursday hours were wrong"
      />
    );

    const note = getByTestId('hours-earnings-line-reopened-note');
    expect(note.props.className).toContain('text-muted-strong');
    expect(note.props.className).not.toContain('text-muted-foreground');
  });

  it('threads smallToneClass into TimelineStep labels (no hardcoded muted-foreground)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../components/WeekTotal.tsx'),
      'utf8'
    );
    const flat = src.replace(/\s+/g, ' ');

    // Parent passes the one computed class; helpers must not recompute.
    expect(flat).toContain('toneClass={smallToneClass}');
    expect(flat).toContain('className={toneClass}');
    // TimelineStep must not keep a literal muted-foreground of its own.
    const timelineStepIdx = flat.indexOf('function TimelineStep(');
    expect(timelineStepIdx).toBeGreaterThan(-1);
    const timelineStepSlice = flat.slice(
      timelineStepIdx,
      timelineStepIdx + 500
    );
    expect(timelineStepSlice).not.toContain('text-muted-foreground');
    expect(timelineStepSlice).toContain('className={toneClass}');
  });

  it('binds the reopened note to smallToneClass, not a muted-foreground literal', () => {
    const src = readFileSync(
      join(import.meta.dir, '../components/WeekTotal.tsx'),
      'utf8'
    );
    const flat = src.replace(/\s+/g, ' ');
    // Prefer the JSX site over the Maestro comment that also names the testID.
    const noteIdx = flat.indexOf(
      'testID="hours-earnings-line-reopened-note" className='
    );
    expect(noteIdx).toBeGreaterThan(-1);
    const noteWindow = flat.slice(noteIdx, noteIdx + 80);
    expect(noteWindow).toContain('className={smallToneClass}');
    expect(noteWindow).not.toContain('className="text-muted-foreground"');
  });
});
