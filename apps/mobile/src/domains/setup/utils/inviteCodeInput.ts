/**
 * @module domains/setup/utils/inviteCodeInput
 *
 * Format-as-you-type for the household invite code.
 *
 * The code is generated for humans — `inviteCode.ts` on the API side draws
 * from an alphabet with the ambiguous glyphs removed (no 0/O, no 1/I/L)
 * precisely "because this code gets read aloud over the phone and typed in by
 * hand". The entry field then undid that care: it accepted anything, and the
 * only normalisation before lookup was `.trim().toUpperCase()`. So a carer who
 * typed `R4K92T` without the hyphen — a reasonable reading of "six characters"
 * — got told her code was wrong.
 *
 * This makes the wrong shapes untypeable rather than rejected: strip whatever
 * is not code-alphabet, uppercase, cap at six, and put the hyphen in.
 */

/** Six code characters plus the hyphen this inserts. */
export const INVITE_CODE_INPUT_MAX_LENGTH = 7;

const CODE_CHARS = 6;
const SEGMENT = 3;

/**
 * Normalise raw keystrokes/paste into `XXX-XXX`.
 *
 * Deliberately does NOT drop the glyphs the generator avoids (O, 0, I, 1, L).
 * They can never appear in a real code, so silently eating them would delete
 * a character under the typing cursor and leave the person unable to see what
 * they typed. Let them through and let the lookup say no.
 */
export function formatInviteCodeInput(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_CHARS);
  return cleaned.length > SEGMENT
    ? `${cleaned.slice(0, SEGMENT)}-${cleaned.slice(SEGMENT)}`
    : cleaned;
}
