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
    expect(source).toContain('disabled={!canSubmit}');
    expect(source).not.toMatch(/catch\s*\{\s*return;\s*\}/);
  });

  it('warns before create when the carer has a conflicting busy block', () => {
    expect(source).toContain('availabilityApi.getBusyBlocks');
    expect(source).toContain('findConflictingBusyBlocks');
    expect(source).toContain('schedule-extra-clash-confirm');
    expect(source).toContain("t('shifts.extraClashTitle'");
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
});
