/**
 * @module domains/setup/__tests__/ManageChildrenScreen.test
 *
 * Post-onboarding entry point: a parent reaches this from Settings to add,
 * edit, or remove children. Reuses `SetupScreenShell`/`ChildrenManager` but
 * MUST behave like a settings screen, not a wizard step — the CTA returns
 * the parent to wherever they came from (router.back()), it never pushes
 * further into the setup flow, and it derives its household from the
 * server-backed `useIsOnboarded`, never the in-flight `setupProgress` store.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentPath = join(__dirname, '../components/ManageChildrenScreen.tsx');
let source: string;

beforeAll(async () => {
  source = await Bun.file(componentPath).text();
});

describe('ManageChildrenScreen', () => {
  it('exports the component', () => {
    expect(source).toContain('export function ManageChildrenScreen');
  });

  it('wires a distinct testID from the wizard screen', () => {
    expect(source).toContain('manage-children-screen');
  });

  it('reuses ChildrenManager rather than duplicating the list/form logic', () => {
    expect(source).toContain('ChildrenManager');
  });

  it('derives household from server-backed useIsOnboarded, not setupProgress', () => {
    expect(source).toContain('useIsOnboarded');
    expect(source).not.toContain('useSetupProgressStore');
  });

  it('returns the parent to where they came from, never forward through the wizard', () => {
    expect(source).toContain('router.back()');
    expect(source).not.toContain('getSetupStepRoute');
    expect(source).not.toContain('setCurrentStep');
  });
});
