/**
 * @module domains/schedule/__tests__/ScheduleRespondScreen.test
 *
 * Source-inspection tests (docs/09-TESTING.md §5 Pattern A) — NOT a render
 * test. ScheduleRespondScreen uses `AlertDialog`
 * (`@rn-primitives/alert-dialog`), which is not mocked in
 * `apps/mobile/bun.setup.ts`'s global preload — the exact precedent is
 * `apps/mobile/src/app/(private)/(tabs)/settings.tsx`, also tested via
 * source-inspection only (see `settings.test.tsx`). We assert architectural
 * markers instead of rendering.
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

  it('renders a StatusPill outside-hours warning plus non-blocking note copy', () => {
    expect(source).toContain('variant="outside-hours"');
    expect(source).toContain('outsideHoursWarning');
    expect(source).toContain('outsideHoursNote');
  });

  it('wires the total-hours summary testID', () => {
    expect(source).toContain('testID="schedule-respond-total-hours"');
  });

  it('wires the accept and decline testIDs', () => {
    expect(source).toContain('testID="schedule-respond-accept"');
    expect(source).toContain('testID="schedule-respond-decline"');
    expect(source).toContain('testID="schedule-respond-decline-confirm"');
  });

  it('confirms decline via AlertDialog, never a bare RN Modal (GOLDEN-FIX #1)', () => {
    expect(source).toContain('AlertDialog');
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
});
