/**
 * @module domains/today/components/TodayCoverage
 *
 * One parent coverage surface — need-centric headline, shift-centric plan lines
 * below. T4 on the bare ground except gap (`attention`) and live (`live`) cards.
 */
import type { Child } from '@steadily-nanny/shared-types/schemas/child.schema';
import { type Href, useRouter } from 'expo-router';
import { AlertCircle } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { RestrictedActionButton } from '@/src/components/custom/RestrictedActionButton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/src/components/ui/alert-dialog';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { IconChip } from '@/src/components/ui/icon-chip';
import { InlineError } from '@/src/components/ui/inline-error';
import { LiveDot } from '@/src/components/ui/live-dot';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Body, H3, H4, Small } from '@/src/components/ui/typography';
import { useHouseholdCarers } from '@/src/domains/schedule/hooks/useHouseholdCarers';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { localDateToWeekday } from '@/src/domains/schedule/utils/shiftGrouping';
import {
  describeAskCause,
  describeUncoveredCause,
  inferAskState,
  inferUncoveredCauseDetail,
} from '@/src/domains/schedule/utils/uncoveredDisplay';
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';
import { useCreateParentCover } from '@/src/hooks/mutations/useCreateParentCover';
import { useWithdrawCoverAsk } from '@/src/hooks/mutations/useWithdrawCoverAsk';
import { useDayThread } from '@/src/hooks/queries/useDayThread';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useRestrictedAction } from '@/src/hooks/queries/useRestrictedAction';
import { useShiftsRange } from '@/src/hooks/queries/useShiftsRange';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { utcIsoToWallClockHHMM, wallClockToUtcIso } from '@/src/lib/wallClock';
import {
  gapEscalationHours,
  type PlanLine,
  useTodayCoverage,
} from '../hooks/useTodayCoverage';

interface TodayCoverageProps {
  householdId: string;
  timeZone: string;
  /** Household `week_starts_on` — threaded through to `useTodayCoverage`'s
   * week-entries query so it reads the household's own business week. */
  weekStartsOn: number;
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
  weekStartsOn,
  householdChildren,
  demoted = false,
}: TodayCoverageProps) {
  const { t } = useTranslation('today');
  const { t: tSchedule } = useTranslation('schedule');
  const { t: tError } = useTranslation('errors');
  const router = useRouter();
  const state = useTodayCoverage(householdId, timeZone, weekStartsOn);
  const [withdrawConfirmOpen, setWithdrawConfirmOpen] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const carersQuery = useHouseholdCarers(householdId);
  const membersQuery = useHouseholdMembers(householdId);
  const createCover = useCreateParentCover();
  const withdrawCoverAsk = useWithdrawCoverAsk();
  // §7 — the same server gate `createExtraShift` consults for a co-parent
  // under `approval_mode='owner_only'` (`ApprovalGateAction: 'extra_shift'`).
  // `createParentCover` ("I've got it") is NOT gated server-side, so it stays
  // unrestricted here on purpose.
  const askCoverRestriction = useRestrictedAction({
    householdId,
    action: tSchedule('cover.restrictedActionAskCover'),
  });
  const withdrawAskRestriction = useRestrictedAction({
    householdId,
    action: tSchedule('cover.restrictedActionWithdrawAsk'),
  });

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

  // §5.4 (D-47): inside 12h the headline stops describing the gap and starts
  // counting down to it. Demoted the card has already lost arbitration to
  // something more urgent, so it must not shout — and the tone stays
  // `attention`, never `critical`: the escalation is copy, not a new register.
  const escalationHours =
    !demoted && singleWindow
      ? gapEscalationHours(singleWindow.startsAt, Date.now())
      : null;

  const gapHeadline = (() => {
    if (!singleWindow) {
      return t('coverage.gap.titleMany', { count: windows.length });
    }
    const start = formatClockTime(singleWindow.startsAt, timeZone);
    const end = formatClockTime(singleWindow.endsAt, timeZone);
    if (escalationHours !== null) {
      return t('coverage.gap.titleOneEscalated', {
        weekday: tSchedule(`weekday.${localDateToWeekday(state.localDate)}`),
        start,
        end,
        count: escalationHours,
      });
    }
    return t('coverage.gap.titleOne', {
      childName: childName(singleWindow.childId, householdChildren),
      start,
      end,
    });
  })();

  // §2.4a — `carerId` omitted builds the "ask someone else" href (opens the
  // picker); passed explicitly it re-targets the same carer ("ask again").
  const extraHrefFor = (carerId: string | null): Href | null => {
    if (!singleWindow) return null;
    const start = utcIsoToWallClockHHMM(singleWindow.startsAt, timeZone);
    const end = utcIsoToWallClockHHMM(singleWindow.endsAt, timeZone);
    const params = new URLSearchParams({
      date: state.localDate,
      start,
      end,
      childId: singleWindow.childId,
    });
    if (carerId) {
      params.set('carerId', carerId);
    }
    return `/(private)/schedule/shifts/extra?${params.toString()}` as Href;
  };
  const extraHref = extraHrefFor(singleCarer?.user_id ?? null);

  // §2.4a — the cover-ask lifecycle overlaying the gap's original cause, for
  // the SAME window the action row acts on. A separate fact from `cause`
  // above: `cause` is why the window opened, this is what has since been
  // done about it.
  const askState = singleWindow
    ? inferAskState(singleWindow, shiftsQuery.data ?? [], Date.now())
    : null;
  const askCarerName = askState
    ? resolveCarerName(
        membersQuery.data?.find(m => m.user_id === askState.shift.carer_id),
        t('today:carerFallback')
      )
    : null;

  // §2.4a's action-row table, one branch per ask state. `escalated` (§5.4) is
  // driven purely by the clock and stays on the plain "ask" copy when there is
  // no ask yet — only an outstanding ask changes what the primary button says.
  const defaultAskLabel = singleWindow
    ? singleCarerFirstName
      ? tSchedule('cover.askToCover', {
          carerName: singleCarerFirstName,
          start: formatClockTime(singleWindow.startsAt, timeZone),
        })
      : tSchedule('cover.askSomeoneToCover', {
          start: formatClockTime(singleWindow.startsAt, timeZone),
          end: formatClockTime(singleWindow.endsAt, timeZone),
        })
    : '';
  const primaryAsk = (() => {
    if (askState?.state === 'expired') {
      return {
        label: tSchedule('cover.askAgain', { carerName: askCarerName ?? '' }),
        href: extraHrefFor(askState.shift.carer_id),
      };
    }
    if (askState) {
      // pending or declined: someone has already answered (or is answering)
      // this exact question — the next step is a DIFFERENT person, not them.
      return {
        label: tSchedule('cover.askSomeoneElse'),
        href: extraHrefFor(null),
      };
    }
    return { label: defaultAskLabel, href: extraHref };
  })();
  // §2.4a's table has no "hours wrong" link on any ask-lifecycle row — it is
  // the "none asked" default's third action, not a permanent fixture.
  const showHoursWrongLink = !askState;
  const showAskSomeoneElseSecondary = askState?.state === 'expired';
  const showWithdrawAskLink = askState?.state === 'pending';

  const handleWithdrawConfirm = () => {
    if (askState?.state !== 'pending') return;
    setWithdrawError(null);
    void withdrawCoverAsk
      .mutateAsync(askState.shift.id)
      .then(() => {
        setWithdrawConfirmOpen(false);
      })
      .catch(error => {
        setWithdrawError(getLocalizedErrorMessage(error, tError));
      });
  };

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
          // The one window this card acts on ALSO carries the ask-lifecycle
          // line (§2.4a) — a second `inferAskState` call per window would be
          // redundant work for windows the action row never touches, and
          // B3's "one owner" already scopes the ask state to the window with
          // actions.
          const isActedWindow =
            singleWindow !== undefined &&
            window.childId === singleWindow.childId &&
            window.commitmentId === singleWindow.commitmentId &&
            window.startsAt === singleWindow.startsAt;
          if (isActedWindow && askState) {
            const causeLine = describeAskCause({
              state: askState.state,
              window,
              shift: askState.shift,
              carerName: askCarerName ?? t('today:carerFallback'),
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
          }
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

        {singleWindow && primaryAsk.href ? (
          <View className="gap-2">
            {/* L1's action is a full-width filled button at `lg` (56pt); the
                demoted rung gets a ghost link instead, because a card that
                lost arbitration must not out-shout the one that won it.
                Restricted via §7's `extra_shift` gate — the same one
                `createExtraShift` consults server-side for a co-parent under
                `owner_only`. */}
            <RestrictedActionButton
              testID="today-coverage-ask-cover"
              size={demoted ? 'sm' : 'lg'}
              variant={demoted ? 'ghost' : 'default'}
              className={demoted ? 'self-start px-0' : 'w-full'}
              label={primaryAsk.label}
              reason={askCoverRestriction.reason}
              onPress={() => router.push(primaryAsk.href as Href)}
            />
            {showAskSomeoneElseSecondary ? (
              <RestrictedActionButton
                testID="today-coverage-ask-someone-else"
                size="sm"
                variant="outline"
                label={tSchedule('cover.askSomeoneElse')}
                reason={askCoverRestriction.reason}
                onPress={() => {
                  const href = extraHrefFor(null);
                  if (href) router.push(href);
                }}
              />
            ) : null}
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
            {showHoursWrongLink ? (
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
            ) : null}
            {showWithdrawAskLink ? (
              <View>
                <Pressable
                  testID="today-coverage-withdraw-ask"
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: withdrawAskRestriction.disabled,
                  }}
                  accessibilityHint={withdrawAskRestriction.reason ?? undefined}
                  hitSlop={8}
                  disabled={withdrawAskRestriction.disabled}
                  onPress={() => {
                    setWithdrawError(null);
                    setWithdrawConfirmOpen(true);
                  }}
                >
                  <Small
                    className={
                      withdrawAskRestriction.disabled
                        ? 'text-muted-foreground'
                        : 'text-primary'
                    }
                    weight="medium"
                  >
                    {tSchedule('cover.withdrawAsk')}
                  </Small>
                </Pressable>
                {withdrawAskRestriction.reason ? (
                  <Small
                    testID="today-coverage-withdraw-ask-reason"
                    className="mt-2 text-muted-foreground"
                  >
                    {withdrawAskRestriction.reason}
                  </Small>
                ) : null}
                <AlertDialog
                  open={withdrawConfirmOpen}
                  onOpenChange={open => {
                    if (!open) {
                      setWithdrawConfirmOpen(false);
                      setWithdrawError(null);
                    }
                  }}
                >
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {tSchedule('cover.withdrawAskConfirmTitle')}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {tSchedule('cover.withdrawAskConfirmBody', {
                          carerName: askCarerName ?? t('today:carerFallback'),
                        })}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    {withdrawError ? (
                      <InlineError
                        testID="today-coverage-withdraw-ask-error"
                        message={withdrawError}
                      />
                    ) : null}
                    <AlertDialogFooter>
                      <AlertDialogCancel
                        testID="today-coverage-withdraw-ask-keep"
                        onPress={() => {
                          setWithdrawConfirmOpen(false);
                          setWithdrawError(null);
                        }}
                      >
                        <Small>
                          {tSchedule('cover.withdrawAskConfirmKeep')}
                        </Small>
                      </AlertDialogCancel>
                      <AlertDialogAction
                        testID="today-coverage-withdraw-ask-confirm"
                        disabled={withdrawCoverAsk.isPending}
                        onPress={handleWithdrawConfirm}
                      >
                        <Small>
                          {tSchedule('cover.withdrawAskConfirmWithdraw')}
                        </Small>
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </View>
            ) : null}
          </View>
        ) : null}
      </Card>

      {planLines}
    </View>
  );
}
