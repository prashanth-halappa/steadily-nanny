/**
 * @module domains/schedule/__tests__/ExtraShiftScreen.test
 * Pattern A — native DateTimePicker cannot render under bun:test.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const screenPath = join(__dirname, '../components/ExtraShiftScreen.tsx');
let source: string;

beforeAll(async () => {
  source = await Bun.file(screenPath).text();
});

describe('ExtraShiftScreen', () => {
  it('reads optional prefill params from the route', () => {
    expect(source).toContain('useLocalSearchParams');
    expect(source).toContain('params.date');
    expect(source).toContain('params.start');
    expect(source).toContain('params.carerId');
    expect(source).toContain('params.childId');
  });

  it('uses native pickers and disables submit until the form is valid', () => {
    expect(source).toContain('TimeRangePicker');
    expect(source).toContain('DateTimeField');
    expect(source).toContain('isExtraShiftFormValid');
    // `canSubmit` now folds in `canWriteHousehold.canWrite`, and the button
    // also refuses while that read is still resolving — unknown must not
    // render an enabled write on a household that may have closed.
    expect(source).toContain('!canSubmit');
    expect(source).toContain('canWriteHousehold.canWrite');
    expect(source).not.toMatch(/catch\s*\{\s*return;\s*\}/);
  });

  it('warns before create when the carer has a conflicting busy block', () => {
    expect(source).toContain('availabilityApi.getBusyBlocks');
    // D73/D74: the busy-block filter moved behind `collectExtraShiftWarnings`,
    // which now runs all three pre-submit checks (past start, another carer's
    // overlapping shift, cross-household busy) through one helper.
    expect(source).toContain('collectExtraShiftWarnings');
    expect(source).toContain('schedule-extra-clash-confirm');
    expect(source).toContain("t('shifts.extraClashTitle'");
  });

  it('confirms a past start and another carer overlap, but refuses the same carer twice', () => {
    // Same carer against herself is a 409 the DB raises (shifts_carer_window_excl),
    // so it must NOT be offered as "Create anyway" — it gets a readable message.
    expect(source).toContain('shiftApi.range');
    expect(source).toContain("t('shifts.extraPastTitle')");
    expect(source).toContain("t('shifts.extraHouseholdOverlapTitle'");
    expect(source).toContain("t('shifts.extraSameCarerConflict'");
    expect(source).toContain('sameCarerConflict');
  });

  it('lets the parent pick carer and children', () => {
    expect(source).toContain('useHouseholdCarers');
    expect(source).toContain('useChildren');
    expect(source).toContain('carer_id: carerId');
    expect(source).toContain('child_ids');
  });

  it('REGRESSION: guards the form behind a client-side role check, not just the parent-gated button that reaches it', () => {
    // The bug: this screen relied entirely on the caller (a parent-gated
    // button) to keep a nanny out — the server rejects the request, but
    // the client happily rendered the whole form and only failed on
    // submit. Mirrors the guard SchedulePendingScreen/ScheduleBuildScreen
    // use, with an honest not-available state instead of a bare null.
    expect(source).toContain('isParentEditorRole');
    expect(source).toContain('useIsOnboarded');
    expect(source).toContain('testID="schedule-extra-shift-not-available"');
    expect(source).toContain(
      'testID="schedule-extra-shift-not-available-back"'
    );
    expect(source).toContain("t('shifts.extraNotAvailableTitle')");
    expect(source).toContain("t('shifts.extraNotAvailableDescription')");
  });

  it('REGRESSION: submit is gated by useRestrictedAction for owner_only co-parents, not only closedReason', () => {
    // The bug: ExtraShiftScreen only passed closedReason into the submit
    // button. Under approval_mode=owner_only the server refuses a co-parent
    // via assertApprovalAllows(..., 'extra_shift'), but the client stayed
    // enabled until the 403. Mirror TodayCoverage: useRestrictedAction with
    // the seeded verb, reason wins over closedReason.
    expect(source).toContain('useRestrictedAction');
    expect(source).toContain("t('shifts.restrictedActionAddExtra')");
    expect(source).toContain(
      'reason={extraShiftRestriction.reason ?? closedReason}'
    );
  });
});
