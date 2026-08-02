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

  it('REGRESSION: the send handler goes through sendScheduleWeek, never a manual create-then-mutate chain with hook-bound ids', () => {
    // The bug: `useReplaceSchedulePatternDays(patternId)` /
    // `useSendSchedulePattern(patternId)` captured `patternId` at render
    // time, so a pattern created earlier in the SAME handler pass was still
    // `undefined` by the time those hooks' mutationFns ran (setPatternId is
    // an async state update, it doesn't rebind a hook parameter mid-call).
    // Both hooks now take no id parameter at all — the id travels as part
    // of the mutate() argument instead, resolved once by sendScheduleWeek.
    expect(source).toContain('sendScheduleWeek');
    expect(source).toContain('useReplaceSchedulePatternDays()');
    expect(source).toContain('useSendSchedulePattern()');
    expect(source).not.toMatch(/useReplaceSchedulePatternDays\(patternId\)/);
    expect(source).not.toMatch(/useSendSchedulePattern\(patternId\)/);
  });

  it('REGRESSION: onSend catches a sendScheduleWeek rejection instead of re-throwing past a bare finally', () => {
    // The bug: `try { await sendScheduleWeek(...) } finally { setIsSending(false) }`
    // has NO `catch` — `finally` runs but does not swallow the exception, so
    // a failure still propagates out of `onSend`, and `onCta={() => void
    // onSend()}` discards that rejection with no handler — an unhandled
    // promise rejection, the same defect class as D7's clock-in bug. Each
    // underlying mutation already shows its own toast via `onError`, so the
    // fix is simply to stop the rejection from escaping, not to add new UI.
    const onSendMatch = source.match(
      /const onSend = async \(\) => \{[\s\S]*?\n {2}\};/
    );
    expect(onSendMatch).not.toBeNull();
    const onSendBody = onSendMatch?.[0] ?? '';
    expect(onSendBody).toMatch(/\}\s*catch\s*\{/);
  });

  it('REGRESSION: the carer-name fallback is a translated placeholder, never an un-namespaced UI title string', () => {
    // The bug: `t('carerPickerTitle')` (missing the `build.` namespace
    // prefix) resolved to nothing and rendered the raw key as the carer's
    // NAME — "carerPickerTitle will be able to accept or decline this week."
    expect(source).not.toContain("t('carerPickerTitle')");
    expect(source).toContain("t('build.carerFallbackName')");
  });

  it("D25: fetches the selected carer's availability and warns — never blocks — on a day/time outside it", () => {
    // Fetched via the real hook (real endpoint, real Zod-validated response
    // — see useAvailabilityForCarer.test.ts and availability.test.ts's
    // getForUser cases for that layer's own render/call-level coverage).
    // The clash check itself is the SAME already-unit-tested pure function
    // ScheduleRespondScreen uses (utils.test.ts's `isOutsideAvailability`
    // describe block), reused here rather than re-derived.
    expect(source).toContain('useAvailabilityForCarer(selectedCarerId)');
    expect(source).toContain('isOutsideAvailability(');
    expect(source).toContain("from '../utils'");
    expect(source).toContain('variant="outside-hours"');
    expect(source).toContain("t('build.outsideHoursWarning')");
    // Never blocks: TimeRangePicker is unconditional, not gated behind
    // `!outsideAvailability` or any disabled/hidden prop tied to it.
    expect(source).not.toMatch(
      /outsideAvailability[\s\S]{0,80}<TimeRangePicker/
    );
    expect(source).not.toMatch(/TimeRangePicker[\s\S]{0,40}disabled/);
  });

  it('D25: does not treat a still-loading availability fetch as "outside availability" (no false-positive warning flash)', () => {
    // isOutsideAvailability itself treats "no row for this weekday" as
    // outside — correct once data has actually loaded, wrong while it's
    // still in flight (undefined). The screen must gate on that explicitly.
    expect(source).toMatch(
      /carerAvailability\.data !== undefined[\s\S]{0,40}isOutsideAvailability/
    );
  });

  it('REGRESSION: a failed draft fetch reaches a real error step, never a permanent spinner', () => {
    // The bug: `hasHydratedDraft` starts false whenever `?patternId=` is
    // set and only flips inside the hydrate effect's SUCCESS path, while
    // the step-advance effect refuses to leave 'loading' until it flips —
    // so `useSchedulePattern` erroring left `step === 'loading'` forever
    // and the parent stared at a spinner with no retry and no way out.
    expect(source).toContain("'draft-error'");
    expect(source).toContain('existingPattern.isError');
    expect(source).toContain('testID="schedule-build-draft-error"');
    // Both recoveries: refetch, and abandon-hydration-and-build-by-hand.
    expect(source).toContain('existingPattern.refetch()');
    expect(source).toContain('startFreshFromDraftError');
    expect(source).toContain("t('build.draftErrorTitle')");
    expect(source).toContain("t('build.draftErrorRetry')");
    expect(source).toContain("t('build.draftErrorStartFresh')");
  });

  it("REGRESSION: the error check runs BEFORE the effect's `!existingPattern.data` bail, or it could never fire", () => {
    const effect = source.match(
      /useEffect\(\(\) => \{\s*if \(hasHydratedDraft\)[\s\S]*?\n {2}\}, \[[\s\S]*?\]\);/
    );
    expect(effect).not.toBeNull();
    const effectBody = effect?.[0] ?? '';
    expect(effectBody.indexOf('existingPattern.isError')).toBeLessThan(
      effectBody.indexOf('!existingPattern.data')
    );
    // A retry that fails AGAIN must not re-strand the wizard: the retry
    // handler leaves `step` on 'draft-error' and it is the hydrate SUCCESS
    // path that hands control back to 'loading'.
    expect(effectBody).toContain("setStep('loading')");
  });

  it('D11 REGRESSION: onPatternCreated persists a freshly-created id into React state immediately, so a retry after partial failure resumes instead of orphaning a second draft', () => {
    // The bug: if `createPattern` succeeded but `replaceDays`/`sendPattern`
    // then failed, the created id never reached this component's
    // `patternId` state (only `setPatternId(resolvedPatternId)` AFTER full
    // success did that) — so retrying called `createPattern` again and left
    // a second, orphaned draft pattern behind every attempt.
    const onSendMatch = source.match(
      /const onSend = async \(\) => \{[\s\S]*?\n {2}\};/
    );
    const onSendBody = onSendMatch?.[0] ?? '';
    expect(onSendBody).toContain('onPatternCreated');
    // Must call the SAME setPatternId used for the full-success path — a
    // second, different state setter would risk the two falling out of
    // sync. Isolate the `sendScheduleWeek({...})` call block and assert
    // `onPatternCreated` wires directly to `setPatternId`, not to some
    // intermediate/ref-based tracker that could itself go stale.
    expect(onSendBody).toMatch(/onPatternCreated:\s*setPatternId/);
  });
});
