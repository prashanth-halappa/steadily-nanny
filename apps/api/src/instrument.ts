/**
 * Sentry instrumentation.
 *
 * MUST be loaded before any other modules via `--preload`, so Sentry is
 * initialized before Express and other modules are instrumented.
 *
 * The feature-area map + path resolver are imported from the SINGLE shared
 * module (`config/sentryFeatureAreas`) — the source repo duplicated them here
 * and in config/sentry.ts.
 *
 * @see https://docs.sentry.io/platforms/javascript/guides/bun/
 * @module instrument
 */
import * as Sentry from '@sentry/bun';
import dotenv from 'dotenv';
import { APP_IDENTITY } from './config/app.identity';
import { getFeatureAreaFromPath } from './config/sentryFeatureAreas';

dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: nodeEnv,

  release: `${APP_IDENTITY.name}-api@${process.env.npm_package_version || '1.0.0'}`,

  tracesSampleRate: nodeEnv === 'production' ? 0.2 : 1.0,

  // Do NOT send default PII (IPs, cookies, auth headers). User context (id) is
  // set explicitly via Sentry.setUser() in app.ts.
  sendDefaultPii: false,

  // Bun cannot OTel-patch Express, so setupExpressErrorHandler emits an
  // unactionable "express is not instrumented" warning. Error capture and
  // HTTP/fetch tracing are unaffected; only per-route perf spans are missing.
  disableInstrumentationWarnings: true,

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

  beforeSend: event => {
    if (event.transaction === 'GET /health' || event.transaction === 'GET /') {
      return null;
    }
    return event;
  },

  beforeSendTransaction: event => {
    if (event.transaction?.includes('/health')) {
      return null;
    }
    return event;
  },
});
