/**
 * @module domains/timesheet/__tests__/HoursScreens.test
 *
 * Source-inspection tests (Pattern A, docs/09-TESTING.md §5) for the Hours
 * tab's screens — they pull in FlashList / BottomSheetBase's native-heavy
 * internals, so we assert architectural markers instead of full rendering.
 * Covers: required testIDs (Maestro needs these), role derivation via
 * useIsOnboarded (never a local flag), BottomSheetBase instead of a bare
 * RN Modal (GOLDEN-FIXES #1), and money staying explicitly out of scope.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentsDir = join(__dirname, '../components');

async function readSource(fileName: string): Promise<string> {
  return Bun.file(join(componentsDir, fileName)).text();
}

let hoursScreenSource: string;
let nannyWeekViewSource: string;
let parentWeekViewSource: string;
let queryNoteSheetSource: string;

beforeAll(async () => {
  hoursScreenSource = await readSource('HoursScreen.tsx');
  nannyWeekViewSource = await readSource('NannyWeekView.tsx');
  parentWeekViewSource = await readSource('ParentWeekView.tsx');
  queryNoteSheetSource = await readSource('QueryNoteSheet.tsx');
});

describe('HoursScreen', () => {
  it('renders an H1 title on the main path, not the settings week-starts hint', () => {
    expect(hoursScreenSource).toContain('hours-title');
    expect(hoursScreenSource).toContain("t('title')");
    expect(hoursScreenSource).not.toContain('hours-monday-week-note');
    expect(hoursScreenSource).not.toContain('weekStartsHint');
  });

  it('wires the hours-screen testID', () => {
    expect(hoursScreenSource).toContain('hours-screen');
  });

  it('derives role + household from useIsOnboarded, not a local flag', () => {
    expect(hoursScreenSource).toContain('useIsOnboarded');
    expect(hoursScreenSource).not.toMatch(/useSetupProgress|localRole/);
  });

  it('resolves the week boundary in the HOUSEHOLD timezone, not a bare `new Date()`', () => {
    expect(hoursScreenSource).toContain('household?.timezone');
    expect(hoursScreenSource).toMatch(
      /getWeekStartISO\(\s*new Date\(\),\s*timezone\s*\)/
    );
  });

  it('forks nanny vs parent views by isParentEditorRole (covers co-parents)', () => {
    expect(hoursScreenSource).toContain('isParentEditorRole');
    expect(hoursScreenSource).toContain('ParentWeekView');
    expect(hoursScreenSource).toContain('NannyWeekView');
  });
});

describe('NannyWeekView', () => {
  it('wires the total testID via WeekTotal', () => {
    expect(nannyWeekViewSource).toContain('hours-week-total');
  });

  it('computes overtime with formatOvertimeDelta rather than hand-rolled math', () => {
    expect(nannyWeekViewSource).toContain('formatOvertimeDelta');
  });
});

describe('ParentWeekView', () => {
  it('explains why Approve is disabled when the week is not actionable', () => {
    expect(parentWeekViewSource).toContain('hours-approve-waiting');
    expect(parentWeekViewSource).toContain('waitingForSubmit');
  });

  it('approval is a single tap — no confirmation dialog wrapping it', () => {
    expect(parentWeekViewSource).not.toMatch(/AlertDialog/);
  });

  it('REGRESSION: approve/query mutateAsync calls are try/caught, never a bare .then() with no rejection handler', () => {
    // The bug (same class as D7's clock-in double-tap defect):
    // `void mutation.mutateAsync(...).then(onFulfilled)` with no `.catch()`
    // and no surrounding try/catch leaves the promise's rejection path
    // completely unhandled — an "Uncaught (in promise)" in metro.log on any
    // failure, even though the mutation's own `onError` still shows a toast.
    // `void` only suppresses a lint warning, it does NOT attach a rejection
    // handler.
    expect(parentWeekViewSource).not.toMatch(
      /void (approveTimesheet|queryTimesheet)\.mutateAsync/
    );
    expect(parentWeekViewSource).toMatch(
      /try\s*\{\s*await approveTimesheet\.mutateAsync/
    );
    expect(parentWeekViewSource).toMatch(
      /try\s*\{\s*await queryTimesheet\.mutateAsync/
    );
  });
});

describe('QueryNoteSheet', () => {
  it('uses BottomSheetBase, never a bare RN Modal (GOLDEN-FIXES #1)', () => {
    expect(queryNoteSheetSource).toContain('BottomSheetBase');
    // The doc comment itself references `<Modal>` in backticks to explain the
    // rule — check for an actual RN Modal import, not the substring anywhere.
    expect(queryNoteSheetSource).not.toMatch(
      /import\s*\{[^}]*\bModal\b[^}]*\}\s*from\s*'react-native'/
    );
  });

  it('disables submit until a note is entered', () => {
    expect(queryNoteSheetSource).toMatch(/disabled=\{!note\.trim\(\)/);
  });
});
