/**
 * @module domains/setup/__tests__/ManageInviteScreen.test
 *
 * Post-onboarding entry point: a parent reaches this from Settings to
 * generate another nanny invite code (e.g. to onboard a second nanny).
 * Unlike the wizard's InviteScreen, this screen does NOT auto-generate a
 * code on mount — visiting it repeatedly must not silently mint unused
 * invite codes — the parent explicitly taps "generate".
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentPath = join(__dirname, '../components/ManageInviteScreen.tsx');
let source: string;

beforeAll(async () => {
  source = await Bun.file(componentPath).text();
});

describe('ManageInviteScreen', () => {
  it('exports the component', () => {
    expect(source).toContain('export function ManageInviteScreen');
  });

  it('wires a distinct testID from the wizard screen', () => {
    expect(source).toContain('manage-invite-screen');
  });

  it('requires an explicit tap to generate a code — no auto-fire on mount', () => {
    expect(source).toContain('invite-generate-button');
    expect(source).not.toContain('useEffect');
  });

  it('reuses InviteCodeCard for the code/retry display', () => {
    expect(source).toContain('InviteCodeCard');
  });

  it('derives household from server-backed useIsOnboarded, not setupProgress', () => {
    expect(source).toContain('useIsOnboarded');
    expect(source).not.toContain('useSetupProgressStore');
  });

  it('shows a role picker and passes the selected role to createInvite', () => {
    expect(source).toContain('InviteRolePicker');
    expect(source).toContain('selectedRole');
    expect(source).toContain('createInvite.mutate({ role: selectedRole })');
  });

  it('returns the parent to where they came from, never forward through the wizard', () => {
    expect(source).toContain('router.back()');
  });
});
