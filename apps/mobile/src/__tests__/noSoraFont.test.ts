import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Glob } from 'bun';

/**
 * GUARDRAIL: Ledger uses the platform face. NativeWind silently drops unknown
 * utility classes — a leftover `font-sora-medium` produces no error and no
 * weight. Assert zero `font-sora` / `'Sora-` matches in source.
 *
 * (This file intentionally mentions those strings only inside RegExp sources
 * and this comment block naming the migration.)
 */
describe('guardrail: no Sora references', () => {
  it('has zero Sora font utilities or family literals outside this guardrail', async () => {
    const offenders: string[] = [];
    // Split construction so this file itself does not trip a naive string search
    // if the skip below ever regresses.
    const soraUtil = new RegExp('font-' + 'sora');
    const soraFamily = new RegExp(`['"]Sora` + '-');

    const glob = new Glob('{src,lib}/**/*.{ts,tsx}');
    for await (const file of glob.scan({
      cwd: process.cwd(),
      absolute: true,
    })) {
      if (file.includes('noSoraFont')) continue;
      const content = readFileSync(file, 'utf8');
      if (soraUtil.test(content) || soraFamily.test(content)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
