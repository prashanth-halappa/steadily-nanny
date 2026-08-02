/**
 * @module domains/setup/__tests__/ManageAvailabilityScreen.test
 *
 * Post-onboarding entry point: a nanny reaches this from Settings to change
 * her weekday availability — before this screen shipped there was no route
 * to `AvailabilityScreen` after first-run setup at all.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentPath = join(
  __dirname,
  '../components/ManageAvailabilityScreen.tsx'
);
let source: string;

beforeAll(async () => {
  source = await Bun.file(componentPath).text();
});

describe('ManageAvailabilityScreen', () => {
  it('exports the component', () => {
    expect(source).toContain('export function ManageAvailabilityScreen');
  });

  it('wires a distinct testID from the wizard screen', () => {
    expect(source).toContain('manage-availability-screen');
  });

  it('reuses AvailabilityEditor rather than duplicating the weekday/time logic', () => {
    expect(source).toContain('AvailabilityEditor');
  });

  it('returns the parent to where they came from, never forward through the wizard', () => {
    expect(source).toContain('router.back()');
  });
});
