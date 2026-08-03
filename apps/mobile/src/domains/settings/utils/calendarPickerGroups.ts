/**
 * @module domains/settings/utils/calendarPickerGroups
 *
 * Pure grouping helpers for the calendar picker sheet.
 */
export interface PickerCalendar {
  id: string;
  title: string;
  sourceName: string;
  sourceType: string;
  isLocal: boolean;
}

export interface CalendarSourceGroup<
  T extends PickerCalendar = PickerCalendar,
> {
  sourceName: string;
  isLocal: boolean;
  calendars: T[];
}

export function groupCalendarsBySource<T extends PickerCalendar>(
  calendars: T[]
): CalendarSourceGroup<T>[] {
  const order: string[] = [];
  const bySource = new Map<string, CalendarSourceGroup<T>>();

  for (const cal of calendars) {
    const key = `${cal.isLocal ? 'local' : 'remote'}:${cal.sourceName}`;
    let group = bySource.get(key);
    if (!group) {
      group = {
        sourceName: cal.sourceName,
        isLocal: cal.isLocal,
        calendars: [],
      };
      bySource.set(key, group);
      order.push(key);
    }
    group.calendars.push(cal);
  }

  // Non-local sources first so Google/Outlook surface above "On My iPhone".
  return order
    .map(key => bySource.get(key))
    .filter((group): group is CalendarSourceGroup<T> => group != null)
    .sort((a, b) => Number(a.isLocal) - Number(b.isLocal));
}

export function hasNonLocalWritableCalendar(
  calendars: PickerCalendar[]
): boolean {
  return calendars.some(cal => !cal.isLocal);
}
