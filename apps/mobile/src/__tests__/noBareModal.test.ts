import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Glob } from 'bun';

/**
 * GUARDRAIL: never present a bare React-Native `<Modal>` above the navigator — on
 * iOS it can strand a transparent, touch-blocking UIWindow (app appears frozen).
 * The ONLY sanctioned wrapper is BottomSheetBase.
 */
describe('guardrail: no bare RN <Modal>', () => {
  it('is only used inside BottomSheetBase', async () => {
    const offenders: string[] = [];
    const glob = new Glob('{src,lib}/**/*.tsx');
    for await (const file of glob.scan({
      cwd: process.cwd(),
      absolute: true,
    })) {
      if (file.includes('BottomSheetBase')) continue;
      if (file.includes('__tests__') || file.endsWith('.test.tsx')) continue;
      const content = readFileSync(file, 'utf8');
      if (/<Modal\b/.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
