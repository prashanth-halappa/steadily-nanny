/**
 * @module domains/schedule/components/PendingScheduleCard
 *
 * The carer's entry point to the respond flow. Meant to be mounted on the
 * Today screen (by whichever agent owns `TodayScreen.tsx` — this component
 * is exported from `src/domains/schedule` for exactly that purpose and
 * takes no props).
 *
 * Renders NOTHING when there is no `pending` schedule pattern where the
 * signed-in user is the carer — no empty state, no placeholder. It should
 * be invisible on an ordinary day, only appearing when there's genuinely
 * something to respond to.
 *
 * CROSS-HOUSEHOLD (Pattern A's inverse defect — see
 * `docs/CROSS-CUTTING-DEFECT-PATTERNS.md` §A). An earlier version read
 * `useSchedulePatterns(activeHousehold.householdId)` — only the ACTIVE
 * household — so a pending week from her OTHER family never showed here at
 * all: a missed obligation, not a mislabelled one. `useInboxItems()` already
 * fans `pending_pattern` out across EVERY household she belongs to (the
 * same list `NeedsAttentionCard` filters this kind out of, on the stated
 * grounds that this card covers it — now actually true), so sourcing from
 * there is both the fix and fewer queries than a second per-household fetch.
 * One card renders PER pending pattern, named by its own household
 * (`useHouseholdLookup().nameFor`) — never a single card that can only ever
 * speak for one family.
 *
 * The inbox item carries `householdId` + `patternId` + `dtstart`, but not
 * the day/hours breakdown (list responses never include nested days — only
 * the detail route does), so each row still needs its own
 * `useSchedulePattern(patternId)` call for that. Hooks can't run inside a
 * loop, hence `PendingPatternRow` — one subcomponent instance per pending
 * pattern, each free to call its own detail query.
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';
import { Body, H4 } from '@/src/components/ui/typography';
import { useInboxItems } from '@/src/domains/inbox/hooks/useInboxItems';
import type { InboxItem } from '@/src/domains/inbox/utils/buildInboxItems';
import { useHouseholdLookup } from '@/src/hooks/queries/useHouseholdById';
import { useSchedulePattern } from '@/src/hooks/queries/useSchedulePattern';
import { calculateWeekTotalHours } from '../utils';

type PendingPatternItem = Extract<InboxItem, { kind: 'pending_pattern' }>;

function PendingPatternRow({
  item,
  familyName,
}: {
  item: PendingPatternItem;
  familyName: string | null;
}) {
  const { t } = useTranslation('schedule');
  const router = useRouter();
  const detail = useSchedulePattern(item.patternId);

  // Invisible until we have the day detail too — never a placeholder or a
  // momentary "0 days".
  if (detail.isLoading || !detail.data) {
    return null;
  }

  const days = detail.data.days;
  const totalHours = calculateWeekTotalHours(days);
  // days are BLOCKS now, not days. We must report DISTINCT weekday count.
  const distinctDaysCount = new Set(days.map(d => d.weekday)).size;

  return (
    <Card
      testID={`today-pending-schedule-card-${item.patternId}`}
      className="gap-2 p-5.5"
    >
      <H4>
        {familyName
          ? t('todayCard.pendingTitleNamed', { family: familyName })
          : t('todayCard.pendingTitle')}
      </H4>
      <Body className="text-muted-foreground" tabular>
        {t('todayCard.pendingBody', {
          count: distinctDaysCount,
          hours: totalHours,
        })}
      </Body>
      <Button
        testID={`today-pending-schedule-cta-${item.patternId}`}
        onPress={() =>
          router.push(`/(private)/schedule/respond/${item.patternId}` as Href)
        }
      >
        <Text className="text-primary-foreground font-medium">
          {t('todayCard.pendingCta')}
        </Text>
      </Button>
    </Card>
  );
}

export function PendingScheduleCard() {
  const { items } = useInboxItems();
  const { nameFor } = useHouseholdLookup();

  // buildInboxItems already gates this to `status: 'pending' && carer_id ===
  // me` (§2.2) — no separate userId check needed here.
  const pendingPatterns = items.filter(
    (item): item is PendingPatternItem => item.kind === 'pending_pattern'
  );

  if (pendingPatterns.length === 0) {
    return null;
  }

  return (
    <>
      {pendingPatterns.map(item => (
        <PendingPatternRow
          key={item.patternId}
          item={item}
          familyName={nameFor(item.householdId)}
        />
      ))}
    </>
  );
}
