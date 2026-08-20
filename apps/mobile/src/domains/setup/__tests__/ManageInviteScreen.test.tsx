/**
 * @module domains/setup/__tests__/ManageInviteScreen.test
 *
 * Post-onboarding entry point: a parent reaches this from Settings to
 * generate an invite code for a nanny, co-parent, or helper.
 * Unlike the wizard's InviteScreen, this screen does NOT auto-generate a
 * code on mount — visiting it repeatedly must not silently mint unused
 * invite codes — the parent explicitly taps "generate".
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { join } from 'node:path';
import { fireEvent, render } from '@testing-library/react-native';
import { Button } from '@/src/components/ui/button';
import {
  resetNavigationMocks,
  setupNavigationMock,
} from '@/src/test-utils/mocks/navigation';

const componentPath = join(__dirname, '../components/ManageInviteScreen.tsx');
let source: string;

const createInviteMutate = mock();

setupNavigationMock();

mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
  useIsOnboarded: () => ({
    householdId: 'household-1',
    role: 'parent',
    status: 'onboarded',
  }),
}));

mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
  useActiveHousehold: () => ({
    household: {
      id: 'household-1',
      currency: 'USD',
      timezone: 'UTC',
      cancellation_paid_within_hours: 24,
      week_starts_on: 0,
    },
  }),
}));

mock.module('@/src/hooks/mutations/useCreateInvite', () => ({
  useCreateInvite: () => ({
    mutate: createInviteMutate,
    isPending: false,
    data: null,
    isError: false,
    reset: mock(),
  }),
}));

mock.module('@/src/hooks/mutations/useRevokeInvite', () => ({
  useRevokeInvite: () => ({
    mutate: mock(),
    isPending: false,
  }),
}));

let ManageInviteScreen: typeof import('../components/ManageInviteScreen').ManageInviteScreen;

beforeAll(async () => {
  source = await Bun.file(componentPath).text();
  ({ ManageInviteScreen } = await import('../components/ManageInviteScreen'));
});

beforeEach(() => {
  createInviteMutate.mockClear();
  resetNavigationMocks();
});

describe('ManageInviteScreen', () => {
  it('exports the component', () => {
    expect(source).toContain('export function ManageInviteScreen');
  });

  it('wires a distinct testID from the wizard screen', () => {
    expect(source).toContain('manage-invite-screen');
  });

  it('requires an explicit tap to generate a code — no auto-fire on mount', () => {
    expect(source).not.toContain('invite-generate-button');
    expect(source).toContain("t('invite.generateButton')");
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
    // P8 widened this call to optionally carry a drafted `pay_offer` (see
    // "pay offer card" below) — the no-offer arm still sends exactly this.
    expect(source).toContain('{ role: selectedRole }');
  });

  it('returns the parent to where they came from, never forward through the wizard', () => {
    expect(source).toContain('router.back()');
  });

  it('D3: wires useRevokeInvite through to InviteCodeCard, clearing the invite on success', () => {
    expect(source).toContain('useRevokeInvite');
    expect(source).toContain('onRevoke=');
    expect(source).toContain('createInvite.reset()');
    expect(source).toContain('setHasStarted(false)');
  });

  // P8 (mobile half): the same drafted-offer-on-invite capability InviteScreen
  // has, PLUS the ability to see/change the offer on an already-minted
  // pending nanny invite from this session.
  describe('pay offer card (P8)', () => {
    it('renders the offer card only when the selected role is nanny, before a code is minted', () => {
      expect(source).toContain('selectedRole === HOUSEHOLD_INVITE_ROLES.NANNY');
      expect(source).toContain('invite-offer-card');
    });

    it('attaches the drafted offer to the create-invite call, sending no pay_offer key when nothing was drafted', () => {
      expect(source).toContain('pay_offer: payOffer');
      expect(source).toContain('{ role: selectedRole }');
    });

    it('lets a parent change the offer on a still-pending nanny invite by revoking and recreating — no PATCH for pay_offer exists', () => {
      expect(source).toContain('invite.role === HOUSEHOLD_INVITE_ROLES.NANNY');
      expect(source).toContain('revokeInvite.mutate(invite.id');
      // Two mutate call sites now: the original mint, and the revoke-then-
      // recreate offer edit.
      expect(
        source.match(/createInvite\.mutate\(/g)?.length
      ).toBeGreaterThanOrEqual(2);
    });

    it('shows the draft state line and never a weekly total', () => {
      expect(source).toContain("t('invite.offer.draftState')");
      expect(source).not.toContain('weekly_equivalent_minor');
    });

    // Editing revokes and re-mints, so the code the parent may already have
    // texted stops working. Warn only once a code actually exists — before
    // the mint there is nothing to invalidate and the line would be a lie.
    it('warns that editing replaces the code, and only once a code exists', () => {
      expect(source).toContain("t('invite.offer.editReplacesCode')");
      expect(source).toMatch(
        /hasStarted && invite \?[\s\S]{0,400}invite-offer-edit-replaces-code/
      );
    });
  });

  describe('pre-mint CTA (WP1)', () => {
    it('renders exactly one primary button before a code is minted, and the shell CTA calls createInvite', () => {
      const { getByTestId, queryByTestId, UNSAFE_getAllByType } = render(
        <ManageInviteScreen />
      );

      expect(queryByTestId('invite-generate-button')).toBeNull();

      // The pre-mint defect was two filled primaries — a body Generate plus the
      // shell Done. Count only those screen-level CTAs, not sheet internals
      // (PayChangeSheet mounts behind the same mocked Button type).
      const screenPrimaryIds = UNSAFE_getAllByType(Button)
        .filter(
          btn =>
            (btn.props.variant ?? 'default') === 'default' &&
            (btn.props.testID === 'manage-invite-screen-cta' ||
              btn.props.testID === 'invite-generate-button')
        )
        .map(btn => btn.props.testID);
      expect(screenPrimaryIds).toEqual(['manage-invite-screen-cta']);

      fireEvent.press(getByTestId('manage-invite-screen-cta'));

      expect(createInviteMutate).toHaveBeenCalledTimes(1);
      expect(createInviteMutate).toHaveBeenCalledWith({ role: 'nanny' });
    });
  });
});
