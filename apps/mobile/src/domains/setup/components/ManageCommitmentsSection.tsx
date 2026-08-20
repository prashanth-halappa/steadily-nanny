/**
 * @module domains/setup/components/ManageCommitmentsSection
 *
 * List/add/delete recurring care hours for one child.
 *
 * P3.3: once hours exist here, this is also where the parent is offered the
 * next step — confirming them as the usual week, which is the ONLY thing
 * that produces shifts (`docs/12-NEED-COVERAGE.md` §9: commitments never
 * become shifts by themselves, and that stays true). The builder opens
 * prefilled from these same hours, so the parent never has to retype them
 * and never has to learn that the two are separate records.
 *
 * The active-nanny gate is load-bearing, not defensive: during onboarding
 * `INVITE` is the step AFTER this one, so with nobody hired the builder has
 * no carer to propose a week to and the button would dead-end on its carer
 * picker. Before a nanny exists, this renders nothing.
 */
import {
  CHILD_COMMITMENT_KINDS,
  type ChildCommitment,
} from '@steadily-nanny/shared-types/schemas/child.schema';
import { SCHEDULE_PATTERN_STATUSES } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { type Href, useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Icon } from '@/lib/icons/iconWithClassName';
import { InlineRetry } from '@/src/components/custom/InlineRetry';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';
import { Body, H4, Small } from '@/src/components/ui/typography';
import { useHouseholdCarers } from '@/src/domains/schedule/hooks/useHouseholdCarers';
import {
  buildWeeklyRrule,
  CommitmentFormSheet,
  type CommitmentFormValues,
} from '@/src/domains/setup/components/CommitmentFormSheet';
import { formatCareHoursPrimary } from '@/src/domains/setup/utils/careHoursDisplay';
import { parseWeeklyDays } from '@/src/domains/setup/utils/commitmentRrule';
import { useCreateCommitment } from '@/src/hooks/mutations/useCreateCommitment';
import { useDeleteCommitment } from '@/src/hooks/mutations/useDeleteCommitment';
import { queryState } from '@/src/hooks/queries/queryState';
import { useCommitments } from '@/src/hooks/queries/useCommitments';
import { useSchedulePatterns } from '@/src/hooks/queries/useSchedulePatterns';

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
  const { t: tErrors } = useTranslation('errors');
  const router = useRouter();
  const commitments = useCommitments(householdId, childId);
  const carers = useHouseholdCarers(householdId);
  const patterns = useSchedulePatterns(householdId);
  const createCommitment = useCreateCommitment(householdId, childId);
  const deleteCommitment = useDeleteCommitment(householdId, childId);
  const [formVisible, setFormVisible] = useState(false);

  const commitmentList = commitments.data ?? [];
  const isEmpty = commitmentList.length === 0;

  const hasActiveNanny = (carers.data ?? []).length > 0;
  // PENDING counts as much as ACCEPTED: a week already sent and waiting on
  // the nanny means "confirm this as your usual week" is untrue, and tapping
  // it would walk the parent into building a SECOND week over the first.
  const openPattern = (patterns.data ?? []).find(
    pattern =>
      pattern.status === SCHEDULE_PATTERN_STATUSES.ACCEPTED ||
      pattern.status === SCHEDULE_PATTERN_STATUSES.PENDING
  );
  // False alarm (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B): `isLoading`
  // alone can't tell "still loading" from "settled with an error" — a
  // failed carers/patterns read has `isLoading: false` too, and used to
  // offer "confirm this as your usual week" (or hide a genuinely pending
  // one) off data that never arrived.
  const gatingQs = queryState(carers, patterns);
  // Both gating queries must have resolved first, or the offer flashes in
  // and then disappears on a household that already has a week.
  const canOfferWeek =
    !isEmpty && gatingQs.status === 'ready' && hasActiveNanny;
  const showConfirmWeek = canOfferWeek && !openPattern;
  // Say where the week got to rather than going silent — the parent has just
  // added hours and is owed the reason they aren't on the calendar yet.
  const showWeekPending =
    canOfferWeek && openPattern?.status === SCHEDULE_PATTERN_STATUSES.PENDING;
  const showGatingError = !isEmpty && gatingQs.status === 'error';

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
      <H4>{t('careHours.sectionTitle')}</H4>
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

      {showConfirmWeek ? (
        <View
          testID={`commitment-confirm-week-${childId}`}
          className="gap-2 border-border border-t pt-3"
        >
          <Small className="text-muted-foreground">
            {t('careHours.confirmWeekBody')}
          </Small>
          <Button
            testID={`commitment-confirm-week-cta-${childId}`}
            size="sm"
            onPress={() => router.push('/(private)/schedule/build' as Href)}
          >
            <Text>{t('careHours.confirmWeekCta')}</Text>
          </Button>
        </View>
      ) : null}

      {showWeekPending ? (
        <Small
          testID={`commitment-week-pending-${childId}`}
          className="border-border border-t pt-3 text-muted-foreground"
        >
          {t('careHours.weekPendingBody')}
        </Small>
      ) : null}

      {showGatingError ? (
        <View className="border-border border-t pt-3">
          <InlineRetry
            testID={`commitment-retry-${childId}`}
            message={tErrors('network')}
            onRetry={() => {
              void carers.refetch();
              void patterns.refetch();
            }}
          />
        </View>
      ) : null}

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
