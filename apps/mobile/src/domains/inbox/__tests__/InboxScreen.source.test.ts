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
const routePath = join(__dirname, '../../../app/(private)/inbox.tsx');

let screenSource: string;
let hookSource: string;
let buildSource: string;
let copySource: string;
let routeSource: string;

beforeAll(async () => {
  screenSource = await Bun.file(screenPath).text();
  hookSource = await Bun.file(hookPath).text();
  buildSource = await Bun.file(buildPath).text();
  copySource = await Bun.file(copyPath).text();
  routeSource = await Bun.file(routePath).text();
});

describe('InboxScreen source', () => {
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
    expect(screenSource).toContain('inboxItemCopy');
    expect(screenSource).toContain('titleForItem');
    expect(screenSource).toContain('subtitleForItem');
    expect(screenSource).toContain('hrefForItem');
    // The functions themselves must live in the shared module, not here.
    expect(screenSource).not.toContain('function titleForItem');
    expect(screenSource).not.toContain('function subtitleForItem');
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
  it('composes the three pending-work sources across all households', () => {
    expect(hookSource).toContain('schedulePatternApi');
    expect(hookSource).toContain('useMePendingChangeRequests');
    expect(hookSource).toContain('timesheetApi');
    expect(hookSource).toContain('buildInboxItems');
    expect(hookSource).toContain('active.households');
    // Single fan-in — never N changeRequestApi.listForShift / useQueries per shift.
    expect(hookSource).not.toContain('changeRequestApi');
    expect(hookSource).not.toContain('useMeShifts');
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
  it('is a thin delegate to InboxScreen', () => {
    expect(routeSource).toContain('InboxScreen');
    expect(routeSource).toContain('export default');
  });
});

describe('inboxItemCopy source', () => {
  it('deep-links each pending-work kind to an existing screen', () => {
    expect(copySource).toContain('schedule/shifts/');
    expect(copySource).toContain('schedule/respond/');
    expect(copySource).toContain('(tabs)/hours');
    expect(copySource).toContain('weekStart=');
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
