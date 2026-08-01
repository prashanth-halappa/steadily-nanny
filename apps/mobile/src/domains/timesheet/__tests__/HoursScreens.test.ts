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
  it('wires the hours-screen testID', () => {
    expect(hoursScreenSource).toContain('hours-screen');
  });

  it('derives role + household from useIsOnboarded, not a local flag', () => {
    expect(hoursScreenSource).toContain('useIsOnboarded');
    expect(hoursScreenSource).not.toMatch(/useSetupProgress|localRole/);
  });

  it('forks nanny vs parent views by SETUP_ROLES.PARENT', () => {
    expect(hoursScreenSource).toContain('SETUP_ROLES.PARENT');
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
  it('wires the approve and query testIDs', () => {
    expect(parentWeekViewSource).toContain('hours-approve-button');
    expect(parentWeekViewSource).toContain('hours-query-button');
  });

  it('approval is a single tap — no confirmation dialog wrapping it', () => {
    expect(parentWeekViewSource).not.toMatch(/AlertDialog/);
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
