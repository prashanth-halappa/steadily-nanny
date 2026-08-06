# 05 — API LLM Integration & Background Jobs

> Purpose: how this API talks to an LLM (model registry, type-safe structured output, prompt conventions, error handling/graceful degradation) and how it runs scheduled background work (`/api/jobs/*` behind an API key, triggered by an external cron). All examples are real excerpts from a production API, labelled with their path.

The LLM layer uses **Google Gemini via the Vercel AI SDK**, through **Vertex AI** (`ai` + `@ai-sdk/google-vertex`) — authentication is **Application Default Credentials (ADC)**, not an API key. The patterns (centralized model registry, `generateObject`/`generateLlmObject` with a Zod schema, graceful degradation) are provider-agnostic — swap the provider package and model ids for any other.

---

## 1. Model Registry (`config/llmProvider.ts` + `config/app.llmConfigs.ts`)

The provider setup is split into two files. **`llmProvider.ts`** (generic, don't edit per-app) instantiates `createVertex` once and exports **tier factories** — plain functions, not pre-built model instances, so a fresh model handle is created per call:

Example: `apps/api/src/config/llmProvider.ts`
```ts
import { createVertex } from '@ai-sdk/google-vertex';
import { env } from './env';

const vertex = createVertex({
  project: env.GOOGLE_VERTEX_PROJECT,
  location: env.GOOGLE_VERTEX_LOCATION,
});

export const flashLiteModel = (): LanguageModel => vertex('gemini-2.5-flash-lite');
export const flashModel = (): LanguageModel => vertex('gemini-2.5-flash');
export const proModel = (): LanguageModel => vertex('gemini-2.5-pro');
export const embeddingModel = () => vertex.embeddingModel('gemini-embedding-001');
```
`llmProvider.ts` also defines the `LlmCallConfig` interface (`model`, `temperature?`, `maxOutputTokens?`, `timeoutMs?`, `maxRetries`, `disableThinking`) that every named config below is built from.

**`app.llmConfigs.ts`** (per-app — this is where you add your own named, task-specific bundles) imports the tier factories and builds a config per LLM-backed feature:

Example: `apps/api/src/config/app.llmConfigs.ts`
```ts
import { flashModel } from './llmProvider';
import type { LlmCallConfig } from './llmProvider';

export const widgetDescriptionConfig: LlmCallConfig = {
  model: flashModel(),
  disableThinking: true, // Gemini 2.5's default "thinking" adds 3-6s — skip it for latency-sensitive paths
};
```
Call sites import the named config (`widgetDescriptionConfig`), never a raw model string or tier factory directly — so model choice, temperature, timeout, and retry behavior for a given feature are centralized in one place and swappable without touching the call site.

**The flash / flash-lite / pro split — rationale:**
- **flash-lite** — cheapest and fastest; trivial, high-volume generations where quality bar is low.
- **flash** — the default workhorse. Fast and cheap enough for latency-sensitive, high-volume tasks where accuracy needs are moderate.
- **pro** — slower and pricier; reserved for **complex or high-stakes** work where accuracy beats latency/cost. The principle: *spend tokens where a wrong answer is expensive; save them everywhere else.*
- A dedicated **embedding model** (`gemini-embedding-001`) powers semantic-similarity features.

**Why Vertex AI instead of a Gemini API key:** ADC lets a Cloud Run service authenticate via its attached service account with no key file to rotate or leak, and centralizes billing/quota under one GCP project. See `PROVISIONING.md` §3 for the one-time GCP setup (enable the Vertex AI API, grant a service account the Vertex AI User role).

---

## 2. Structured Output — `generateLlmObject` + Zod

For structured output, use the shipped **`generateLlmObject<T>`** wrapper (`apps/api/src/domains/llm/services/llmGenerate.ts`), not the AI SDK's raw `generateObject`. It wraps `generateObject` and folds in the four things every real call needs: a Zod-typed `.object`, PII masking, a hard timeout (`AbortController`) with bounded retries, and typed error triage (it throws a single `LlmGenerationError` — see §4).

Example: `apps/api/src/domains/widget/services/widgetCommandService.ts`
```ts
const { object } = await generateLlmObject<WidgetDescription>({
  config: widgetDescriptionConfig,   // a named LlmCallConfig from app.llmConfigs.ts (model + knobs)
  schema: WidgetDescriptionSchema,   // Zod schema → typed .object
  prompt,
  piiName: ownerDisplayName,         // masked out of the prompt…
  pii: 'maskAndUnmask',              // …and restored in the result (see GOLDEN-FIXES #9)
  timeoutLabel: 'widget description',
});
return object;                       // fully typed as WidgetDescription
```
Notes that generalize:
- **`config`** is a named `LlmCallConfig` bundle (§1), never a raw model string — model/temperature/timeout/retry/`disableThinking` for a feature live in one place, swappable without touching the call site.
- **`pii`** (`'none' | 'maskOnly' | 'maskAndUnmask'`) masks `piiName` before the prompt leaves the process and, for `maskAndUnmask`, restores it in the typed result — the fix for GOLDEN-FIXES #9.
- **Timeout + retries** are enforced *inside* the wrapper (`AbortController` plus the config's `timeoutMs`/`maxRetries`), so the SDK's own back-off can't silently blow the latency budget.

Under the hood the wrapper still calls the AI SDK's `generateObject({ model, schema, system, prompt, abortSignal, maxRetries, providerOptions })` — reach for raw `generateObject` only if you need a knob `generateLlmObject` doesn't expose.

---

## 3. Prompt Conventions

The shipped widget example keeps its single prompt **inline** in the service that uses it:

Example: `apps/api/src/domains/widget/services/widgetCommandService.ts`
```ts
const prompt =
  `Write a warm one-sentence description and up to 3 short lowercase tags ` +
  `for a widget called "${widgetName}", created by ${ownerDisplayName}.`;
```
That's fine for one or two prompts. **Once a domain has several prompts** (or any prompt worth versioning/testing/localizing), promote them to **exported functions** in a `src/prompts/` module instead of inline string literals:

- Name them `getSystemPrompt_<task>(locale)` for system prompts and `build<Task>Prompt(...)` for the user message, so they're parameterizable and unit-testable.
- Structure a longer system prompt with **XML-style section tags** (`<role>`, `<context>`, `<objectives>`, `<instructions>`) — models attend to those sections reliably.
- Thread a **`locale`** parameter through so localization is a prompt input, not a code fork.
- Keep shared voice/persona fragments in one place (e.g. `src/prompts/shared/`) and import them into multiple prompts so tone stays consistent.

(This template ships **no `src/prompts/` directory yet** — the one widget prompt is small enough to stay inline. Create the directory when your first multi-prompt domain lands.)

---

## 4. LLM Error Handling & Graceful Degradation

`generateLlmObject` throws exactly one error type on failure — **`LlmGenerationError`** (`apps/api/src/domains/llm/services/llmGenerate.ts`) — carrying **triage metadata** so callers and logs classify a failure without string-matching:

```ts
export type LlmGenerationErrorType = 'timeout' | 'no_object' | 'api_error' | 'unknown';
export interface LlmGenerationErrorMetadata {
  errorType: LlmGenerationErrorType;
  modelId: string;
  timedOut: boolean;
  timeoutMs?: number;
}
```
The wrapper classifies the underlying AI SDK error (`AI_NoObjectGeneratedError` → `no_object`, `AI_APICallError`/`AI_RetryError` → `api_error`, an abort → `timeout`) and preserves the original as the error's `cause`.

**Graceful degradation — "never 5xx to the user":** a user-facing AI feature must not surface an LLM failure as an error. Catch `LlmGenerationError`, log it, and return an **empty-but-valid** result so the request still succeeds (HTTP 200); rethrow anything that ISN'T an `LlmGenerationError` (that's a real bug, not a degraded model call).

Example: `apps/api/src/domains/widget/services/widgetCommandService.ts`
```ts
try {
  const { object } = await generateLlmObject<WidgetDescription>({
    config: widgetDescriptionConfig,
    schema: WidgetDescriptionSchema,
    prompt,
    /* … piiName / pii / timeoutLabel … */
  });
  return object;
} catch (error) {
  if (error instanceof LlmGenerationError) {
    logLlmGenerationFailure({ operation: 'widgetDescription', widgetName }, error);
    return { description: `A widget called "${widgetName}".`, tags: [] };   // deterministic fallback
  }
  throw error;   // not a degraded LLM call — a real bug; let it surface
}
```
This is exactly why VERIFICATION.md's Level C walkthrough says the widget `generate-description` action still returns *some* description even with no Vertex credentials — the fallback path is the contract working, not a bug. For work that's worth retrying later, pair this instant fallback with a background job (§5).

---

## 5. Background Jobs

Long-running, scheduled, or fire-and-forget work runs as **HTTP endpoints under `/api/jobs/*`**, invoked by an **external scheduler**. One implementation of this is Supabase **`pg_cron` + `pg_net`** calling the endpoints on a cron schedule, but any cron (cloud scheduler, GitHub Actions, k8s CronJob) hitting the URL works.

### 5.1 Auth & wiring

The whole job router sits behind `validateJobApiKey` and is mounted on the app **before** the user-token auth (see `04-API-ARCHITECTURE.md` §1.2) — there is no user, only the `X-Job-Api-Key` shared secret. A `jobHandler` wrapper adapts an async controller method into an Express handler and **fire-and-forgets** it (`void`), so the route can ACK quickly.

Example: `apps/api/src/routes/jobRoutes.ts`
```ts
const jobHandler = (method) => (req, res, next) => { void method(req, res, next); };

const router = Router();
router.use(validateJobApiKey);                       // every job route requires the API key

// SETUP: add your own job routes here, one line each.
router.post('/example-maintenance', jobHandler(JobController.runExampleMaintenance)); // cross-cutting stub
router.post('/widget-digest',       jobHandler(JobController.runWidgetDigest));       // domain-owned example
```

The scheduler is configured once in SQL. The cron call passes the API key as a header:
```sql
-- Supabase SQL editor (pg_cron + pg_net), run with service_role:
SELECT cron.schedule('widget-digest', '0 6 * * *',   -- daily 6 AM UTC
  $$SELECT net.http_post(
      url := '<API_URL>/api/jobs/widget-digest',
      headers := jsonb_build_object('X-Job-Api-Key', '<JOB_API_KEY>', 'Content-Type', 'application/json'),
      body := '{}'::jsonb
  )$$);
```

### 5.2 Where job code lives

- Cross-cutting jobs: `apps/api/src/jobs/` (the shipped example: `exampleMaintenanceJob.ts`).
- Domain-owned jobs: `apps/api/src/domains/<feature>/jobs/` (the shipped example: `domains/widget/jobs/widgetDigestJob.ts`).
- `JobController` (`apps/api/src/controllers/jobController.ts`) imports the job functions and wraps each with logging/timing/run-tracking using the shared factory helpers `createTrackedJobHandler` / `createSimpleJobHandler` (`apps/api/src/controllers/jobHandlerFactory.ts`) — `createTrackedJobHandler` records each run into the `job_runs` table, `createSimpleJobHandler` doesn't. `createTrackedJobHandler` also reads `errorCount` off the summary it just recorded: a non-zero count still completes the `job_runs` row (so the numbers are never lost) and *then* logs at `error` and forwards a `JobCompletedWithErrorsError`, so the response is a failure and Sentry sees it (`jobHandlerFactory.ts:81-93`).

### 5.3 The shipped jobs

| Endpoint | What it does | Cadence |
|---|---|---|
| `POST /api/jobs/example-maintenance` | A cross-cutting maintenance stub — replace its body with your own periodic work. | your choice |
| `POST /api/jobs/widget-digest` | Counts widgets created in the last 24h and returns a summary the tracked-job handler records into `job_runs` (`domains/widget/jobs/widgetDigestJob.ts`). | daily |
| `POST /api/jobs/integrity-checks` | Production data-integrity sweep (`jobs/integrityCheckJob.ts`). Calls `run_integrity_checks()` (migration `056_integrity_checks.sql`, rekeyed for departed carers by `061_integrity_checks_departed_carers.sql`), which runs eight read-only checks — `timesheet_total_mismatch`, `approved_snapshot_mismatch`, `pto_net_negative`, `expense_pending_dup`, `cancellation_unsettled`, `entry_overlap`, `stuck_runner`, `orphan_week` — and returns one row per violation. The job logs one `logger.error` per class (max 5 sample ids) and returns `errorCount = violations`, which makes the run **fail** via `createTrackedJobHandler` (§5.2) and page through Sentry. It never repairs anything. | daily 04:10 UTC (`057_integrity_checks_cron.sql`) |

### 5.4 Batch-job design notes (for when you build one)

The shipped `widgetDigestJob` is a simple aggregate (one COUNT query) — deliberately minimal. A **real batch job** that processes rows (e.g. retrying the §4 fallback work asynchronously) should follow these patterns — the widget job's own header comment points here:
- **Small batch size** (e.g. `BATCH_SIZE = 10`) so total runtime safely fits inside the stuck-timeout window — never size a batch so it can exceed its own re-claim timeout.
- **`FOR UPDATE SKIP LOCKED`** row claiming (via the repository) for safe concurrent workers.
- **State machine** per row: `pending → processing → success | failed`, with `last_attempt_at` set on claim.
- **Bounded retries** with a cooldown, and **stuck-item requeue** (items stuck in `processing` past a timeout go back to `pending`).
- **Log success/failure counts** each run.

This is the backbone of the graceful-degradation story from §4: the user-facing call returns an empty-but-valid result instantly on failure, and a batch job retries the work asynchronously.

---

## Cross-references
- Middleware ordering, env validation (including the `env.core.ts`/`app.env.ts` split), `LLMServiceError`'s `BaseError` lineage, and the `/api/jobs` mount-before-auth rationale: `04-API-ARCHITECTURE.md`.
- Env skeleton (`GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION`, `JOB_API_KEY`): `templates/api/env.ts`. Dashboard-side Vertex AI + service-account setup: `PROVISIONING.md` §3.
