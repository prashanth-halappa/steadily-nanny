/**
 * @module hooks/queries/useRestrictedAction
 *
 * "Can I do this here, and if not, who can?" — the one answer behind S4's
 * restricted state (`docs/design/attention-and-notifications.md` §7).
 *
 * A household on `approval_mode='owner_only'` lets only the OWNER act alone
 * (`apps/api/.../approvalGateService.ts`). Mobile used to collapse `owner` and
 * `parent` into one role, so a co-parent saw the affordance, tapped it, and
 * learned the rule from a 403. This is the client that stops lying: the server
 * gate does not move, and this hook never grants anything — it only reports
 * that an action will be refused, and by whose authority.
 *
 * DISABLED WITH A REASON, NEVER HIDDEN — a hidden button is indistinguishable
 * from a bug (§7). Render with `RestrictedActionButton`, which keeps the 44pt
 * target and puts `reason` on `accessibilityHint`.
 *
 * NOT a helper's gate (B5 / D-21). A helper has no payroll access at all, so
 * she does not see a disabled Approve button — she does not see the money
 * surface. `isPastMember` (`useIsOnboarded`) strips her writes separately.
 */
import { HOUSEHOLD_APPROVAL_MODES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useTranslation } from 'react-i18next';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { useAuthStore } from '@/src/store/auth';
import { useHouseholdMembers } from './useHouseholdMembers';
import { useHouseholds } from './useHouseholds';
import { useIsOnboarded } from './useIsOnboarded';

export interface RestrictedActionState {
  /** True when the server will refuse this action for this reader. */
  disabled: boolean;
  /** The sentence to show beneath the button, or null when unrestricted. */
  reason: string | null;
}

const UNRESTRICTED: RestrictedActionState = { disabled: false, reason: null };

export function useRestrictedAction({
  householdId,
  action,
}: {
  /** The household the action writes to; defaults to the active one. */
  householdId?: string | null;
  /** Already-translated verb phrase: "approve hours", "cancel short-notice shifts". */
  action: string;
}): RestrictedActionState {
  const { t } = useTranslation('common');
  const onboarding = useIsOnboarded();
  const currentUserId = useAuthStore(s => s.session?.user?.id ?? null);
  const id = householdId ?? onboarding.householdId;
  const households = useHouseholds();
  const members = useHouseholdMembers(id);

  const household = households.data?.find(h => h.id === id);
  // The members list is authoritative for the household actually being acted
  // on — which is not always the active one (`ShiftDetailScreen` is reached by
  // shift id alone). `membershipRole` covers the frame before it resolves.
  const myMembership = members.data?.find(m => m.user_id === currentUserId);
  const myRole =
    myMembership?.role ??
    (id === onboarding.householdId ? onboarding.membershipRole : null);

  // Unknown resolves to UNRESTRICTED on purpose: a button that flickers
  // disabled while two queries settle reads as broken, and the 403 is still
  // there as the backstop.
  if (household?.approval_mode !== HOUSEHOLD_APPROVAL_MODES.OWNER_ONLY) {
    return UNRESTRICTED;
  }
  if (myRole !== 'parent') return UNRESTRICTED;

  const owner = members.data?.find(m => m.role === 'owner');
  const name = resolveCarerName(owner, t('restrictedActionOwner'));

  return { disabled: true, reason: t('restrictedAction', { name, action }) };
}
