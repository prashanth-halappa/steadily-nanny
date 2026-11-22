// Validate environment configuration at startup (fail-fast). MUST be first.
import './config/env';

import { toNodeHandler } from 'better-auth/node';
import compression from 'compression';
import express from 'express';
import helmet from 'helmet';
import { auth } from './auth';
import { APP_IDENTITY } from './config/app.identity';
import helmetConfig from './config/helmetConfig';
import Sentry from './config/sentry';
import publicInviteRoutes from './domains/household/routes/publicInviteRoutes';
import { validateSession } from './middlewares/auth';
import { cacheControl } from './middlewares/cacheControl';
import { errorHandler } from './middlewares/errorHandler';
import { morganMiddleware } from './middlewares/logger';
import { userRateLimiter } from './middlewares/rateLimit';
import { requestId } from './middlewares/requestId';
import appStatusRoutes from './routes/appStatusRoutes';
import apiRoutes from './routes/index';
import jobRoutes from './routes/jobRoutes';

const app = express();

// Trust exactly one proxy hop (e.g. Cloud Run's front-end) so req.ip resolves to
// the real client without trusting a fully client-spoofable X-Forwarded-For chain.
app.set('trust proxy', 1);

// Security headers first.
app.use(helmet(helmetConfig));

// gzip/brotli compression.
app.use(compression());

// Cache-Control headers.
app.use(cacheControl);

// Correlation ID before anything logs.
app.use(requestId);

// Better Auth owns /api/auth/* end to end. It reads the raw request body
// itself, so it MUST be mounted before express.json() (which would consume the
// stream). Express 5 path syntax: `*splat` is the named wildcard. It has its own
// per-IP rate limiting (memory store) and origin checks against trustedOrigins.
app.all('/api/auth/*splat', toNodeHandler(auth));

// Body parsing. The `verify` hook preserves the RAW body only for webhook routes
// so HMAC signatures can be verified (parsed JSON can't be re-hashed).
app.use(
  express.json({
    limit: '100kb',
    verify: (req, _res, buf) => {
      if ((req as express.Request).url?.startsWith('/api/webhooks/')) {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      }
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// HTTP access log → logger.
app.use(morganMiddleware);

// ── Routes that DON'T use session auth — mount BEFORE validateSession.
// Job routes: X-Job-Api-Key auth (external scheduler, no user).
app.use('/api/jobs', jobRoutes);
// App status: pre-auth (optional session resolved inside for per-user betaAllPro).
app.use('/api/app', appStatusRoutes);
// The public terms page's two routes (3-O §6.2): the invite CODE is the bearer
// secret, and the reader is a parent who has been sent a link and has no
// account yet. Mounted before `validateSession` below for that reason;
// every other `/api/v1/household-invites/...` path falls through this router
// to the authenticated stack, because an Express Router next()s on a miss.
app.use('/api/v1/household-invites', publicInviteRoutes);
// SETUP: mount any signed webhook routes here (their own shared secret, not a
// session) — e.g. `app.use('/api/webhooks', myWebhookRoutes)`. The raw
// body needed for signature verification is captured above for any
// `/api/webhooks/*` path regardless of which webhook route handles it.

// ── Session-authenticated API (order matters).
app.use('/api/v1', validateSession); // attaches req.user
app.use('/api/v1', userRateLimiter); // after auth so the key is the user id
app.use('/api/v1', (req, _res, next) => {
  if (req.user) {
    Sentry.setUser({ id: req.user.id }); // email omitted (PII minimization)
  }
  next();
});
app.use('/api/v1', apiRoutes);

// Health check for the orchestrator.
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Root endpoint.
app.get('/', (_req, res) => {
  res.status(200).json({
    message: `${APP_IDENTITY.name} API is running`,
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

// Global error handler — ALWAYS LAST.
app.use(errorHandler);

export default app;
