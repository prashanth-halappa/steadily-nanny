/**
 * @module domains/setup/utils/__tests__/inviteCodeInput
 *
 * The field a carer meets before she has any reason to trust the app. A
 * predictive keyboard was caught inserting the literal word "THE" into it, and
 * a code typed without the hyphen was rejected as wrong. Both are the field's
 * fault, not hers.
 */
import { describe, expect, it } from 'bun:test';
import {
  formatInviteCodeInput,
  INVITE_CODE_INPUT_MAX_LENGTH,
} from '@/src/domains/setup/utils/inviteCodeInput';

describe('formatInviteCodeInput', () => {
  it('inserts the hyphen as she types past the third character', () => {
    expect(formatInviteCodeInput('R4K')).toBe('R4K');
    expect(formatInviteCodeInput('R4K9')).toBe('R4K-9');
    expect(formatInviteCodeInput('R4K92T')).toBe('R4K-92T');
  });

  it('leaves a correctly typed code alone', () => {
    expect(formatInviteCodeInput('R4K-92T')).toBe('R4K-92T');
  });

  it('uppercases, so the shift key is not load-bearing', () => {
    expect(formatInviteCodeInput('r4k92t')).toBe('R4K-92T');
  });

  it('drops what a keyboard or a paste adds — spaces, words, punctuation', () => {
    expect(formatInviteCodeInput('R4K 92T')).toBe('R4K-92T');
    expect(formatInviteCodeInput('  R4K-92T  ')).toBe('R4K-92T');
    // The captured failure: QuickType completing a word into the field.
    expect(formatInviteCodeInput('THE')).toBe('THE');
    expect(formatInviteCodeInput('R4K-92T THE')).toBe('R4K-92T');
  });

  it('cannot exceed the code length, however much is pasted', () => {
    const out = formatInviteCodeInput('R4K92TXXXXXXXX');
    expect(out).toBe('R4K-92T');
    expect(out.length).toBeLessThanOrEqual(INVITE_CODE_INPUT_MAX_LENGTH);
  });

  it('does not eat characters under the cursor', () => {
    // O/1 can never be in a real code, but deleting them as she types would
    // make the field feel broken. Let them through; the lookup says no.
    expect(formatInviteCodeInput('O1O1O1')).toBe('O1O-1O1');
  });

  it('is idempotent — re-running over its own output changes nothing', () => {
    const once = formatInviteCodeInput('r4k 92t');
    expect(formatInviteCodeInput(once)).toBe(once);
  });
});
