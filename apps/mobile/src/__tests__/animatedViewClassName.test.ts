import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Glob } from 'bun';

/**
 * GUARDRAIL: never apply a NativeWind `className` to a Reanimated `Animated.View`.
 * It overflows its parent and `overflow-hidden` does NOT clip it. Use inline
 * `style={{}}` (via useThemeColors) instead. Canonical reference:
 * src/components/ui/loading-indicator.tsx.
 */
describe('guardrail: className on Animated.View', () => {
  it('is never used anywhere in the app source', async () => {
    // Matches `<Animated.View ... className=` up to the closing `>` of the tag
    // (the char class matches newlines, so it catches multi-line opening tags).
    const offendingTag = /<Animated\.View\b[^>]*className=/;
    const offenders: string[] = [];

    const glob = new Glob('{src,lib}/**/*.tsx');
    for await (const file of glob.scan({
      cwd: process.cwd(),
      absolute: true,
    })) {
      const content = readFileSync(file, 'utf8');
      if (offendingTag.test(content)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});
