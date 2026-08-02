/**
 * @module domains/setup/utils/timezones
 *
 * A curated, hand-picked list of common IANA time zone identifiers for the
 * household settings time zone picker — deliberately NOT
 * `Intl.supportedValuesOf('timeZone')` (~445 zones), for two reasons: this
 * codebase has no device pass confirming Hermes support for that API on the
 * pinned RN/Hermes version (see CLAUDE.md's "no device" constraint for
 * agents), and a flat 445-item picker with no search would be poor UX
 * regardless. Extend this list (or add search) if a household needs a zone
 * not covered here — every value below is a real IANA identifier, validated
 * against `Intl.DateTimeFormat` in this module's test.
 *
 * Never free-text: `HouseholdSchema.timezone` accepts any non-empty string,
 * and a typo'd zone (accepted by the schema, meaningless to
 * `Intl`/`AT TIME ZONE`) is worse than not offering the field at all — see
 * the team-lead brief for D-household-settings.
 */

export interface TimezoneOption {
  value: string;
  label: string;
}

export const COMMON_TIMEZONES: readonly TimezoneOption[] = [
  { value: 'UTC', label: 'UTC' },

  // Europe
  { value: 'Europe/London', label: 'London (Europe/London)' },
  { value: 'Europe/Dublin', label: 'Dublin (Europe/Dublin)' },
  { value: 'Europe/Lisbon', label: 'Lisbon (Europe/Lisbon)' },
  { value: 'Europe/Madrid', label: 'Madrid (Europe/Madrid)' },
  { value: 'Europe/Paris', label: 'Paris (Europe/Paris)' },
  { value: 'Europe/Amsterdam', label: 'Amsterdam (Europe/Amsterdam)' },
  { value: 'Europe/Brussels', label: 'Brussels (Europe/Brussels)' },
  { value: 'Europe/Berlin', label: 'Berlin (Europe/Berlin)' },
  { value: 'Europe/Zurich', label: 'Zurich (Europe/Zurich)' },
  { value: 'Europe/Rome', label: 'Rome (Europe/Rome)' },
  { value: 'Europe/Stockholm', label: 'Stockholm (Europe/Stockholm)' },
  { value: 'Europe/Oslo', label: 'Oslo (Europe/Oslo)' },
  { value: 'Europe/Copenhagen', label: 'Copenhagen (Europe/Copenhagen)' },
  { value: 'Europe/Warsaw', label: 'Warsaw (Europe/Warsaw)' },
  { value: 'Europe/Athens', label: 'Athens (Europe/Athens)' },
  { value: 'Europe/Istanbul', label: 'Istanbul (Europe/Istanbul)' },
  { value: 'Europe/Moscow', label: 'Moscow (Europe/Moscow)' },

  // Americas
  { value: 'America/St_Johns', label: 'Newfoundland (America/St_Johns)' },
  { value: 'America/Halifax', label: 'Halifax (America/Halifax)' },
  { value: 'America/New_York', label: 'New York (America/New_York)' },
  { value: 'America/Toronto', label: 'Toronto (America/Toronto)' },
  { value: 'America/Chicago', label: 'Chicago (America/Chicago)' },
  { value: 'America/Mexico_City', label: 'Mexico City (America/Mexico_City)' },
  { value: 'America/Denver', label: 'Denver (America/Denver)' },
  { value: 'America/Phoenix', label: 'Phoenix (America/Phoenix)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (America/Los_Angeles)' },
  { value: 'America/Vancouver', label: 'Vancouver (America/Vancouver)' },
  { value: 'America/Anchorage', label: 'Anchorage (America/Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Honolulu (Pacific/Honolulu)' },
  { value: 'America/Bogota', label: 'Bogotá (America/Bogota)' },
  { value: 'America/Lima', label: 'Lima (America/Lima)' },
  { value: 'America/Santiago', label: 'Santiago (America/Santiago)' },
  {
    value: 'America/Argentina/Buenos_Aires',
    label: 'Buenos Aires (America/Argentina/Buenos_Aires)',
  },
  { value: 'America/Sao_Paulo', label: 'São Paulo (America/Sao_Paulo)' },

  // Africa
  { value: 'Africa/Casablanca', label: 'Casablanca (Africa/Casablanca)' },
  { value: 'Africa/Lagos', label: 'Lagos (Africa/Lagos)' },
  { value: 'Africa/Cairo', label: 'Cairo (Africa/Cairo)' },
  { value: 'Africa/Nairobi', label: 'Nairobi (Africa/Nairobi)' },
  {
    value: 'Africa/Johannesburg',
    label: 'Johannesburg (Africa/Johannesburg)',
  },

  // Middle East / South & Central Asia
  { value: 'Asia/Dubai', label: 'Dubai (Asia/Dubai)' },
  { value: 'Asia/Karachi', label: 'Karachi (Asia/Karachi)' },
  { value: 'Asia/Kolkata', label: 'Mumbai / Delhi (Asia/Kolkata)' },
  { value: 'Asia/Dhaka', label: 'Dhaka (Asia/Dhaka)' },

  // Southeast & East Asia
  { value: 'Asia/Bangkok', label: 'Bangkok (Asia/Bangkok)' },
  { value: 'Asia/Jakarta', label: 'Jakarta (Asia/Jakarta)' },
  { value: 'Asia/Singapore', label: 'Singapore (Asia/Singapore)' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong (Asia/Hong_Kong)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (Asia/Shanghai)' },
  { value: 'Asia/Manila', label: 'Manila (Asia/Manila)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (Asia/Tokyo)' },
  { value: 'Asia/Seoul', label: 'Seoul (Asia/Seoul)' },

  // Oceania
  { value: 'Australia/Perth', label: 'Perth (Australia/Perth)' },
  { value: 'Australia/Adelaide', label: 'Adelaide (Australia/Adelaide)' },
  { value: 'Australia/Brisbane', label: 'Brisbane (Australia/Brisbane)' },
  { value: 'Australia/Sydney', label: 'Sydney (Australia/Sydney)' },
  { value: 'Pacific/Auckland', label: 'Auckland (Pacific/Auckland)' },
];

/** Look up a curated option by IANA value, or `undefined` if not covered. */
export function findTimezoneOption(value: string): TimezoneOption | undefined {
  return COMMON_TIMEZONES.find(z => z.value === value);
}
