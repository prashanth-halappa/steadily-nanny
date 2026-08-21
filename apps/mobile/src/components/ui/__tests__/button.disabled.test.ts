/**
 * @module components/ui/__tests__/button.disabled
 *
 * Disabled buttons must fade (opacity-60). opacity-100 cancels the fade so
 * muted is only ~2% from secondary — a parent taps Approve and nothing happens.
 * Source-text test: bun.setup.ts stubs buttonVariants to '', so class strings
 * are invisible to a component render.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const buttonPath = join(__dirname, '../button.tsx');
let buttonSource: string;

beforeAll(async () => {
  buttonSource = await Bun.file(buttonPath).text();
});

describe('buttonVariants disabled opacity', () => {
  it('has no disabled:opacity-100 (fade must not be cancelled)', () => {
    expect(buttonSource).not.toMatch(/disabled:opacity-100/);
  });

  it('pairs every disabled:bg-muted with disabled:opacity-60', () => {
    const mutedMatches = buttonSource.match(/disabled:bg-muted/g) ?? [];
    expect(mutedMatches.length).toBeGreaterThan(0);
    expect(buttonSource).toMatch(
      /disabled:bg-muted(?:\s+disabled:opacity-60|[^'"]*disabled:opacity-60)/
    );
    // Every occurrence must be on a class string that also has opacity-60
    for (const match of buttonSource.matchAll(
      /'[^']*disabled:bg-muted[^']*'/g
    )) {
      expect(match[0]).toMatch(/disabled:opacity-60/);
    }
  });
});
