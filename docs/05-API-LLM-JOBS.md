# 05 — API LLM Integration & Background Jobs

> Purpose: how this API talks to an LLM (model registry, type-safe structured output, prompt conventions, error handling/graceful degradation) and how it runs scheduled background work (`/api/jobs/*` behind an API key, triggered by an external cron). All examples are real excerpts from a production API, labelled with their path.

The LLM layer uses **Google Gemini via the Vercel AI SDK** (`ai` + `@ai-sdk/google`). The patterns (centralized model registry, `generateObject` with a Zod schema, XML-tagged prompts, graceful degradation) are provider-agnostic — swap the provider package and model ids for any other.

---

## 1. Model Registry (`config/llmConfig.ts`)

One module instantiates the provider once and exports **named model constants**, each chosen for a task. Call sites import a meaningfully-named model (`multiInsightExtractionModel`), never a raw model string — so model choices are centralized and swappable in one file.

Example: `apps/api/src/config/llmConfig.ts`
```ts
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { env } from './env';

const google = createGoogleGenerativeAI({ apiKey: env.LLM_GOOGLE_API_KEY });

// Tiers — pick the cheapest model that meets the task's accuracy/latency bar.
const flashStructured     = () => google('gemini-2.5-flash');       // fast, cheap, structured
const flashLiteStructured = () => google('gemini-2.5-flash-lite');  // cheapest, simplest tasks

// Named, task-specific exports
export const activityModel              = flashLiteStructured();      // trivial generation
export const multiInsightExtractionModel = flashStructured();        // latency-sensitive extraction
export const chatModel                  = google('gemini-2.5-flash'); // streaming text (no schema)
export const narrativeManualModel       = google('gemini-2.5-pro');   // complex narrative synthesis
export const clinicalSafetyModel        = google('gemini-2.5-pro');   // safety-critical classification
export const embeddingModel             = google.textEmbeddingModel('text-embedding-004');
```

**The flash / flash-lite / pro split — rationale:**
- **flash-lite** — cheapest and fastest; trivial, high-volume generations where quality bar is low.
- **flash** — the default workhorse. Fast and cheap enough for latency-sensitive, high-volume tasks (extraction, chat, digests) where accuracy needs are moderate.
- **pro** — slower and pricier; reserved for **complex or high-stakes** work where accuracy beats latency/cost: long-form narrative synthesis and **safety-critical / clinical classification**. The principle: *spend tokens where a wrong answer is expensive; save them everywhere else.*
- A dedicated **embedding model** (`text-embedding-004`) powers semantic-similarity features.

---

## 2. Structured Output — `generateObject` + Zod

For anything beyond free-text, use `generateObject({ model, schema, system, prompt, temperature })`. The Zod `schema` constrains the model's output and the SDK returns a **type-safe `.object`** matching `z.infer<typeof schema>` — no manual JSON parsing or validation.

Example: `apps/api/src/domains/llm/services/llmMultiInsightExtractionService.ts`
```ts
const result = await generateObject({
  model: multiInsightExtractionModel,
  schema: LlmExtractionResponseSchema,   // Zod schema → typed .object
  system: systemPrompt,
  prompt: userPrompt,
  temperature: 0.3,                      // low temp → consistent extraction
  abortSignal: abortController.signal,   // enforce a hard timeout (see §4)
  maxRetries: 1,                         // bound retries so back-off can't eat the timeout budget
  providerOptions: {
    google: { thinkingConfig: { thinkingBudget: 0 } }, // disable "thinking" latency for fast paths
  },
});
return result.object;                    // fully typed
```
Notes that generalize:
- **`temperature`** low (≈0.3) for extraction/classification; higher (≈0.7) for creative/narrative.
- **`abortSignal` + `maxRetries`** together cap worst-case latency — without bounding retries, the SDK's default back-off can silently consume the timeout budget.
- Provider-specific knobs go under `providerOptions`. Here, Gemini 2.5's default "thinking" adds 3–6 s; disabling it (`thinkingBudget: 0`) is essential for latency-sensitive paths.

---

## 3. Prompt Conventions (`src/prompts/`)

Prompts live in `apps/api/src/prompts/*.ts` as **exported functions** — not inline string literals — so they're versionable, testable, and parameterizable.

- Naming: `getSystemPrompt_<task>(locale)` for system prompts, `userPrompt_<task>(...)` / `build…Prompt(...)` for the user message.
- **XML-style tags** structure the system prompt into sections the model attends to reliably: `<role>`, `<context>`, `<objectives>`, `<instructions>`, plus domain blocks like `<memory_types>`.
- A **`locale` parameter** threads localization into generation.

Example: `apps/api/src/prompts/focusAreaPrompt.ts`
```ts
import { buildLocaleInstruction } from '../utils/localeUtils';
import { APP_PERSONA } from './shared/appVoiceGuidelines';

export function getSystemPrompt_focusArea(locale: string = 'en'): string {
  return `
<role>
${APP_PERSONA}
Your expertise includes developmental psychology, evidence-based trait selection, ...
</role>
<objectives>
1. OPTIMAL FOCUS SELECTION: identify the single most helpful trait ...
2. GROWTH CELEBRATION: recognize specific recent progress ...
</objectives>
<instructions>
STEP 1: REVIEW HISTORICAL CONTEXT — build an exclusion list ...
STEP 2: ANALYZE CANDIDATE TRAITS — evaluate skill level, timing ...
</instructions>`;
}
```
`APP_PERSONA` is a plain string constant holding your product's voice/tone guidelines (role, expertise, tone) — swap its content for your own app's persona. Shared persona/voice fragments live in `src/prompts/shared/` and are imported into multiple prompts so tone stays consistent.

---

## 4. LLM Error Handling & Graceful Degradation

LLM failures get a dedicated `LLMServiceError` (extends `ContextualError`) with an **`isRetryable`** flag and **static factory methods** for the common failure modes.

Example: `apps/api/src/errors/LLMServiceError.ts`
```ts
export class LLMServiceError extends ContextualError<LLMServiceContext> {
  public readonly isRetryable: boolean;
  static rateLimitExceeded(ctx = {}) {
    return new LLMServiceError('LLM service rate limit exceeded', 'RATE_LIMIT_EXCEEDED', 429, ctx, true);
  }
  static timeout(ctx = {})         { return new LLMServiceError('LLM request timed out', 'TIMEOUT_ERROR', 504, ctx, true); }
  static invalidResponse(ctx = {}) { return new LLMServiceError('invalid response format', 'EXTERNAL_SERVICE_ERROR', 502, ctx, false); }
  // sanitizeContext() truncates the prompt to 500 chars so logs aren't polluted / leak PII
}
```
The context type carries `service`, `model`, `operation`, `duration`, `retryAttempt`, sanitized `prompt`, etc., and `sanitizeContext()` truncates the prompt before serialization.

**Graceful degradation — "never 503 to the user":** for user-facing AI features (e.g. voice-to-memory extraction), an LLM failure must **not** surface as an error. The service catches everything and returns an **empty-but-valid** result so the request still succeeds (HTTP 200) and the app degrades gracefully — the work can be retried later by a background job.

Example: `apps/api/src/domains/llm/services/llmMultiInsightExtractionService.ts`
```ts
try {
  const result = await this.callLlm(transcription, child_age_months);
  if (!result) {
    logger.warn('Multi-insight extraction failed, returning empty insights');
    return { insights: [], transcription, error: 'extraction_unavailable' }; // graceful fallback
  }
  // ...filter + return
} catch (error) {
  logger.error('Multi-insight extraction error', { error: String(error) });
  return { insights: [], transcription, error: 'extraction_unavailable' };   // never throws to the user
}
```
The internal `callLlm` returns `null` on timeout/abort/error (it doesn't rethrow), and the public method maps that to the safe fallback shape. Logs are PII-sanitized before writing.

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

router.post('/weekly-summaries',      jobHandler(JobController.runWeeklySummaries));      // Sunday 6 AM UTC
router.post('/smart-notifications',   jobHandler(JobController.runSmartNotifications));   // every 15 min
router.post('/llm-extraction-batch',  jobHandler(JobController.runLlmExtractionBatch));   // process pending LLM work
router.post('/embedding-batch',       jobHandler(JobController.runEmbeddingBatch));       // generate embeddings
```

The scheduler is configured once in SQL. The cron call passes the API key as a header:
```sql
-- Supabase SQL editor (pg_cron + pg_net), run with service_role:
SELECT cron.schedule('dispatch-notifications', '*/15 * * * *',
  $$SELECT net.http_post(
      url := '<API_URL>/api/v1/jobs/dispatch-notifications',
      headers := jsonb_build_object('X-Job-Api-Key', '<JOB_API_KEY>', 'Content-Type', 'application/json'),
      body := '{}'::jsonb
  )$$);
```

### 5.2 Where job code lives

- Cross-cutting jobs: `apps/api/src/jobs/` (e.g. `onboardingDripJob`, `reengagementJob`, `monthlySummaryJob`).
- Domain-owned jobs: `apps/api/src/domains/<feature>/jobs/` (e.g. `domains/memory/jobs/llmExtractionBatchJob.ts`).
- `JobController` (`apps/api/src/controllers/jobController.ts`) imports the job functions and wraps each with logging/timing/run-tracking (via a `JobRunService`) using shared factory helpers (`createTrackedJobHandler`) to avoid 20+ copies of the same boilerplate.

### 5.3 Representative jobs (real examples)

| Endpoint | What it does | Cadence |
|---|---|---|
| `POST /api/jobs/weekly-summaries` | Generate weekly developmental summaries | Sunday 6 AM UTC |
| `POST /api/jobs/smart-notifications` | Evaluate + queue behavioral notifications | every 15 min |
| `POST /api/jobs/llm-extraction-batch` | Process memories with `extraction_status='pending'` via the LLM | on schedule |
| `POST /api/jobs/embedding-batch` | Generate embeddings for new records | on schedule |
| `POST /api/jobs/dispatch-notifications` | Central queue dispatcher | every 15 min |

### 5.4 Batch-job design notes (worth copying)

The LLM extraction batch job (`apps/api/src/domains/memory/jobs/llmExtractionBatchJob.ts`) models robust batch processing:
- **Small batch size** (`BATCH_SIZE = 10`) so total runtime (≈5–10 s/item) safely fits inside the stuck-timeout window — never size a batch so it can exceed its own re-claim timeout.
- **`FOR UPDATE SKIP LOCKED`** row claiming (via the repository) for safe concurrent workers.
- **State machine** per row: `pending → processing → success | failed`, with `last_attempt_at` set on claim.
- **Bounded retries** (`retry_count < 5`) with a cooldown, and **stuck-item requeue** (items stuck in `processing` > 30 min go back to `pending`).
- **Log success/failure counts** each run.

This is the backbone of the graceful-degradation story from §4: user-facing extraction returns an empty result instantly on failure, and this batch job retries the work asynchronously.

---

## Cross-references
- Middleware ordering, env validation, `LLMServiceError`'s `BaseError` lineage, and the `/api/jobs` mount-before-auth rationale: `04-API-ARCHITECTURE.md`.
- Env skeleton (`LLM_GOOGLE_API_KEY`, `JOB_API_KEY`): `templates/api/env.ts`.
