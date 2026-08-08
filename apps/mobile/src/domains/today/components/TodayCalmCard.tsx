/**
 * @module domains/today/components/TodayCalmCard
 *
 * "Parent at ease" (Wave 2-G, plan's Emotional register): when the inbox is
 * empty, nothing is live, AND someone is covering today, this is the one
 * reassurance on the screen — a T3 `tone="positive"` card, no action, no
 * chevron. Today that reassurance was grey text in a white card, as if it
 * were an error.
 *
 * Derived entirely from data the screen already fetches: `useInboxItems`
 * (already the source `NeedsAttentionCard` reads) and `useTodayCoverRows`
 * (the same cached queries `NannyLiveStatusCard` reads — see that hook's
 * module doc). No new query.
 *
 * "Cover today" means an ONGOING obligation — a carer who hasn't clocked in
 * yet but will (`arriving`/`scheduled`), not one whose day already ended
 * (`finished`): the calm state is about what's still true for the rest of
 * today, not a completed record.
 *
 * Naming "which children": `Shift` carries no child association (no
 * `child_ids` field on the schema), so this card cannot honestly scope to
 * specific children the way the plan's example copy does ("...with Ada and
 * Rosie..."). It names the carer and the window instead of inventing a
 * child list — the calmest version that's still true.
 */
import { useTranslation } from 'react-i18next';
import { Card } from '@/src/components/ui/card';
import { Body, H4 } from '@/src/components/ui/typography';
import { useInboxItems } from '@/src/domains/inbox/hooks/useInboxItems';
import { useTodayCoverRows } from '../hooks/useTodayCoverRows';

interface TodayCalmCardProps {
  householdId: string;
  timeZone: string;
  /** Whether anyone is currently on the clock in this household — computed
   * once by `TodayScreen` via `useHouseholdIsLive` and passed down rather
   * than re-queried here. */
  isLive: boolean;
}

export function TodayCalmCard({
  householdId,
  timeZone,
  isLive,
}: TodayCalmCardProps) {
  const { t } = useTranslation('today');
  const inbox = useInboxItems();
  const cover = useTodayCoverRows(householdId, timeZone);

  const inboxEmpty = !inbox.isLoading && inbox.items.length === 0;
  // Arriving is sooner than scheduled — `rows` is already sorted that way
  // (live -> finished -> arriving -> scheduled), so the first non-finished,
  // non-live row is the soonest still-ongoing obligation.
  const coverRow = cover.rows.find(
    row => row.kind === 'arriving' || row.kind === 'scheduled'
  );
  const calm = inboxEmpty && !isLive && !cover.isLoading && Boolean(coverRow);

  if (!calm || !coverRow) return null;

  return (
    <Card testID="today-calm-card" tone="positive" className="gap-1 p-5.5">
      <H4>{t('calm.title')}</H4>
      <Body>
        {t('calm.body', { name: coverRow.name, detail: coverRow.detail })}
      </Body>
    </Card>
  );
}
