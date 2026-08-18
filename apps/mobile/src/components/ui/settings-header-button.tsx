/**
 * @module components/ui/settings-header-button
 *
 * The gear that replaced the Settings tab (WP-C). Settings stopped earning a
 * quarter of the tab bar — it is visited monthly, while the Inbox is the
 * shared record between a family and its carer — so it moved up into the
 * header band as an icon, and the Inbox took the slot.
 *
 * Every tab root plus the Inbox mounts this, because it is now the ONLY way
 * to reach sign-out, delete-account and the household switcher. Transient
 * loading/error/empty branches are exempt; a screen that can settle into a
 * steady state without one is a dead end (see
 * `components/ui/__tests__/settings-reachability.test.ts`).
 */
import { router } from 'expo-router';
import { Settings } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';
import { spacing } from '@/lib/design-tokens';
import { Icon } from '@/lib/icons/iconWithClassName';

const TOUCH_TARGET = {
  minWidth: spacing.minTouchTarget,
  minHeight: spacing.minTouchTarget,
} as const;

export function SettingsHeaderButton() {
  const { t } = useTranslation('common');
  return (
    <Pressable
      testID="header-settings"
      accessibilityRole="button"
      accessibilityLabel={t('tabs.settings')}
      onPress={() => router.push('/settings')}
      hitSlop={8}
      className="-mr-2 items-center justify-center"
      style={TOUCH_TARGET}
    >
      <Icon icon={Settings} size={24} className="text-muted-strong" />
    </Pressable>
  );
}
