/**
 * @module domains/inbox/__tests__/InboxScreen.source.test
 *
 * Pattern A — architectural markers for the inbox screen and composition hook.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const screenPath = join(__dirname, '../components/InboxScreen.tsx');
const hookPath = join(__dirname, '../hooks/useInboxItems.ts');
const buildPath = join(__dirname, '../utils/buildInboxItems.ts');
const copyPath = join(__dirname, '../utils/inboxItemCopy.ts');
const rowPath = join(__dirname, '../components/InboxRow.tsx');
const routePath = join(__dirname, '../../../app/(private)/(tabs)/inbox.tsx');

let screenSource: string;
let hookSource: string;
let buildSource: string;
let copySource: string;
let rowSource: string;
let routeSource: string;

beforeAll(async () => {
  screenSource = await Bun.file(screenPath).text();
  hookSource = await Bun.file(hookPath).text();
  buildSource = await Bun.file(buildPath).text();
  copySource = await Bun.file(copyPath).text();
  rowSource = await Bun.file(rowPath).text();
  routeSource = await Bun.file(routePath).text();
});

describe('InboxScreen source', () => {
  // WP-C: a tab root has nothing behind it to go back to — the back button
  // came out and the settings icon went in, and the scroll has to clear the
  // floating tab bar the way every other tab root does.
  it('is a tab root: settings icon, no back button, tab-bar scroll padding', () => {
    expect(screenSource).toContain('SettingsHeaderButton');
    expect(screenSource).not.toContain('inbox-back');
    expect(screenSource).not.toContain('BackButton');
    expect(screenSource).toContain('useTabBarScrollPadding');
  });

  it('exports the screen and wires root + empty testIDs', () => {
    expect(screenSource).toContain('export function InboxScreen');
    expect(screenSource).toContain('inbox-screen');
    expect(screenSource).toContain('inbox-empty');
    expect(screenSource).toContain('useInboxItems');
  });

  it('surfaces ErrorState + retry instead of empty-success on failure', () => {
    expect(screenSource).toContain('ErrorState');
    expect(screenSource).toContain('isError');
    expect(screenSource).toContain('refetch');
  });

  it('shares title/subtitle/href copy with NeedsAttentionCard via inboxItemCopy', () => {
    // The row owns per-item copy and the screen owns the destination, so the
    // guarantee spans both files — what matters is that neither hand-rolls
    // copy that `NeedsAttentionCard` reads from the same shared module.
    const surface = screenSource + rowSource;
    expect(surface).toContain('inboxItemCopy');
    expect(surface).toContain('titleForItem');
    expect(surface).toContain('subtitleForItem');
    expect(screenSource).toContain('hrefForItem');
    // The functions themselves must live in the shared module, not here.
    expect(surface).not.toContain('function titleForItem');
    expect(surface).not.toContain('function subtitleForItem');
    expect(screenSource).not.toContain('function hrefForItem');
  });

  it('never mounts a bare RN Modal (GOLDEN-FIX #1)', () => {
    expect(screenSource).not.toMatch(/<Modal\b/);
  });

  it('uses useElevation for row shadows, not Tailwind shadow-*', () => {
    expect(screenSource).toContain('useElevation');
    expect(screenSource).not.toMatch(/className="[^"]*shadow-/);
  });

  it('renders a submitted-week row deep-linking to Hours, parent/owner-only via buildInboxItems', () => {
    expect(copySource).toContain('submitted_week');
    expect(buildSource).toContain('submitted_week');
  });
});

describe('useInboxItems source', () => {
  it('composes the four pending-work sources across all households', () => {
    expect(hookSource).toContain('schedulePatternApi');
    expect(hookSource).toContain('useMePendingChangeRequests');
    expect(hookSource).toContain('timesheetApi');
    expect(hookSource).toContain('buildInboxItems');
    expect(hookSource).toContain('active.households');
    // Single fan-in — never N changeRequestApi.listForShift / useQueries per shift.
    expect(hookSource).not.toContain('changeRequestApi');
    // §2.2/§2.3a — `useMeShifts` IS the fan-in for pending_shift, called ONCE
    // (not once per household, which `households.map` over a shifts fetch
    // would be — the exact anti-pattern this file guards against elsewhere).
    expect(hookSource).toContain('useMeShifts');
    expect(hookSource).not.toMatch(/households\.map\([^)]*[Ss]hift/);
  });

  it('exposes an error channel with refetch — failures must not collapse to []', () => {
    expect(hookSource).toMatch(/isError/);
    expect(hookSource).toMatch(/refetch/);
    expect(hookSource).toMatch(/return \{[^}]*isError/s);
    // Households list failure must surface — empty-success collapse otherwise.
    expect(hookSource).toContain('active.isError');
  });

  it('uses isLoading only for the loading flag — never isFetching', () => {
    expect(hookSource).not.toMatch(/isFetching/);
    expect(hookSource).toContain('isLoading');
  });

  it('passes role into buildInboxItems', () => {
    expect(hookSource).toMatch(/buildInboxItems\(\{[\s\S]*role/);
  });
});

describe('buildInboxItems source', () => {
  it('gates queried weeks by carer identity and submitted weeks by parent role', () => {
    expect(buildSource).toContain('role');
    expect(buildSource).toContain('carer_id');
    expect(buildSource).toContain('isParentEditorRole');
  });

  it('gates submitted weeks by parent/owner role — carers must never see them', () => {
    expect(buildSource).toContain('submitted_week');
    expect(buildSource).toMatch(
      /isParentEditorRole\(input\.role\)\)\s*\{[\s\S]*submitted_week/
    );
  });
});

describe('inbox route', () => {
  it('is a thin delegate to InboxScreen, living in the tab group', () => {
    expect(routeSource).toContain('InboxScreen');
    expect(routeSource).toContain('export default');
  });
});

describe('inboxItemCopy source', () => {
  it('deep-links each pending-work kind to an existing screen', () => {
    // The shift-detail path is no longer spelled out here: WP-A2 routes both
    // shift kinds through `shiftDetailHref`, the SAME resolver the push
    // notification uses, so the inbox and the notification cannot drift to
    // two destinations for one fact.
    expect(copySource).toContain('shiftDetailHref');
    expect(copySource).toContain('schedule/respond/');
    expect(copySource).toContain('(tabs)/hours');
    expect(copySource).toContain('weekStart=');
  });

  // HYBRID contract (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §A): a TAB can
  // only ever show ONE household, so every href that lands on one carries
  // the id the tab has to switch to. Detail screens resolve it from the
  // entity instead and carry it only so the two surfaces agree.
  it('carries householdId on every href that lands on the Hours tab', () => {
    expect(copySource).toContain('householdId=');
  });

  it('exports titleForItem, subtitleForItem, hrefForItem and ctaForItem', () => {
    expect(copySource).toContain('export function titleForItem');
    expect(copySource).toContain('export function subtitleForItem');
    expect(copySource).toContain('export function hrefForItem');
    expect(copySource).toContain('export function ctaForItem');
  });

  it('keeps deadlineForItem as a no-op now that co-parent approvals are gone', () => {
    expect(copySource).toContain('export function deadlineForItem');
    expect(copySource).toContain('return null');
  });
});
