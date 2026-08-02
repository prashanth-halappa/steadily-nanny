/**
 * @module domains/setup/components/ManageCommitmentsSection
 *
 * List/add/delete fixed commitments for one child (Wave D / flow 1g).
 */
import type { ChildCommitment } from '@steadily-nanny/shared-types/schemas/child.schema';
import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@/lib/icons/iconWithClassName';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Body, H3 } from '@/src/components/ui/typography';
import {
  buildWeeklyRrule,
  CommitmentFormSheet,
  type CommitmentFormValues,
} from '@/src/domains/setup/components/CommitmentFormSheet';
import {
  formatCommitmentTime,
  parseWeeklyDays,
} from '@/src/domains/setup/utils/commitmentRrule';
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
  const days = parseWeeklyDays(commitment.rrule);
  const dayCount = days.length;

  return (
    <View
      testID={`commitment-row-${commitment.id}`}
      className="flex-row items-center justify-between rounded-lg bg-muted p-3"
    >
      <View className="flex-1 gap-0.5">
        <Body className="font-sora-medium">{commitment.label}</Body>
        <Body className="text-xs text-muted-foreground">
          {commitment.kind} · {formatCommitmentTime(commitment.start_time)}–
          {formatCommitmentTime(commitment.end_time)} · {dayCount} day
          {dayCount === 1 ? '' : 's'}
          {commitment.excluded_from_cover ? ' · excluded from cover' : ''}
        </Body>
      </View>
      <Pressable
        testID={`commitment-delete-${commitment.id}`}
        accessibilityRole="button"
        accessibilityLabel={`Delete ${commitment.label}`}
        onPress={onDelete}
        hitSlop={8}
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
  const commitments = useCommitments(householdId, childId);
  const createCommitment = useCreateCommitment(householdId, childId);
  const deleteCommitment = useDeleteCommitment(householdId, childId);
  const [formVisible, setFormVisible] = useState(false);

  const handleSubmit = (values: CommitmentFormValues) => {
    createCommitment.mutate(
      {
        kind: values.kind,
        label: values.label,
        rrule: buildWeeklyRrule(values.days),
        start_time: `${values.startTime}:00`,
        end_time: `${values.endTime}:00`,
        excluded_from_cover: values.excludedFromCover,
      },
      { onSuccess: () => setFormVisible(false) }
    );
  };

  return (
    <View
      testID={`manage-commitments-${childId}`}
      className="gap-2 rounded-lg border border-border p-3"
    >
      <H3 className="text-base">Commitments</H3>
      <Body className="text-xs text-muted-foreground">
        Fixed times like preschool or naps — gaps are raised when cover is
        missing.
      </Body>

      {(commitments.data ?? []).map(c => (
        <CommitmentRow
          key={c.id}
          commitment={c}
          onDelete={() => deleteCommitment.mutate(c.id)}
        />
      ))}

      <Button
        testID={`commitment-add-${childId}`}
        variant="outline"
        size="sm"
        onPress={() => setFormVisible(true)}
      >
        <Text>Add commitment</Text>
      </Button>

      <CommitmentFormSheet
        visible={formVisible}
        onDismiss={() => setFormVisible(false)}
        onSubmit={handleSubmit}
        isSubmitting={createCommitment.isPending}
        childName={childName}
      />
    </View>
  );
}
