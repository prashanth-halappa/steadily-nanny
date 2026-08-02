/**
 * app.ts — Express application assembly (TEACHING SCAFFOLD)
 *
 * The ORDER of middleware below is load-bearing. Each numbered step explains
 * why it sits where it does. Swap the placeholder route mounts for your own.
 *
 * Golden rule: error handler LAST, body parser BEFORE routes, and any route
 * that uses its OWN auth scheme (API-key jobs, signed webhooks, public status)
 * must mount BEFORE the global bearer-token auth middleware — otherwise that
 * middleware will reject the request with 401 before it reaches its handler.
 */

// 0. Fail-fast env validation MUST be the very first import so a misconfigured
//    deploy crashes at boot, not on the first request.
import './config/env';

import compression from 'compression';
import express from 'express';
import helmet from 'helmet';

// --- middlewares (implement these per the architecture doc) ---
import { validateBearerToken } from './middlewares/auth';       // bearer/JWT auth
import { errorHandler } from './middlewares/errorHandler';      // global error handler
import { morganMiddleware } from './middlewares/logger';        // HTTP access log → winston
import { userRateLimiter } from './middlewares/rateLimit';      // per-user rate limit
import { requestId } from './middlewares/requestId';            // X-Request-ID correlation
import apiRoutes from './routes/index';             // bearer-token auth (the main API)
// --- route groups ---
import jobRoutes from './routes/jobRoutes';        // API-key auth
import webhookRoutes from './routes/webhookRoutes'; // signed-payload auth

// import Sentry from './config/sentry';            // optional error monitoring

const app = express();

// 1. Trust proxy headers so req.ip is the real client IP behind a load balancer.
app.set('trust proxy', true);

// 2. Error-monitoring request handler BEFORE routes (e.g. Sentry.setupExpressErrorHandler(app)).

// 3. Security headers.
app.use(helmet(/* helmetConfig */));

// 4. Response compression (gzip/brotli) — typically 60–80% smaller bodies.
app.use(compression());

// 5. (optional) Cache-Control header strategy middleware goes here.

// 6. Request ID — assign before anything that logs, so every log line correlates.
app.use(requestId);

// 7. Body parsing. Preserve the raw body ONLY for webhook routes that need it
//    for HMAC signature verification (parsed JSON can't be re-hashed).
app.use(
  express.json({
    verify: (req, _res, buf) => {
      if ((req as express.Request).url?.startsWith('/api/webhooks/')) {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      }
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// 8. HTTP access logging (after body parse, before routes).
app.use(morganMiddleware);

// ============================================================================
// 9. PRE-AUTH ROUTE GROUPS — each carries its OWN auth and MUST mount before
//    the bearer-token middleware in step 10.
// ============================================================================

// Scheduled jobs: authenticated by a shared API key (X-Job-Api-Key) inside the
// router, NOT a user token. A cron/scheduler calls these — there is no user.
app.use('/api/jobs', jobRoutes);

// Signed webhooks: verified via HMAC over the raw body captured in step 7.
app.use('/api/webhooks', webhookRoutes);

// Public/unauthenticated endpoints (status pings, unsubscribe links) also mount
// here, before validateBearerToken. e.g. app.use('/api/app', appStatusRoutes);

// ============================================================================
// 10. AUTHENTICATED API — bearer token required from here down.
//     The chain runs in this order for a reason:
//       auth → rate limit → (write-side side effects) → user context → routes
// ============================================================================

// 10a. Verify the bearer token and attach req.user (cache-then-verify).
app.use('/api/v1', validateBearerToken);

// 10b. Rate limit AFTER auth so the limiter key can be the user ID, not the IP.
app.use('/api/v1', userRateLimiter);

// 10c. (optional) Write-side side-effect middleware — e.g. a per-user daily
//      "activity" recorder that fires on POST/PUT/PATCH/DELETE with a dedupe
//      cache. Place after auth (needs req.user) and before routes.
// app.use('/api/v1', activityRecorder);

// 10d. (optional) Attach user context to the error monitor scope.
// app.use((req, _res, next) => { if (req.user) Sentry.setUser({ id: req.user.id }); next(); });

// 10e. Mount the actual versioned API router.
app.use('/api/v1', apiRoutes);

// 11. Dev-only docs (lazy-require Swagger so prod never loads it into memory).
if (process.env.NODE_ENV === 'development') {
  // const swaggerUi = require('swagger-ui-express');
  // const { swaggerSpec } = require('./middlewares/swagger');
  // app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// 12. Health check (for container orchestrators / load balancers).
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'OK', uptime: process.uptime() });
});

// 13. Global error handler — ALWAYS LAST. Express only treats a 4-arg function
//     as an error handler, and only middleware registered after the routes
//     catches errors forwarded via next(err).
app.use(errorHandler);

export default app;
