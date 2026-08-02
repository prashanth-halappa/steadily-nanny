/**
 * @module app/(private)/(tabs)/__tests__/schedule.test
 *
 * Source-inspection guardrail (Pattern A, docs/09-TESTING.md §5) for the
 * schedule tab route. Everything about WHAT renders for each role/status
 * combination (loading / error / empty / nanny / parent / helper) is a
 * render test now — see `schedule.behavior.test.tsx`, which carries that
 * weight. The one thing left here is a negative assertion a render test
 * can't express: proving a local-state escape hatch was never reintroduced,
 * which requires reading the source rather than observing behavior.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const screenPath = join(__dirname, '../schedule.tsx');
let screenSource: string;

beforeAll(async () => {
  screenSource = await Bun.file(screenPath).text();
});

describe('ScheduleRoute', () => {
  it('derives role from useIsOnboarded, not local wizard/setup state', () => {
    expect(screenSource).not.toMatch(/useSetupProgress|localRole/);
  });
});
