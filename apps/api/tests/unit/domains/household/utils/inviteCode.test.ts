import { describe, expect, it, spyOn } from 'bun:test';
import {
  generateInviteCode,
  generateUniqueInviteCode,
  INVITE_CODE_ALPHABET,
  isValidInviteCodeFormat,
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
