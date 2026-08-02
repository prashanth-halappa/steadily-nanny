/**
 * @module domains/setup/__tests__/InviteScreen.test
 *
 * Regression coverage for the wizard step, added while extracting
 * `InviteCodeCard` out of it — locks in that the wizard-only concerns
 * (auto-generate on mount, "Done" gated on having a code, returning to
 * Home) survive the refactor unchanged.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentPath = join(__dirname, '../components/InviteScreen.tsx');
let source: string;

beforeAll(async () => {
  source = await Bun.file(componentPath).text();
});

describe('InviteScreen (wizard)', () => {
  it('exports the screen', () => {
    expect(source).toContain('export function InviteScreen');
  });

  it('reuses InviteCodeCard for the code/retry display', () => {
    expect(source).toContain('InviteCodeCard');
  });

  it('still auto-generates a code on mount', () => {
    expect(source).toContain('useEffect');
    expect(source).toContain('hasRequestedInvite');
  });

  it('still gates Done on having a code and returns to Home', () => {
    expect(source).toContain('ctaDisabled={!code}');
    expect(source).toContain('/(private)/(tabs)/home');
  });

  it('keeps its wizard testID and share button', () => {
    expect(source).toContain('invite-screen');
    expect(source).toContain('invite-share-button');
  });
});
