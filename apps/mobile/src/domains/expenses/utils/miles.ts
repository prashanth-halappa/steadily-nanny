/**
 * @module domains/expenses/utils/miles
 *
 * Parses the miles a nanny typed into a mileage claim, mirroring
 * `lib/money.ts`'s `parseMajorToMinor` discipline: VALIDATE the whole
 * string and refuse (return `null`) rather than clean/coerce whatever
 * partially parses. `packages/shared-types/src/schemas/expense.schema.ts`'s
 * `MilesSchema` backs a `numeric(6,1)` DB column — at most ONE decimal
 * place — so this function rejects anything finer client-side with a clear
 * message, instead of letting the server bounce it (or, worse, the DB
 * silently truncating a value that never reaches this validation).
 */

/** Whole or one-decimal-place positive number: `12`, `12.4`. No sign, no
 * grouping — miles are typed directly, never copied from a formatted
 * display the way a money amount can be. */
const MILES_PATTERN = /^\d+(?:\.\d)?$/;

/**
 * Parses what someone typed into minutes-of-precision-safe miles, or
 * `null` when the text:
 *   - isn't a number at all, or carries any trailing/leading junk,
 *   - has more than one decimal place,
 *   - is zero or negative (a mileage claim of 0 miles is not a claim; the
 *     wire schema's `MilesSchema` is `.positive()`).
 */
export function parseMilesInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!MILES_PATTERN.test(trimmed)) return null;

  const miles = Number(trimmed);
  if (!Number.isFinite(miles) || miles <= 0) return null;
  return miles;
}
