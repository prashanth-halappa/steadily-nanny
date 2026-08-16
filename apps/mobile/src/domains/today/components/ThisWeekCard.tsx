/**
 * @module domains/today/components/ThisWeekCard
 *
 * #9's merge, as a COMPOSITION rather than a rewrite: `NannyWeekLine`,
 * `AddMissedHoursCard` and `ThisWeeksShiftsCard` were three separate routine
 * cards competing for the same band of the feed. They keep their own files,
 * their own props and their own tests — this block only labels them and
 * decides which of them a given viewer sees.
 *
 * The eyebrow is the route out: her week is her pay (Hours), his is the
 * plan (Schedule). `ThisWeeksShiftsCard` stays in the schedule domain and is
 * imported from its barrel — a card about shifts belongs to shifts.
 *
 * The two nanny-only children are dropped for a past member for the same
 * reason `ClockInCard` is: every write on a household she was removed from is
 * refused server-side, so the affordance would only ever fail.
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { MetadataLabel } from '@/src/components/ui/typography';
import { ThisWeeksShiftsCard } from '@/src/domains/schedule';
import { SETUP_ROLES, type SetupRole } from '@/src/domains/setup/types';
import { AddMissedHoursCard } from './AddMissedHoursCard';
import { NannyWeekLine } from './NannyWeekLine';

interface ThisWeekCardProps {
  householdId: string;
  /** Household IANA zone — never the device's (GOLDEN-FIXES #21). */
  timeZone: string;
  weekStartsOn: number;
  role: SetupRole | null;
  isPastMember: boolean;
}

export function ThisWeekCard({
  householdId,
  timeZone,
  weekStartsOn,
  role,
  isPastMember,
}: ThisWeekCardProps) {
  const { t } = useTranslation('today');
  const router = useRouter();
  const activeNanny = role === SETUP_ROLES.NANNY && !isPastMember;
  const href = (
    role === SETUP_ROLES.NANNY
      ? '/(private)/(tabs)/hours'
      : '/(private)/(tabs)/schedule'
  ) as Href;

  return (
    <View testID="today-this-week-card" className="gap-3">
      <Pressable
        testID="today-this-week-eyebrow"
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => router.push(href)}
      >
        <MetadataLabel testID="today-this-week-eyebrow-label">
          {t('thisWeek.title')}
        </MetadataLabel>
      </Pressable>

      {activeNanny ? (
        <NannyWeekLine
          householdId={householdId}
          timeZone={timeZone}
          weekStartsOn={weekStartsOn}
        />
      ) : null}

      {activeNanny ? (
        <AddMissedHoursCard
          householdId={householdId}
          timeZone={timeZone}
          weekStartsOn={weekStartsOn}
        />
      ) : null}

      <ThisWeeksShiftsCard />
    </View>
  );
}
