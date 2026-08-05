/**
 * @module domains/setup/__tests__/SetupScreenShell.test
 *
 * Source-inspection guard: SetupScreenShell must not re-apply the top safe-area
 * inset — `(private)/_layout.tsx` and `onboarding/_layout.tsx` own that edge.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const shellPath = join(__dirname, '../components/SetupScreenShell.tsx');
let shellSource: string;

beforeAll(async () => {
  shellSource = await Bun.file(shellPath).text();
});

describe('SetupScreenShell safe-area edges', () => {
  it('applies bottom/left/right safe area only — not top', () => {
    expect(shellSource).toContain("edges={['bottom', 'left', 'right']}");
    expect(shellSource).not.toContain("edges={['top']}");
    expect(shellSource).not.toMatch(/edges=\{[^}]*'top'/);
  });
});
