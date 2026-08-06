import { beforeAll, describe, expect, it, mock } from 'bun:test';

/**
 * Guards the startup-noise bug: an unconfigured PostHog must still be a real
 * client (usePostHog() console.errors when the context holds none) built with a
 * non-empty key (the SDK console.errors on an empty one) and `disabled` set, so
 * nothing is queued or sent.
 *
 * Both branches run in one process by re-importing `client` under a distinct
 * query string, which bypasses the module cache.
 */

class RecordingPostHog {
  constructor(
    public apiKey: string,
    public options: { host?: string; disabled?: boolean }
  ) {}
}

const fakeEnv: { posthogApiKey?: string; posthogHost: string } = {
  posthogApiKey: '',
  posthogHost: 'https://ph.test',
};

// Non-literal specifier: the query is what busts the cache, and it also keeps
// tsc from trying to resolve `../client.ts?tag` as a real module path.
async function loadClient(tag: string): Promise<RecordingPostHog> {
  const mod = await import(`../client.ts?${tag}`);
  return mod.posthogClient;
}

let unconfigured: RecordingPostHog;
let configured: RecordingPostHog;

beforeAll(async () => {
  mock.module('posthog-react-native', () => ({
    default: RecordingPostHog,
    PostHog: RecordingPostHog,
  }));
  mock.module('@/src/config/env', () => ({ env: fakeEnv }));

  fakeEnv.posthogApiKey = '';
  unconfigured = await loadClient('unconfigured');

  fakeEnv.posthogApiKey = 'phc_real_key';
  configured = await loadClient('configured');
});

describe('posthogClient', () => {
  it('is a disabled client with a placeholder key when unconfigured', () => {
    expect(unconfigured).toBeInstanceOf(RecordingPostHog);
    expect(unconfigured.options.disabled).toBe(true);
    expect(unconfigured.apiKey).not.toBe('');
  });

  it('is an enabled client on the real key when configured', () => {
    expect(configured.options.disabled).toBe(false);
    expect(configured.apiKey).toBe('phc_real_key');
    expect(configured.options.host).toBe('https://ph.test');
  });
});
