import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let UserService: typeof import('../../../../../src/domains/user/services/userService').UserService;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    upsert: mock(() => chain),
    update: mock(() => chain),
    delete: mock(() => chain),
    maybeSingle: mock(() => Promise.resolve(finalResponse)),
    single: mock(() => Promise.resolve(finalResponse)),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(finalResponse).then(resolve),
  };
  return chain;
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = {
      from: mock(() => createMockQueryChain()),
      auth: { admin: { deleteUser: mock(async () => ({ error: null })) } },
    };
    return { supabase: obj, supabaseService: obj };
  });
  mock.module('../../../../../src/middlewares/logger', () => ({
    logger: { info: mock(), error: mock(), warn: mock(), debug: mock() },
  }));

  const mod = await import(
    '../../../../../src/domains/user/services/userService'
  );
  UserService = mod.UserService;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('UserService.getProfileById', () => {
  it('selects timezone and week_starts_on alongside the existing profile fields', async () => {
    const chain = createMockQueryChain({
      data: {
        user_id: 'u1',
        name: 'Maya',
        city: 'London',
        country: 'UK',
        preferred_locale: null,
        timezone: 'Europe/London',
        week_starts_on: 1,
        additional_data: null,
      },
      error: null,
    });
    mockSupabaseService.from.mockImplementation(() => chain);

    const profile = await UserService.getProfileById('u1');

    expect(chain.select).toHaveBeenCalledWith(
      expect.stringContaining('timezone')
    );
    expect(chain.select).toHaveBeenCalledWith(
      expect.stringContaining('week_starts_on')
    );
    expect(profile?.timezone).toBe('Europe/London');
    expect(profile?.week_starts_on).toBe(1);
  });
});

describe('UserService.upsertProfile', () => {
  it('includes timezone in the upsert payload when the caller supplies one', async () => {
    const chain = createMockQueryChain({
      data: { user_id: 'u1', name: 'Maya', timezone: 'America/New_York' },
      error: null,
    });
    mockSupabaseService.from.mockImplementation(() => chain);

    await UserService.upsertProfile('u1', {
      name: 'Maya',
      city: '',
      country: '',
      timezone: 'America/New_York',
    });

    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: 'America/New_York' }),
      { onConflict: 'user_id' }
    );
  });

  it('omits timezone from the upsert payload when not supplied — never forces a value the caller did not send', async () => {
    const chain = createMockQueryChain({
      data: { user_id: 'u1', name: 'Maya' },
      error: null,
    });
    mockSupabaseService.from.mockImplementation(() => chain);

    await UserService.upsertProfile('u1', {
      name: 'Maya',
      city: '',
      country: '',
    });

    const payload = chain.upsert.mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty('timezone');
  });
});

describe('UserService.updateProfile', () => {
  it('passes timezone and week_starts_on through to the update payload', async () => {
    const chain = createMockQueryChain({
      data: { user_id: 'u1', timezone: 'Asia/Kolkata', week_starts_on: 0 },
      error: null,
    });
    mockSupabaseService.from.mockImplementation(() => chain);

    await UserService.updateProfile('u1', {
      timezone: 'Asia/Kolkata',
      week_starts_on: 0,
    });

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        timezone: 'Asia/Kolkata',
        week_starts_on: 0,
      })
    );
  });
});
