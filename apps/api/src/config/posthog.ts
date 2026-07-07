import { PostHog } from 'posthog-node';
import { env, isTest } from './env';

// PostHog analytics client. Optional in non-production; disabled if no key.
const posthogApiKey = env.POSTHOG_API_KEY || (isTest ? 'test-key' : '');

if (!posthogApiKey && !isTest) {
  console.warn('POSTHOG_API_KEY not set — PostHog tracking will be disabled');
}

export const phClient = new PostHog(posthogApiKey || 'disabled', {
  host: 'https://us.i.posthog.com',
  flushAt: 1,
  flushInterval: 0,
});
