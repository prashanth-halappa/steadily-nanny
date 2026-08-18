/**
 * Week-level pattern status — outline row scoped to the usual week.
 *
 * Visually distinct from shift-level `StatusPill` (filled chips on calendar
 * rows). Parents see "Your week · Accepted" here while individual shifts on
 * the calendar still carry their own confirmation state.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { cn } from '@/lib/utils';
import { Caption, Label } from '@/src/components/ui/typography';

type PatternStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'withdrawn'
  | 'ended';

const STATUS_STYLES: Record<
  PatternStatus,
  { border: string; statusText: string }
> = {
  pending: {
    border: 'border-warning',
    statusText: 'text-warning-strong',
  },
  accepted: {
    border: 'border-success',
    statusText: 'text-success',
  },
  declined: {
    border: 'border-destructive',
    statusText: 'text-destructive',
  },
  withdrawn: {
    border: 'border-border',
    statusText: 'text-muted-foreground',
  },
  // S9: an ended pattern used to fall through to "no schedule yet" — it
  // reads the same as `withdrawn` (a live week that is no longer live),
  // not as an error state.
  ended: {
    border: 'border-border',
    statusText: 'text-muted-foreground',
  },
};

interface PatternStatusIndicatorProps {
  status: PatternStatus;
  testID?: string;
}

export function PatternStatusIndicator({
  status,
  testID,
}: PatternStatusIndicatorProps) {
  const { t } = useTranslation('schedule');
  const styles = STATUS_STYLES[status];

  const statusLabel = (): string => {
    switch (status) {
      case 'accepted':
        return t('pending.statusAccepted');
      case 'declined':
        return t('pending.statusDeclined');
      case 'withdrawn':
        return t('pending.statusWithdrawn');
      case 'ended':
        return t('pending.statusEnded');
      default:
        return t('pending.statusPending');
    }
  };

  return (
    <View
      testID={testID}
      accessibilityRole="text"
      className={cn(
        'self-start flex-row items-center gap-2 rounded-row border bg-card px-4 py-2.5',
        styles.border
      )}
    >
      <Caption className="text-muted-foreground">
        {t('pending.screenTitle')}
      </Caption>
      <Label className={styles.statusText} weight="semibold">
        {statusLabel()}
      </Label>
    </View>
  );
}

export type { PatternStatus, PatternStatusIndicatorProps };
