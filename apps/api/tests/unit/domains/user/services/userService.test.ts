/** `UserService` profile CRUD on a real D1 (tests/helpers/testDb.ts). */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

let UserService: typeof import('../../../../../src/domains/user/services/userService').UserService;
let t: TestDb;

const profileRow = async () =>
  (await t.d1
    .prepare("SELECT * FROM user_profiles WHERE user_id = 'u1'")
    .first()) as Record<string, unknown> | null;

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  mock.module('../../../../../src/middlewares/logger', () => ({
    logger: { info: mock(), error: mock(), warn: mock(), debug: mock() },
  }));
  ({ UserService } = await import(
    '../../../../../src/domains/user/services/userService'
  ));
});

afterAll(() => t.dispose());

beforeEach(async () => {
  await t.d1.prepare('DELETE FROM user').run();
  await t.d1
    .prepare(
      "INSERT INTO user (id, name, email) VALUES ('u1', 'u1', 'u1@x.test')"
    )
    .run();
});

describe('UserService.getProfileById', () => {
  it('returns timezone and week_starts_on alongside the profile fields', async () => {
    await t.d1
      .prepare(
        "INSERT INTO user_profiles (user_id, name, timezone, week_starts_on) VALUES ('u1', 'Maya', 'Europe/London', 1)"
      )
      .run();
    const profile = await UserService.getProfileById('u1');
    expect(profile).toMatchObject({
      user_id: 'u1',
      name: 'Maya',
      timezone: 'Europe/London',
      week_starts_on: 1,
    });
    expect(await UserService.getProfileById('nobody')).toBeNull();
  });
});

describe('UserService.ensureProfile', () => {
  it('creates the anchor row and never clobbers an existing one', async () => {
    await UserService.ensureProfile('u1');
    expect(await profileRow()).toMatchObject({ user_id: 'u1', name: null });

    await t.d1
      .prepare("UPDATE user_profiles SET name = 'Maya' WHERE user_id = 'u1'")
      .run();
    await UserService.ensureProfile('u1');
    expect((await profileRow())?.name).toBe('Maya');
  });

  it('throws a DatabaseError when the insert fails', async () => {
    // No `user` row: the FK refuses it.
    await expect(UserService.ensureProfile('ghost')).rejects.toThrow(
      'Failed to ensure user profile'
    );
  });
});

describe('UserService.upsertProfile', () => {
  it('stores timezone when the caller supplies one', async () => {
    const p = await UserService.upsertProfile('u1', {
      name: 'Maya',
      city: '',
      country: '',
      timezone: 'America/New_York',
    });
    expect(p).toMatchObject({ name: 'Maya', timezone: 'America/New_York' });
  });

  it('keeps an existing timezone when the caller sends none', async () => {
    await UserService.upsertProfile('u1', {
      name: 'Maya',
      city: '',
      country: '',
      timezone: 'Asia/Kolkata',
    });
    const p = await UserService.upsertProfile('u1', {
      name: 'Maya B',
      city: '',
      country: '',
    });
    expect(p).toMatchObject({ name: 'Maya B', timezone: 'Asia/Kolkata' });
  });
});

describe('UserService.updateProfile', () => {
  it('writes timezone and week_starts_on', async () => {
    await UserService.ensureProfile('u1');
    const p = await UserService.updateProfile('u1', {
      timezone: 'Asia/Kolkata',
      week_starts_on: 0,
    });
    expect(p).toMatchObject({ timezone: 'Asia/Kolkata', week_starts_on: 0 });
  });

  it('throws when there is no profile to update', async () => {
    await expect(
      UserService.updateProfile('u1', { timezone: 'Asia/Kolkata' })
    ).rejects.toThrow('Failed to update user profile');
  });
});
