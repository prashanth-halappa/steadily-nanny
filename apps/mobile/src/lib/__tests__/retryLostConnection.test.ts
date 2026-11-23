import { afterEach, describe, expect, it, mock } from 'bun:test';
import { fetchRetryingLostConnection } from '../retryLostConnection';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const stubFetch = (...results: Array<Response | Error>) => {
  const fn = mock(async () => {
    const next = results.shift();
    if (next instanceof Error) throw next;
    return next as Response;
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
};

describe('fetchRetryingLostConnection', () => {
  it('retries once when iOS reports a lost connection', async () => {
    const fn = stubFetch(
      new TypeError('fetch failed: The network connection was lost.'),
      new Response('ok', { status: 200 })
    );
    const res = await fetchRetryingLostConnection(
      'https://x/api/auth/sign-in/email',
      {
        method: 'POST',
      }
    );
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry other network errors', async () => {
    const fn = stubFetch(new TypeError('Network request failed'));
    await expect(fetchRetryingLostConnection('https://x')).rejects.toThrow(
      'Network request failed'
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after one retry', async () => {
    const lost = () => new TypeError('The network connection was lost.');
    const fn = stubFetch(lost(), lost());
    await expect(fetchRetryingLostConnection('https://x')).rejects.toThrow(
      'lost'
    );
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
