# 04 — API Architecture

> Purpose: the layered, clean-architecture blueprint for an Express 5 + Supabase + Bun API — bootstrap, middleware ordering, the four layers (routes → controllers → services → repositories), error handling, auth, Zod validation, env validation, and logging. Reuse the patterns; swap the product specifics.

The stack: **Express 5**, **Bun** runtime + test runner, **Supabase** (Postgres + Auth + Storage), **Zod** validation, **winston** logging, **Sentry** error monitoring, **PostHog** analytics. All examples are real excerpts from a production API (`apps/api/`), labelled with their path.

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
| 1 | `app.set('trust proxy', true)` | `req.ip` resolves to the real client behind a load balancer. |
| 2 | `Sentry.setupExpressErrorHandler(app)` | Error monitoring request handler before routes. |
| 3 | `helmet(helmetConfig)` | Security headers first. |
| 4 | `compression()` | gzip/brotli — 60–80% smaller responses. |
| 5 | `cacheControl` | Intelligent `Cache-Control` headers. |
| 6 | `requestId` | Assign `X-Request-ID` before anything logs (correlation). |
| 7 | `express.json({ verify })` + `express.urlencoded` | Body parsing. The `verify` callback preserves the **raw body** only for `/api/webhooks/*` so HMAC signatures can be verified (parsed JSON can't be re-hashed). |
| 8 | `morganMiddleware` | HTTP access log → winston, after body parse. |
| 9 | **`/api/jobs`** (`jobRoutes`) | **API-KEY auth — mounts BEFORE Supabase auth.** |
| 9 | **`/api/app`** (status), **`/api/webhooks`** (signed), **`/api/unsubscribe`** (public) | Each has its own / no auth — all mount BEFORE Supabase auth. |
| 10a | `/api/v1` → `validateSupabaseToken` | Bearer-token auth; attaches `req.user`. |
| 10b | `/api/v1` → `userRateLimiter` | After auth so the rate-limit key is the user ID. |
| 10c | `/api/v1` → `streakRecorder` | Write-side side effect (POST/PUT/PATCH/DELETE), needs `req.user`. |
| 10d | user-context middleware | `Sentry.setUser(...)` from `req.user`. |
| 10e | `/api/v1` → `apiRoutes` | The actual versioned router. |
| 11 | `/docs` Swagger (dev only) | Lazy-`require`d so prod never loads it into memory. |
| 12 | `/health`, `/` | Health checks for the orchestrator. |
| 13 | `errorHandler` | **ALWAYS LAST** — Express only catches `next(err)` in middleware registered after the routes. |

Example: `apps/api/src/app.ts`
```ts
// Job routes - API key authentication (not Supabase token)
// Must be mounted before Supabase auth middleware
app.use('/api/jobs', jobRoutes);
// ...
// Apply Supabase auth middleware for all API routes
app.use('/api/v1', validateSupabaseToken);
// Rate limiting applied after auth so we can use user ID for the key
app.use('/api/v1', userRateLimiter);
// Streak recording fires after successful writes; dedupes via cache
app.use('/api/v1', streakRecorder);
```

**Why job routes mount before auth:** scheduled jobs are invoked by an external scheduler (Supabase `pg_cron` + `pg_net`, or any cron hitting the HTTP endpoint). There is no logged-in user and no Supabase JWT — only a shared `X-Job-Api-Key` secret. If `/api/jobs` mounted under `validateSupabaseToken`, every cron call would 401. So the job router carries its own `validateJobApiKey` guard and is mounted on the app *before* the `/api/v1` auth layer. The same logic applies to signed webhooks and public status/unsubscribe routes.

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

A route file wires path → middleware chain → controller method. No logic. Validation, auth, and ownership checks are composed from **preset spreads** to kill boilerplate.

Example: `apps/api/src/routes/memoryRoutes.ts`
```ts
// POST /api/v1/memory/children/:childId
router.post(
  '/children/:childId',
  ...authWithChildParam(ChildIdParamSchema), // requireAuth + validate(params) + ownership
  validate(CreateMemoryRequestSchema, 'body'),
  asyncHandler(MemoryController.createMemory)
);
```

The presets live in `apps/api/src/middlewares/presets.ts` and compose the three most common chains:
```ts
/** Auth + param validation + child ownership (childId in URL params) */
export const authWithChildParam = (schema, target = 'params') => [
  requireAuth, validate(schema, target), validateChildOwnership,
];
/** Auth + validation only (no ownership check) */
export const authWithValidation = (schema, target = 'params') => [
  requireAuth, validate(schema, target),
];
```
Spread them with `...authWithChildParam(schema)` so each route reads as a single declarative chain. (For your domain, replace the "child ownership" check with whatever resource-ownership your entities need.)

### 2.2 Controllers — HTTP only

Controllers never contain business logic. They: pull params/body, get the authed user id, call a service, and shape the response via `sendSuccessResponse`. Errors go to `next(error)` (the global handler classifies them).

Example: `apps/api/src/controllers/childController.ts`
```ts
static async createChild(req: Request, res: Response, next: NextFunction) {
  try {
    const childData: ChildCreateRequest = req.body;
    const result = await ChildService.createChild(getAuthUserId(req), childData);
    return sendSuccessResponse(res, 'Child profile created successfully',
      { child: result.child, relationship: result.relationship }, 201);
  } catch (error) {
    return next(error);
  }
}
```

Two helpers (`apps/api/src/utils/asyncHandler.ts`) make this safe and terse:
```ts
// Forwards any rejected promise to the Express error handler.
export function asyncHandler(fn: AsyncHandler) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
// Pulls the authed id; safe because validateSupabaseToken guarantees req.user.
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

A repository owns one table and extends `BaseRepository<T>` for CRUD, adding domain queries on top.

Example: `apps/api/src/domains/memory/repositories/memoryRepository.ts`
```ts
export class MemoryRepository extends BaseRepository<Memory> {
  constructor() { super('child_memory'); }

  async findByChildId(childId: string, filters?: MemoryQueryFilters): Promise<Memory[]> {
    let query = supabaseService.from(this.table).select('*').eq('child_id', childId);
    if (filters?.status) query = query.eq('status', filters.status);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw new DatabaseError(/* ... */);
    return data ?? [];
  }
}
```

---

## 3. Domain Folder Anatomy

The **blessed** structure is `src/domains/<feature>/`. Each domain is self-contained and exports a barrel `index.ts`. There is **no legacy `src/services/` folder** — all business logic lives under `src/domains/`. (The wider repo also keeps shared HTTP plumbing — `controllers/`, `routes/`, `schemas/`, `middlewares/` — at `src/` top level, but the domain logic itself is always inside `src/domains/`.)

Example: `apps/api/src/domains/memory/`
```
memory/
├── index.ts          # barrel: re-exports types, errors, services, repositories…
├── services/         # memoryQueryService, memoryCommandService (CQRS-lite)
├── repositories/     # memoryRepository (+ specialized: extraction, embedding, pattern)
├── errors/           # memoryErrors.ts — domain error subclasses
├── types/            # domain types
├── jobs/             # llmExtractionBatchJob, embeddingBatchJob, … (scheduled work)
├── schemas/          # domain-local Zod schemas
├── adapters/         # input adapters (chat, assessment, activity, direct)
├── pipeline/         # multi-stage ingestion pipeline
└── utils/
```
The barrel keeps imports clean — consumers do `import { MemoryQueryService } from '../domains/memory'`:
```ts
// apps/api/src/domains/memory/index.ts
export * from './adapters';
export * from './errors';
export * from './pipeline';
export * from './repositories';
export * from './services';
export * from './types';
```
For a new project, a minimal domain is just `{ services, repositories, errors, types, index.ts }`; add `jobs/`, `adapters/`, `pipeline/` only when the feature needs them.

---

## 4. BaseRepository

`BaseRepository<T>` (at `apps/api/src/shared/repositories/baseRepository.ts`) provides `findById`, `findAll(filters)`, `create`, `update`, `delete` — each wrapping a Supabase query and throwing a typed `DatabaseError` on failure. Subclasses call `super('table_name')` and inherit CRUD, then add their own queries (see §2.4).

```ts
async findById(id: string): Promise<T | null> {
  const { data, error } = await supabaseService
    .from(this.table).select('*').eq('id', id).maybeSingle();
  if (error) throw new DatabaseError(`Failed to find ${this.table} by id`,
    'DATABASE_ERROR', { id, operation: 'findById' });
  return data;
}
```
A genericized copy is at `templates/api/baseRepository.ts`.

---

## 5. Supabase Clients — anon vs service role

Two clients are created once and shared (`apps/api/src/config/supabase.ts`):

```ts
export const supabase = createClient(supabaseUrl, supabaseKey);          // ANON key
export const supabaseService = createClient(supabaseUrl, supabaseServiceKey); // SERVICE role
```

- **`supabase` (anon key)** — used to verify user JWTs (`supabase.auth.getUser(token)`). Subject to Row-Level Security.
- **`supabaseService` (service-role key)** — used by **all repositories**. It **bypasses RLS**, so it must be **server-side only and never exposed to clients**. Because RLS is bypassed, the service/repository layer is responsible for ownership enforcement (e.g. the `validateChildOwnership` middleware + service-level checks).

The service key is a top-tier secret — keep it in env, never in the bundle, never in logs.

---

## 6. Authentication

### 6.1 User auth — `validateSupabaseToken`

Bearer token → cache lookup → verify with Supabase → cache the result. Caching avoids a round-trip to Supabase Auth on every request.

Example: `apps/api/src/middlewares/auth.ts`
```ts
const token = extractBearerToken(req);                 // Authorization: Bearer <jwt>
if (!token) return sendErrorResponse(res, 'MISSING_TOKEN', '...', 401);

const cached = cache.get<User>(CacheKeys.token(token)); // 1. cache
if (cached) { req.user = cached; return next(); }

const { data: { user }, error } = await supabase.auth.getUser(token); // 2. verify
if (error || !user) return sendErrorResponse(res, 'INVALID_TOKEN', '...', 401);

cache.set(CacheKeys.token(token), user, TTL.TOKEN);     // 3. cache + attach
req.user = user;
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

Concrete subclasses (`apps/api/src/errors/`): `ValidationError`, `NotFoundError`, `AuthenticationError`, `AuthorizationError`, `ConflictError`, `DatabaseError`, `ExternalServiceError`, `LLMServiceError`, etc. An intermediate `ContextualError<TContext>` adds a typed `context` object plus an overridable `sanitizeContext()` hook for redacting sensitive fields before serialization (used by `LLMServiceError`, `NotificationError`, `WorkflowError`).

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

`config/env.ts` validates `process.env` with Zod at import time and **fails fast** with a formatted error if anything required is missing. It is the **first import in `app.ts`**, so a misconfigured deploy crashes at boot rather than on the first request. `config/config.ts` re-exports a small typed `Config` object derived from `env`.

- **Required** vars (no defaults): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `LLM_GOOGLE_API_KEY`; `PORT`/`NODE_ENV` have defaults.
- **Optional / defaulted**: `SENTRY_DSN`, `POSTHOG_API_KEY`, `JOB_API_KEY`, `LOG_LEVEL`, plus product integrations.
- **Production-only enforcement**: extra `if (NODE_ENV === 'production')` checks throw if certain optional vars are absent in prod.
- **Test stub**: when `NODE_ENV === 'test'`, `validateEnv()` returns a hardcoded placeholder object so unit tests run without a real `.env`.

```ts
// apps/api/src/config/env.ts (shape)
if (process.env.NODE_ENV === 'test') return { /* placeholder values */ } as Env;
const result = envSchema.safeParse(process.env);
if (!result.success) { /* print formatted errors */ throw new Error('Environment validation failed'); }
export const env = result.data;
```
A skeleton with the generic vars is at `templates/api/env.ts`. **Never put real secret values in code or the bundle** — they come from the environment.

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

See `05-API-LLM-JOBS.md` for the LLM model registry, structured output, prompt conventions, and the background-jobs system.
