/**
 * @module domains/setup/__tests__/InviteScreen.test
 *
 * Regression coverage for the wizard step, added while extracting
 * `InviteCodeCard` out of it — locks in that the wizard-only concerns
 * ("Done" gated on having a code, returning to Home) survive the refactor
 * unchanged, plus the later fix that made the role picker actually reach
 * the server.
 *
 * `body` is `source` with the module doc block stripped, so the
 * "must not contain" assertions below test the CODE and are not tripped by
 * a comment that names the removed identifier it is explaining.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentPath = join(__dirname, '../components/InviteScreen.tsx');
let source: string;
let body: string;

beforeAll(async () => {
  source = await Bun.file(componentPath).text();
  body = source.slice(source.indexOf('\nimport '));
});

describe('InviteScreen (wizard)', () => {
  it('exports the screen', () => {
    expect(source).toContain('export function InviteScreen');
  });

  it('reuses InviteCodeCard for the code/retry display', () => {
    expect(source).toContain('InviteCodeCard');
  });

  it('REGRESSION: never auto-mints a code on mount — the role picker was inert', () => {
    // The bug: a single `useEffect` fired `createInvite.mutate` the moment
    // `householdId` was present (already true on mount, it comes from
    // setupProgress), using the `nanny` default, and a `hasRequestedInvite`
    // ref blocked every later attempt — so the picker's selection could
    // never reach the server and every wizard invite was role 'nanny'.
    // The only other call path was InviteCodeCard's `onRetry`, which the
    // card renders ONLY when `isError`.
    expect(body).not.toContain('hasRequestedInvite');
    expect(body).not.toContain('selectedRoleRef');
    expect(body).not.toContain('useEffect');
    expect(body).not.toContain('createInvite.mutate({ role: selectedRoleRef');
  });

  it('shows a role picker and passes the selected role to createInvite', () => {
    expect(source).toContain('InviteRolePicker');
    expect(source).toContain('selectedRole');
    expect(source).toContain('createInvite.mutate({ role: selectedRole })');
  });

  it('mints the code from an explicit tap, the same shape as ManageInviteScreen', () => {
    expect(source).toContain('testID="invite-generate-button"');
    expect(source).toContain('const onGenerate');
    expect(source).toContain('hasStarted');
    // One tap = one code: the generate handler bails while a mint is
    // already in flight, and nothing else calls mutate.
    expect(source).toContain('createInvite.isPending');
    expect(source.match(/createInvite\.mutate\(/g)?.length).toBe(1);
  });

  it('reuses the same handler for retry so a failed mint keeps the picked role', () => {
    expect(source).toContain('onRetry={onGenerate}');
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
