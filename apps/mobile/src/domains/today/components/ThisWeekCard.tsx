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
import { useCurrentPayArrangement } from '@/src/hooks/queries/useCurrentPayArrangement';
import { useAuthStore } from '@/src/store/auth';
import { AddMissedHoursCard } from './AddMissedHoursCard';
import { NannyWeekLine } from './NannyWeekLine';

/**
 * How long after terms are agreed the recovery headline stays true. A week:
 * long enough to catch the hours she worked during the block even if she does
 * not open the app for a few days, short enough that "the rate you just
 * agreed" never appears months into a placement.
 */
const NEW_ARRANGEMENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
  // A1's worst case, recovered. The clock-in block has no escape hatch, so
  // she may well have worked hours she could not clock; a brand-new
  // arrangement is exactly the moment those hours become addable, and the
  // only window in which "the rate you just agreed" is a true sentence.
  const myUserId = useAuthStore(s => s.session?.user?.id);
  const arrangement = useCurrentPayArrangement(
    activeNanny ? householdId : null,
    activeNanny ? myUserId : null
  );
  const arrangementCreatedAt = arrangement.data?.created_at;
  const justAgreedTerms =
    !!arrangementCreatedAt &&
    Date.now() - Date.parse(arrangementCreatedAt) < NEW_ARRANGEMENT_MAX_AGE_MS;
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
          // The card itself only renders when there is a missed day to
          // recover, so this never puts a headline above nothing.
          firstRunHeadline={justAgreedTerms}
          // Same query, handed down rather than re-issued: backdated terms
          // are the ONLY way the card can know about days worked under the
          // clock-in block when no pattern (and so no shift) exists.
          arrangementValidFrom={arrangement.data?.valid_from ?? null}
        />
      ) : null}

      <ThisWeeksShiftsCard />
    </View>
  );
}
