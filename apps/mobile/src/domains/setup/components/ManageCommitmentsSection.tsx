/**
 * @module domains/setup/components/ManageCommitmentsSection
 *
 * List/add/delete recurring care hours for one child.
 */
import {
  CHILD_COMMITMENT_KINDS,
  type ChildCommitment,
} from '@steadily-nanny/shared-types/schemas/child.schema';
import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Icon } from '@/lib/icons/iconWithClassName';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';
import { Body, H3, Small } from '@/src/components/ui/typography';
import {
  buildWeeklyRrule,
  CommitmentFormSheet,
  type CommitmentFormValues,
} from '@/src/domains/setup/components/CommitmentFormSheet';
import { formatCareHoursPrimary } from '@/src/domains/setup/utils/careHoursDisplay';
import { parseWeeklyDays } from '@/src/domains/setup/utils/commitmentRrule';
import { useCreateCommitment } from '@/src/hooks/mutations/useCreateCommitment';
import { useDeleteCommitment } from '@/src/hooks/mutations/useDeleteCommitment';
import { useCommitments } from '@/src/hooks/queries/useCommitments';

interface ManageCommitmentsSectionProps {
  householdId: string;
  childId: string;
  childName: string;
}

function CommitmentRow({
  commitment,
  onDelete,
}: {
  commitment: ChildCommitment;
  onDelete: () => void;
}) {
  const { t } = useTranslation('household');
  const days = parseWeeklyDays(commitment.rrule);
  const primaryLine = formatCareHoursPrimary(
    commitment.start_time,
    commitment.end_time,
    days,
    t
  );

  return (
    <View
      testID={`commitment-row-${commitment.id}`}
      className="flex-row items-center justify-between rounded-row bg-muted p-3"
    >
      <View className="flex-1 gap-1">
        <Body weight="medium">{primaryLine}</Body>
        {commitment.label ? (
          <Small className="text-muted-foreground">{commitment.label}</Small>
        ) : null}
      </View>
      <Pressable
        testID={`commitment-delete-${commitment.id}`}
        accessibilityRole="button"
        accessibilityLabel={t('careHours.deleteLabel', {
          summary: primaryLine,
        })}
        onPress={onDelete}
        className="h-touch w-touch items-center justify-center"
      >
        <Icon icon={Trash2} className="text-muted-foreground" size="sm" />
      </Pressable>
    </View>
  );
}

export function ManageCommitmentsSection({
  householdId,
  childId,
  childName,
}: ManageCommitmentsSectionProps) {
  const { t } = useTranslation('household');
  const commitments = useCommitments(householdId, childId);
  const createCommitment = useCreateCommitment(householdId, childId);
  const deleteCommitment = useDeleteCommitment(householdId, childId);
  const [formVisible, setFormVisible] = useState(false);

  const commitmentList = commitments.data ?? [];
  const isEmpty = commitmentList.length === 0;

  const handleSubmit = (values: CommitmentFormValues) => {
    createCommitment.mutate(
      {
        kind: CHILD_COMMITMENT_KINDS.OTHER,
        label: values.label || undefined,
        rrule: buildWeeklyRrule(values.days),
        start_time: `${values.startTime}:00`,
        end_time: `${values.endTime}:00`,
      },
      { onSuccess: () => setFormVisible(false) }
    );
  };

  return (
    <Card testID={`manage-commitments-${childId}`} className="gap-3 p-3">
      <H3>{t('careHours.sectionTitle')}</H3>
      <Small className="text-muted-foreground">
        {t('careHours.sectionBody', { childName })}
      </Small>

      {isEmpty ? (
        <View testID={`commitment-empty-${childId}`} className="gap-1">
          <Body weight="medium">{t('careHours.emptyTitle')}</Body>
          <Small className="text-muted-foreground">
            {t('careHours.emptyBody')}
          </Small>
        </View>
      ) : (
        commitmentList.map(c => (
          <CommitmentRow
            key={c.id}
            commitment={c}
            onDelete={() => deleteCommitment.mutate(c.id)}
          />
        ))
      )}

      <Button
        testID={`commitment-add-${childId}`}
        variant="outline"
        size="sm"
        onPress={() => setFormVisible(true)}
      >
        <Text>{t('careHours.addButton')}</Text>
      </Button>

      <CommitmentFormSheet
        visible={formVisible}
        onDismiss={() => setFormVisible(false)}
        onSubmit={handleSubmit}
        isSubmitting={createCommitment.isPending}
        childName={childName}
      />
    </Card>
  );
}
