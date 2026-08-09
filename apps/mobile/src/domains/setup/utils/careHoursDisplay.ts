/**
 * @module domains/setup/utils/careHoursDisplay
 *
 * Plain-language summaries for recurring nanny care hours (days + time range).
 */
import { formatCommitmentTime } from '@/src/domains/setup/utils/commitmentRrule';

/** Narrow translate fn — avoids fighting i18next's overloaded TFunction generics. */
type Translate = (key: string, params?: Record<string, unknown>) => string;

const WEEKDAYS = [1, 2, 3, 4, 5];

const WEEKDAY_SHORT_KEYS: Record<number, string> = {
  0: 'schedule:weekdayShort.0',
  1: 'schedule:weekdayShort.1',
  2: 'schedule:weekdayShort.2',
  3: 'schedule:weekdayShort.3',
  4: 'schedule:weekdayShort.4',
  5: 'schedule:weekdayShort.5',
  6: 'schedule:weekdayShort.6',
};

/** "Every day", "Every weekday", or a joined short-day list. */
export function formatCareDaysSummary(days: number[], t: Translate): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) {
    return t('careHours.daysEveryDay');
  }
  if (
    sorted.length === 5 &&
    WEEKDAYS.every(weekday => sorted.includes(weekday))
  ) {
    return t('careHours.daysEveryWeekday');
  }
  return sorted
    .map(d => t(WEEKDAY_SHORT_KEYS[d] ?? 'schedule:weekdayShort.1'))
    .join(', ');
}

/** Primary row line: time range first, then days. */
export function formatCareHoursPrimary(
  start: string,
  end: string,
  days: number[],
  t: Translate
): string {
  return t('careHours.rowPrimary', {
    start: formatCommitmentTime(start),
    end: formatCommitmentTime(end),
    daysSummary: formatCareDaysSummary(days, t),
  });
}

/** Form readback above submit: days, times, child name. */
export function formatCareHoursReadback(
  start: string,
  end: string,
  days: number[],
  childName: string,
  t: Translate
): string {
  return t('careHours.form.readback', {
    daysSummary: formatCareDaysSummary(days, t),
    start: formatCommitmentTime(start),
    end: formatCommitmentTime(end),
    childName,
  });
}
