/**
 * @module domains/setup/components/ChildrenScreen
 *
 * Parent setup step 2: add/edit/remove children. A household must exist
 * before children can be created (`POST /households`), so this screen
 * auto-creates one on first entry if the parent has none yet — there's no
 * separate "name your household" step in Wave 1, so it gets a sensible
 * default name the parent can rename later from settings.
 */
import { type Href, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { birthDateFromAge } from '@/src/domains/setup/childAge';
import {
  ChildFormSheet,
  type ChildFormValues,
} from '@/src/domains/setup/components/ChildFormSheet';
import { ChildRow } from '@/src/domains/setup/components/ChildRow';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { getSetupStepRoute, SETUP_STEPS } from '@/src/domains/setup/types';
import { useCreateChild } from '@/src/hooks/mutations/useCreateChild';
import { useCreateHousehold } from '@/src/hooks/mutations/useCreateHousehold';
import { useDeleteChild } from '@/src/hooks/mutations/useDeleteChild';
import { useUpdateChild } from '@/src/hooks/mutations/useUpdateChild';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useHouseholds } from '@/src/hooks/queries/useHouseholds';
import { useSetupProgressStore } from '@/src/store/setupProgress';

const DEFAULT_HOUSEHOLD_NAME = 'Our household';

export function ChildrenScreen() {
  const router = useRouter();
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);
  const cachedHouseholdId = useSetupProgressStore(s => s.householdId);

  const setHouseholdId = useSetupProgressStore(s => s.setHouseholdId);
  const households = useHouseholds();
  const createHousehold = useCreateHousehold();
  // Guard so an in-flight create isn't fired twice while the mutation settles.
  const hasRequestedHouseholdCreate = useRef(false);

  const householdId = households.data?.[0]?.id ?? cachedHouseholdId ?? null;

  useEffect(() => {
    if (!households.isSuccess) return;

    if (households.data.length === 0) {
      if (!hasRequestedHouseholdCreate.current) {
        hasRequestedHouseholdCreate.current = true;
        createHousehold.mutate({ name: DEFAULT_HOUSEHOLD_NAME });
      }
      return;
    }

    // Adopt an EXISTING household into setupProgress — a returning parent
    // who signs out and back in reaches this screen with a household already
    // on the server but nothing cached locally (setupProgress is wiped on
    // sign-out); without this, InviteScreen reads a null householdId forever
    // and its effect guard never fires. Don't leave this only on the create
    // path's onSuccess.
    const existingId = households.data[0]?.id;
    if (existingId && existingId !== cachedHouseholdId) {
      setHouseholdId(existingId);
    }
  }, [
    households.isSuccess,
    households.data,
    createHousehold,
    cachedHouseholdId,
    setHouseholdId,
  ]);

  const children = useChildren(householdId);
  const createChild = useCreateChild(householdId ?? '');
  const updateChild = useUpdateChild(householdId ?? '');
  const deleteChild = useDeleteChild(householdId ?? '');

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
    const input = {
      name: values.name,
      birth_date: birthDateFromAge(Number(values.age)),
    };
    if (editingChildId) {
      updateChild.mutate(
        { childId: editingChildId, input },
        { onSuccess: () => setFormVisible(false) }
      );
    } else {
      createChild.mutate(input, { onSuccess: () => setFormVisible(false) });
    }
  };

  const onContinue = () => {
    setCurrentStep(SETUP_STEPS.INVITE);
    router.push(getSetupStepRoute(SETUP_STEPS.INVITE) as Href);
  };

  const isLoadingHousehold = !householdId;
  // Gated on >= 1 child, matching useIsOnboarded's server-derived predicate
  // (parent onboarded == owns a household with >= 1 child) — letting Continue
  // through with zero children would let a parent "finish" the wizard in a
  // state the app itself doesn't consider onboarded, and the next cold start
  // would bounce them right back here.
  const hasAtLeastOneChild = (children.data?.length ?? 0) > 0;

  return (
    <SetupScreenShell
      testID="children-screen"
      progress={1 / 3}
      title="Who are the children?"
      subtitle="Add each child so your nanny knows who they're looking after."
      ctaLabel="Continue"
      ctaDisabled={isLoadingHousehold || !hasAtLeastOneChild}
      onCta={onContinue}
    >
      {isLoadingHousehold ? (
        <LoadingIndicator />
      ) : (
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
              title="No children yet"
              description="Add your first child to get started."
            />
          ) : null}

          <Button
            testID="children-add-button"
            variant="outline"
            onPress={openAddForm}
          >
            <Text>Add a child</Text>
          </Button>
        </View>
      )}

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
              }
            : undefined
        }
      />
    </SetupScreenShell>
  );
}
