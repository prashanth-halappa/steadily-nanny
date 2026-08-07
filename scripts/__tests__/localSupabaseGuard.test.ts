/**
 * `assertLocalSupabaseUrl` (GOLDEN-FIXES #26) — shared by every script that
 * reads `apps/api/.env` (which points at the REMOTE project) for a
 * service-role key. Started life inside `seed-test-users.ts`; moved here
 * once `seed-second-household.ts` and `seed-e2e-approval-fixtures.ts`
 * turned out to have the identical unguarded hazard.
 */
import { describe, expect, it } from 'bun:test';
import { assertLocalSupabaseUrl } from '../localSupabaseGuard';

describe('assertLocalSupabaseUrl', () => {
  it('refuses a hosted Supabase URL, naming the resolved host', () => {
    expect(() =>
      assertLocalSupabaseUrl('https://dylhrlvfkibipdkguptz.supabase.co')
    ).toThrow(/refuses to run against dylhrlvfkibipdkguptz\.supabase\.co/);
  });

  it('permits 127.0.0.1, localhost, and ::1', () => {
    expect(() =>
      assertLocalSupabaseUrl('http://127.0.0.1:54321')
    ).not.toThrow();
    expect(() =>
      assertLocalSupabaseUrl('http://localhost:54321')
    ).not.toThrow();
    expect(() => assertLocalSupabaseUrl('http://[::1]:54321')).not.toThrow();
  });
});

// Source-text check, not a real call: these three scripts build a
// service-role client at import time (no `import.meta.main` gate on the
// two seed-* siblings), so actually importing them here would hit the
// network. A grep is the only thing that will catch a FOURTH script being
// added later with a `createClient(` and no guard in front of it — if you
// add one, add its guard call here too.
describe('every service-role seed script guards its client', () => {
  const scripts = [
    '../seed-test-users.ts',
    '../seed-second-household.ts',
    '../seed-e2e-approval-fixtures.ts',
  ];

  it.each(
    scripts
  )('%s calls assertLocalSupabaseUrl before createClient(', async relPath => {
    const src = await Bun.file(new URL(relPath, import.meta.url)).text();
    const guardIndex = src.indexOf('assertLocalSupabaseUrl(');
    const clientIndex = src.indexOf('createClient(');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(clientIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(clientIndex);
  });
});
