import { describe, expect, test } from 'bun:test';
import {
  createUnmaskBuffer,
  maskPII,
  unmaskObjectPII,
} from '../../../src/utils/piiMasking';

describe('maskPII', () => {
  test('masks a name with the default [NAME] placeholder', () => {
    expect(maskPII('Alex went to the park', 'Alex')).toBe(
      '[NAME] went to the park'
    );
  });

  test('honors a custom placeholder', () => {
    expect(maskPII('Alex is here', 'Alex', { placeholder: '[CHILD]' })).toBe(
      '[CHILD] is here'
    );
  });

  test('does not mask a substring inside another word', () => {
    expect(maskPII('Alexander is tall', 'Alex')).toBe('Alexander is tall');
  });

  test('common-word name: skips sentence-initial, masks mid-sentence', () => {
    // "Will" as a modal verb at sentence start is left alone; the possessive
    // mid-sentence use is masked.
    const out = maskPII('Will you help my son Will today', 'Will');
    expect(out.startsWith('Will you')).toBe(true);
    expect(out).toContain('[NAME]');
  });

  test('masks CJK names via substring fallback', () => {
    expect(maskPII('これは さくら です', 'さくら')).toBe('これは [NAME] です');
  });
});

describe('unmaskObjectPII', () => {
  test('restores the name across nested objects/arrays', () => {
    const input = { title: 'For [NAME]', items: ['[NAME] wins'] };
    expect(unmaskObjectPII(input, 'Alex')).toEqual({
      title: 'For Alex',
      items: ['Alex wins'],
    });
  });

  test('restores a bracket-dropped ALL-CAPS leak but not ordinary words', () => {
    expect(unmaskObjectPII('NAME grew, the name field', 'Alex')).toBe(
      'Alex grew, the name field'
    );
  });
});

describe('createUnmaskBuffer', () => {
  test('reassembles a placeholder split across streamed chunks', () => {
    const buf = createUnmaskBuffer('Alex');
    let out = buf.push('Hello [NA');
    out += buf.push('ME] there');
    out += buf.flush();
    expect(out).toBe('Hello Alex there');
  });
});
