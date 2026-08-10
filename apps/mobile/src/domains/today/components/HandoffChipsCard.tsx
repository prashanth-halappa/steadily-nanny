/**
 * @module domains/today/components/HandoffChipsCard
 *
 * Compact daily handoff notes (Wave F / 1i): morning for parent, evening
 * for nanny. Parents can save_moment on evening notes.
 *
 * The `sentAt` timestamp is shown only on the author's own editor (author-scoped
 * via `myNote`) — never on the parent's evening recap block. That recap is
 * somebody else's note by definition; adding a send time there would quietly
 * build a punctuality record out of the nanny's admin.
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
import { Card } from '@/src/components/ui/card';
import { Input } from '@/src/components/ui/input';
import { Text } from '@/src/components/ui/text';
import {
  Caption,
  H4,
  MetadataLabel,
  Small,
} from '@/src/components/ui/typography';
import { SETUP_ROLES, type SetupRole } from '@/src/domains/setup/types';
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';
import {
  chipsForPhase,
  handoffChipLabelKey,
} from '@/src/domains/today/constants/handoffChips';
import { useCreateHandoffNote } from '@/src/hooks/mutations/useCreateHandoffNote';
import { useUpdateHandoffNote } from '@/src/hooks/mutations/useUpdateHandoffNote';
import { useHandoffNotes } from '@/src/hooks/queries/useHandoffNotes';
import { timeToMinutes } from '@/src/lib/displayTime';
import { localDateInZone } from '@/src/lib/localDate';
import { utcIsoToWallClockHHMM } from '@/src/lib/wallClock';
import { useAuthStore } from '@/src/store/auth';

/** Household-local "before 10:00" — the auto-expand cutoff (Wave 2-C). */
const AUTO_EXPAND_CUTOFF_MINUTES = 10 * 60;

function isBeforeTenAM(timeZone: string): boolean {
  const nowHHMM = utcIsoToWallClockHHMM(new Date().toISOString(), timeZone);
  return timeToMinutes(nowHHMM) < AUTO_EXPAND_CUTOFF_MINUTES;
}

function titleForPhase(
  phase: HandoffPhase,
  t: (key: string) => string
): string {
  return phase === HANDOFF_PHASES.MORNING
    ? t('handoff.morningTitle')
    : t('handoff.eveningTitle');
}

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
        'rounded-chip px-3 py-1.5',
        selected ? 'bg-primary' : 'bg-secondary'
      )}
    >
      <Caption
        weight="medium"
        className={selected ? 'text-primary-foreground' : 'text-foreground'}
      >
        {label}
      </Caption>
    </Pressable>
  );
}

function HandoffPhaseEditor({
  phase,
  householdId,
  localDate,
  timeZone,
  existingChips,
  existingNoteId,
  existingBody,
  sentAt,
}: {
  phase: HandoffPhase;
  householdId: string;
  localDate: string;
  timeZone: string;
  existingChips: string[];
  existingNoteId?: string;
  existingBody?: string | null;
  sentAt?: string | null;
}) {
  const { t } = useTranslation('today');
  const suggestions = chipsForPhase(phase);
  const [selected, setSelected] = useState<string[]>(existingChips);
  const [body, setBody] = useState(existingBody ?? '');
  const createNote = useCreateHandoffNote(householdId, localDate);
  const updateNote = useUpdateHandoffNote(householdId, localDate);

  const hydratedForNoteId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const noteIdentity = existingNoteId ?? null;
    if (hydratedForNoteId.current === noteIdentity) return;
    hydratedForNoteId.current = noteIdentity;
    setSelected(existingChips);
    setBody(existingBody ?? '');
  }, [existingNoteId, existingChips, existingBody]);

  const toggleChip = (chip: string) => {
    setSelected(prev =>
      prev.includes(chip) ? prev.filter(c => c !== chip) : [...prev, chip]
    );
  };

  const canSave = selected.length > 0 || body.trim().length > 0;

  const handleSubmit = () => {
    const trimmed = body.trim();
    const payload = {
      chips: selected,
      body: trimmed.length > 0 ? trimmed : null,
    };
    if (existingNoteId) {
      updateNote.mutate({
        handoffNoteId: existingNoteId,
        input: payload,
      });
      return;
    }
    createNote.mutate({
      local_date: localDate,
      phase,
      chips: selected,
      ...(trimmed.length > 0 ? { body: trimmed } : {}),
    });
  };

  const isPending = createNote.isPending || updateNote.isPending;

  const title = titleForPhase(phase, t);

  const sentLabel = sentAt
    ? t('handoff.sentAt', {
        time: formatClockTime(sentAt, timeZone),
      })
    : null;

  return (
    <View testID={`handoff-editor-${phase}`} className="gap-2">
      <H4>{title}</H4>
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
      <Input
        testID={`handoff-body-${phase}`}
        accessibilityLabel={t('handoff.anythingElse')}
        value={body}
        onChangeText={setBody}
        placeholder={t('handoff.anythingElse')}
      />
      {sentLabel ? (
        <Small
          testID={`handoff-sent-${phase}`}
          className="text-muted-foreground"
        >
          {sentLabel}
        </Small>
      ) : null}
      {canSave ? (
        <Button
          testID={`handoff-submit-${phase}`}
          size="sm"
          onPress={handleSubmit}
          disabled={isPending}
        >
          <Text>{t('common:save')}</Text>
        </Button>
      ) : (
        <Small
          testID={`handoff-hint-${phase}`}
          className="text-muted-foreground"
        >
          {phase === HANDOFF_PHASES.MORNING
            ? t('handoff.tapHintParentEditor')
            : t('handoff.tapHintNannyEditor')}
        </Small>
      )}
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
  // `null` = no manual override yet, so `expanded` below tracks the derived
  // auto-expand condition; once she taps "Add a note" it wins outright.
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);

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
  // definition somebody else's note (their nanny's evening handoff). Scoped to
  // today's household-local date so yesterday's recap is gone by morning.
  const eveningNote = useMemo(
    () =>
      (notesQuery.data ?? []).find(
        n => n.phase === HANDOFF_PHASES.EVENING && n.local_date === localDate
      ),
    [notesQuery.data, localDate]
  );

  if (!editorPhase) return null;

  const showMorningBlock =
    role === SETUP_ROLES.PARENT ? !myNote && !eveningNote : true;
  const showEveningRecap = role === SETUP_ROLES.PARENT && eveningNote != null;

  if (!showMorningBlock && !showEveningRecap) return null;

  const existingChips = myNote?.chips ?? [];
  const existingNoteId = myNote?.id;

  // Collapsed by default (~96pt): auto-expands only for the parent's MORNING
  // editor while there is genuinely something to do before the household's
  // morning gets away from it — nothing sent yet AND still before 10:00
  // household-local. The nanny's EVENING editor never auto-expands (that day
  // hasn't happened yet). Once she taps "Add a note" the manual override wins
  // regardless of either condition.
  const shouldAutoExpand =
    !notesQuery.isLoading &&
    !myNote &&
    editorPhase === HANDOFF_PHASES.MORNING &&
    isBeforeTenAM(timeZone);
  const expanded = manualExpanded ?? shouldAutoExpand;

  const summaryChips = existingChips.map(chip =>
    t(handoffChipLabelKey(chip), { defaultValue: chip })
  );
  const summaryLine =
    summaryChips.length > 0
      ? summaryChips.join(' · ')
      : (myNote?.body ??
        (editorPhase === HANDOFF_PHASES.MORNING
          ? t('handoff.tapHintParentEditor')
          : t('handoff.tapHintNannyEditor')));

  return (
    <Card testID="handoff-chips-card" className="gap-3 p-5.5">
      {showEveningRecap ? (
        <View testID="handoff-save-moment-section" className="gap-2">
          <MetadataLabel className="text-muted-foreground">
            {t('handoff.eveningRecap')}
          </MetadataLabel>
          <View className="flex-row flex-wrap gap-1">
            {eveningNote.chips.map(chip => (
              <Small key={chip}>
                {t(handoffChipLabelKey(chip), { defaultValue: chip })}
              </Small>
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
                ? t('handoff.savedAsMoment')
                : t('handoff.saveAsMoment')}
            </Text>
          </Button>
        </View>
      ) : null}

      {showMorningBlock ? (
        expanded ? (
          <HandoffPhaseEditor
            phase={editorPhase}
            householdId={householdId}
            localDate={localDate}
            timeZone={timeZone}
            existingChips={existingChips}
            existingNoteId={existingNoteId}
            existingBody={myNote?.body}
            sentAt={myNote?.created_at}
          />
        ) : (
          <View testID="handoff-collapsed" className="gap-1">
            <H4>{titleForPhase(editorPhase, t)}</H4>
            <Small
              testID="handoff-collapsed-summary"
              className="text-muted-foreground"
              numberOfLines={1}
            >
              {summaryLine}
            </Small>
            <Button
              testID="handoff-add-note"
              variant="ghost"
              size="sm"
              className="self-start px-0"
              onPress={() => setManualExpanded(true)}
            >
              <Text className="text-primary">{t('handoff.addNote')}</Text>
            </Button>
          </View>
        )
      ) : null}
    </Card>
  );
}
