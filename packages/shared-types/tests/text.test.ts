import { describe, expect, it } from 'bun:test';
import { countSentences, countWords } from '../src/text';

describe('text utils', () => {
  describe('countWords', () => {
    it('counts words separated by whitespace', () => {
      expect(countWords('one two three')).toBe(3);
    });

    it('collapses multiple spaces, tabs, and newlines', () => {
      expect(countWords('  one   two\nthree\t four ')).toBe(4);
    });

    it('returns 0 for an empty or whitespace-only string', () => {
      expect(countWords('')).toBe(0);
      expect(countWords('   ')).toBe(0);
    });

    it('counts a single word', () => {
      expect(countWords('hello')).toBe(1);
    });
  });

  describe('countSentences', () => {
    it('counts sentences ending in . ! or ?', () => {
      expect(countSentences('Hi there. How are you? Great!')).toBe(3);
    });

    it('treats consecutive terminators as a single sentence', () => {
      expect(countSentences('Really?! Yes...')).toBe(2);
    });

    it('returns 0 when there is no terminator', () => {
      expect(countSentences('no terminator here')).toBe(0);
    });
  });
});
