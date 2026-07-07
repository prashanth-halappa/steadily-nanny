/**
 * Supabase test mocks — mock auth, database query builder, and storage.
 */

import { mock } from 'bun:test';

export const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  role: 'authenticated',
};

export const mockSession = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expires_in: 3600,
  expires_at: Date.now() + 3600000,
  token_type: 'bearer',
  user: mockUser,
};

/** Chainable Supabase query builder mock. */
export function createMockQueryBuilder(
  data: unknown = null,
  error: unknown = null
) {
  const builder: Record<string, ReturnType<typeof mock>> = {
    select: mock(() => builder),
    insert: mock(() => builder),
    update: mock(() => builder),
    delete: mock(() => builder),
    upsert: mock(() => builder),
    eq: mock(() => builder),
    neq: mock(() => builder),
    gt: mock(() => builder),
    gte: mock(() => builder),
    lt: mock(() => builder),
    lte: mock(() => builder),
    like: mock(() => builder),
    ilike: mock(() => builder),
    is: mock(() => builder),
    in: mock(() => builder),
    contains: mock(() => builder),
    order: mock(() => builder),
    limit: mock(() => builder),
    range: mock(() => builder),
    single: mock(() => Promise.resolve({ data, error })),
    maybeSingle: mock(() => Promise.resolve({ data, error })),
  };
  return builder;
}

export function createMockSupabaseClient(
  options: {
    user?: typeof mockUser | null;
    session?: typeof mockSession | null;
    queryData?: unknown;
    queryError?: unknown;
  } = {}
) {
  const queryBuilder = createMockQueryBuilder(
    options.queryData,
    options.queryError
  );

  return {
    auth: {
      getUser: mock(() =>
        Promise.resolve({
          data: { user: options.user ?? mockUser },
          error: null,
        })
      ),
      getSession: mock(() =>
        Promise.resolve({
          data: { session: options.session ?? mockSession },
          error: null,
        })
      ),
      signInWithPassword: mock(() =>
        Promise.resolve({
          data: { user: mockUser, session: mockSession },
          error: null,
        })
      ),
      signOut: mock(() => Promise.resolve({ error: null })),
      refreshSession: mock(() =>
        Promise.resolve({
          data: { session: mockSession },
          error: null,
        })
      ),
      onAuthStateChange: mock(
        (_callback: (event: string, session: unknown) => void) => {
          return { data: { subscription: { unsubscribe: mock(() => {}) } } };
        }
      ),
    },
    from: mock((_table: string) => queryBuilder),
    storage: {
      from: mock((_bucket: string) => ({
        upload: mock(() =>
          Promise.resolve({ data: { path: 'test-path' }, error: null })
        ),
        remove: mock(() => Promise.resolve({ data: null, error: null })),
        getPublicUrl: mock(() => ({
          data: { publicUrl: 'https://example.com/test.jpg' },
        })),
      })),
    },
  };
}

/** Setup Supabase mock — call in beforeAll. Mocks `@/src/lib/supabase`. */
export function setupSupabaseMock(
  options: Parameters<typeof createMockSupabaseClient>[0] = {}
) {
  const mockClient = createMockSupabaseClient(options);

  mock.module('@/src/lib/supabase', () => ({
    supabase: mockClient,
  }));

  return mockClient;
}
