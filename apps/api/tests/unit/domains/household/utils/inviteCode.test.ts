import { describe, expect, it, spyOn } from 'bun:test';
import {
  generateInviteCode,
  generateUniqueInviteCode,
  INVITE_CODE_ALPHABET,
  isValidInviteCodeFormat,
  normalizeInviteCode,
} from '../../../../../src/domains/household/utils/inviteCode';

describe('INVITE_CODE_ALPHABET', () => {
  it('excludes ambiguous glyphs: 0, O, 1, I, L', () => {
    for (const glyph of ['0', 'O', '1', 'I', 'L']) {
      expect(INVITE_CODE_ALPHABET).not.toContain(glyph);
    }
  });
});

describe('generateInviteCode', () => {
  it('produces XXX-XXX format from the restricted alphabet', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateInviteCode();
      expect(code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
      expect(isValidInviteCodeFormat(code)).toBe(true);
      for (const char of code.replace('-', '')) {
        expect(INVITE_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it('does not use Math.random', () => {
    const randomSpy = spyOn(Math, 'random');
    generateInviteCode();
    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });
});

describe('generateUniqueInviteCode', () => {
  it('retries on collision until the exists-check accepts a candidate', async () => {
    let calls = 0;
    const exists = async () => {
      calls += 1;
      return calls === 1; // first candidate collides, second is free
    };
    const code = await generateUniqueInviteCode(exists);
    expect(code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    expect(calls).toBe(2);
  });

  it('throws after exhausting retries rather than looping forever', async () => {
    await expect(generateUniqueInviteCode(async () => true)).rejects.toThrow();
  });
});

/**
 * `normalizeInviteCode` — the codes a person actually types.
 *
 * The generator deliberately avoids ambiguous glyphs "because this code gets
 * read aloud over the phone and typed in by hand". The lookup then compared
 * strings exactly, so a carer who typed the six characters without the hyphen
 * was told her code was wrong. These are all the same code.
 */
describe('normalizeInviteCode', () => {
  it('accepts the code exactly as it is displayed', () => {
    expect(normalizeInviteCode('R4K-92T')).toBe('R4K-92T');
  });

  it('accepts the six characters with no hyphen — "six characters like R4K-92T"', () => {
    expect(normalizeInviteCode('R4K92T')).toBe('R4K-92T');
  });

  it('accepts lower case, as a messaging app or keyboard may deliver it', () => {
    expect(normalizeInviteCode('r4k-92t')).toBe('R4K-92T');
  });

  it('accepts spaces and stray punctuation around a pasted token', () => {
    expect(normalizeInviteCode('  R4K 92T ')).toBe('R4K-92T');
    expect(normalizeInviteCode('R4K–92T')).toBe('R4K-92T'); // en dash
  });

  it('ignores a hyphen typed in the wrong place', () => {
    expect(normalizeInviteCode('R-4K92T')).toBe('R4K-92T');
  });

  it('never returns more than the six code characters', () => {
    expect(normalizeInviteCode('R4K-92T-EXTRA')).toBe('R4K-92T');
  });

  it('leaves a partial code partial rather than inventing a hyphen', () => {
    expect(normalizeInviteCode('R4K')).toBe('R4K');
    expect(normalizeInviteCode('R4')).toBe('R4');
    expect(normalizeInviteCode('')).toBe('');
  });

  it('normalises what it is given without vouching for it — a wrong code stays wrong', () => {
    // O and 1 can never appear in a generated code. Passing them through
    // rather than silently deleting them is deliberate: the lookup says no,
    // instead of the field eating characters under the cursor.
    expect(normalizeInviteCode('O1O-1O1')).toBe('O1O-1O1');
  });
});
