# 05 — API Background Jobs

> Purpose: how this API runs scheduled background work — Cloudflare Workers cron triggers calling tracked job handlers, with `/api/jobs/*` kept as a manual-trigger surface behind an API key. (The filename still says "LLM" for link stability; the `llm` domain was deleted — it had zero callers — and the LLM/Vertex sections went with it. If you add LLM calls later, document them in a new section here.)

## 1. How jobs run

Scheduled work runs as **Workers cron triggers**, not HTTP calls from an external scheduler.

- `apps/api/wrangler.jsonc` → `triggers.crons` lists one entry per distinct schedule (10 today; the Workers Paid plan is required above 5).
- `apps/api/src/scheduled.ts` exports `scheduled(controller)`; it looks `controller.cron` up in **`CRON_JOBS`** (`cron expression → { name, job }`) and runs `entry.job.run()`. A failure is logged and swallowed so the invocation never rejects (`run()` already reports to Sentry and records `job_runs`).
- **`CRON_JOBS` and `triggers.crons` MUST stay in sync.** A cron in `wrangler.jsonc` with no `CRON_JOBS` entry logs `no job registered` and does nothing; an entry with no trigger never fires.
- The cron path needs **no API key** — it never goes through HTTP or Express.
- Locally: `bun run dev` starts `wrangler dev --test-scheduled`; fire one with `curl "http://localhost:8787/__scheduled?cron=5+*+*+*+*"` (URL-encode the expression).

**Kill-switch:** remove the job's line from `triggers.crons` in `wrangler.jsonc` and redeploy (`wrangler deploy`). See `ROLLBACK-RUNBOOK.md`.

## 2. Manual trigger: `/api/jobs/*`

Every job is also exposed as `POST /api/jobs/<name>` for manual runs and smoke tests. The router sits behind `validateJobApiKey` (`X-Job-Api-Key` must equal the `JOB_API_KEY` secret) and `jobRateLimiter`, and is mounted **before** session auth (see `04-API-ARCHITECTURE.md` §1.2) because there is no user. `JOB_API_KEY` is only needed for this manual path (it is still production-required in `env.core.ts`).

Example: `apps/api/src/routes/jobRoutes.ts`
```ts
const router = Router();
router.use(validateJobApiKey);
router.use(jobRateLimiter);
router.post('/reminders', jobHandler(JobController.runReminders));
```
`jobHandler` adapts a controller method into an Express handler and fire-and-forgets it so the route ACKs quickly.

## 3. Where job code lives

- Cross-cutting jobs: `apps/api/src/jobs/` (e.g. `scheduleHorizonJob.ts`; `exampleMaintenanceJob.ts` is the barebones stub).
- `JobController` (`apps/api/src/controllers/jobController.ts`) wraps each with logging/timing/run-tracking via `createTrackedJobHandler` / `createSimpleJobHandler` (`controllers/jobHandlerFactory.ts`). The tracked variant records each run into `job_runs` (skipping if a fresh run is still `running`). A non-zero `errorCount` on the summary still completes the `job_runs` row, then logs at `error` and forwards a `JobCompletedWithErrorsError`, so the run counts as a failure and Sentry sees it.

## 4. The shipped jobs

| Name (`CRON_JOBS`) | Cron (UTC) |
|---|---|
| schedule-horizon | `0 3 * * *` |
| reminders | `5 * * * *` |
| cancellation-pay-reconcile | `25 * * * *` |
| integrity-checks | `10 4 * * *` |
| no-show-sweep | `*/10 * * * *` |
| uncovered-digest | `35 * * * *` |
| cover-ask-expiry | `3-58/5 * * * *` |
| shift-completion | `40 3 * * *` |
| no-show-digest | `50 * * * *` |
| job-health | `15 6 * * *` |

`integrity-checks` runs read-only SQL checks (`jobs/integrityChecks.ts`) and sets `errorCount = violations`, so a violation fails the run and pages via Sentry; it never repairs anything. `job-health` flags registered jobs that are stale, missing or failed, by reading `job_runs` (there is no pg_net failure probe any more), and alerts `OPS_ALERT_EMAILS` / `OPS_ALERT_USER_IDS`.

## 5. Adding a job

1. Write `apps/api/src/jobs/<name>Job.ts` and a `JobController.run<Name>` via the factory.
2. Add `'<cron>': { name, job }` to `CRON_JOBS` in `src/scheduled.ts`.
3. Add the same cron string to `triggers.crons` in `wrangler.jsonc`.
4. (Optional) add a `router.post` line in `jobRoutes.ts` for manual runs.

## 6. Batch-job design notes

A job that processes rows should:
- Use a **small batch size** so runtime fits well inside the stuck-timeout window.
- **Claim rows with a guarded write.** D1 has no `FOR UPDATE SKIP LOCKED` and no interactive transactions: claim with `UPDATE … SET status='processing' WHERE id=? AND status='pending'` and check `meta.changes` (see `apps/api/src/db/MIGRATION-NOTES.md`, "How to replace FOR UPDATE on D1").
- Keep a per-row state machine (`pending → processing → success | failed`), bounded retries with a cooldown, and stuck-item requeue.
- Log success/failure counts each run.
- Stay inside Workers CPU/subrequest limits; a cron invocation is a single Worker run.

## Cross-references
- Middleware ordering, env validation and the `/api/jobs` mount-before-auth rationale: `04-API-ARCHITECTURE.md`.
- Cron kill-switch and deploy ordering: `ROLLBACK-RUNBOOK.md`.
