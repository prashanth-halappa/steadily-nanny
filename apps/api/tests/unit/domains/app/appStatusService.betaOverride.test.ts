/**
 * The beta override matches on user id OR email. When the caller's email is
 * not passed in, it now comes from the Better Auth `user` table (D1), not
 * Supabase's auth.admin.getUserById.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { user } from '../../../../src/db/schema';
import { createTestDb, type TestDb } from '../../../helpers/testDb';

let t: TestDb;
let getAppStatus: typeof import('../../../../src/domains/app/services/appStatusService').getAppStatus;
const orFilters: string[] = [];

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../src/db/client', () => ({ db: t.db }));

  const chain = {
    select: () => chain,
    limit: () => chain,
    eq: () => chain,
    or: (filter: string) => {
      orFilters.push(filter);
      return chain;
    },
    single: async () => ({
      data: { min_supported_version: '1.0.0', latest_version: '1.0.0' },
      error: null,
    }),
    maybeSingle: async () => ({ data: { beta_all_pro: true }, error: null }),
  };
  mock.module('../../../../src/config/supabase', () => ({
    supabaseService: { from: () => chain },
  }));

  ({ getAppStatus } = await import(
    '../../../../src/domains/app/services/appStatusService'
  ));
});

afterAll(async () => {
  await t.dispose();
  mock.restore();
});

describe('getAppStatus beta override', () => {
  it('looks the email up in the Better Auth user table when not given', async () => {
    await t.db
      .insert(user)
      .values({ id: 'u-1', name: 'Priya', email: 'priya@example.test' });

    const status = await getAppStatus('1.0.0', 'ios', 'u-1');

    expect(orFilters).toEqual([
      'user_id.eq.u-1,email.ilike.priya@example.test',
    ]);
    expect(status.betaAllPro).toBe(true);
  });
});
