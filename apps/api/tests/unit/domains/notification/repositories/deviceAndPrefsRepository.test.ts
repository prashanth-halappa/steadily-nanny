/** DeviceRepository + NotificationPrefsRepository on a real Miniflare D1. */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import {
  user,
  userDeviceInfo,
  userProfiles,
} from '../../../../../src/db/schema';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

let t: TestDb;
let DeviceRepository: any;
let NotificationPrefsRepository: any;

const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TOKEN_B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  ({ DeviceRepository } = await import(
    '../../../../../src/domains/notification/repositories/deviceRepository'
  ));
  ({ NotificationPrefsRepository } = await import(
    '../../../../../src/domains/notification/repositories/notificationPrefsRepository'
  ));
  await t.db.insert(user).values({ id: 'u1', name: 'u1', email: 'u1@x.test' });
  await t.db.insert(userProfiles).values({ user_id: 'u1' });
});

afterAll(() => t.dispose());

describe('DeviceRepository', () => {
  it('upserts on (user_id, device_id), lists deliverable tokens, clears tokens', async () => {
    const first = await DeviceRepository.upsertDevice('u1', {
      deviceId: 'd1',
      expoPushToken: TOKEN_A,
      platform: 'ios',
      notificationPermission: 'denied',
    });
    const again = await DeviceRepository.upsertDevice('u1', {
      deviceId: 'd1',
      expoPushToken: TOKEN_A,
      platform: 'ios',
      notificationPermission: 'provisional',
      timezone: 'Europe/London',
    });
    expect(again.id).toBe(first.id);
    expect(again.timezone).toBe('Europe/London');
    await DeviceRepository.upsertDevice('u1', {
      deviceId: 'd2',
      expoPushToken: TOKEN_B,
      platform: 'android',
      notificationPermission: 'granted',
    });
    await DeviceRepository.upsertDevice('u1', {
      deviceId: 'd3',
      expoPushToken: 'not-a-token',
      platform: 'android',
      notificationPermission: 'granted',
    });
    expect(await t.db.select().from(userDeviceInfo)).toHaveLength(3);
    expect(
      (await DeviceRepository.getDeliverableTokensForUser('u1')).sort()
    ).toEqual([TOKEN_A, TOKEN_B]);

    await DeviceRepository.removeTokens([TOKEN_A]);
    expect(await DeviceRepository.getDeliverableTokensForUser('u1')).toEqual([
      TOKEN_B,
    ]);
  });
});

describe('NotificationPrefsRepository', () => {
  it('returns null when absent, then upserts with JSON + boolean round-trip', async () => {
    const repo = new NotificationPrefsRepository();
    expect(await repo.findByUserId('u1')).toBeNull();
    const input = {
      disabled_types: ['shift_reminder'],
      quiet_hours_enabled: true,
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
      timezone: 'Europe/London',
    };
    await repo.upsert('u1', input);
    const updated = await repo.upsert('u1', {
      ...input,
      quiet_hours_enabled: false,
    });
    expect(updated).toMatchObject({ ...input, quiet_hours_enabled: false });
    expect(await repo.findByUserId('u1')).toMatchObject({
      disabled_types: ['shift_reminder'],
      quiet_hours_enabled: false,
    });
  });
});
