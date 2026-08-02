/**
 * @module domains/setup/components/ChildrenManager
 *
 * The add/edit/remove child list body, extracted out of `ChildrenScreen` so
 * it can be reused, unchanged, by the post-onboarding settings entry point
 * (`ManageChildrenScreen`). Household resolution/creation and the wizard's
 * "Continue" gating are wizard-specific concerns and stay in `ChildrenScreen`
 * — this component only needs an already-existing household id.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Text } from '@/src/components/ui/text';
import { birthDateFromAge } from '@/src/domains/setup/childAge';
import {
  ChildFormSheet,
  type ChildFormValues,
} from '@/src/domains/setup/components/ChildFormSheet';
import { ChildRow } from '@/src/domains/setup/components/ChildRow';
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
      {(children.data ?? []).map(child => (
        <ChildRow
          key={child.id}
          testID={`children-row-${child.id}`}
          name={child.name}
          colour={child.colour}
          birthDate={child.birth_date}
          onPress={() => openEditForm(child.id)}
          onRemove={() => deleteChild.mutate(child.id)}
        />
      ))}

      {children.isSuccess && children.data.length === 0 ? (
        <EmptyState
          variant="inline"
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
