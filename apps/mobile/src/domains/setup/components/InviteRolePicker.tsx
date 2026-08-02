/**
 * @module domains/setup/components/InviteRolePicker
 *
 * Lets a parent choose which role an invite code grants — nanny, co-parent,
 * or helper — before generating the code.
 */
import type { HouseholdInviteRole } from '@steadily-nanny/shared-types/schemas/household.schema';
import { HOUSEHOLD_INVITE_ROLES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { RoleOptionCard } from '@/src/domains/setup/components/RoleOptionCard';

const INVITE_ROLE_OPTIONS = [
  HOUSEHOLD_INVITE_ROLES.NANNY,
  HOUSEHOLD_INVITE_ROLES.PARENT,
  HOUSEHOLD_INVITE_ROLES.HELPER,
] as const satisfies readonly HouseholdInviteRole[];

interface InviteRolePickerProps {
  selected: HouseholdInviteRole;
  onSelect: (role: HouseholdInviteRole) => void;
}

export function InviteRolePicker({
  selected,
  onSelect,
}: InviteRolePickerProps) {
  const { t } = useTranslation('household');

  return (
    <View className="gap-3" testID="invite-role-picker">
      {INVITE_ROLE_OPTIONS.map(role => (
        <RoleOptionCard
          key={role}
          testID={`invite-role-${role}`}
          title={t(`invite.roles.${role}.title`)}
          description={t(`invite.roles.${role}.description`)}
          selected={selected === role}
          onPress={() => onSelect(role)}
        />
      ))}
    </View>
  );
}

export type { InviteRolePickerProps };
