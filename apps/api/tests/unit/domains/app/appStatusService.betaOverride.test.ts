/**
 * `getAppStatus` on a real D1: the global config row plus the per-user beta
 * override, matched on user id OR (case-insensitive) email. When the caller's
 * email is not passed in, it comes from the Better Auth `user` table.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import { createTestDb, type TestDb } from '../../../helpers/testDb';

let t: TestDb;
let getAppStatus: typeof import('../../../../src/domains/app/services/appStatusService').getAppStatus;
let cache: typeof import('../../../../src/utils/cache').cache;

const run = (sql: string, ...binds: unknown[]) =>
  t.d1
    .prepare(sql)
    .bind(...binds)
    .run();

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../src/db/client', () => ({ db: t.db }));
  ({ getAppStatus } = await import(
    '../../../../src/domains/app/services/appStatusService'
  ));
  ({ cache } = await import('../../../../src/utils/cache'));
});

afterAll(() => t.dispose());

beforeEach(async () => {
  cache.del(cache.keys());
  for (const table of ['user_beta_overrides', 'app_config', 'user']) {
    await run(`DELETE FROM ${table}`);
  }
  await run(
    "INSERT INTO user (id, name, email) VALUES ('u-1', 'Priya', 'priya@example.test')"
  );
});

describe('getAppStatus', () => {
  it('returns safe defaults when there is no config row', async () => {
    const status = await getAppStatus('1.0.0', 'ios', 'u-1');
    expect(status.status).toBe('ok');
    expect(status.update.currentVersion).toBe('1.0.0');
    expect(status.betaAllPro).toBe(false);
  });

  it('computes update flags and store url from the config row', async () => {
    await run(
      `INSERT INTO app_config (id, min_supported_version, latest_version, android_store_url, announcements)
       VALUES (1, '1.1.0', '1.2.0', 'https://play.test', '[]')`
    );
    const status = await getAppStatus('1.0.0', 'android');
    expect(status.update).toMatchObject({
      required: true,
      available: true,
      storeUrl: 'https://play.test',
    });
  });
});

describe('getAppStatus beta override', () => {
  beforeEach(async () => {
    await run(
      "INSERT INTO app_config (id, latest_version, beta_all_pro) VALUES (1, '1.0.0', 0)"
    );
  });

  it('matches by the email from the Better Auth user table, case-insensitively', async () => {
    await run(
      "INSERT INTO user_beta_overrides (id, email, beta_all_pro) VALUES ('o1', 'PRIYA@example.test', 1)"
    );
    expect((await getAppStatus('1.0.0', 'ios', 'u-1')).betaAllPro).toBe(true);
  });

  it('matches by user id', async () => {
    await run(
      "INSERT INTO user_beta_overrides (id, user_id, beta_all_pro) VALUES ('o1', 'u-1', 1)"
    );
    expect(
      (await getAppStatus('1.0.0', 'ios', 'u-1', 'other@example.test'))
        .betaAllPro
    ).toBe(true);
  });

  it("ignores someone else's override", async () => {
    await run(
      "INSERT INTO user_beta_overrides (id, email, beta_all_pro) VALUES ('o1', 'x@example.test', 1)"
    );
    expect((await getAppStatus('1.0.0', 'ios', 'u-1')).betaAllPro).toBe(false);
  });
});
