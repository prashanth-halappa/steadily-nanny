/**
 * @module domains/today/components/HandoffChipsCard
 *
 * Compact daily handoff notes (Wave F / 1i): morning for parent, evening
 * for nanny. Parents can save_moment on evening notes.
 */
import {
  HANDOFF_PHASES,
  type HandoffPhase,
} from '@steadily-nanny/shared-types/schemas/handoff.schema';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { cn } from '@/lib/utils';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Body, H3 } from '@/src/components/ui/typography';
import { SETUP_ROLES, type SetupRole } from '@/src/domains/setup/types';
import {
  chipsForPhase,
  handoffChipLabelKey,
} from '@/src/domains/today/constants/handoffChips';
import { useCreateHandoffNote } from '@/src/hooks/mutations/useCreateHandoffNote';
import { useUpdateHandoffNote } from '@/src/hooks/mutations/useUpdateHandoffNote';
import { useHandoffNotes } from '@/src/hooks/queries/useHandoffNotes';
import { localDateInZone } from '@/src/lib/localDate';
import { useAuthStore } from '@/src/store/auth';

interface HandoffChipsCardProps {
  householdId: string;
  timeZone: string;
  role: SetupRole;
}

function ChipToggle({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn(
        'rounded-full px-3 py-1.5',
        selected ? 'bg-primary' : 'bg-muted'
      )}
    >
      <Text
        className={cn(
          'text-sm font-sora-medium',
          selected ? 'text-primary-foreground' : 'text-foreground'
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function HandoffPhaseEditor({
  phase,
  householdId,
  localDate,
  existingChips,
  existingNoteId,
}: {
  phase: HandoffPhase;
  householdId: string;
  localDate: string;
  existingChips: string[];
  existingNoteId?: string;
}) {
  const { t } = useTranslation('today');
  const suggestions = chipsForPhase(phase);
  const [selected, setSelected] = useState<string[]>(existingChips);
  const createNote = useCreateHandoffNote(householdId, localDate);
  const updateNote = useUpdateHandoffNote(householdId, localDate);

  // Re-seed the selection ONLY when the underlying note's identity actually
  // changes. `existingChips` is a brand-new `[]` on every render for as long
  // as no note exists yet, so an effect keyed on the array itself re-fired
  // continuously and wiped whatever the user had just tapped — most visibly
  // under `refetchOnWindowFocus`, where merely backgrounding the app cleared
  // the in-progress selection. The ref makes "did the real note change?" the
  // condition, rather than "did a new array literal show up?".
  const hydratedForNoteId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const noteIdentity = existingNoteId ?? null;
    if (hydratedForNoteId.current === noteIdentity) return;
    hydratedForNoteId.current = noteIdentity;
    setSelected(existingChips);
  }, [existingNoteId, existingChips]);

  const toggleChip = (chip: string) => {
    setSelected(prev =>
      prev.includes(chip) ? prev.filter(c => c !== chip) : [...prev, chip]
    );
  };

  const handleSubmit = () => {
    if (existingNoteId) {
      updateNote.mutate({
        handoffNoteId: existingNoteId,
        input: { chips: selected },
      });
      return;
    }
    createNote.mutate({
      local_date: localDate,
      phase,
      chips: selected,
    });
  };

  const isPending = createNote.isPending || updateNote.isPending;

  const title =
    phase === HANDOFF_PHASES.MORNING ? 'Morning handoff' : 'Evening handoff';

  return (
    <View testID={`handoff-editor-${phase}`} className="gap-2">
      <H3 className="text-base">{title}</H3>
      <View className="flex-row flex-wrap gap-2">
        {suggestions.map(chip => (
          <ChipToggle
            key={chip}
            testID={`handoff-chip-${phase}-${chip}`}
            label={t(handoffChipLabelKey(chip), { defaultValue: chip })}
            selected={selected.includes(chip)}
            onPress={() => toggleChip(chip)}
          />
        ))}
      </View>
      <Button
        testID={`handoff-submit-${phase}`}
        size="sm"
        onPress={handleSubmit}
        disabled={isPending || selected.length === 0}
      >
        <Text>Save</Text>
      </Button>
    </View>
  );
}

export function HandoffChipsCard({
  householdId,
  timeZone,
  role,
}: HandoffChipsCardProps) {
  const { t } = useTranslation('today');
  const localDate = localDateInZone(timeZone);
  const notesQuery = useHandoffNotes(householdId, localDate);
  const updateNote = useUpdateHandoffNote(householdId, localDate);
  const currentUserId = useAuthStore(s => s.user?.id) ?? null;

  const editorPhase: HandoffPhase | null =
    role === SETUP_ROLES.PARENT
      ? HANDOFF_PHASES.MORNING
      : role === SETUP_ROLES.NANNY
        ? HANDOFF_PHASES.EVENING
        : null;

  // The editor binds to THIS user's OWN note for the phase — never merely
  // the first note carrying it. `handoff_notes` has no unique constraint on
  // (household, local_date, phase), so multiple notes per phase are expected
  // and normal: with two carers in one household, carer B's editor was
  // pre-filling with carer A's chips and then PATCHing A's note id on
  // submit — a 403 that never cleared, because every refetch handed B the
  // same foreign note again.
  const myNote = useMemo(
    () =>
      currentUserId
        ? (notesQuery.data ?? []).find(
            n => n.phase === editorPhase && n.author_id === currentUserId
          )
        : undefined,
    [notesQuery.data, editorPhase, currentUserId]
  );

  // Deliberately NOT author-scoped: the recap a parent reads back is by
  // definition somebody else's note (their nanny's evening handoff).
  const eveningNote = useMemo(
    () => (notesQuery.data ?? []).find(n => n.phase === HANDOFF_PHASES.EVENING),
    [notesQuery.data]
  );

  if (!editorPhase) return null;

  const existingChips = myNote?.chips ?? [];
  const existingNoteId = myNote?.id;

  return (
    <View testID="handoff-chips-card" className="gap-3 rounded-lg bg-muted p-3">
      <HandoffPhaseEditor
        phase={editorPhase}
        householdId={householdId}
        localDate={localDate}
        existingChips={existingChips}
        existingNoteId={existingNoteId}
      />

      {role === SETUP_ROLES.PARENT && eveningNote ? (
        <View
          testID="handoff-save-moment-section"
          className="gap-2 border-t border-border pt-3"
        >
          <Body className="text-sm text-muted-foreground">
            Evening recap from your nanny
          </Body>
          <View className="flex-row flex-wrap gap-1">
            {eveningNote.chips.map(chip => (
              <Body key={chip} className="text-sm">
                {t(handoffChipLabelKey(chip), { defaultValue: chip })}
              </Body>
            ))}
          </View>
          <Button
            testID="handoff-save-moment"
            variant={eveningNote.moment_saved_at ? 'outline' : 'default'}
            size="sm"
            onPress={() =>
              updateNote.mutate({
                handoffNoteId: eveningNote.id,
                input: { save_moment: !eveningNote.moment_saved_at },
              })
            }
            disabled={updateNote.isPending}
          >
            <Text>
              {eveningNote.moment_saved_at
                ? 'Saved as moment'
                : 'Save as moment'}
            </Text>
          </Button>
        </View>
      ) : null}
    </View>
  );
}
