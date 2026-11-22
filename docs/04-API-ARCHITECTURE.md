# 04 — API Architecture

> Purpose: the layered, clean-architecture blueprint for an Express 5 + Cloudflare Workers + D1 API — bootstrap, middleware ordering, the four layers (routes → controllers → services → repositories), error handling, auth, Zod validation, env validation, and logging. Reuse the patterns; swap the product specifics.

The stack: **Express 5** running as a **Cloudflare Worker** (`nodejs_compat` + `httpServerHandler`, entry `src/worker.ts`; `src/index.ts` is a Bun-only local entry), **Bun** test runner, **Cloudflare D1** (SQLite) via **Drizzle ORM**, **Better Auth** (cookie sessions), **Zod** validation, **winston** logging, **Sentry** error monitoring, **PostHog** analytics. All examples are real excerpts from a production API (`apps/api/`), labelled with their path.

---

## 1. Bootstrap & Middleware Order

### 1.1 `index.ts` — server + graceful shutdown

The entry point is tiny: import the assembled `app`, listen, and wire graceful shutdown. The key non-obvious step is **flushing the analytics client on shutdown** so buffered events aren't lost when the container is killed.

Example: `apps/api/src/index.ts`
```ts
import app from './app';
import config from './config/config';
import { phClient } from './config/posthog';
import { logger } from './middlewares/logger';

const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info(`Server running on port ${config.port}`);
});

const shutdown = () => {
  logger.info('Shutting down...');
  void phClient.shutdown(); // flushes and closes PostHog
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

The dev/start scripts preload an instrumentation file before the app so monitoring is initialized first: `bun --preload ./src/instrument.ts src/index.ts`.

### 1.2 `app.ts` — the EXACT middleware stack order

This ordering is **load-bearing**. Each layer depends on state set by an earlier one, and any route with its own auth scheme must mount *before* the global token auth.

| # | Middleware / mount | Why it sits here |
|---|---|---|
| 0 | `import './config/env'` (first import) | Fail-fast env validation before anything reads `process.env`. |
| 1 | `app.set('trust proxy', 1)` | Trust exactly **one** proxy hop (the Cloudflare edge) so `req.ip` resolves to the real client without trusting a fully client-spoofable `X-Forwarded-For` chain. |
| 2 | `Sentry.setupExpressErrorHandler(app)` | Error monitoring request handler before routes. |
| 3 | `helmet(helmetConfig)` | Security headers first. |
| 4 | `compression()` | gzip/brotli — smaller responses. |
| 5 | `cacheControl` | Intelligent `Cache-Control` headers. |
| 6 | `requestId` | Assign a correlation id before anything logs. |
| 7 | `express.json({ verify })` + `express.urlencoded` | Body parsing. The `verify` callback preserves the **raw body** only for `/api/webhooks/*` so HMAC signatures can be verified (parsed JSON can't be re-hashed). |
| 8 | `morganMiddleware` | HTTP access log → winston, after body parse. |
| 8b | `/api/auth/*` → `toNodeHandler(auth)` | Better Auth owns these routes end to end and reads the raw body, so it mounts before the body parsers' consumers and before session auth. |
| 9 | **`/api/jobs`** (`jobRoutes`) | **API-KEY auth — mounts BEFORE session auth.** |
| 9 | **`/api/app`** (`appStatusRoutes`), **`/api/webhooks`** (`subscriptionWebhookRoutes`, signed) | Each has its own / no auth — both mount BEFORE session auth. |
| 10a | `/api/v1` → `validateSession` | Better Auth cookie-session auth (`auth.api.getSession`); attaches `req.user`. |
| 10b | `/api/v1` → `userRateLimiter` | After auth so the rate-limit key is the user ID. |
| 10c | `/api/v1` → inline user-context middleware | `Sentry.setUser({ id: req.user.id })` — email deliberately omitted (PII minimization). |
| 10d | `/api/v1` → `apiRoutes` | The actual versioned router (see `src/routes/index.ts`). |
| 11 | `/health`, `/` | Health check for the orchestrator; root returns a status message. |
| 12 | `errorHandler` | **ALWAYS LAST** — Express only catches `next(err)` in middleware registered after the routes. |

This template does **not** ship a streak-recording middleware, a `/api/unsubscribe` route, or a dev-only Swagger/API-docs mount. All three exist in the reference app this template was extracted from, but were deliberately left out of v1 — they're tied to features (a streak/gamification model, an email-preferences model, an API-docs UI) this template doesn't include yet. See `PORTING.md` for what each did and how to add one back if your app needs it. The rule for adding your own doesn't change: any route needing its own auth scheme mounts **before** the `/api/v1` → `validateSession` line, exactly like the job/webhook/app-status routes above.

Example: `apps/api/src/app.ts`
```ts
// Job routes - API-key authentication (not a session).
// Must be mounted before session auth middleware.
app.use('/api/jobs', jobRoutes);
app.use('/api/app', appStatusRoutes);
app.use('/api/webhooks', subscriptionWebhookRoutes);

// Session-authenticated API (order matters).
app.use('/api/v1', validateSession); // attaches req.user
app.use('/api/v1', userRateLimiter); // after auth so the key is the user id
app.use('/api/v1', (req, _res, next) => {
  if (req.user) {
    Sentry.setUser({ id: req.user.id }); // email omitted (PII minimization)
  }
  next();
});
app.use('/api/v1', apiRoutes);
```

**Why job routes mount before auth:** scheduled jobs normally run from Workers cron triggers (`src/scheduled.ts`, no HTTP at all); `/api/jobs/*` exists for manual runs. There is no logged-in user and no session — only a shared `X-Job-Api-Key` secret. If `/api/jobs` mounted under `validateSession`, every manual call would 401. So the job router carries its own `validateJobApiKey` guard and is mounted on the app *before* the `/api/v1` auth layer. The same logic applies to the signed webhook route and the pre-auth app-status route.

A ready-to-fill, fully-commented version of this file is at `templates/api/app.ts`.

---

## 2. The Four Layers

```
Routes        — routing + middleware wiring only (<200 lines/file)
  ↓
Controllers   — HTTP layer ONLY: parse req, call service, format response, next(error)
  ↓
Services      — ALL business logic; CQRS-lite (separate query vs command services)
  ↓
Repositories  — DB access; extend BaseRepository
```

### 2.1 Routes — thin, declarative middleware wiring

A route file wires path → middleware chain → controller method. No logic. Validation, auth, and ownership checks are composed from **preset spreads** to kill boilerplate. Routes live INSIDE their domain (`domains/<feature>/routes/`), not in a top-level `src/routes/` folder — see §3.

Example: `apps/api/src/domains/widget/routes/widgetRoutes.ts` (mounted at `/api/v1/widgets`)
```ts
// Shared ownership guard for /:widgetId routes. The lookup throws
// WidgetNotFoundError (→ 404) when the widget is missing OR not the caller's, so
// every id-scoped route is authorized before its controller runs (and the
// looked-up widget is cached + attached to the request).
const widgetOwnership = {
  param: 'widgetId',
  lookup: (userId: string, widgetId: string): Promise<Widget> =>
    widgetQueryService.getOwned(userId, widgetId),
};

// Create — no ownership concept yet (the row doesn't exist).
router.post(
  '/',
  ...authWithValidation(CreateWidgetSchema, 'body'),
  asyncHandler(WidgetController.create)
);

// Update — ownership-checked.
router.patch(
  '/:widgetId',
  ...authWithOwnership(WidgetIdParamSchema, widgetOwnership),
  validate(UpdateWidgetSchema, 'body'),
  asyncHandler(WidgetController.update)
);
```

The presets live in `apps/api/src/middlewares/presets.ts` and compose the two most common chains:
```ts
/** Auth + validation only (no ownership check). */
export const authWithValidation = (
  schema: ZodSchema | ZodTypeAny,
  target: ValidateTarget = 'params'
): RequestHandler[] => [requireAuth, validate(schema, target)];

/**
 * Auth + validation + resource-ownership check. Supply a `lookup` (see
 * `makeOwnershipValidator`) that throws NotFoundError when the user doesn't own
 * the resource.
 */
export const authWithOwnership = <T>(
  schema: ZodSchema | ZodTypeAny,
  ownership: OwnershipValidatorOptions<T>, // { param, source?, lookup, attachAs? }
  target: ValidateTarget = 'params'
): RequestHandler[] => [
  requireAuth,
  validate(schema, target),
  makeOwnershipValidator(ownership),
];
```
Spread them with `...authWithOwnership(schema, ownership)` so each route reads as a single declarative chain. `makeOwnershipValidator` (`apps/api/src/middlewares/validateResourceOwnership.ts`) is a **generic** resource-ownership factory — it takes an id param name and a `lookup(userId, resourceId)` function for any entity, with positive/negative-TTL caching built in. Supply your own `lookup` per resource; there's no per-domain ownership middleware to hand-write.

### 2.2 Controllers — HTTP only

Controllers never contain business logic. They: pull params/body, get the authed user id, call a service, and shape the response via `sendSuccessResponse`. Errors go to `next(error)` (the global handler classifies them). Controllers live INSIDE their domain (`domains/<feature>/controllers/`), not in a top-level `src/controllers/` folder — see §3.

Example: `apps/api/src/domains/widget/controllers/widgetController.ts`
```ts
async create(req: Request, res: Response, next: NextFunction) {
  try {
    const widget = await widgetCommandService.create(
      getAuthUserId(req),
      req.body
    );
    return sendSuccessResponse(res, 'Widget created', { widget }, 201);
  } catch (error) {
    return next(error);
  }
},
```

Two helpers (`apps/api/src/utils/asyncHandler.ts`) make this safe and terse:
```ts
// Forwards any rejected promise to the Express error handler.
export function asyncHandler(fn: AsyncHandler) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
// Pulls the authed id; safe because validateSession guarantees req.user.
export function getAuthUserId(req: Request): string {
  const id = req.user?.id;
  if (!id) throw new Error('Unreachable: auth middleware guarantees user');
  return id;
}
```
Wrapping a controller in `asyncHandler(...)` removes the need for a try/catch in every method, though either style works.

### 2.3 Services — business logic, CQRS-lite split

Services hold all domain logic and validate ownership before mutating. Non-trivial domains split **reads** and **writes** into separate service classes (CQRS-lite): a `QueryService` (read-only, no mutations) and a `CommandService` (writes, with cache invalidation).

Example: `apps/api/src/domains/memory/services/`
```
memoryQueryService.ts    // reads: getById, list for child, personalization context
memoryCommandService.ts  // writes: create / update / resolve / delete (+ cache invalidation)
```
Services accept an **injectable repository** defaulting to a production instance, which makes them trivial to unit-test with a mock repo:
```ts
// apps/api/src/domains/memory/services/memoryCommandService.ts
const defaultMemoryRepository = new MemoryRepository();
static async createMemory(
  data: CreateMemoryData,
  repository: MemoryRepository = defaultMemoryRepository, // inject a mock in tests
): Promise<Memory> { /* ... */ }
```

### 2.4 Repositories — DB access, extend BaseRepository

A repository owns one Drizzle table and extends `BaseRepository<T>` for CRUD, adding domain queries on top.

Example shape (see `apps/api/src/domains/timesheet/repositories/`):
```ts
export class TimesheetRepository extends BaseRepository<Timesheet> {
  constructor() { super(timesheets); } // the Drizzle table object, not a string

  async findByHousehold(householdId: string): Promise<Timesheet[]> {
    return db.select().from(timesheets)
      .where(eq(timesheets.household_id, householdId))
      .orderBy(desc(timesheets.created_at));
  }
}
```
`db` comes from `src/db/client.ts` (Drizzle over the D1 binding). Multi-statement writes use `db.batch([...])` as guarded atomic writes — D1 has no interactive transactions (see `apps/api/src/db/MIGRATION-NOTES.md`).

---

## 3. Domain Folder Anatomy

The **blessed** structure is `src/domains/<feature>/`. Each domain is self-contained: **its own** `controllers/`, `routes/`, `services/`, `repositories/`, `errors/`, `types/`, and an optional `schemas/` all live INSIDE the domain folder, plus a barrel `index.ts`. There is **no legacy `src/services/` folder** — all business logic lives under `src/domains/`, and no per-domain controller/route file lives at top-level `src/controllers/`/`src/routes/` either.

Top-level `src/controllers/` and `src/routes/` still exist, but hold only **cross-cutting, non-domain** plumbing that isn't owned by any one feature: the versioned-router aggregator (`src/routes/index.ts`, which mounts every domain's router — see §1.2), the job-only routes/aggregation for `/api/jobs`, and shared factories like `src/controllers/jobHandlerFactory.ts` (`createTrackedJobHandler`/`createSimpleJobHandler`, used by every domain's background jobs). If you're adding a new feature, its controller/route/service/repository files go inside `src/domains/<feature>/`, full stop — see the widget domain below for the real, working shape.

Example: `apps/api/src/domains/widget/`
```
widget/
├── index.ts          # barrel
├── routes/           # widgetRoutes.ts — mounted at /api/v1/widgets in src/routes/index.ts
├── controllers/      # widgetController.ts — HTTP layer only
├── services/         # widgetQueryService.ts (reads), widgetCommandService.ts (writes, CQRS-lite)
├── repositories/      # widgetRepository.ts — extends BaseRepository
├── errors/           # widgetErrors.ts — WidgetNotFoundError extends NotFoundError
├── types/            # domain types
├── jobs/             # widgetDigestJob.ts (scheduled work, via the job-handler factories)
└── schemas.ts         # domain-local Zod schemas (see the note in §2.1 about promoting
                        # these to packages/shared-types/src/schemas/<feature>.schema.ts instead)
```
A minimal new domain is just `{ controllers, routes, services, repositories, errors, types, index.ts }`; add `jobs/`, `adapters/`, `pipeline/` only when the feature needs them (larger domains, like a content-ingestion pipeline, add more subfolders — the widget domain above is the minimal real shape to copy).

---

## 4. BaseRepository

`BaseRepository<T, TTable>` (at `apps/api/src/shared/repositories/baseRepository.ts`) provides `findById`, `findAll(filters)`, `create`, `update`, `delete` over a Drizzle table — each throwing a typed `DatabaseError` on failure (via `mapDbError`, which classifies unique / foreign_key / check / overlap violations; never test `err.message` directly because Drizzle wraps driver errors). Subclasses call `super(table)` and inherit CRUD, then add their own queries (see §2.4).

A genericized copy is at `templates/api/baseRepository.ts` (still the old supabase-js shape — treat it as a layering sketch only).

---

## 5. Database access — D1 via Drizzle

One handle, created once per isolate in `apps/api/src/db/client.ts`: `drizzle(env.DB, { schema })` over the D1 binding declared in `wrangler.jsonc`. Schema lives in `src/db/schema/*.ts`; migrations in `apps/api/migrations/` (`drizzle-kit generate`, applied with `wrangler d1 migrations apply`).

- **There is no RLS.** The API is the only DB client, so the service/repository layer is solely responsible for authorization (membership/role checks at the top of each service method, plus the `makeOwnershipValidator` middleware factory — §2.1). A "missing or not yours" lookup throws the same `NotFoundError`.
- D1 gotchas: statement-level atomicity only (guarded writes / `db.batch`), 100 bound parameters per statement (chunk large `IN` lists), `meta.changes` counts trigger writes. Full list in `apps/api/src/db/MIGRATION-NOTES.md`.

---

## 6. Authentication

### 6.1 User auth — `validateSession`

Better Auth (`apps/api/src/auth.ts`, mounted at `/api/auth/*`) issues a cookie session (email/password, Apple and Google id-token sign-in; the Expo plugin carries the cookie on mobile). `validateSession` resolves it with `auth.api.getSession` and attaches `req.user = { id, email, name }`; no or expired session → 401.

Example: `apps/api/src/middlewares/auth.ts`
```ts
const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
if (!session) return sendErrorResponse(res, 'UNAUTHORIZED', 'Invalid or expired token', 401);
req.user = { id: session.user.id, email: session.user.email, name: session.user.name };
next();
```
A companion `requireAuth` middleware (used inside the presets) asserts `req.user.id` exists and otherwise forwards an `AuthenticationError`.

### 6.2 Job auth — `validateJobApiKey`

Scheduled-job routes use a shared secret header instead of a user token.

Example: `apps/api/src/middlewares/jobAuth.ts`
```ts
const apiKey = req.headers['x-job-api-key'];
const expectedKey = process.env.JOB_API_KEY;
if (!expectedKey) return sendErrorResponse(res, 'INTERNAL_SERVER_ERROR', 'Server configuration error', 500);
if (!apiKey || apiKey !== expectedKey)
  return sendErrorResponse(res, 'AUTHENTICATION_REQUIRED', 'Unauthorized', 401);
next();
```

---

## 7. Error Handling

### 7.1 `BaseError` hierarchy

All app errors extend an abstract `BaseError` carrying `code`, `statusCode`, `isOperational`, and optional `metadata`, with a `toJSON()` for serialization.

Example: `apps/api/src/errors/BaseError.ts`
```ts
export abstract class BaseError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly metadata?: ErrorMetadata;
  constructor(message, code, statusCode = 500, isOperational = true, metadata?) {
    super(message);
    this.name = this.constructor.name;
    /* assign fields */
    Error.captureStackTrace(this, this.constructor);
  }
  public toJSON() {
    return { error: { name: this.name, code: this.code, message: this.message,
      ...(this.metadata && { metadata: this.metadata }) },
      statusCode: this.statusCode, isOperational: this.isOperational, stack: this.stack };
  }
}
```

Concrete subclasses (`apps/api/src/errors/`): `ValidationError`, `NotFoundError`, `AuthenticationError`, `AuthorizationError`, `ConflictError`, `DatabaseError`, `ExternalServiceError`, etc. An intermediate `ContextualError<TContext>` adds a typed `context` object plus an overridable `sanitizeContext()` hook for redacting sensitive fields before serialization (available for any domain error that needs a redactable typed context).

Domain errors subclass the generic ones with a fixed code, e.g. `apps/api/src/domains/memory/errors/memoryErrors.ts`:
```ts
export class MemoryNotFoundError extends NotFoundError {
  constructor(memoryId: string, metadata?) {
    super('Memory not found', 'MEMORY_NOT_FOUND', { memoryId, ...metadata });
    this.name = 'MemoryNotFoundError';
  }
}
```

### 7.2 Global `errorHandler`

The last middleware classifies every error into a standardized JSON envelope and tags it in Sentry by feature area.

Example: `apps/api/src/middlewares/errorHandler.ts`
```ts
Sentry.withScope(scope => {
  scope.setTag('feature_area', getFeatureAreaFromPath(req.path));
  if (req.user) scope.setUser({ id: req.user.id, email: req.user.email });
  if (error instanceof BaseError) {
    scope.setTag('error_code', error.code);
    scope.setLevel(error.statusCode >= 500 ? 'error' : 'warning');
  }
  Sentry.captureException(error);
});

if (error instanceof ZodError)  return respond(ValidationError.fromZodError(error)); // → 400
if (error instanceof BaseError) return respond(error);                               // → its statusCode
// unknown → 500 with details/stack only in development
```
Classification rules:
- `ZodError` → converted to `ValidationError` (HTTP 400) via `ValidationError.fromZodError`.
- `BaseError` (and subclasses) → serialized with their own `statusCode` and `code`.
- Anything else → generic `500 INTERNAL_SERVER_ERROR`; `message`/`stack` are only included when `NODE_ENV === 'development'`.

Every response shares the envelope `{ success: false, error, timestamp, path, requestId }`.

---

## 8. Zod Validation

Request schemas live in `apps/api/src/schemas/` (often re-exporting shared schemas from the types package and adding API-specific URL-param schemas). A generic `validate(schema, target)` middleware runs the schema against `req.body | query | params`.

Example: `apps/api/src/middlewares/validator.ts`
```ts
export function validate<T>(schema, property: 'body'|'query'|'params' = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[property]);
    if (!result.success) {
      const error = new ZodError(result.error.issues);
      error.name = 'ValidationError';
      return next(error); // the global handler turns this into a 400
    }
    if (property === 'query') req.validatedQuery = result.data; // req.query is read-only in Express 5
    else req[property] = result.data;                           // body/params can be reassigned
    next();
  };
}
```
**`validatedQuery` convention:** Express 5 makes `req.query` read-only, so validated/coerced query data is written to `req.validatedQuery` instead — controllers read from there for query params, and from `req.body`/`req.params` for the others.

---

## 9. Env Validation

`config/env.ts` validates `process.env` with Zod at import time and **fails fast** with a formatted error if anything required is missing. It is the **first import in `app.ts`**, so a misconfigured deploy crashes at boot rather than on the first request. The schema itself is split across two files merged by `env.ts`: `config/env.core.ts` (the framework-level schema — Better Auth, Apple/Google ids, Sentry, job auth, email) and `config/app.env.ts` (an intentionally near-empty extension point for your own app-specific vars). `config/config.ts` re-exports a small typed `Config` object derived from `env`.

- **Required**: `BETTER_AUTH_SECRET` (>= 32 chars; rotating it signs everyone out). `PORT`/`NODE_ENV`/`BETTER_AUTH_URL` have defaults. On Workers, vars come from `wrangler.jsonc` `vars` and `wrangler secret put`; locally from `apps/api/.dev.vars` (`wrangler dev`). `nodejs_compat` populates `process.env` from them, which is what `env.ts` reads.
- **Optional / defaulted**: `APPLE_*`/`GOOGLE_*` client ids (a provider is on only when its client id is set), `RESEND_WEBHOOK_SECRET`, `SENTRY_DSN`, `LOG_LEVEL`, `EMAIL_FROM`, plus your own app-specific vars in `app.env.ts`.
- **Production-only enforcement**: `productionRequiredCoreKeys` in `env.core.ts` (currently `JOB_API_KEY`, `RESEND_API_KEY`) are optional in dev/test but throw if absent when `NODE_ENV === 'production'`.
- **Test stub**: when `NODE_ENV === 'test'`, env resolution returns a hardcoded placeholder object (`coreTestEnv` merged with `appTestEnv`) so unit tests run without a real `.env`.

```ts
// apps/api/src/config/env.ts (shape)
const envSchema = coreEnvSchema.extend(appEnvSchema.shape);
if (process.env.NODE_ENV === 'test') return { ...coreTestEnv, ...appTestEnv } as Env;
const result = envSchema.safeParse(process.env);
if (!result.success) { /* print formatted errors */ throw new Error('Environment validation failed'); }
export const env = result.data;
```
A skeleton with the generic vars is at `templates/api/env.ts`. **Never put real secret values in code or the bundle** — they come from the environment. See `PROVISIONING.md` for where each value comes from.

---

## 10. Logging

A single **winston** logger with a custom **SentryTransport** (errors also become Sentry messages), plus **morgan** streaming HTTP access logs into winston.

Example: `apps/api/src/middlewares/logger.ts`
```ts
class SentryTransport extends Transport {
  log(info, callback) {
    Sentry.captureMessage(info.message, { level: this.getSentryLevel(info.level), extra: info });
    callback();
  }
}
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [ new winston.transports.Console(/* colorized */),
                new SentryTransport({ level: 'error' }) ],
});
export const morganMiddleware = morgan(':method :url :status ... :response-time ms',
  { stream: { write: (m) => logger.info(m.trim()) } });
```
A `logError(error, req)` helper enriches log entries with `requestId`, `userId`, and (for `BaseError`) `code`/`statusCode`/`metadata`.

**Dev log file:** the dev script tees stdout into a file so you can grep/tail it while debugging:
```jsonc
// apps/api/package.json
"dev": "mkdir -p logs && bun --preload ./src/instrument.ts --watch src/index.ts 2>&1 | tee -a logs/dev.log"
```

---

## Templates referenced
- `templates/api/tsconfig.json` — strict TS config
- `templates/api/bunfig.toml` — test/coverage config (`concurrency = 1`)
- `templates/api/env.ts` — Zod env skeleton
- `templates/api/app.ts` — commented middleware-order scaffold
- `templates/api/baseRepository.ts` — genericized base repository
- `templates/api/run-tests-one-file.sh` — one-file-per-process test runner

See `05-API-LLM-JOBS.md` for the background-jobs system (Workers cron).
