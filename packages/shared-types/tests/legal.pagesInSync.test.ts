/**
 * GOLDEN-FIXES #20: bumping CURRENT_LEGAL_VERSION re-prompts every user, so it
 * must never drift from what the published pages say. Both pages state
 * "Effective and last updated: <Month D, YYYY>"; this pins them to the constant.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CURRENT_LEGAL_VERSION } from '../src/schemas/legal.schema';

const PUBLIC_DIR = join(import.meta.dir, '../../../infra/nanny-site/public');

const expected = new Date(
  `${CURRENT_LEGAL_VERSION}T00:00:00Z`
).toLocaleDateString('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

describe('legal pages match CURRENT_LEGAL_VERSION', () => {
  for (const page of ['terms.html', 'privacy.html']) {
    it(`${page} states the current version date`, () => {
      const html = readFileSync(join(PUBLIC_DIR, page), 'utf8');
      expect(html).toContain(`Effective and last updated: ${expected}`);
    });
  }
});
