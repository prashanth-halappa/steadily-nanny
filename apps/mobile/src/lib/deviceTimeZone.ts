/**
 * @module lib/deviceTimeZone
 * Best-effort IANA zone from expo-localization calendars (D29 seeding).
 */
import { getCalendars } from 'expo-localization';

export function getDeviceTimeZone(): string {
  try {
    const calendars = getCalendars();
    return calendars[0]?.timeZone ?? 'UTC';
  } catch {
    return 'UTC';
  }
}
