import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Glob } from 'bun';

/**
 * GUARDRAIL: never present a bare React-Native `<Modal>` above the navigator — on
 * iOS it can strand a transparent, touch-blocking UIWindow (app appears frozen).
 * The ONLY sanctioned wrapper is BottomSheetBase.
 *
 * Comments are stripped before matching. The original version grepped raw file
 * content, so a doc comment *explaining this very rule* tripped it — which
 * happened twice in one session, and both authors fixed it by rewording the
 * prose. That is the wrong direction of travel: a guardrail that punishes
 * writing down why it exists teaches people to stop writing it down, and the
 * next person meets the bare `<Modal>` trap with no explanation nearby.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

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
      const content = stripComments(readFileSync(file, 'utf8'));
      if (/<Modal\b/.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('still catches a real bare <Modal> in code', () => {
    // The guardrail must not be so lenient it stops working. A JSX usage
    // survives comment-stripping; the same text inside a comment does not.
    expect(/<Modal\b/.test(stripComments('const x = <Modal visible />;'))).toBe(
      true
    );
    expect(/<Modal\b/.test(stripComments('// never use <Modal> here'))).toBe(
      false
    );
    expect(
      /<Modal\b/.test(stripComments('/** Avoid `<Modal>` — see #1 */'))
    ).toBe(false);
  });
});
