/**
 * @module lib/weekdayOrder
 *
 * Presentation-only weekday reorder for D29. Values are always Postgres
 * `extract(dow)` indices (0=Sunday..6=Saturday). Changing `weekStartsOn`
 * only rotates display order — stored / toggled / RRULE weekdays stay the
 * same integers.
 */
export function getWeekdayOrder(
  weekStartsOn: number | null | undefined
): number[] {
  const start =
    typeof weekStartsOn === 'number' &&
    Number.isInteger(weekStartsOn) &&
    weekStartsOn >= 0 &&
    weekStartsOn <= 6
      ? weekStartsOn
      : 1;
  return Array.from({ length: 7 }, (_, i) => (start + i) % 7);
}
