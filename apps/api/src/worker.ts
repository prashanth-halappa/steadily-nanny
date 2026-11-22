/**
 * Cloudflare Workers entry (wrangler `main`).
 *
 * Express runs unchanged under `nodejs_compat`: `app.listen` registers the
 * server with the runtime and `httpServerHandler` routes each `fetch` into it.
 * Cron Triggers land in `scheduled` (see ./scheduled.ts).
 *
 * Env: string vars/secrets reach `process.env` via `nodejs_compat` (populated
 * by default for compatibility_date >= 2025-04-01), which is what config/env.ts
 * validates. Locally use `.dev.vars` with `wrangler dev`.
 *
 * `src/index.ts` stays as a Bun-only local entry (`bun src/index.ts`).
 *
 * @module worker
 */
import { httpServerHandler } from 'cloudflare:node';
import { withSentry } from '@sentry/cloudflare';
import app from './app';
import { APP_IDENTITY } from './config/app.identity';
import { getFeatureAreaFromPath } from './config/sentryFeatureAreas';
import { scheduled } from './scheduled';

const PORT = 8080;
app.listen(PORT);

type SentryEnv = { SENTRY_DSN?: string; NODE_ENV?: string };

export default withSentry(
  (env: SentryEnv) => ({
    dsn: env.SENTRY_DSN || undefined,
    environment: env.NODE_ENV ?? 'development',
    release: `${APP_IDENTITY.name}-api`,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.2 : 1.0,
    // sendDefaultPii stays off (no IPs/cookies/auth headers); user id is set in app.ts.
    beforeBreadcrumb: breadcrumb => {
      if (breadcrumb.category === 'http' && breadcrumb.data?.url) {
        breadcrumb.data = {
          ...breadcrumb.data,
          featureArea: getFeatureAreaFromPath(breadcrumb.data.url as string),
        };
      }
      if (breadcrumb.category === 'console' && breadcrumb.level === 'debug') {
        return null;
      }
      return breadcrumb;
    },
    beforeSend: event =>
      event.transaction === 'GET /health' || event.transaction === 'GET /'
        ? null
        : event,
    beforeSendTransaction: event =>
      event.transaction?.includes('/health') ? null : event,
  }),
  { ...httpServerHandler({ port: PORT }), scheduled }
);
