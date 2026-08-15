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
    // P8 widened this call to optionally carry a drafted `pay_offer`, so the
    // exact literal call is no longer a single fixed string — the role still
    // reaches the mutate call (`{ role: selectedRole }`, the no-offer arm)
    // and the "pay offer card" describe block below covers the offer arm.
    expect(source).toContain('{ role: selectedRole }');
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

  it('still gates Continue on having a code, and advances to notifications instead of finishing onboarding', () => {
    expect(source).toContain('ctaDisabled={!code}');
    expect(source).toContain('SETUP_STEPS.NOTIFICATIONS_PERMISSION');
    expect(source).not.toContain('/(private)/(tabs)/home');
  });

  it('keeps its wizard testID and share button', () => {
    expect(source).toContain('invite-screen');
    expect(source).toContain('invite-share-button');
  });

  it('D3: wires useRevokeInvite through to InviteCodeCard, clearing the invite on success', () => {
    expect(source).toContain('useRevokeInvite');
    expect(source).toContain('onRevoke=');
    // On success it must clear BOTH the mutation state InviteCodeCard reads
    // (createInvite.reset()) and the local hasStarted flag, or the card is
    // left showing a stuck spinner instead of returning to the role picker.
    expect(source).toContain('createInvite.reset()');
    expect(source).toContain('setHasStarted(false)');
  });

  // P8 (mobile half): a parent may record a pay OFFER while inviting a nanny.
  // The offer rides the invite code itself — there is no carer yet to hang a
  // real arrangement on — so it must reach the server in the SAME
  // createInvite call that mints the code, never a second request.
  describe('pay offer card (P8)', () => {
    it('renders the offer card only when the selected role is nanny', () => {
      expect(source).toContain('selectedRole === HOUSEHOLD_INVITE_ROLES.NANNY');
      expect(source).toContain('invite-offer-card');
    });

    it('attaches the drafted offer to the SAME mutate call that mints the code', () => {
      expect(source).toContain('pay_offer: payOffer');
      // Still exactly one mutate call — the offer is an argument to it, not a
      // second request.
      expect(source.match(/createInvite\.mutate\(/g)?.length).toBe(1);
    });

    it('sends no pay_offer key at all when nothing was drafted', () => {
      expect(source).toContain('{ role: selectedRole }');
    });

    it('has no Skip control — absence of a drafted offer already means "no offer"', () => {
      expect(body).not.toContain('invite-offer-skip');
      expect(body).not.toContain('SkipButton');
    });

    it('shows the draft state line and never a weekly total', () => {
      expect(source).toContain("t('invite.offer.draftState')");
      expect(body).not.toContain('weekly_equivalent_minor');
    });

    it('opens PayChangeSheet in offer mode', () => {
      expect(source).toContain('PayChangeSheet');
      expect(source).toContain('mode="offer"');
    });
  });
});
