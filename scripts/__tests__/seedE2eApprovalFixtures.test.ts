/**
 * Pattern-A — seed-e2e-approval-fixtures skips (exit 0) when prerequisites
 * are not yet satisfied via the app.
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const scriptPath = join(import.meta.dir, '../seed-e2e-approval-fixtures.ts');

describe('seed-e2e-approval-fixtures.ts', () => {
  it('skips with exit 0 when nanny is not an active member of Our household', async () => {
    const src = await Bun.file(scriptPath).text();

    expect(src).toContain(
      'Could not find a "${HOUSEHOLD_NAME}" household with ${NANNY_EMAIL} as an active member'
    );
    expect(src).toContain('[skip]');
    expect(src).toMatch(/if \(!householdId\)[\s\S]*process\.exit\(0\)/);
  });

  it('still fails fast when test users are missing', async () => {
    const src = await Bun.file(scriptPath).text();

    expect(src).toMatch(/not found\. Run scripts\/seed-test-users\.ts first/);
    expect(src).toContain('process.exit(1)');
  });
});
