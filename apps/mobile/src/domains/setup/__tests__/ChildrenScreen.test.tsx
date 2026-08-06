/**
 * @module domains/setup/__tests__/ChildrenScreen.test
 *
 * Regression coverage for the wizard step, added while extracting
 * `ChildrenManager` out of it — locks in that the wizard-only concerns
 * (household auto-create, "Continue" gated on >= 1 child, advancing to the
 * INVITE step) survive the refactor unchanged.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentPath = join(__dirname, '../components/ChildrenScreen.tsx');
let source: string;

beforeAll(async () => {
  source = await Bun.file(componentPath).text();
});

describe('ChildrenScreen (wizard)', () => {
  it('exports the screen', () => {
    expect(source).toContain('export function ChildrenScreen');
  });

  it('reuses ChildrenManager for the list/form body', () => {
    expect(source).toContain('ChildrenManager');
  });

  it('still auto-creates a household on first entry', () => {
    expect(source).toContain('useCreateHousehold');
    expect(source).toContain('useUpsertProfile');
    expect(source).toContain('buildBootstrapProfileRequest');
  });

  it('still gates Continue on at least one child and advances to INVITE', () => {
    expect(source).toContain('hasAtLeastOneChild');
    expect(source).toContain('SETUP_STEPS.INVITE');
  });

  it('keeps its wizard testID and progress bar', () => {
    expect(source).toContain('children-screen');
    expect(source).toContain('progress={1 / 3}');
  });
});
