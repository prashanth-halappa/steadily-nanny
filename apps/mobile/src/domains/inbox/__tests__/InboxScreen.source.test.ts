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
const routePath = join(__dirname, '../../../app/(private)/inbox.tsx');

let screenSource: string;
let hookSource: string;
let buildSource: string;
let routeSource: string;

beforeAll(async () => {
  screenSource = await Bun.file(screenPath).text();
  hookSource = await Bun.file(hookPath).text();
  buildSource = await Bun.file(buildPath).text();
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

  it('formats approval deadlines at minute granularity', () => {
    expect(screenSource).toContain('formatApprovalDeadline');
    expect(screenSource).not.toMatch(/timeoutAt\.slice\(0,\s*10\)/);
  });

  it('deep-links each pending-work kind to an existing screen', () => {
    expect(screenSource).toContain('schedule/shifts/');
    expect(screenSource).toContain('schedule/respond/');
    expect(screenSource).toContain('(tabs)/hours');
    expect(screenSource).toContain('weekStart=');
  });

  it('never mounts a bare RN Modal (GOLDEN-FIX #1)', () => {
    expect(screenSource).not.toMatch(/<Modal\b/);
  });

  it('uses useElevation for row shadows, not Tailwind shadow-*', () => {
    expect(screenSource).toContain('useElevation');
    expect(screenSource).not.toMatch(/className="[^"]*shadow-/);
  });
});

describe('useInboxItems source', () => {
  it('composes the four pending-work sources across all households', () => {
    expect(hookSource).toContain('schedulePatternApi');
    expect(hookSource).toContain('useMePendingChangeRequests');
    expect(hookSource).toContain('timesheetApi');
    expect(hookSource).toContain('listPendingApprovals');
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

  it('enables the parent-only approvals query only for parent editors', () => {
    expect(hookSource).toContain('isParentEditorRole');
    expect(hookSource).toContain('useIsOnboarded');
    // Approvals enabled clause must AND the parent gate — nannies must not
    // fire GET /approvals (403) on every inbox open.
    expect(hookSource).toMatch(/parentEditor/);
    expect(hookSource).toMatch(
      /enabled:\s*[^\n]*parentEditor|enabled:[^\n]*\n[^\n]*parentEditor/
    );
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
  it('gates queried weeks by carer identity and approvals by parent role', () => {
    expect(buildSource).toContain('role');
    expect(buildSource).toContain('carer_id');
    expect(buildSource).toContain('isParentEditorRole');
  });
});

describe('inbox route', () => {
  it('is a thin delegate to InboxScreen', () => {
    expect(routeSource).toContain('InboxScreen');
    expect(routeSource).toContain('export default');
  });
});
