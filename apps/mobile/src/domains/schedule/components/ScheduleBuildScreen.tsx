/**
 * @module domains/schedule/components/ScheduleBuildScreen
 *
 * Parent flow: build a "usual week" and send it to a carer. A multi-step
 * wizard (carer -> days -> hours -> repeat -> review), all local state until
 * the final "Send" action, which chains create -> replaceDays -> send.
 *
 * WEEKDAY CONVENTION: `WeekStrip.onToggle` already reports the Postgres
 * `extract(dow)` index (0=Sunday..6=Saturday) — this screen never remaps it
 * against display order. All day-selection math goes through the
 * dependency-free helpers in `../utils` (`toggleWeekday`, `buildWeeklyRrule`,
 * `calculateWeekTotalHours`) rather than being re-derived inline, so the
 * off-by-one this component exists to avoid has exactly one place to get
 * right — see `../__tests__/utils.test.ts`.
 *
 * TIME CONVENTION: `start_time`/`end_time` are nominal local wall-clock
 * "HH:MM" strings end to end — never converted to a `Date` here. The server
 * derives each occurrence's UTC instant from the household's timezone.
 *
 * D25: once a carer is selected, this screen fetches their stated
 * availability (`GET /availability/:userId`, previously orphaned — a parent
 * could send an entirely unschedulable week and only find out when the
 * carer declined) and flags a picked day/time that falls outside it with
 * `StatusPill variant="outside-hours"`, the SAME non-blocking warning
 * `ScheduleRespondScreen` shows the carer for the mirror-image check — reusing
 * `isOutsideAvailability` from `../utils` rather than re-deriving the clash
 * logic here. Per the product rule (see that helper's own doc comment):
 * warn, never block — every day stays fully selectable regardless.
 *
 * DRAFT RESUME: an optional `patternId` prop (from the build route's
 * `?patternId=` search param — see SchedulePendingScreen's "Continue
 * building" CTA for a draft, and SchedulePatternBanner's "Change it" for an
 * ACCEPTED pattern) resumes an existing pattern instead of starting a fresh
 * wizard. Two things make this safe:
 *  1. `patternId` local state is seeded from the prop, so `sendScheduleWeek`
 *     never creates a SECOND draft for a pattern that already exists — but
 *     (WS-K) it only REUSES that id via `replaceDays` when the resumed
 *     pattern's `status` (threaded through as `patternStatus`, from
 *     `existingPattern.data`) is a known `'draft'`. A resumed ACCEPTED (or
 *     any other non-draft) pattern instead makes `sendScheduleWeek` create a
 *     BRAND NEW pattern — the API's `assertDraft` 409s on a PUT to a
 *     pattern that's already been answered, and the server's
 *     supersede-on-accept ends the old one once the carer accepts the new
 *     one. See `sendScheduleWeek`'s own header/`patternStatus` doc comments.
 *  2. Once the draft's days load (`useSchedulePattern`), `hydrateDraftPattern`
 *     (`../utils` — a pure, independently-unit-tested function) derives the
 *     carer/days/times/children/interval selections from them, so the
 *     wizard resumes with the parent's prior progress rather than an empty
 *     carer-picker step.
 *  3. If that fetch FAILS, the wizard enters the 'draft-error' step instead
 *     of sitting on the loading spinner forever (`hasHydratedDraft` never
 *     flips on error, and the step-advance effect will not leave 'loading'
 *     until it does). Two recoveries are offered: retry the fetch, or
 *     abandon hydration and build the week by hand against the same draft.
 *
 * CARE-HOURS PREFILL (P3.2): a fresh wizard (no `?patternId=`) opens on the
 * week the parent already stated as care hours rather than a hard-coded
 * 09:00-17:00 — `hydrateFromCommitments` (`../utils`, unit-tested) unions
 * `child_commitments` into selected days, a per-day earliest-start /
 * latest-end window, and per-day children. With exactly one active nanny and
 * a usable derived week it opens straight at 'review', so the parent sees the
 * week they just typed with her name on it and confirms it once.
 *
 * This is a PREFILLED FORM and nothing else: nothing is persisted, no
 * commitment becomes a shift, and `docs/12-NEED-COVERAGE.md` §9's decoupling
 * is untouched — the parent simply never has to learn it exists. Because the
 * per-day union can EXCEED any single child's stated window, both the 'hours'
 * and 'review' steps disclose where the times came from.
 *
 * Wave B: `householdId` comes from `useActiveHousehold`, not
 * `useIsOnboarded().householdId` — a parent (Wave 1: owns exactly one
 * household) gets the identical id either way, but this keeps every
 * data-fetching screen going through the one hook that's actually
 * responsible for "which household".
 */
import type { HouseholdMember } from '@steadily-nanny/shared-types/schemas/household.schema';
import { type Href, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { BackButton } from '@/src/components/ui/back-button';
import { Button } from '@/src/components/ui/button';
import { ChildChip } from '@/src/components/ui/child-chip';
import { EmptyState } from '@/src/components/ui/empty-state';
import { FieldLabel } from '@/src/components/ui/field-label';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Text } from '@/src/components/ui/text';
import { TimeRangePicker } from '@/src/components/ui/time-range-picker';
import { isEndAfterStart } from '@/src/components/ui/time-range-picker.utils';
import { Body, Caption } from '@/src/components/ui/typography';
import { WeekStrip } from '@/src/components/ui/week-strip';
import { useHouseholdCarers } from '@/src/domains/schedule/hooks/useHouseholdCarers';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useCreateSchedulePattern } from '@/src/hooks/mutations/useCreateSchedulePattern';
import { useReplaceSchedulePatternDays } from '@/src/hooks/mutations/useReplaceSchedulePatternDays';
import { useSendSchedulePattern } from '@/src/hooks/mutations/useSendSchedulePattern';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useAvailabilityForCarer } from '@/src/hooks/queries/useAvailabilityForCarer';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useHouseholdCommitments } from '@/src/hooks/queries/useHouseholdCommitments';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useSchedulePattern } from '@/src/hooks/queries/useSchedulePattern';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';
import { getWeekdayOrder } from '@/src/lib/weekdayOrder';
import {
  buildWeeklyRrule,
  calculateWeekTotalHours,
  hydrateDraftPattern,
  hydrateFromCommitments,
  isOutsideAvailability,
  sendScheduleWeek,
  todayIsoDate,
  toggleWeekday,
} from '../utils';

type Step =
  | 'loading'
  | 'draft-error'
  | 'no-carer'
  | 'carer'
  | 'days'
  | 'hours'
  | 'repeat'
  | 'review';

const DEFAULT_START = '09:00';
const DEFAULT_END = '17:00';

interface DayTime {
  start: string;
  end: string;
}

interface ScheduleBuildScreenProps {
  /** An existing draft pattern's id, e.g. from the build route's `?patternId=` search param — see this component's own header comment (DRAFT RESUME). */
  patternId?: string;
}

export function ScheduleBuildScreen({
  patternId: resumePatternId,
}: ScheduleBuildScreenProps = {}) {
  const router = useRouter();
  const { t } = useTranslation('schedule');
  const { t: tCommon } = useTranslation('common');
  const { t: tErrors } = useTranslation('errors');
  const onboarding = useIsOnboarded();
  const activeHousehold = useActiveHousehold();
  const householdId = activeHousehold.householdId;
  const profile = useUserProfile();
  const displayOrder = getWeekdayOrder(profile.data?.week_starts_on);

  const carers = useHouseholdCarers(householdId);
  const children = useChildren(householdId);
  const existingPattern = useSchedulePattern(resumePatternId);
  // P3.2: the care hours the parent already stated. Read-only — nothing here
  // is ever written back, and a commitment still never becomes a shift
  // (`docs/12-NEED-COVERAGE.md` §9). Not fetched at all when resuming a
  // draft, whose own saved days are the truth instead.
  const householdCommitments = useHouseholdCommitments(
    resumePatternId ? null : householdId
  );

  const [selectedCarerId, setSelectedCarerId] = useState<string | null>(null);
  // D25: fetched as soon as a carer is selected (before the 'hours' step is
  // even reached) so the warning is ready the moment there's something to
  // warn about, rather than popping in after the picker renders.
  const carerAvailability = useAvailabilityForCarer(selectedCarerId);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [dayTimes, setDayTimes] = useState<Record<number, DayTime>>({});
  const [dayChildren, setDayChildren] = useState<Record<number, string[]>>({});
  const [intervalWeeks, setIntervalWeeks] = useState<1 | 2>(1);
  const [step, setStep] = useState<Step>('loading');
  // Seeded from `resumePatternId` (never left undefined when resuming) so
  // `sendScheduleWeek`'s `!patternId` check never fires for this draft —
  // see the header comment's DRAFT RESUME point 1.
  const [patternId, setPatternId] = useState<string | undefined>(
    resumePatternId
  );
  const [isSending, setIsSending] = useState(false);
  const [hasHydratedDraft, setHasHydratedDraft] = useState(!resumePatternId);
  // P3.2: a resumed draft carries its own days, so the care-hours seed is
  // already "done" in that case and must never run over them.
  const [hasSeededCareHours, setHasSeededCareHours] = useState(
    !!resumePatternId
  );
  const [prefilledFromCareHours, setPrefilledFromCareHours] = useState(false);

  const createPattern = useCreateSchedulePattern(householdId ?? undefined);
  const replaceDays = useReplaceSchedulePatternDays();
  const sendPattern = useSendSchedulePattern();

  // Resume: once the existing draft's days have loaded, derive this
  // screen's local selections from them (point 2 of the header comment's
  // DRAFT RESUME section) — runs at most once, guarded by `hasHydratedDraft`
  // so a background refetch of the same query never stomps on edits the
  // parent makes afterwards.
  //
  // The error branch is not optional: `hasHydratedDraft` starts `false`
  // whenever `resumePatternId` is set, and the step-advance effect below
  // refuses to leave 'loading' until it flips — so a failed
  // `useSchedulePattern` fetch used to strand the screen on a spinner with
  // no retry and no way out. A retry deliberately STAYS on 'draft-error'
  // (its progress shows through `isFetching`); it is this effect's success
  // path that hands the wizard back to 'loading' for the advance effect
  // below to pick up, so a retry that fails again can never re-strand.
  useEffect(() => {
    if (hasHydratedDraft) return;
    if (existingPattern.isError) {
      setStep('draft-error');
      return;
    }
    if (!existingPattern.data) return;
    const hydrated = hydrateDraftPattern(existingPattern.data);
    if (hydrated.carerId) setSelectedCarerId(hydrated.carerId);
    if (hydrated.selectedDays.length > 0) {
      setSelectedDays(hydrated.selectedDays);
      setDayTimes(prev => ({ ...prev, ...hydrated.dayTimes }));
      setDayChildren(prev => ({ ...prev, ...hydrated.dayChildren }));
    }
    setIntervalWeeks(hydrated.intervalWeeks);
    setStep('loading');
    setHasHydratedDraft(true);
  }, [hasHydratedDraft, existingPattern.data, existingPattern.isError]);

  /** 'draft-error' recovery A: refetch the draft and re-enter the wizard. */
  const retryDraftLoad = () => {
    void existingPattern.refetch();
  };

  /** 'draft-error' recovery B: abandon hydration and build the week by hand.
   * `patternId` still points at the existing draft, so sending updates that
   * draft rather than orphaning a second one. */
  const startFreshFromDraftError = () => {
    setHasHydratedDraft(true);
    setStep('loading');
  };

  // P3.2: seed the wizard from the care hours the parent already stated, so
  // "07:00-13:00 every weekday" isn't something they have to type twice. Runs
  // at most once (`hasSeededCareHours`), so a background refetch can never
  // stomp on a day they've since changed — the same guard shape as the draft
  // hydrate effect above.
  //
  // Only a fully VALID derived week is seeded: `prefilledFromCareHours` is
  // both "we filled this in" and "it's usable", which is what the step-advance
  // effect below keys the review shortcut on. Each commitment's own end is
  // after its own start (DB check), and the per-day union only ever widens
  // that, so an invalid day is close to unreachable — but seeding one would
  // leave the parent on a form with a permanently disabled CTA, so it falls
  // back to the ordinary hard-coded defaults instead.
  useEffect(() => {
    if (hasSeededCareHours || !householdId) return;
    if (householdCommitments.isLoading) return;
    setHasSeededCareHours(true);
    const seeded = hydrateFromCommitments(householdCommitments.data ?? []);
    const isUsable =
      seeded.selectedDays.length > 0 &&
      seeded.selectedDays.every(day => {
        const times = seeded.dayTimes[day];
        return times !== undefined && isEndAfterStart(times.start, times.end);
      });
    if (!isUsable) return;
    setSelectedDays(seeded.selectedDays);
    // Seeded values go UNDER `prev`, so anything already set wins — and the
    // default-fill effect below still only writes days with no entry, so a
    // pre-seed composes with it rather than fighting it.
    setDayTimes(prev => ({ ...seeded.dayTimes, ...prev }));
    setDayChildren(prev => ({ ...seeded.dayChildren, ...prev }));
    setPrefilledFromCareHours(true);
  }, [
    hasSeededCareHours,
    householdId,
    householdCommitments.isLoading,
    householdCommitments.data,
  ]);

  // Advance out of 'loading' once carers (and, when resuming, the draft's
  // own days) have resolved. A single carer is auto-selected and skips the
  // carer-picker step entirely (the common case — one nanny per household
  // in this wave); resuming a draft that already has a carer AND days skips
  // straight to 'review' instead.
  useEffect(() => {
    if (step !== 'loading' || carers.isLoading) return;
    if (resumePatternId && !hasHydratedDraft) return;
    // P3.2: decide only once the care-hours seed has resolved, or the wizard
    // opens on 'days' and then jumps to 'review' under the parent.
    if (!hasSeededCareHours) return;
    const rows = carers.data ?? [];
    if (rows.length === 0) {
      setStep('no-carer');
    } else if (selectedCarerId) {
      setStep(selectedDays.length > 0 ? 'review' : 'days');
    } else if (rows.length === 1) {
      setSelectedCarerId(rows[0]?.user_id ?? null);
      // P3.2: exactly one nanny AND a usable week derived from the care
      // hours means we can show the parent the week they just typed, with
      // her name on it, and ask for one confirmation. More than one nanny
      // (the carer picker is a real question) or no usable week falls back
      // to the wizard's normal first step.
      setStep(prefilledFromCareHours ? 'review' : 'days');
    } else {
      setStep('carer');
    }
  }, [
    step,
    carers.isLoading,
    carers.data,
    resumePatternId,
    hasHydratedDraft,
    hasSeededCareHours,
    prefilledFromCareHours,
    selectedCarerId,
    selectedDays.length,
  ]);

  // New days default to 09:00-17:00, covering every current child — synced
  // whenever the selection changes rather than re-derived at send time. Days
  // the care-hours seed above already filled are left alone (`!next[day]`),
  // so the two compose: seeded days keep the parent's stated hours, days they
  // add by hand afterwards still get the plain defaults.
  useEffect(() => {
    setDayTimes(prev => {
      const next = { ...prev };
      for (const day of selectedDays) {
        if (!next[day]) next[day] = { start: DEFAULT_START, end: DEFAULT_END };
      }
      return next;
    });
    setDayChildren(prev => {
      const next = { ...prev };
      for (const day of selectedDays) {
        if (!next[day]) next[day] = (children.data ?? []).map(c => c.id);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDays, children.data]);

  const toggleDay = (day: number) => {
    setSelectedDays(prev => toggleWeekday(prev, day));
  };

  const toggleChildForDay = (day: number, childId: string) => {
    setDayChildren(prev => {
      const current = prev[day] ?? [];
      const nextForDay = current.includes(childId)
        ? current.filter(id => id !== childId)
        : [...current, childId];
      return { ...prev, [day]: nextForDay };
    });
  };

  const selectedCarer = (carers.data ?? []).find(
    c => c.user_id === selectedCarerId
  );

  const totalHours = calculateWeekTotalHours(
    selectedDays.map(day => ({
      start_time: dayTimes[day]?.start ?? DEFAULT_START,
      end_time: dayTimes[day]?.end ?? DEFAULT_END,
    }))
  );

  const allDaysValid = selectedDays.every(day => {
    const times = dayTimes[day];
    return times !== undefined && isEndAfterStart(times.start, times.end);
  });

  // A missing display name falls back to a neutral, translated placeholder
  // — NEVER a UI step title (that was the bug: an un-namespaced `t()` call
  // rendered the raw key "carerPickerTitle" as the carer's name).
  const carerDisplayName = (member: HouseholdMember) =>
    resolveCarerName(member, t('build.carerFallbackName'));

  const cancelWizard = () => router.back();
  const cancelProps = {
    onSkip: cancelWizard,
    skipLabel: tCommon('cancel'),
  } as const;

  /** Step-back only when a prior wizard step exists; first step uses Cancel. */
  const backToCarerOrExit =
    (carers.data?.length ?? 0) > 1 ? () => setStep('carer') : cancelWizard;

  const onSend = async () => {
    if (!selectedCarerId || selectedDays.length === 0) return;
    setIsSending(true);
    try {
      // All orchestration (create -> replaceDays -> send) happens inside
      // `sendScheduleWeek`, which resolves the pattern id ONCE in this call
      // stack and threads it explicitly into every dependent mutation —
      // see its header comment for why a `useMutation(patternId)` hook
      // parameter is the wrong shape here (React state updates are async,
      // so `setPatternId` would not have rebound `replaceDays`/`sendPattern`
      // by the time they're called in this same handler pass).
      const resolvedPatternId = await sendScheduleWeek({
        patternId,
        // WS-K: only a KNOWN 'draft' is safe to edit in place — an accepted
        // (or any other non-draft) resumed pattern must get a brand NEW one
        // instead of a PUT the API will 409 (`PATTERN_NOT_EDITABLE`). See
        // `sendScheduleWeek`'s own `patternStatus` doc comment.
        patternStatus: existingPattern.data?.status,
        carerId: selectedCarerId,
        rrule: buildWeeklyRrule(selectedDays, intervalWeeks),
        dtstart: todayIsoDate(),
        days: selectedDays.map(day => ({
          weekday: day,
          start_time: dayTimes[day]?.start ?? DEFAULT_START,
          end_time: dayTimes[day]?.end ?? DEFAULT_END,
          children: (dayChildren[day] ?? []).map(childId => ({
            child_id: childId,
          })),
        })),
        createPattern: input => createPattern.mutateAsync(input),
        replaceDays: args => replaceDays.mutateAsync(args),
        sendPattern: args => sendPattern.mutateAsync(args),
        // D11: persist a freshly-created id into state THE INSTANT it's
        // known, not only after full success — otherwise a partial failure
        // (creation succeeds, replaceDays/sendPattern doesn't) leaves this
        // component with no way to learn about the draft it already paid
        // to create, and a retry calls createPattern again, orphaning a
        // second draft on every failed attempt. `setPatternId` is a stable
        // `useState` dispatch, never subject to the staleness `patternId`
        // (the hook-parameter version) used to have — see sendScheduleWeek's
        // own header comment.
        onPatternCreated: setPatternId,
      });
      setPatternId(resolvedPatternId);

      router.replace('/(private)/schedule' as Href);
    } catch (error) {
      // WS-K: the primary CTA on this screen OWNS its failure surface —
      // it does not just trust that some nested mutation's onError already
      // fired one. A bare `finally` here (no `catch` at all) would let the
      // rejection escape past `onCta={() => void onSend()}` with nothing to
      // catch it, an unhandled promise rejection — the same defect class as
      // D7's clock-in bug. A silent failure on a primary "Send" CTA must be
      // impossible, so this is unconditional and explicit rather than
      // implicit and three hops away.
      showErrorToast(getLocalizedErrorMessage(error, tErrors));
    } finally {
      setIsSending(false);
    }
  };

  if (
    onboarding.status === 'loading' ||
    activeHousehold.isLoading ||
    step === 'loading'
  ) {
    return (
      <View
        testID="schedule-build-screen"
        style={{ flex: 1 }}
        className="items-center justify-center bg-background"
      >
        <LoadingIndicator />
      </View>
    );
  }

  // Parent-only. A bare `null` used to leave a deep-linked nanny/helper
  // staring at a blank screen — no message, no back affordance, nothing.
  // Mirrors TimeOffScreen's `time-off-not-available` pattern.
  if (onboarding.role !== SETUP_ROLES.PARENT) {
    return (
      <View
        testID="schedule-build-not-available"
        className="flex-1 bg-background"
      >
        <View
          style={{
            paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
            paddingTop: SCREEN_CONTENT_STYLE.padding,
          }}
        >
          <BackButton
            testID="schedule-build-not-available-back"
            onPress={cancelWizard}
            label={tCommon('back')}
          />
        </View>
        <View
          className="mt-8"
          style={{ paddingHorizontal: SCREEN_CONTENT_STYLE.padding }}
        >
          <EmptyState
            variant="inline"
            title={t('build.notAvailableTitle')}
            description={t('build.notAvailableDescription')}
          />
        </View>
      </View>
    );
  }

  return (
    <View testID="schedule-build-screen" style={{ flex: 1 }}>
      {step === 'draft-error' ? (
        <SetupScreenShell
          testID="schedule-build-draft-error"
          title={t('build.draftErrorTitle')}
          subtitle={t('build.draftErrorBody')}
          ctaLabel={t('build.draftErrorRetry')}
          ctaDisabled={existingPattern.isFetching}
          onCta={retryDraftLoad}
          onSkip={startFreshFromDraftError}
          skipLabel={t('build.draftErrorStartFresh')}
          onBack={cancelWizard}
          backLabel={tCommon('back')}
        />
      ) : null}

      {step === 'no-carer' ? (
        <SetupScreenShell
          testID="schedule-build-no-carer"
          title={t('build.noCarerTitle')}
          subtitle={t('build.noCarerBody')}
          ctaLabel={t('build.noCarerCta')}
          onCta={() => router.back()}
          onBack={() => router.back()}
          backLabel={tCommon('back')}
        />
      ) : null}

      {step === 'carer' ? (
        <SetupScreenShell
          testID="schedule-build-carer"
          progress={0.2}
          title={t('build.carerPickerTitle')}
          subtitle={t('build.carerPickerSubtitle')}
          ctaLabel={t('build.carerPickerCta')}
          ctaDisabled={!selectedCarerId}
          onCta={() => setStep('days')}
          onBack={cancelWizard}
          backLabel={tCommon('back')}
          {...cancelProps}
        >
          <View className="gap-2">
            {(carers.data ?? []).map(member => (
              <Button
                key={member.id}
                testID={`schedule-carer-option-${member.user_id}`}
                variant={
                  selectedCarerId === member.user_id ? 'default' : 'outline'
                }
                onPress={() => setSelectedCarerId(member.user_id)}
              >
                <Text>{carerDisplayName(member)}</Text>
              </Button>
            ))}
          </View>
        </SetupScreenShell>
      ) : null}

      {step === 'days' ? (
        <SetupScreenShell
          testID="schedule-build-days"
          progress={0.4}
          title={t('build.daysTitle', {
            name: selectedCarer
              ? carerDisplayName(selectedCarer)
              : t('build.carerFallbackName'),
          })}
          subtitle={t('build.daysSubtitle')}
          ctaLabel={t('build.daysCta')}
          ctaDisabled={selectedDays.length === 0}
          onCta={() => setStep('hours')}
          onBack={backToCarerOrExit}
          backLabel={tCommon('back')}
          {...cancelProps}
        >
          <WeekStrip
            testID="schedule-day-toggle"
            selected={selectedDays}
            onToggle={toggleDay}
            weekStartsOn={profile.data?.week_starts_on}
          />
        </SetupScreenShell>
      ) : null}

      {step === 'hours' ? (
        <SetupScreenShell
          testID="schedule-build-hours"
          progress={0.6}
          title={t('build.hoursTitle')}
          subtitle={t('build.hoursSubtitle')}
          ctaLabel={t('build.hoursCta')}
          ctaDisabled={!allDaysValid}
          onCta={() => setStep('repeat')}
          onBack={() => setStep('days')}
          backLabel={tCommon('back')}
          {...cancelProps}
        >
          <View className="gap-6">
            {prefilledFromCareHours ? (
              <Body
                testID="schedule-build-prefill-note"
                className="text-muted-foreground"
              >
                {t('build.prefilledFromCareHours')}
              </Body>
            ) : null}
            {displayOrder
              .filter(day => selectedDays.includes(day))
              .map(day => {
                const dayStart = dayTimes[day]?.start ?? DEFAULT_START;
                const dayEnd = dayTimes[day]?.end ?? DEFAULT_END;
                // `undefined` (still loading) is deliberately NOT treated as
                // "outside availability" — isOutsideAvailability's own
                // contract is "no row for this weekday = outside", which
                // would otherwise flash a false warning on every day before
                // the fetch resolves.
                const outsideAvailability =
                  carerAvailability.data !== undefined &&
                  isOutsideAvailability(
                    { weekday: day, start_time: dayStart, end_time: dayEnd },
                    carerAvailability.data
                  );
                return (
                  <View key={day} className="gap-2">
                    <View className="flex-row items-center justify-between gap-2">
                      <Body weight="medium">{t(`weekday.${day}`)}</Body>
                      {outsideAvailability ? (
                        <StatusPill
                          variant="outside-hours"
                          label={t('build.outsideHoursWarning')}
                          testID={`schedule-build-outside-hours-${day}`}
                        />
                      ) : null}
                    </View>
                    {outsideAvailability ? (
                      <Caption className="text-warning">
                        {t('build.outsideHoursNote')}
                      </Caption>
                    ) : null}
                    <TimeRangePicker
                      testID={`schedule-build-time-range-${day}`}
                      start={dayStart}
                      end={dayEnd}
                      onChange={(start, end) =>
                        setDayTimes(prev => ({
                          ...prev,
                          [day]: { start, end },
                        }))
                      }
                    />
                    <FieldLabel>{t('build.childrenLabel')}</FieldLabel>
                    <View className="flex-row flex-wrap gap-2">
                      {(children.data ?? []).map(child => (
                        <ChildChip
                          key={child.id}
                          testID={`schedule-build-child-${day}-${child.id}`}
                          name={child.name}
                          colour={child.colour ?? undefined}
                          selected={(dayChildren[day] ?? []).includes(child.id)}
                          onPress={() => toggleChildForDay(day, child.id)}
                        />
                      ))}
                    </View>
                  </View>
                );
              })}
          </View>
        </SetupScreenShell>
      ) : null}

      {step === 'repeat' ? (
        <SetupScreenShell
          testID="schedule-build-repeat"
          progress={0.8}
          title={t('build.repeatTitle')}
          ctaLabel={t('build.repeatCta')}
          onCta={() => setStep('review')}
          onBack={() => setStep('hours')}
          backLabel={tCommon('back')}
          {...cancelProps}
        >
          <View className="gap-2">
            <Button
              testID="schedule-repeat-weekly"
              variant={intervalWeeks === 1 ? 'default' : 'outline'}
              onPress={() => setIntervalWeeks(1)}
            >
              <Text>{t('build.repeatWeekly')}</Text>
            </Button>
            <Button
              testID="schedule-repeat-fortnightly"
              variant={intervalWeeks === 2 ? 'default' : 'outline'}
              onPress={() => setIntervalWeeks(2)}
            >
              <Text>{t('build.repeatFortnightly')}</Text>
            </Button>
          </View>
        </SetupScreenShell>
      ) : null}

      {step === 'review' ? (
        <SetupScreenShell
          testID="schedule-send"
          progress={1}
          title={t('build.reviewTitle')}
          subtitle={
            selectedCarer
              ? t('build.reviewSubtitle', {
                  carerName: carerDisplayName(selectedCarer),
                })
              : undefined
          }
          ctaLabel={t('build.reviewSendCta')}
          ctaDisabled={isSending || !allDaysValid}
          onCta={() => void onSend()}
          onBack={() => setStep('repeat')}
          backLabel={tCommon('back')}
          {...cancelProps}
        >
          <View className="gap-4">
            {/* The parent lands HERE directly when the week was prefilled and
                there is one nanny, so the disclosure has to be on this step
                too — a note only on 'hours' would be one they never see. */}
            {prefilledFromCareHours ? (
              <Body
                testID="schedule-review-prefill-note"
                className="text-muted-foreground"
              >
                {t('build.prefilledFromCareHours')}
              </Body>
            ) : null}
            <Body testID="schedule-review-days-count" tabular>
              {t('build.reviewDaysCount', { count: selectedDays.length })}
            </Body>
            <Body testID="schedule-review-hours-total" tabular>
              {t('build.reviewHoursTotal', { hours: totalHours })}
            </Body>
            {displayOrder
              .filter(day => selectedDays.includes(day))
              .map(day => (
                <View key={day} className="gap-1">
                  <Body weight="medium" tabular>
                    {t(`weekday.${day}`)} —{' '}
                    {dayTimes[day]?.start ?? DEFAULT_START}
                    {'–'}
                    {dayTimes[day]?.end ?? DEFAULT_END}
                  </Body>
                  <View className="flex-row flex-wrap gap-2">
                    {(children.data ?? [])
                      .filter(child =>
                        (dayChildren[day] ?? []).includes(child.id)
                      )
                      .map(child => (
                        <ChildChip
                          key={child.id}
                          name={child.name}
                          colour={child.colour ?? undefined}
                        />
                      ))}
                  </View>
                </View>
              ))}
          </View>
        </SetupScreenShell>
      ) : null}
    </View>
  );
}

export type { Step as ScheduleBuildStep };
