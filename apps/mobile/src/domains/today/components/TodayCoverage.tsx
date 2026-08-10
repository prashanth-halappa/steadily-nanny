/**
 * @module domains/today/components/TodayCoverage
 *
 * One parent coverage surface — need-centric headline, shift-centric plan lines
 * below. T4 on the bare ground except gap (`attention`) and live (`live`) cards.
 */
import type { Child } from '@steadily-nanny/shared-types/schemas/child.schema';
import { type Href, useRouter } from 'expo-router';
import { AlertCircle } from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { IconChip } from '@/src/components/ui/icon-chip';
import { LiveDot } from '@/src/components/ui/live-dot';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Body, H3, H4, Small } from '@/src/components/ui/typography';
import { useHouseholdCarers } from '@/src/domains/schedule/hooks/useHouseholdCarers';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import {
  describeUncoveredCause,
  inferUncoveredCauseDetail,
} from '@/src/domains/schedule/utils/uncoveredDisplay';
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';
import { useCreateParentCover } from '@/src/hooks/mutations/useCreateParentCover';
import { useDayThread } from '@/src/hooks/queries/useDayThread';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useShiftsRange } from '@/src/hooks/queries/useShiftsRange';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { utcIsoToWallClockHHMM, wallClockToUtcIso } from '@/src/lib/wallClock';
import { type PlanLine, useTodayCoverage } from '../hooks/useTodayCoverage';

interface TodayCoverageProps {
  householdId: string;
  timeZone: string;
  householdChildren: readonly Child[];
  demoted?: boolean;
}

function childName(childId: string, children: readonly Child[]): string {
  return children.find(c => c.id === childId)?.name ?? '';
}

function carerFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function PlanLineView({
  line,
  timeZone,
}: {
  line: PlanLine;
  timeZone: string;
}) {
  const { t } = useTranslation('today');
  const testId = line.shiftId
    ? `today-coverage-plan-${line.shiftId}`
    : `today-coverage-plan-${line.key}`;

  if (line.kind === 'live' && line.startsAt) {
    return (
      <Card tone="live" className="gap-2 p-5.5">
        <View className="flex-row items-center gap-2">
          <LiveDot testID={`${testId}-dot`} />
          <Body testID={testId}>
            {t('coverage.plan.here', {
              time: formatClockTime(line.liveSince ?? line.startsAt, timeZone),
            })}
          </Body>
        </View>
      </Card>
    );
  }

  if (line.kind === 'parentCover' && line.startsAt && line.endsAt) {
    return (
      <Body testID={testId} className="text-sm text-muted-foreground">
        {t('coverage.plan.youCovering', {
          start: formatClockTime(line.startsAt, timeZone),
          end: formatClockTime(line.endsAt, timeZone),
        })}
      </Body>
    );
  }

  if (line.kind === 'finished') {
    return (
      <Body testID={testId} className="text-sm text-muted-foreground">
        {line.leftAt && line.durationLabel
          ? t('coverage.plan.left', {
              name: line.name,
              time: formatClockTime(line.leftAt, timeZone),
              duration: line.durationLabel,
            })
          : line.detail}
      </Body>
    );
  }

  if (line.kind === 'arriving' && line.arrivingMinutes != null) {
    return (
      <Body testID={testId} className="text-sm text-muted-foreground">
        {t('coverage.plan.arrivingIn', { count: line.arrivingMinutes })}
      </Body>
    );
  }

  if (line.kind === 'booked' && line.startsAt && line.endsAt) {
    return (
      <View testID={testId} className="flex-row flex-wrap items-center gap-2">
        <Body className="text-sm">
          {t('coverage.plan.booked', {
            name: line.name,
            start: formatClockTime(line.startsAt, timeZone),
            end: formatClockTime(line.endsAt, timeZone),
          })}
        </Body>
        {line.confirmation ? (
          <StatusPill
            variant={
              line.confirmation === 'confirmed' ? 'confirmed' : 'pending'
            }
            label={
              line.confirmation === 'confirmed'
                ? t('coverage.status.confirmed')
                : t('coverage.status.waiting')
            }
          />
        ) : null}
      </View>
    );
  }

  return (
    <Body testID={testId} className="text-sm text-muted-foreground">
      {line.detail}
    </Body>
  );
}

export function TodayCoverage({
  householdId,
  timeZone,
  householdChildren,
  demoted = false,
}: TodayCoverageProps) {
  const { t } = useTranslation('today');
  const { t: tSchedule } = useTranslation('schedule');
  const router = useRouter();
  const state = useTodayCoverage(householdId, timeZone);
  const carersQuery = useHouseholdCarers(householdId);
  const membersQuery = useHouseholdMembers(householdId);
  const createCover = useCreateParentCover();

  const localDate = localDateInZone(timeZone);
  const tomorrow = addLocalDays(localDate, 1);
  const from = wallClockToUtcIso(localDate, '00:00', timeZone);
  const to = wallClockToUtcIso(tomorrow, '00:00', timeZone);
  const shiftsQuery = useShiftsRange(householdId, from, to);
  const dayThread = useDayThread(householdId, localDate);

  const runningLateLines = useMemo(() => {
    const events = dayThread.data ?? [];
    const shifts = shiftsQuery.data ?? [];
    const members = membersQuery.data ?? [];
    return events
      .filter(
        event => event.event_type === 'running_late' && event.shift_id != null
      )
      .map(event => {
        const shift = shifts.find(s => s.id === event.shift_id);
        const member = members.find(m => m.user_id === shift?.carer_id);
        const name = carerFirstName(
          resolveCarerName(member, t('carerFallback'))
        );
        return { shiftId: event.shift_id as string, name };
      });
  }, [dayThread.data, shiftsQuery.data, membersQuery.data, t]);

  if (state.status === 'loading') {
    return null;
  }

  if (state.status === 'setup') {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/settings/children' as Href)}
      >
        <Card testID="today-coverage" className="gap-1 p-5.5">
          <Body weight="medium">{t('cover.setup.title')}</Body>
          <Body className="text-sm text-muted-foreground">
            {t('cover.setup.body')}
          </Body>
        </Card>
      </Pressable>
    );
  }

  if (state.status === 'noNeedToday') {
    const weekday = tSchedule(`weekday.${state.weekday}`);
    return (
      <View testID="today-coverage" className="gap-1">
        <Body weight="medium">{t('cover.noNeed.title')}</Body>
        <Body className="text-sm text-muted-foreground">
          {t('cover.noNeed.body', { weekday })}
        </Body>
      </View>
    );
  }

  const planLines = (
    <View className="gap-2">
      {state.plan.map(line => (
        <PlanLineView key={line.key} line={line} timeZone={timeZone} />
      ))}
      {runningLateLines.map(line => (
        <Body
          key={`running-late-${line.shiftId}`}
          testID={`today-coverage-running-late-${line.shiftId}`}
          className="text-sm text-muted-foreground"
        >
          {t('coverage.plan.runningLate', { name: line.name })}
        </Body>
      ))}
    </View>
  );

  if (state.status === 'booked') {
    return (
      <View testID="today-coverage" className="gap-2">
        {planLines}
      </View>
    );
  }

  const windows = state.windows;
  const singleWindow = windows.length === 1 ? windows[0] : undefined;
  const visible = windows.length >= 4 ? windows.slice(0, 2) : windows;
  const hiddenCount = windows.length - visible.length;
  const carers = carersQuery.data ?? [];
  const singleCarer = carers.length === 1 ? carers[0] : null;
  // Empty fallback ON PURPOSE. Always through the resolver — reading the raw
  // name columns here would ignore a carer's display-name override and call
  // her one name in this button and another on every other surface — but a
  // carer with no name at all must resolve to '' so the CTA falls through to
  // the generic "Ask a nanny to cover" copy. A phrase fallback ('Carer',
  // 'A nanny') gets chopped by the first-name split into "Ask Carer" / "Ask A".
  const singleCarerFirstName = singleCarer
    ? carerFirstName(resolveCarerName(singleCarer, ''))
    : '';

  const gapHeadline =
    windows.length === 1 && singleWindow
      ? t('coverage.gap.titleOne', {
          childName: childName(singleWindow.childId, householdChildren),
          start: formatClockTime(singleWindow.startsAt, timeZone),
          end: formatClockTime(singleWindow.endsAt, timeZone),
        })
      : t('coverage.gap.titleMany', { count: windows.length });

  const extraHref = (() => {
    if (!singleWindow) return null;
    const start = utcIsoToWallClockHHMM(singleWindow.startsAt, timeZone);
    const end = utcIsoToWallClockHHMM(singleWindow.endsAt, timeZone);
    const params = new URLSearchParams({
      date: state.localDate,
      start,
      end,
      childId: singleWindow.childId,
    });
    if (singleCarer?.user_id) {
      params.set('carerId', singleCarer.user_id);
    }
    return `/(private)/schedule/shifts/extra?${params.toString()}` as Href;
  })();

  // Rule M (daylight-v2 §2.3): on the ochre `surfaceAttention` ground
  // `mutedForeground` measures 4.28:1 and fails AA at these sizes. Demoted the
  // card is plain white, where `mutedForeground` is fine and correct.
  const detailMutedClass = demoted
    ? 'text-muted-foreground'
    : 'text-muted-strong';

  return (
    <View testID="today-coverage" className="gap-3">
      <Card
        testID="today-coverage-gap-card"
        tone={demoted ? 'default' : 'attention'}
        className="gap-3 p-5.5"
      >
        {/* The single largest fix in the v2 audit: this sentence — a child is
            not covered right now — used to be 16/24/500, smaller than the
            handoff card's title below it. At L1 it is an H3; demoted it drops
            a whole rung to H4 on a plain white card, and the chip drops out of
            the brand register with it (daylight-v2 §2.4: an attention ground
            already carries the message, so its chip is never a category hue —
            and a card that is NOT the one thing to do never wears plum). */}
        <View className="flex-row items-center gap-3">
          <IconChip
            testID="today-coverage-gap-chip"
            tone={demoted ? 'schedule' : 'brand'}
            icon={AlertCircle}
          />
          {demoted ? (
            <H4 testID="today-coverage-gap-headline" className="flex-1">
              {gapHeadline}
            </H4>
          ) : (
            <H3 testID="today-coverage-gap-headline" className="flex-1">
              {gapHeadline}
            </H3>
          )}
        </View>

        {visible.map(window => {
          const causeDetail = inferUncoveredCauseDetail(
            window,
            shiftsQuery.data ?? []
          );
          const carerName = causeDetail.shift
            ? resolveCarerName(
                membersQuery.data?.find(
                  m => m.user_id === causeDetail.shift?.carer_id
                ),
                t('today:carerFallback')
              )
            : null;
          const causeLine = describeUncoveredCause({
            cause: causeDetail.cause,
            shift: causeDetail.shift,
            carerName,
            timeZone,
            t: tSchedule,
          });
          return (
            <Small
              key={`${window.childId}|${window.commitmentId}|${window.startsAt}`}
              className={detailMutedClass}
            >
              {causeLine}
            </Small>
          );
        })}

        {hiddenCount > 0 ? (
          <Small className={detailMutedClass}>
            {t('coverage.gap.andMore', { count: hiddenCount })}
          </Small>
        ) : null}

        {singleWindow && extraHref ? (
          <View className="gap-2">
            {/* L1's action is a full-width filled button at `lg` (56pt); the
                demoted rung gets a ghost link instead, because a card that
                lost arbitration must not out-shout the one that won it. */}
            <Button
              testID="today-coverage-ask-cover"
              size={demoted ? 'sm' : 'lg'}
              variant={demoted ? 'ghost' : 'default'}
              className={demoted ? 'self-start px-0' : 'w-full'}
              onPress={() => router.push(extraHref)}
            >
              {singleCarerFirstName
                ? tSchedule('cover.askToCover', {
                    carerName: singleCarerFirstName,
                    start: formatClockTime(singleWindow.startsAt, timeZone),
                  })
                : tSchedule('cover.askSomeoneToCover', {
                    start: formatClockTime(singleWindow.startsAt, timeZone),
                    end: formatClockTime(singleWindow.endsAt, timeZone),
                  })}
            </Button>
            <Button
              testID="today-coverage-parent-cover"
              size="sm"
              variant="secondary"
              disabled={createCover.isPending}
              onPress={() => {
                void createCover.mutateAsync({
                  householdId,
                  starts_at: singleWindow.startsAt,
                  ends_at: singleWindow.endsAt,
                  child_id: singleWindow.childId,
                });
              }}
            >
              {tSchedule('cover.iveGotIt')}
            </Button>
            <Pressable
              testID="today-coverage-hours-wrong"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => router.push('/settings/children' as Href)}
            >
              <Small className="text-primary" weight="medium">
                {tSchedule('cover.hoursWrong')}
              </Small>
            </Pressable>
          </View>
        ) : null}
      </Card>

      {planLines}
    </View>
  );
}
