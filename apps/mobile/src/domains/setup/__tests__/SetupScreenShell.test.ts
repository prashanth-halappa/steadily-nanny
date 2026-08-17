/**
 * @module domains/setup/__tests__/SetupScreenShell.test
 *
 * Source-inspection guard: SetupScreenShell must not re-apply the top safe-area
 * inset — `(private)/_layout.tsx` and `onboarding/_layout.tsx` own that edge.
 * The BOTTOM edge is deliberately absent too: the pinned CTA carries its own
 * `pb-8`, and with the KeyboardAvoidingView in place a bottom inset would be
 * counted a second time on top of the keyboard's own height.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const shellPath = join(__dirname, '../components/SetupScreenShell.tsx');
let shellSource: string;

beforeAll(async () => {
  shellSource = await Bun.file(shellPath).text();
});

describe('SetupScreenShell safe-area edges', () => {
  it('applies left/right safe area only — neither top nor bottom', () => {
    expect(shellSource).toContain("edges={['left', 'right']}");
    expect(shellSource).not.toMatch(/edges=\{[^}]*'top'/);
    expect(shellSource).not.toMatch(/edges=\{[^}]*'bottom'/);
  });

  it('wraps the scroll body and the pinned CTA in one KeyboardAvoidingView', () => {
    expect(shellSource).toContain('<KeyboardAvoidingView');
    // One wrapper, not one per child.
    expect(shellSource.match(/<KeyboardAvoidingView/g)).toHaveLength(1);
    // It opens before the ScrollView and closes after the CTA block.
    const kavOpen = shellSource.indexOf('<KeyboardAvoidingView');
    const kavClose = shellSource.indexOf('</KeyboardAvoidingView>');
    expect(kavOpen).toBeLessThan(shellSource.indexOf('<ScrollView'));
    expect(kavClose).toBeGreaterThan(shellSource.indexOf('-cta'));
  });
});
