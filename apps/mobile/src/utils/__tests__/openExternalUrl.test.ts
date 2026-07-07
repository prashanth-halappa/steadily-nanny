import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test';

// mock.module must be registered in beforeAll BEFORE the dynamic import so the
// helper picks up the mocked native modules (see TESTING.md).
const openBrowserAsync = mock(async () => ({ type: 'opened' }));
const linkingOpenURL = mock(async () => undefined);
const captureException = mock(
  (_error?: unknown, _options?: unknown): undefined => undefined
);

let openExternalUrl: typeof import('../openExternalUrl').openExternalUrl;

beforeAll(async () => {
  mock.module('expo-web-browser', () => ({ openBrowserAsync }));
  mock.module('react-native', () => ({
    Linking: { openURL: linkingOpenURL },
  }));
  mock.module('@sentry/react-native', () => ({ captureException }));
  ({ openExternalUrl } = await import('../openExternalUrl'));
});

afterEach(() => {
  openBrowserAsync.mockClear();
  linkingOpenURL.mockClear();
  captureException.mockClear();
});

describe('openExternalUrl', () => {
  it('opens https URLs in the in-app browser (bypasses universal-link capture)', async () => {
    await openExternalUrl('https://yourapp.example.com/terms');

    expect(openBrowserAsync).toHaveBeenCalledTimes(1);
    expect(openBrowserAsync).toHaveBeenCalledWith(
      'https://yourapp.example.com/terms'
    );
    expect(linkingOpenURL).not.toHaveBeenCalled();
  });

  it('opens http URLs in the in-app browser too', async () => {
    await openExternalUrl('http://example.com');

    expect(openBrowserAsync).toHaveBeenCalledTimes(1);
    expect(linkingOpenURL).not.toHaveBeenCalled();
  });

  it('falls back to Linking for non-web schemes (mailto)', async () => {
    await openExternalUrl('mailto:support@yourapp.example.com?subject=Hi');

    expect(linkingOpenURL).toHaveBeenCalledWith(
      'mailto:support@yourapp.example.com?subject=Hi'
    );
    expect(openBrowserAsync).not.toHaveBeenCalled();
  });

  it('never throws and reports to Sentry when the open fails', async () => {
    openBrowserAsync.mockImplementationOnce(async () => {
      throw new Error('Unable to open URL: https://yourapp.example.com/terms');
    });

    const result = await openExternalUrl(
      'https://yourapp.example.com/terms',
      'auth-terms'
    );
    expect(result).toBeUndefined();

    expect(captureException).toHaveBeenCalledTimes(1);
    const options = captureException.mock.calls[0]?.[1] as
      | { tags: { context: string }; extra: { url: string } }
      | undefined;
    expect(options?.tags.context).toBe('auth-terms');
    expect(options?.extra.url).toBe('https://yourapp.example.com/terms');
  });
});
