/**
 * @module domains/setup/childAge
 *
 * The wire contract stores a child's `birth_date` (see
 * `packages/shared-types/src/schemas/child.schema.ts`: "Age is always derived
 * client-side from this — never stored as an age"), but the add/edit-child UI
 * asks for a simple whole-number age. These helpers convert both ways: age ->
 * an approximate birth_date (Jan 1 of the birth year — the exact day is
 * unknown from age alone) for writes, and birth_date -> age for display.
 */

/** Approximate ISO `YYYY-MM-DD` birth date for a given whole-number age, as of today. */
export function birthDateFromAge(age: number, now: Date = new Date()): string {
  const birthYear = now.getFullYear() - age;
  return `${birthYear}-01-01`;
}

/** Whole-number age derived from an ISO birth date, or null if absent/invalid. */
export function ageFromBirthDate(
  birthDate: string | null,
  now: Date = new Date()
): number | null {
  if (!birthDate) return null;
  const parsed = new Date(birthDate);
  if (Number.isNaN(parsed.getTime())) return null;

  let age = now.getFullYear() - parsed.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > parsed.getMonth() ||
    (now.getMonth() === parsed.getMonth() && now.getDate() >= parsed.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;

  return age < 0 ? null : age;
}
