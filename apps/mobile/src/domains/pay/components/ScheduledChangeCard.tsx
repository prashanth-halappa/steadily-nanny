/**
 * @module domains/pay/components/ScheduledChangeCard
 *
 * §6 / D-16's scheduled-change card — a `valid_from` after "today" is a
 * promise that has not landed yet. Extracted out of `PayArrangementScreen`
 * (F18) so `MyPayScreen` can render the SAME card READ-ONLY: a nanny sees
 * the raise coming, but only the parent who owns the arrangement can edit or
 * call it off. `canManage` is the whole gate — false renders neither button.
 */
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { InlineError } from '@/src/components/ui/inline-error';
import { Text } from '@/src/components/ui/text';
import { H3, Small } from '@/src/components/ui/typography';
import { formatDisplayDateWithYear } from '../utils/payArrangementForm';
import { buildTermsDiff, summarizeTermsDiff } from '../utils/termsDiff';

/** §6's card names the headline terms only — the full diff is one tap away
 * in the history once the change lands. */
const SCHEDULED_SUMMARY_TERMS = 2;

interface ScheduledChangeCardProps {
  /** The SCHEDULED row — the future-dated `pay_arrangements` version this
   * card is about. */
  arrangement: PayArrangement;
  /** The row currently in effect — the diff's "before" side. */
  currentArrangement: PayArrangement;
  /** Gates Edit/Cancel: true for the parent who owns this arrangement,
   * false for the nanny's read-only `MyPayScreen` card. */
  canManage: boolean;
  onEdit?: () => void;
  onCancel?: () => void;
  /** Already-translated refusal string, rendered INLINE (GOLDEN #40) —
   * `PayArrangementScreen` owns `cancelScheduled`'s mutation state and
   * passes the resolved copy through rather than this card knowing about
   * the mutation at all. */
  cancelError?: string | null;
}

export function ScheduledChangeCard({
  arrangement,
  currentArrangement,
  canManage,
  onEdit,
  onCancel,
  cancelError = null,
}: ScheduledChangeCardProps) {
  const { t } = useTranslation('pay');

  return (
    <Card testID="pay-scheduled-change-card" tone="attention">
      <CardContent className="gap-3">
        <H3>
          {t('scheduledChange.title', {
            date: formatDisplayDateWithYear(arrangement.valid_from),
          })}
        </H3>
        <Small testID="pay-scheduled-diff" className="text-muted-strong">
          {summarizeTermsDiff(
            buildTermsDiff(currentArrangement, arrangement, t),
            SCHEDULED_SUMMARY_TERMS
          )}
        </Small>
        {canManage ? (
          <View className="flex-row gap-2">
            <Button
              testID="pay-scheduled-edit"
              variant="ghost"
              onPress={onEdit}
            >
              <Text>{t('scheduledChange.editButton')}</Text>
            </Button>
            <Button
              testID="pay-scheduled-cancel"
              variant="ghost"
              onPress={onCancel}
            >
              <Text>{t('scheduledChange.cancelButton')}</Text>
            </Button>
          </View>
        ) : null}
        {cancelError ? (
          <InlineError
            testID="pay-scheduled-cancel-error"
            message={cancelError}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
