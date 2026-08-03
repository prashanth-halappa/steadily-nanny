/**
 * @module components/ui/__tests__/button.disabled
 * Daylight #26 / #39 — disabled must not look enabled; sm must meet 44pt on native.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BUTTON_SRC = readFileSync(join(import.meta.dir, '../button.tsx'), 'utf8');

describe('Button disabled and sm size (Pattern A)', () => {
  it('does not use opacity-50 alone for the disabled look', () => {
    // opacity-50 on plum reads as an enabled lavender secondary (~1.5:1 label).
    expect(BUTTON_SRC).not.toMatch(/props\.disabled\s*&&\s*['"]opacity-50/);
    expect(BUTTON_SRC).toMatch(/disabled:/);
  });

  it('gives size=sm a native height that meets the 44pt minimum', () => {
    expect(BUTTON_SRC).toMatch(/sm:\s*['`][^'`]*native:h-12/);
  });
});
