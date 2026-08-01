/**
 * @module domains/schedule/__tests__/ScheduleBuildScreen.test
 *
 * Source-inspection tests (docs/09-TESTING.md §5 Pattern A) — NOT a render
 * test. ScheduleBuildScreen imports TimeRangePicker, which itself cannot be
 * parsed under bun:test (see time-range-picker.test.tsx's doc comment:
 * `@react-native-community/datetimepicker` ships unparseable Flow-typed
 * source, and the failure happens at module-graph parse time, before any
 * mock can intercept it — so even a component that only conditionally
 * renders TimeRangePicker deep in its tree cannot be imported at all under
 * bun:test). The real, render-free logic (weekday toggling, RRULE
 * construction, hours totals) is covered directly against `../utils` in
 * `utils.test.ts`; this file only pins that the screen wires that logic up
 * correctly rather than re-deriving it inline.
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentPath = join(__dirname, '../components/ScheduleBuildScreen.tsx');
let source: string;

describe('ScheduleBuildScreen source', () => {
  it('reads the component source', async () => {
    source = await Bun.file(componentPath).text();
    expect(source.length).toBeGreaterThan(0);
  });

  it('exports the component', () => {
    expect(source).toContain('export function ScheduleBuildScreen');
  });

  it('delegates weekday toggling and RRULE construction to the pure utils, never re-deriving them inline', () => {
    expect(source).toContain('toggleWeekday');
    expect(source).toContain('buildWeeklyRrule');
    expect(source).toContain("from '../utils'");
  });

  it('passes WeekStrip selected/onToggle straight through — no display-order remapping', () => {
    expect(source).toContain('testID="schedule-day-toggle"');
    expect(source).toMatch(/<WeekStrip[\s\S]{0,200}selected={selectedDays}/);
    expect(source).not.toContain('DISPLAY_ORDER[');
  });

  it('never converts a wall-clock time to a Date — times stay "HH:MM" strings end to end', () => {
    expect(source).not.toContain('parseTime(');
    expect(source).not.toContain('formatTime(');
    expect(source).not.toMatch(/new Date\([^)]*start/i);
  });

  it('never sends `timezone` in the create-pattern body (server copies it from the household)', () => {
    expect(source).not.toMatch(/timezone:\s*household/);
  });

  it('sends the full send chain: create -> replaceDays -> send', () => {
    expect(source).toContain('useCreateSchedulePattern');
    expect(source).toContain('useReplaceSchedulePatternDays');
    expect(source).toContain('useSendSchedulePattern');
    expect(source).toContain('createPattern.mutateAsync');
    expect(source).toContain('replaceDays.mutateAsync');
    expect(source).toContain('sendPattern.mutateAsync');
  });

  it('uses the review step as the one that actually sends, testID schedule-send', () => {
    expect(source).toContain('testID="schedule-send"');
  });

  it('has a stable outer testID for the whole screen, independent of wizard step', () => {
    expect(source).toContain('testID="schedule-build-screen"');
  });

  it('assigns each carer picker option a per-user testID', () => {
    expect(source).toContain('schedule-carer-option-');
  });

  it('assigns per-day time-range and child-chip testIDs', () => {
    expect(source).toContain('schedule-build-time-range-');
    expect(source).toContain('schedule-build-child-');
  });

  it('offers weekly and fortnightly repeat options with stable testIDs', () => {
    expect(source).toContain('testID="schedule-repeat-weekly"');
    expect(source).toContain('testID="schedule-repeat-fortnightly"');
  });
});
