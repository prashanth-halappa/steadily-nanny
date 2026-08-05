import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Glob } from 'bun';

/**
 * GUARDRAIL (Phase 3+4 adversarial review, finding 14): the display-major /
 * store-minor conversion lives in EXACTLY ONE place —
 * `src/lib/money.ts`'s `formatMoney`/`formatRate`/`parseMajorToMinor`/
 * `minorToMajorText`. `docs/11-MONEY.md` §1 is explicit: "nobody hand-rolls
 * `* 100` / `/ 100` elsewhere." `ExpenseAddSheet.tsx` and `PayChangeSheet.tsx`
 * both did (`(minor / 100).toFixed(2)`), each its own silent little
 * reimplementation of `minorToMajorText` that would drift the moment one of
 * them changed rounding behaviour and the other didn't.
 *
 * Same comment-stripping discipline as `noBareModal.test.ts` — a doc comment
 * *explaining* the rule (like this one, and this file's own source) must
 * never trip the guardrail it describes.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('guardrail: no hand-rolled minor/100 money math outside lib/money.ts', () => {
  it('every "/ 100" division lives in src/lib/money.ts', async () => {
    const offenders: string[] = [];
    const glob = new Glob('src/**/*.{ts,tsx}');
    for await (const file of glob.scan({
      cwd: process.cwd(),
      absolute: true,
    })) {
      if (file.endsWith('/src/lib/money.ts')) continue;
      if (file.includes('__tests__') || /\.test\.tsx?$/.test(file)) continue;
      const content = stripComments(readFileSync(file, 'utf8'));
      if (/\/\s*100\b/.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('still catches a real hand-rolled division', () => {
    expect(/\/\s*100\b/.test(stripComments('(minor / 100).toFixed(2)'))).toBe(
      true
    );
    expect(
      /\/\s*100\b/.test(
        stripComments('// docs/11-MONEY.md §1: nobody hand-rolls / 100')
      )
    ).toBe(false);
  });
});
