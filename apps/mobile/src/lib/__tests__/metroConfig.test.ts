/**
 * `@better-auth/expo`'s online manager does `import('expo-network')` (an
 * optional peer we don't ship) every time the session refresher re-inits —
 * i.e. after a sign-out. Metro turns an unresolvable dynamic import into a
 * SYNCHRONOUS throw, which skips the library's `.catch`, rejects
 * `getSession()`, and the second sign-in of a session shows "Network error".
 * Metro must resolve it to an empty module so the library's own fallback runs.
 */
import { describe, expect, it } from 'bun:test';

describe('metro.config resolver', () => {
  it('resolves expo-network to an empty module', () => {
    const config = require('../../../metro.config.js') as {
      resolver: {
        resolveRequest: (
          ctx: unknown,
          name: string,
          platform: string
        ) => unknown;
      };
    };
    const ctx = {
      resolveRequest: () => {
        throw new Error('fell through to the default resolver');
      },
    };
    expect(config.resolver.resolveRequest(ctx, 'expo-network', 'ios')).toEqual({
      type: 'empty',
    });
  });
});
