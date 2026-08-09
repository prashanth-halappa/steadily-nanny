/**
 * @module domains/schedule/__tests__/ScheduleRespondScreen.test
 *
 * Source-inspection tests (docs/09-TESTING.md §5 Pattern A) — NOT a render
 * test. Decline confirm hosts a Textarea, so it must live in BottomSheetBase
 * (keyboard-aware), not AlertDialog — same structural contract as
 * ReopenWeekDialog / settings delete-account. Keyboard occlusion cannot be
 * simulated under bun:test, so we assert architectural markers instead.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentPath = join(
  __dirname,
  '../components/ScheduleRespondScreen.tsx'
);
let source: string;

beforeAll(async () => {
  source = await Bun.file(componentPath).text();
});

describe('ScheduleRespondScreen source', () => {
  it('reads the component source', () => {
    expect(source.length).toBeGreaterThan(0);
  });

  it('exports the component', () => {
    expect(source).toContain('export function ScheduleRespondScreen');
  });

  it('wires the pattern, respond-mutation and availability hooks', () => {
    expect(source).toContain('useSchedulePattern');
    expect(source).toContain('useRespondToSchedulePattern');
    expect(source).toContain('useAvailability');
  });

  it('delegates the outside-hours clash check to the pure util, never re-deriving it inline', () => {
    expect(source).toContain('isOutsideAvailability');
    expect(source).toContain("from '../utils'");
  });

  it('has a stable outer testID for the whole screen', () => {
    expect(source).toContain('testID="schedule-respond-screen"');
  });

  it('wires a per-day outside-hours warning testID off the weekday', () => {
    expect(source).toContain('schedule-respond-outside-hours-${');
  });

  it('renders a StatusPill outside-hours warning on its own row (no duplicate note)', () => {
    expect(source).toContain('variant="outside-hours"');
    expect(source).toContain('outsideHoursWarning');
    expect(source).not.toContain('outsideHoursNote');
  });

  it('orders days via getWeekdayOrder from the reader profile (matches parent preview)', () => {
    expect(source).toContain('getWeekdayOrder');
    expect(source).toContain('useUserProfile');
    expect(source).toContain('week_starts_on');
    expect(source).not.toContain('[1, 2, 3, 4, 5, 6, 0]');
  });

  it('pins total hours + Accept/Decline in a footer outside the day ScrollView', () => {
    expect(source).toContain('schedule-respond-footer');
    expect(source).toContain('schedule-respond-scroll');
    const footerIdx = source.indexOf('schedule-respond-footer');
    const scrollCloseApprox = source.lastIndexOf('</ScrollView>');
    expect(footerIdx).toBeGreaterThan(scrollCloseApprox);
    expect(source.indexOf('schedule-respond-total-hours')).toBeGreaterThan(
      footerIdx
    );
    expect(source.indexOf('schedule-respond-accept')).toBeGreaterThan(
      footerIdx
    );
  });

  it('wires the total-hours summary testID', () => {
    expect(source).toContain('testID="schedule-respond-total-hours"');
  });

  it('wires the accept and decline testIDs', () => {
    expect(source).toContain('testID="schedule-respond-accept"');
    expect(source).toContain('testID="schedule-respond-decline"');
    expect(source).toContain('testID="schedule-respond-decline-confirm"');
  });

  it('uses BottomSheetBase (keyboard-aware), never AlertDialog', () => {
    // Render tests cannot reproduce software-keyboard occlusion of the
    // confirm button. Assert the structural fix that ReopenWeekDialog /
    // QueryNoteSheet already use: BottomSheetBase owns KeyboardAvoidingView
    // + ScrollView. Doc comments may name AlertDialog as the rejected
    // precedent — ban the import, not the substring.
    expect(source).toContain('BottomSheetBase');
    expect(source).not.toMatch(/from\s+'@\/src\/components\/ui\/alert-dialog'/);
    expect(source).toContain('fitContent');
    expect(source).not.toMatch(/<Modal\b/);
  });

  it('never gates Accept on the outside-hours check — accepting must always remain possible', () => {
    // Isolate the Accept button's own JSX block (from its testID to the next
    // closing tag) and assert it carries no `disabled={...}` wired to the
    // outside-hours check. A blanket "no disabled attr anywhere in the file"
    // assertion would be too strong (e.g. disabling while the mutation is
    // pending is fine) — what must never happen is Accept being disabled
    // because a day is outside marked availability.
    const acceptBlockMatch = source.match(
      /testID="schedule-respond-accept"[\s\S]{0,300}?(?:<\/Button>|\/>)/
    );
    expect(acceptBlockMatch).not.toBeNull();
    const acceptBlock = acceptBlockMatch?.[0] ?? '';
    expect(acceptBlock).not.toMatch(/disabled={[^}]*outside/i);
    expect(acceptBlock).not.toMatch(/disabled={[^}]*Outside/);
  });

  it('REGRESSION: a double-tap cannot fire two responds — a synchronous ref guard gates both handlers', () => {
    // The bug: after a successful accept, the screen re-rendered with the
    // SAME enabled Accept button (respond.isPending flips back to false the
    // instant the mutation resolves, and nothing else changed), so a nanny
    // who taps twice in quick succession could fire two `respond` calls.
    // `respond.isPending` alone isn't a reliable enough guard against two
    // taps in the same event-loop tick — a ref, checked and set
    // SYNCHRONOUSLY before the first `await`, is.
    expect(source).toContain('useRef');
    expect(source).toContain('hasRespondedRef');
    const guardCount = (
      source.match(
        /if \(hasRespondedRef\.current \|\| respond\.isPending\) return;/g
      ) ?? []
    ).length;
    expect(guardCount).toBe(2);
  });

  it('REGRESSION: Accept and the decline-confirm action both disable once responded, and Accept navigates away on success', () => {
    expect(source).toContain('hasResponded');
    const acceptBlockMatch = source.match(
      /testID="schedule-respond-accept"[\s\S]{0,300}?(?:<\/Button>|\/>)/
    );
    expect(acceptBlockMatch?.[0]).toMatch(
      /disabled={respond\.isPending \|\| hasResponded}/
    );
    const declineConfirmBlockMatch = source.match(
      /testID="schedule-respond-decline-confirm"[\s\S]{0,500}?(?:<\/Button>|\/>)/
    );
    expect(declineConfirmBlockMatch?.[0]).toMatch(
      /disabled={respond\.isPending \|\| hasResponded}/
    );
    // On success, Accept leaves the screen entirely rather than sitting on
    // the same stale UI — the prior bug's screenshot was literally titled
    // "stuck-after-accept".
    expect(source).toMatch(/router\.replace\(/);
  });

  it('shows per-child windows on each day using the pattern payload', () => {
    expect(source).toContain('respond.childWindow');
    expect(source).toContain('start_time');
    expect(source).toContain('end_time');
    expect(source).toContain('schedule-respond-child-window-');
  });

  it('explains shorter days with household commitment labels when present', () => {
    expect(source).toContain('useHouseholdCommitments');
    expect(source).toContain('respond.structuralNote');
    expect(source).toContain('respond.structuralNoteLabelled');
    expect(source).toContain('schedule-respond-structural-note-');
    expect(source).toContain('calculateDayHours');
  });
});
