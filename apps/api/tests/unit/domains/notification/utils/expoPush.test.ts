import { afterEach, describe, expect, it } from 'bun:test';
import {
  chunk,
  isExpoPushToken,
  sendPush,
} from '../../../../../src/domains/notification/utils/expoPush';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('expoPush', () => {
  it('validates tokens like the SDK', () => {
    expect(isExpoPushToken('ExponentPushToken[abc]')).toBe(true);
    expect(isExpoPushToken('ExpoPushToken[abc]')).toBe(true);
    expect(isExpoPushToken('12345678-1234-1234-1234-123456789012')).toBe(true);
    expect(isExpoPushToken('ExpoPushToken[abc')).toBe(false);
    expect(isExpoPushToken('nope')).toBe(false);
    expect(isExpoPushToken(5)).toBe(false);
  });

  it('chunks by 100', () => {
    const sizes = chunk(Array.from({ length: 250 }, (_, i) => i)).map(
      c => c.length
    );
    expect(sizes).toEqual([100, 100, 50]);
  });

  it('returns tickets and throws on http / errors', async () => {
    const reply = (body: unknown, status = 200) => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(body), {
          status,
        })) as unknown as typeof fetch;
    };
    const msg = { to: 'ExpoPushToken[a]' };
    reply({ data: [{ status: 'ok', id: '1' }] });
    expect(await sendPush([msg])).toEqual([{ status: 'ok', id: '1' }]);
    reply({}, 500);
    await expect(sendPush([msg])).rejects.toThrow('500');
    reply({ errors: [{ message: 'bad' }] });
    await expect(sendPush([msg])).rejects.toThrow('bad');
  });
});
