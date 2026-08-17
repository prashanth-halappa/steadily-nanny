/**
 * @module domains/timesheet/components/WeekQueryThread
 *
 * The week thread (`docs/design/attention-and-notifications.md` §3, D-18 /
 * D-19 / D-46). `WeekTotal` states what state the agreement is in; this card
 * says what was SAID about it. Mounted by both `NannyWeekView` and
 * `ParentWeekView` directly under `WeekTotal` — `WeekTotal` does not grow a
 * sixteenth band, and the parent-only promoted `query_note` band it used to
 * carry is gone: that guard was the literal code that made P1 true.
 *
 * Presentational, exactly like `WeekTotal` — it owns no query, no mutation
 * and no sheet. The week views fetch the thread, own the send, and hand back
 * `sendError`. That is also what keeps it renderable under
 * `@testing-library/react-native`, unlike the views themselves.
 *
 * The rules that are NOT negotiable here:
 *
 * - **Nothing renders when the thread is empty (D16).** No header, no empty
 *   state, no "no messages yet". On the ~50 clean weeks a year the Hours
 *   screen looks exactly as it did — same invisible-when-idle discipline as
 *   `NeedsAttentionCard`. The entry point for a nanny with nothing to
 *   dispute is §3.1's text link on the week, not a card announcing its own
 *   absence.
 * - **Both sides always see every message.** There is no viewer branch over
 *   the message list, and there must never be one.
 * - **Authors are named, not roled** — "The Ahmeds", "You", "Priya", never
 *   "Parent"/"Carer". The names come snapshotted on the wire; the only word
 *   this component chooses is "You", for the reader's own messages.
 * - **Timestamps are the record.** Every message carries date + time in the
 *   HOUSEHOLD zone (Marisol's "schedule-change timestamps as evidence", on
 *   money).
 * - **Never a badge, never an unread dot** (daylight-v2 §6.6).
 * - A refusal is stated INLINE under the composer. This card can sit under
 *   an open BottomSheetBase, where a toast is not visible on iOS at all
 *   (GOLDEN-FIXES #40).
 */
import type {
  TimesheetStatus,
  TimesheetThreadMessage,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { MessageCircle } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { IconChip } from '@/src/components/ui/icon-chip';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, H4, MetadataLabel, Small } from '@/src/components/ui/typography';
import { localDateInZone } from '@/src/lib/localDate';
import { formatClockTime } from '../utils/duration';
import { formatEarningsSpanDate } from '../utils/earningsFormat';
import type { EarningsRole } from './WeekEarningsLine';

interface WeekQueryThreadProps {
  testID?: string;
  /** Oldest first — the order is the record. */
  messages: readonly TimesheetThreadMessage[];
  /** Whose messages read "You". Null while the session is still resolving,
   * which simply means every message is named. */
  currentUserId: string | null;
  /** Household IANA zone — every timestamp is stated in it, never the
   * device's (GOLDEN-FIXES #21 bug class). */
  timeZone: string;
  /** `undefined` while the timesheet read is pending or has failed — kept
   * distinct from `null` ("settled: genuinely not submitted") so callers
   * never have to pre-coerce an unknown status
   * (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B). */
  timesheetStatus: TimesheetStatus | null | undefined;
  /** Who is looking — the composer fork ONLY; never the message list. */
  viewerRole: EarningsRole;
  /** §3.1: she opened a thread on an approved week, so the composer comes
   * back for the conversation that resulted. An approved week whose
   * arithmetic is wrong is the one Marisol has actually lived through. */
  composerReopened?: boolean;
  onSend: (message: string) => void;
  isSending?: boolean;
  /** The last send's refusal, rendered inline — never toasted. */
  sendError?: string | null;
}

/**
 * "Wed 12 Aug, 18:04" — the household zone's calendar day and clock time.
 * Composed from the two existing formatters rather than a third date helper;
 * the ` · ` join is this app's standing convention for a metadata line.
 */
function formatMessageAt(createdAtISO: string, timeZone: string): string {
  const instant = new Date(createdAtISO);
  const day = formatEarningsSpanDate(localDateInZone(timeZone, instant));
  return `${day}, ${formatClockTime(createdAtISO, timeZone)}`;
}

/**
 * Whenever either side may still speak (§3): while the week is `queried`,
 * both sides; on a `submitted` week, the nanny (§3.1's link is what opens
 * it). An `approved` week is history, not a chat — until she opens one
 * herself, which is the whole point of §3.1's last paragraph.
 */
function showComposerFor(
  status: TimesheetStatus | null | undefined,
  role: EarningsRole,
  composerReopened: boolean
): boolean {
  if (composerReopened) return true;
  if (status === 'queried') return true;
  return status === 'submitted' && role === 'nanny';
}

export function WeekQueryThread({
  testID = 'hours-week-thread',
  messages,
  currentUserId,
  timeZone,
  timesheetStatus,
  viewerRole,
  composerReopened = false,
  onSend,
  isSending = false,
  sendError = null,
}: WeekQueryThreadProps) {
  const { t } = useTranslation('hours');
  const [draft, setDraft] = useState('');

  const showComposer = showComposerFor(
    timesheetStatus,
    viewerRole,
    composerReopened
  );

  // D16 — the whole card, header included, is absent on a clean week.
  if (messages.length === 0) return null;

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed || isSending) return;
    onSend(trimmed);
    setDraft('');
  };

  return (
    <Card testID={testID} className="mb-4">
      <CardContent className="gap-4">
        <View className="flex-row items-center gap-3">
          <IconChip tone="hours" icon={MessageCircle} />
          <H4 className="flex-1">{t('thread.title')}</H4>
        </View>

        {messages.map(message => (
          <View key={message.id} className="gap-1">
            <MetadataLabel
              testID={`${testID}-message-${message.id}-meta`}
              className="text-muted-foreground"
            >
              {`${
                currentUserId && message.author_id === currentUserId
                  ? t('thread.you')
                  : message.author_name
              } · ${formatMessageAt(message.created_at, timeZone)}`}
            </MetadataLabel>
            {/* `query_withdrawn` carries no text on the wire — the sentence
                is rendered in the READER's language, never the writer's. */}
            <Body testID={`${testID}-message-${message.id}-body`}>
              {message.kind === 'query_withdrawn'
                ? t('thread.queryWithdrawn', { author: message.author_name })
                : message.body}
            </Body>
          </View>
        ))}

        {showComposer ? (
          <View className="gap-2">
            <Textarea
              testID={`${testID}-composer`}
              accessibilityLabel={t('thread.composerPlaceholder')}
              value={draft}
              onChangeText={setDraft}
              placeholder={t('thread.composerPlaceholder')}
            />
            {sendError ? (
              <Small testID={`${testID}-error`} className="text-destructive">
                {sendError}
              </Small>
            ) : null}
            <Button
              testID={`${testID}-send`}
              disabled={!draft.trim() || isSending}
              onPress={handleSend}
            >
              <Text>{t('thread.send')}</Text>
            </Button>
            {/* "A thread that lets her argue but not correct the record is
                P1 with extra steps" — the day rows stay editable while the
                week is queried, and the card says so. */}
            {timesheetStatus === 'queried' ? (
              <MetadataLabel
                testID={`${testID}-still-editable`}
                className="text-muted-foreground"
              >
                {t('thread.stillEditable')}
              </MetadataLabel>
            ) : null}
          </View>
        ) : null}
      </CardContent>
    </Card>
  );
}

export type { WeekQueryThreadProps };
