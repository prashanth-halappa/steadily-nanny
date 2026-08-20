/**
 * @module domains/setup/components/ChildrenManager
 *
 * The add/edit/remove child list body, extracted out of `ChildrenScreen` so
 * it can be reused, unchanged, by the post-onboarding settings entry point
 * (`ManageChildrenScreen`). Household resolution/creation and the wizard's
 * "Continue" gating are wizard-specific concerns and stay in `ChildrenScreen`
 * — this component only needs an already-existing household id.
 */

import { X } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { Icon } from '@/lib/icons/iconWithClassName';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { ChildChip } from '@/src/components/ui/child-chip';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Text } from '@/src/components/ui/text';
import { Body } from '@/src/components/ui/typography';
import {
  ageFromBirthDate,
  birthDateFromAge,
} from '@/src/domains/setup/childAge';
import {
  ChildFormSheet,
  type ChildFormValues,
} from '@/src/domains/setup/components/ChildFormSheet';
import { ManageCommitmentsSection } from '@/src/domains/setup/components/ManageCommitmentsSection';
import { useCreateChild } from '@/src/hooks/mutations/useCreateChild';
import { useDeleteChild } from '@/src/hooks/mutations/useDeleteChild';
import { useUpdateChild } from '@/src/hooks/mutations/useUpdateChild';
import { useChildren } from '@/src/hooks/queries/useChildren';

interface ChildrenManagerProps {
  householdId: string;
}

export function ChildrenManager({ householdId }: ChildrenManagerProps) {
  const { t } = useTranslation('household');

  const children = useChildren(householdId);
  const createChild = useCreateChild(householdId);
  const updateChild = useUpdateChild(householdId);
  const deleteChild = useDeleteChild(householdId);

  const [formVisible, setFormVisible] = useState(false);
  const [editingChildId, setEditingChildId] = useState<string | null>(null);

  const editingChild =
    editingChildId != null
      ? (children.data?.find(c => c.id === editingChildId) ?? null)
      : null;

  const openAddForm = () => {
    setEditingChildId(null);
    setFormVisible(true);
  };

  const openEditForm = (childId: string) => {
    setEditingChildId(childId);
    setFormVisible(true);
  };

  const handleSubmit = (values: ChildFormValues) => {
    const notes = values.routineNotes.trim();
    if (editingChildId) {
      updateChild.mutate(
        {
          childId: editingChildId,
          input: {
            name: values.name,
            birth_date: birthDateFromAge(Number(values.age)),
            routine_notes: notes,
          },
        },
        { onSuccess: () => setFormVisible(false) }
      );
    } else {
      createChild.mutate(
        {
          name: values.name,
          birth_date: birthDateFromAge(Number(values.age)),
          ...(notes.length > 0 ? { routine_notes: notes } : {}),
        },
        { onSuccess: () => setFormVisible(false) }
      );
    }
  };

  return (
    <View className="gap-3">
      {(children.data ?? []).length > 0 ? (
        <Card className="overflow-hidden p-0">
          {(children.data ?? []).map((child, index, allChildren) => {
            const age = ageFromBirthDate(child.birth_date);
            return (
              <View key={child.id}>
                <View className="gap-2 p-4">
                  <View
                    testID={`children-row-${child.id}`}
                    className="flex-row items-center gap-3"
                  >
                    <Pressable
                      testID={`children-row-${child.id}-edit`}
                      accessibilityRole="button"
                      onPress={() => openEditForm(child.id)}
                      className="flex-1 flex-row items-center gap-3"
                    >
                      <ChildChip
                        name={child.name}
                        colour={child.colour ?? undefined}
                      />
                      <Body className="text-muted-foreground">
                        {age === null
                          ? t('children.ageUnknown')
                          : t('children.ageYears', { count: age })}
                      </Body>
                    </Pressable>
                    <Pressable
                      testID={`children-row-${child.id}-remove`}
                      accessibilityRole="button"
                      accessibilityLabel={t('children.removeLabel', {
                        name: child.name,
                      })}
                      onPress={() => deleteChild.mutate(child.id)}
                      hitSlop={8}
                    >
                      <View className="h-8 w-8 items-center justify-center rounded-full bg-muted">
                        <Icon
                          icon={X}
                          className="text-muted-foreground"
                          size="sm"
                        />
                      </View>
                    </Pressable>
                  </View>
                  <ManageCommitmentsSection
                    householdId={householdId}
                    childId={child.id}
                    childName={child.name}
                  />
                </View>
                {index < allChildren.length - 1 ? (
                  <View
                    className="ml-4 bg-border"
                    style={{ height: StyleSheet.hairlineWidth }}
                  />
                ) : null}
              </View>
            );
          })}
        </Card>
      ) : null}

      {children.isSuccess && children.data.length === 0 ? (
        <EmptyState
          variant="inline"
          image={illustrations.emptyChildren}
          title={t('children.emptyTitle')}
          description={t('children.emptyDescription')}
        />
      ) : null}

      <Button
        testID="children-add-button"
        variant="outline"
        onPress={openAddForm}
      >
        <Text>{t('children.addButton')}</Text>
      </Button>

      <ChildFormSheet
        visible={formVisible}
        onDismiss={() => setFormVisible(false)}
        onSubmit={handleSubmit}
        isSubmitting={createChild.isPending || updateChild.isPending}
        initialValues={
          editingChild
            ? {
                name: editingChild.name,
                age: String(
                  editingChild.birth_date
                    ? new Date().getFullYear() -
                        new Date(editingChild.birth_date).getFullYear()
                    : ''
                ),
                routineNotes: editingChild.routine_notes ?? '',
              }
            : undefined
        }
      />
    </View>
  );
}
