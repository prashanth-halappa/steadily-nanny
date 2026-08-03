/**
 * @module components/ui/__tests__/alert-dialog.footer
 * P0-4 leftover — flex-col-reverse inverts Cancel/destructive on native (sm: never fires).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(import.meta.dir, '../alert-dialog.tsx'), 'utf8');

describe('AlertDialogFooter (Pattern A)', () => {
  it('does not use flex-col-reverse (native never reaches the sm: breakpoint)', () => {
    expect(SRC).not.toContain('flex-col-reverse');
  });

  it('stacks actions in column order so Cancel stays above destructive', () => {
    expect(SRC).toMatch(/AlertDialogFooter[\s\S]*?flex flex-col/);
  });
});
