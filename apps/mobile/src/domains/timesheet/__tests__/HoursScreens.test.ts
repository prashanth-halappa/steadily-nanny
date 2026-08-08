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
let weekTotalSource: string;

beforeAll(async () => {
  hoursScreenSource = await readSource('HoursScreen.tsx');
  nannyWeekViewSource = await readSource('NannyWeekView.tsx');
  parentWeekViewSource = await readSource('ParentWeekView.tsx');
  queryNoteSheetSource = await readSource('QueryNoteSheet.tsx');
  weekTotalSource = await readSource('WeekTotal.tsx');
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

  it('reads weekStart from useLocalSearchParams and derives weekOffset (Gap 3)', () => {
    expect(hoursScreenSource).toContain('useLocalSearchParams');
    expect(hoursScreenSource).toContain('weekStartFromRoute');
    expect(hoursScreenSource).toContain('weeksBetween');
    // Typed search params on Hours are weekStart-only — schedule deep-link
    // fields must not be declared here (they belong on schedule routes).
    expect(hoursScreenSource).toMatch(/useLocalSearchParams<\{\s*weekStart\?:/);
  });

  it('consumes weekStart as a one-shot (Wave 2B) — apply, clear param, reset on blur', () => {
    expect(hoursScreenSource).toContain('router.setParams');
    expect(hoursScreenSource).toMatch(
      /setParams\(\{\s*weekStart:\s*undefined\s*\}\)/
    );
    expect(hoursScreenSource).toContain('useFocusEffect');
    // Must not wipe the consumed offset when the param disappears — that
    // would snap back to the current week on the same visit.
    expect(hoursScreenSource).not.toMatch(
      /prevRouteWeekStart[\s\S]*setUserWeekOffset\(null\)/
    );
  });

  it('forks nanny vs parent views by isParentEditorRole (covers co-parents)', () => {
    expect(hoursScreenSource).toContain('isParentEditorRole');
    expect(hoursScreenSource).toContain('ParentWeekView');
    expect(hoursScreenSource).toContain('NannyWeekView');
  });

  // REGRESSION (BUG1, same fix as Settings/Today/Schedule): the floating
  // tab bar overlays this screen's content instead of reserving its own
  // layout space, so a fixed paddingBottom is not safe-area-aware and can
  // strand the last row in a tap-through dead zone under the bar.
  it('REGRESSION: sizes the empty-role ScrollView bottom padding off the tab bar height', () => {
    expect(hoursScreenSource).toContain('useTabBarScrollPadding');
    expect(hoursScreenSource).toContain('paddingBottom: tabBarScrollPadding');
  });
});

describe('NannyWeekView', () => {
  it('wires the total testID via WeekTotal', () => {
    expect(nannyWeekViewSource).toContain('hours-week-total');
  });

  it('computes overtime with formatOvertimeDelta rather than hand-rolled math', () => {
    expect(nannyWeekViewSource).toContain('formatOvertimeDelta');
  });

  it('REGRESSION: sizes the FlashList bottom padding off the tab bar height (BUG1)', () => {
    expect(nannyWeekViewSource).toContain('useTabBarScrollPadding');
    expect(nannyWeekViewSource).toContain('paddingBottom: tabBarScrollPadding');
  });
});

describe('ParentWeekView', () => {
  // Daylight P0-3: the honest "why is Approve disabled" copy now renders
  // inside `WeekTotal` (`actionsNote`, testID `hours-approve-waiting`) —
  // ParentWeekView still DECIDES the copy (the `waitingForHours`/
  // `waitingAfterQuery` keys live in its `actionsNote` computation) and
  // hands it down; WeekTotal stays presentational.
  it('explains why Approve is disabled with honest clock-out submit copy (no fake submit button)', () => {
    expect(parentWeekViewSource).toContain('waitingForHours');
    expect(parentWeekViewSource).toContain('waitingAfterQuery');
    expect(parentWeekViewSource).not.toContain('waitingForSubmit');
    expect(weekTotalSource).toContain('hours-approve-waiting');
  });

  // SUPERSEDED by TIER0-CX-SPEC.md §4.3: approving now freezes a gross
  // figure alongside the hours, so the tap opens `ApproveWeekDialog` (an
  // `AlertDialog`, GOLDEN-FIXES #1) instead of calling the mutation
  // directly. The button press only opens the dialog; the mutation call
  // itself still lives in `handleApprove` (asserted below), reached from the
  // dialog's confirm action.
  //
  // Daylight P0-3: the button itself now renders inside `WeekTotal`
  // (`primaryAction`) — the handler that opens the dialog is still owned
  // and passed down by ParentWeekView, as a plain object property rather
  // than a JSX prop.
  it('approve is behind a confirmation dialog (ApproveWeekDialog), not a direct tap', () => {
    expect(parentWeekViewSource).toContain('ApproveWeekDialog');
    expect(parentWeekViewSource).toContain('isApproveDialogOpen');
    expect(parentWeekViewSource).toMatch(
      /onPress:\s*\(\) => setIsApproveDialogOpen\(true\)/
    );
  });

  it('shows ErrorState when the week queries fail — never a silent zero-hour week', () => {
    expect(parentWeekViewSource).toContain('ErrorState');
    expect(parentWeekViewSource).toContain('entriesQuery.isError');
  });

  it('prefers entry-derived carer names and never mislabels a multi-carer week', () => {
    expect(parentWeekViewSource).toContain('resolveWeekCarerHeaderName');
    expect(parentWeekViewSource).toContain('useHouseholdMembers');
    expect(parentWeekViewSource).toContain('resolveMemberDisplayName');
    expect(parentWeekViewSource).toContain('carer_display_name');
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

  it('REGRESSION: sizes the FlashList bottom padding off the tab bar height (BUG1)', () => {
    expect(parentWeekViewSource).toContain('useTabBarScrollPadding');
    expect(parentWeekViewSource).toContain(
      'paddingBottom: tabBarScrollPadding'
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
