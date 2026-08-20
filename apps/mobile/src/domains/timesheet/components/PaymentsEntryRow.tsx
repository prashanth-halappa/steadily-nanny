/**
 * @module domains/timesheet/components/PaymentsEntryRow
 *
 * The doorway into the Payments screen, rendered in each week view's
 * footer. Replaces a bare `Pressable`/`Small` link that had no
 * `accessibilityRole` (VoiceOver read it as static text) and a ~14pt hit
 * area against the repo's 44pt floor (`spacing.minTouchTarget`).
 *
 * A row, not a card — `PaymentsScreen` is capped at L4 in its own module
 * doc, and a `Card` as the doorway to an L4 room is a hierarchy inversion.
 * `rounded-row` + `elevation.row` matches `PendingExpensesRow`, the peer
 * "go somewhere else" affordance two nodes below this one in the same
 * footer — neither is more urgent than the other.
 */
import { ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Icon } from '@/lib/icons/iconWithClassName';
import { Body, Small } from '@/src/components/ui/typography';
import { spacing } from '~/lib/design-tokens/spacing';
import { CHEVRON_SLOT } from './TimeEntryRow';

interface PaymentsEntryRowProps {
  subtitle: string;
  onPress: () => void;
  testID?: string;
}

export function PaymentsEntryRow({
  subtitle,
  onPress,
  testID = 'hours-payments-link',
}: PaymentsEntryRowProps) {
  const { t } = useTranslation('hours');

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('payments.entryLink')}
      onPress={onPress}
      className="mt-4 gap-1"
      style={{ minHeight: spacing.minTouchTarget }}
    >
      <View className="flex-row items-center justify-between gap-3">
        <Body className="flex-1 text-primary">{t('payments.screenTitle')}</Body>
        <Icon
          icon={ChevronRight}
          size={CHEVRON_SLOT}
          className="text-primary"
        />
      </View>
      <Small testID={`${testID}-subtitle`} className="text-muted-foreground">
        {subtitle}
      </Small>
    </Pressable>
  );
}

export type { PaymentsEntryRowProps };
