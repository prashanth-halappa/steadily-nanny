/**
 * Pattern-A: root package.json exposes `seed` chaining the three fixtures.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const rootPackageJson = join(import.meta.dir, '../../package.json');

describe('root seed script', () => {
  it('chains seed-test-users → seed-second-household → seed-e2e-approval-fixtures with &&', () => {
    const pkg = JSON.parse(readFileSync(rootPackageJson, 'utf8')) as {
      scripts: Record<string, string>;
    };
    const seed = pkg.scripts.seed ?? '';
    expect(seed).toContain('scripts/seed-test-users.ts');
    expect(seed).toContain('scripts/seed-second-household.ts');
    expect(seed).toContain('scripts/seed-e2e-approval-fixtures.ts');
    expect(seed).toContain('seed-test-users.ts &&');
    expect(seed).toContain('seed-second-household.ts &&');
    expect(seed.indexOf('seed-test-users')).toBeLessThan(
      seed.indexOf('seed-second-household')
    );
    expect(seed.indexOf('seed-second-household')).toBeLessThan(
      seed.indexOf('seed-e2e-approval-fixtures')
    );
  });
});
