/**
 * @module api/endpoints/__tests__/household.customHolidays.test
 * Covers: URL construction (household-nested), request validation,
 * response-envelope unwrap + Zod validation for householdApi.listCustomHolidays /
 * setCustomHolidays. An empty `custom_holidays` array is a valid PUT — it is
 * how the last custom day is deleted — so the client must not refuse it.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let householdApi: any;
let apiClient: any;

const now = '2026-08-01T00:00:00.000Z';
const HOUSEHOLD_ID = '77777777-7777-4777-8777-777777777777';

const validRow = {
  id: '88888888-8888-4888-8888-888888888888',
  household_id: HOUSEHOLD_ID,
  name: 'Diwali',
  dates: ['2026-11-08'],
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

describe('householdApi.listCustomHolidays', () => {
  it('GETs /v1/households/:householdId/custom-holidays and returns the validated rows', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { household_custom_holidays: [validRow] } },
    });

    const result = await householdApi.listCustomHolidays(HOUSEHOLD_ID);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/custom-holidays`
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(validRow.id);
  });
});

describe('householdApi.setCustomHolidays', () => {
  it('PUTs the validated body to /v1/households/:householdId/custom-holidays and returns the array', async () => {
    apiClient.put.mockResolvedValue({
      data: { data: { household_custom_holidays: [validRow] } },
    });

    const body = {
      custom_holidays: [{ name: 'Diwali', dates: ['2026-11-08'] }],
    };
    const result = await householdApi.setCustomHolidays(HOUSEHOLD_ID, body);

    expect(apiClient.put).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/custom-holidays`,
      body
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(validRow.id);
  });

  it('accepts an empty custom_holidays array and still PUTs', async () => {
    apiClient.put.mockResolvedValue({
      data: { data: { household_custom_holidays: [] } },
    });

    const body = { custom_holidays: [] };
    const result = await householdApi.setCustomHolidays(HOUSEHOLD_ID, body);

    expect(apiClient.put).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/custom-holidays`,
      body
    );
    expect(result).toEqual([]);
  });
});
