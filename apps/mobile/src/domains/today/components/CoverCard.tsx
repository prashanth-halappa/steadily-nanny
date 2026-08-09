/**
 * @module domains/today/components/CoverCard
 *
 * Live daily cover status for parents and helpers. Replaces the day-thread
 * `CoverageGapBanner` — uncovered windows are computed from shifts +
 * commitments + closures so fixing the schedule clears the card immediately.
 *
 * Three states:
 * - **setup** — no care-hours commitments yet; quiet prompt to add them.
 * - **uncovered** — T1 `tone="attention"` (respecting `demoted`).
 * - **covered** — daily reassurance via `tone="positive"`; never competes
 *   for the T1 slot.
 *
 * Role gate lives on `TodayScreen` (`canViewParentSchedule`) — nannies see
 * none of the three states.
 */

import type { Child } from '@steadily-nanny/shared-types/schemas/child.schema';
import { type Href, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';
import { Card } from '@/src/components/ui/card';
import { Body, H4 } from '@/src/components/ui/typography';
import {
  coveredVariantIndex,
  isFullDayUncovered,
} from '@/src/domains/schedule/utils/uncoveredDisplay';
import { commitmentBoundsOnLocalDate } from '@/src/domains/schedule/utils/uncoveredWeek';
import { useHouseholdCommitments } from '@/src/hooks/queries/useHouseholdCommitments';
import { formatInstantInZone } from '@/src/lib/displayTime';
import { useUncoveredToday } from '../hooks/useUncoveredToday';

interface CoverCardProps {
  householdId: string;
  timeZone: string;
  householdChildren: readonly Child[];
  demoted?: boolean;
}

const COVERED_VARIANT_KEYS = [
  'cover.covered.variant0',
  'cover.covered.variant1',
  'cover.covered.variant2',
  'cover.covered.variant3',
] as const;

function childName(childId: string, children: readonly Child[]): string {
  return children.find(c => c.id === childId)?.name ?? '';
}

function formatWindowTime(iso: string, timeZone: string): string {
  return formatInstantInZone(iso, timeZone);
}

export function CoverCard({
  householdId,
  timeZone,
  householdChildren,
  demoted = false,
}: CoverCardProps) {
  const { t } = useTranslation('today');
  const { t: tSchedule } = useTranslation('schedule');
  const router = useRouter();
  const state = useUncoveredToday(householdId, timeZone);
  const commitmentsQuery = useHouseholdCommitments(householdId);
  const commitments = commitmentsQuery.data ?? [];

  const coveredLine = useMemo(() => {
    if (state.status !== 'covered') {
      return null;
    }
    const idx = coveredVariantIndex(state.localDate);
    return t(COVERED_VARIANT_KEYS[idx] ?? COVERED_VARIANT_KEYS[0]);
  }, [state, t]);

  if (state.status === 'loading' || state.status === 'error') {
    return null;
  }

  if (state.status === 'setup') {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/settings/children' as Href)}
      >
        <Card testID="cover-card" className="gap-1 p-5.5">
          <Body weight="medium">{t('cover.setup.title')}</Body>
          <Body className="text-sm text-muted-foreground">
            {t('cover.setup.body')}
          </Body>
        </Card>
      </Pressable>
    );
  }

  if (state.status === 'covered') {
    return (
      <Card testID="cover-card" tone="positive" className="gap-1 p-5.5">
        <H4>{t('cover.covered.title')}</H4>
        <Body>{coveredLine}</Body>
      </Card>
    );
  }

  const windows = state.windows;
  const title =
    windows.length === 1
      ? t('cover.uncovered.titleOne', {
          childName: childName(windows[0]?.childId ?? '', householdChildren),
        })
      : t('cover.uncovered.titleMany', { count: windows.length });

  const visible = windows.length >= 4 ? windows.slice(0, 2) : windows;
  const hiddenCount = windows.length - visible.length;

  const openSchedule = () => {
    router.push(
      `/(private)/schedule/shifts?localDate=${encodeURIComponent(state.localDate)}&focusUncovered=1&householdId=${encodeURIComponent(householdId)}` as Href
    );
  };

  return (
    <Pressable accessibilityRole="button" onPress={openSchedule}>
      <Card
        testID="cover-card"
        tone={demoted ? 'default' : 'attention'}
        className="gap-1 p-5.5"
      >
        <Body weight="medium">{title}</Body>
        {visible.map(window => {
          const name = childName(window.childId, householdChildren);
          const commitment = commitments.find(
            c => c.id === window.commitmentId
          );
          const cause = tSchedule(`cover.cause.${window.cause}`);
          let line: string;
          if (commitment) {
            const { startUtc, endUtc } = commitmentBoundsOnLocalDate(
              commitment,
              state.localDate,
              timeZone
            );
            if (isFullDayUncovered(window, startUtc, endUtc)) {
              line = t('cover.uncovered.windowAllDay', {
                childName: name,
                cause,
              });
            } else {
              const start = formatWindowTime(window.startsAt, timeZone);
              const end = formatWindowTime(window.endsAt, timeZone);
              line = t('cover.uncovered.windowLine', {
                childName: name,
                start,
                end,
                cause,
              });
            }
          } else {
            line = t('cover.uncovered.windowFallback', {
              childName: name,
              cause,
            });
          }
          return (
            <Body
              key={`${window.childId}|${window.commitmentId}|${window.startsAt}`}
              testID={`cover-window-${window.startsAt}`}
              className="text-sm text-muted-foreground"
            >
              {line}
            </Body>
          );
        })}
        {hiddenCount > 0 ? (
          <Body className="text-sm text-muted-foreground">
            {t('cover.uncovered.andMore', { count: hiddenCount })}
          </Body>
        ) : null}
      </Card>
    </Pressable>
  );
}
