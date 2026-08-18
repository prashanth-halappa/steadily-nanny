/**
 * @module api/endpoints/__tests__/household.holidays.test
 * Covers: URL construction (household-nested), request validation,
 * response-envelope unwrap + Zod validation for householdApi.listHolidays /
 * setHolidays.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let householdApi: any;
let apiClient: any;

const now = '2026-08-01T00:00:00.000Z';
const HOUSEHOLD_ID = '77777777-7777-4777-8777-777777777777';

const validRow = {
  id: '99999999-9999-4999-8999-999999999999',
  household_id: HOUSEHOLD_ID,
  holiday_key: 'independence_day',
  observed: true,
  created_at: now,
  updated_at: now,
};

beforeAll(async () => {
  mock.module('@/src/api/client', () => ({
    apiClient: {
      get: mock(() => Promise.resolve({})),
      post: mock(() => Promise.resolve({})),
      put: mock(() => Promise.resolve({})),
      patch: mock(() => Promise.resolve({})),
      delete: mock(() => Promise.resolve({})),
    },
  }));

  const mod = await import('../household');
  householdApi = mod.householdApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
  apiClient.put.mockReset?.();
});

describe('householdApi.listHolidays', () => {
  it('GETs /v1/households/:householdId/holidays and returns the validated rows', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { household_holidays: [validRow] } },
    });

    const result = await householdApi.listHolidays(HOUSEHOLD_ID);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/holidays`
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(validRow.id);
  });
});

describe('householdApi.setHolidays', () => {
  it('PUTs the validated body to /v1/households/:householdId/holidays and returns the array', async () => {
    apiClient.put.mockResolvedValue({
      data: { data: { household_holidays: [validRow] } },
    });

    const body = {
      holidays: [{ holiday_key: 'independence_day', observed: true }],
    };
    const result = await householdApi.setHolidays(HOUSEHOLD_ID, body);

    expect(apiClient.put).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/holidays`,
      body
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(validRow.id);
  });

  it('rejects an unknown holiday_key without calling the API', async () => {
    await expect(
      householdApi.setHolidays(HOUSEHOLD_ID, {
        holidays: [{ holiday_key: 'st_swithins_day', observed: true }],
      })
    ).rejects.toThrow();
    expect(apiClient.put).not.toHaveBeenCalled();
  });
});
