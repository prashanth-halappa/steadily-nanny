/**
 * @module domains/today/components/CrossFamilyStrip
 *
 * P5 (A2). Today stays scoped to ONE household, so anything urgent in a
 * nanny's OTHER families is invisible until she switches — and she has no
 * reason to switch unless she already knows. This strip is the exception:
 * a compact line above the (unscoped) scrolling header for the few things that
 * genuinely cannot wait (`utils/crossFamilyAlerts.ts` owns which three
 * facts qualify — everything else survives until she switches).
 *
 * THE RULES ARE THE DESIGN:
 *  - NOT a `Card`. No elevation, no `tone`, and NEVER apricot — apricot
 *    means THIS household's clock is running, and borrowing it here would
 *    make another family's clock look like this one's.
 *  - Exactly ONE VERB, always "Switch" (`setActiveHouseholdId`). It states;
 *    it never asks. Every resolution happens after the switch, on that
 *    household's own Today, where the attention ladder already works.
 *  - One line, one named family, ever. With more than one qualifying
 *    family, "· N more" opens a `BottomSheetBase` listing them — a route,
 *    never a second line and never a count she could feel behind on.
 *  - Renders null when nothing qualifies — the common case, and the whole
 *    point: its value is scarcity.
 *
 * Self-contained, no props — mounted once in `TodayScreen`, above the
 * header and OUTSIDE the ScrollView, so it never scrolls away
 * (`TodayScreen.layout.test.ts` pins the order). Reads the SAME `useMeShifts` window `useInboxItems` already
 * queries (`-7`/`+21` days) so the two share one cache entry rather than
 * doubling the request.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Body, H3, Small } from '@/src/components/ui/typography';
import { useInboxItems } from '@/src/domains/inbox/hooks/useInboxItems';
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useMeShifts } from '@/src/hooks/queries/useMeShifts';
import { useRunningTimeEntry } from '@/src/hooks/queries/useRunningTimeEntry';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { wallClockToUtcIso } from '@/src/lib/wallClock';
import {
  type CrossFamilyAlert,
  type CrossFamilyAlertKind,
  resolveCrossFamilyAlerts,
} from '../utils/crossFamilyAlerts';

const STRIP_STYLE = {
  paddingHorizontal: 16,
  paddingVertical: 8,
} as const;

function lineCopyKey(kind: CrossFamilyAlertKind): string {
  return `crossFamily.line.${kind}`;
}

function sheetReasonKey(kind: CrossFamilyAlertKind): string {
  return `crossFamily.sheetReason.${kind}`;
}

export function CrossFamilyStrip() {
  const { t } = useTranslation('today');
  const {
    householdId: activeHouseholdId,
    households,
    setActiveHouseholdId,
  } = useActiveHousehold();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const activeHousehold = households.find(h => h.id === activeHouseholdId);
  const timeZone = activeHousehold?.timezone ?? 'UTC';
  const today = localDateInZone(timeZone);
  // Same window `useInboxItems` already queries `useMeShifts` with — one
  // shared cache entry, not a second network round-trip.
  const from = wallClockToUtcIso(addLocalDays(today, -7), '00:00', timeZone);
  const to = wallClockToUtcIso(addLocalDays(today, 21), '00:00', timeZone);

  const inbox = useInboxItems();
  const runningEntry = useRunningTimeEntry();
  const meShiftsQuery = useMeShifts(from, to);

  const householdTimeZoneById = new Map(
    households.map(h => [h.id, h.timezone])
  );

  const alerts = resolveCrossFamilyAlerts({
    items: inbox.items,
    runningEntry: runningEntry.data
      ? {
          household_id: runningEntry.data.household_id,
          clock_in_at: runningEntry.data.clock_in_at,
        }
      : null,
    activeHouseholdId,
    households,
    meShifts: meShiftsQuery.data ?? [],
    todayLocalDate: today,
  });

  if (alerts.length === 0) return null;

  const top = alerts[0] as CrossFamilyAlert;
  const moreCount = alerts.length - 1;

  const lineFor = (alert: CrossFamilyAlert): string => {
    if (alert.kind === 'runningClock' && alert.since) {
      return t(lineCopyKey(alert.kind), {
        familyName: alert.familyName,
        time: formatClockTime(
          alert.since,
          householdTimeZoneById.get(alert.householdId) ?? 'UTC'
        ),
      });
    }
    return t(lineCopyKey(alert.kind), { familyName: alert.familyName });
  };

  const sheetReasonFor = (alert: CrossFamilyAlert): string => {
    if (alert.kind === 'runningClock' && alert.since) {
      return t(sheetReasonKey(alert.kind), {
        time: formatClockTime(
          alert.since,
          householdTimeZoneById.get(alert.householdId) ?? 'UTC'
        ),
      });
    }
    return t(sheetReasonKey(alert.kind));
  };

  return (
    <>
      <View testID="cross-family-strip" style={STRIP_STYLE}>
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1 flex-row flex-wrap items-baseline gap-x-1">
            <Small
              testID="cross-family-strip-line"
              className="text-muted-strong"
            >
              {lineFor(top)}
            </Small>
            {moreCount > 0 ? (
              <AnimatedPressable
                testID="cross-family-strip-more"
                accessibilityRole="button"
                onPress={() => setIsSheetOpen(true)}
              >
                <Small className="text-muted-strong">
                  {t('crossFamily.moreSuffix', { count: moreCount })}
                </Small>
              </AnimatedPressable>
            ) : null}
          </View>
          <AnimatedPressable
            testID="cross-family-strip-switch"
            accessibilityRole="button"
            onPress={() => setActiveHouseholdId(top.householdId)}
          >
            <Small className="text-primary">{t('crossFamily.switchCta')}</Small>
          </AnimatedPressable>
        </View>
      </View>

      <BottomSheetBase
        sheetId="cross-family-strip"
        visible={isSheetOpen}
        onDismiss={() => setIsSheetOpen(false)}
        fitContent
        testID="cross-family-strip-sheet"
      >
        <View className="gap-3 px-6 pb-4">
          <H3>{t('crossFamily.sheetTitle')}</H3>
          {alerts.map(alert => (
            <View key={alert.householdId} className="gap-0.5 py-1">
              <Body>{alert.familyName}</Body>
              <Small className="text-muted-foreground">
                {sheetReasonFor(alert)}
              </Small>
            </View>
          ))}
        </View>
      </BottomSheetBase>
    </>
  );
}
