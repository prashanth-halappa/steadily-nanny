/**
 * Human-transcribable household invite code generation.
 *
 * Format: XXX-XXX, uppercase, drawn from an alphabet with ambiguous glyphs
 * removed (no 0/O, no 1/I/L) — this code gets read aloud over the phone and
 * typed in by hand, so a code containing 'O' vs '0' or 'I' vs '1' would be a
 * support ticket waiting to happen.
 *
 * @module domains/household/utils/inviteCode
 */
import { randomInt } from 'node:crypto';
import { DatabaseError } from '../../../errors';

/** A-Z minus I/L/O, plus 2-9 minus 0/1. 31 characters. */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const SEGMENT_LENGTH = 3;
const CODE_FORMAT = /^[A-Z2-9]{3}-[A-Z2-9]{3}$/;
const MAX_GENERATION_ATTEMPTS = 10;

function randomSegment(length: number): string {
  let segment = '';
  for (let i = 0; i < length; i += 1) {
    const index = randomInt(INVITE_CODE_ALPHABET.length);
    segment += INVITE_CODE_ALPHABET[index];
  }
  return segment;
}

/** Generate one candidate code in XXX-XXX format. Not guaranteed unique. */
export function generateInviteCode(): string {
  return `${randomSegment(SEGMENT_LENGTH)}-${randomSegment(SEGMENT_LENGTH)}`;
}

/** Whether a string matches the XXX-XXX invite code shape. */
export function isValidInviteCodeFormat(code: string): boolean {
  return CODE_FORMAT.test(code);
}

/**
 * Generate a code guaranteed unique against `exists`, retrying on collision.
 * Throws after MAX_GENERATION_ATTEMPTS rather than looping forever if the
 * keyspace is somehow exhausted or `exists` is misbehaving.
 */
export async function generateUniqueInviteCode(
  exists: (code: string) => Promise<boolean>
): Promise<string> {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = generateInviteCode();
    const collides = await exists(candidate);
    if (!collides) {
      return candidate;
    }
  }
  throw new DatabaseError(
    'Failed to generate a unique invite code after multiple attempts',
    'INVITE_CODE_EXHAUSTED'
  );
}
