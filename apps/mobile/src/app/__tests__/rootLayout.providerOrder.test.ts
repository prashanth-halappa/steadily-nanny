import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pattern A (source inspection): the root layout's provider tree order is
 * load-bearing. GestureHandlerRootView must wrap the navigator; QueryClient
 * Provider must be above anything reading server state; PostHog wraps Analytics
 * so usePostHog() works; AppGate wraps the Stack; PortalHost sits at the bottom.
 */
describe('root layout provider order', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/app/_layout.tsx'),
    'utf8'
  );

  // JSX open-tag forms so import lines (alphabetical) don't skew the order check.
  const order = [
    '<RootErrorBoundary',
    '<GestureHandlerRootView',
    '<QueryClientProvider',
    '<PostHogProvider',
    '<AnalyticsProvider',
    '<AppGate',
    '<Stack',
  ];

  it('nests providers in the required order', () => {
    let previousIndex = -1;
    for (const token of order) {
      const index = source.indexOf(token);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  });

  it('always hands PostHogProvider a client', () => {
    // Left to build its own from a missing key, the SDK console.errors; so does
    // usePostHog() when the context holds no client. See analytics/client.ts.
    expect(source).toContain('<PostHogProvider client={posthogClient}');
  });

  it('imports polyfills first and hardens Sentry PII off', () => {
    expect(source.indexOf("import '@/polyfills'")).toBe(0);
    expect(source).toContain('sendDefaultPii: false');
  });

  it('places AnimatedSplash inside QueryClientProvider (needs useIsOnboarded)', () => {
    const queryIdx = source.indexOf('<QueryClientProvider');
    const splashIdx = source.indexOf('<AnimatedSplash');
    expect(splashIdx).toBeGreaterThan(queryIdx);
  });
});
