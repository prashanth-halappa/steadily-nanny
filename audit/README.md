# Steadily Nanny — correctness & auditability sweep

Read-only audit of the hours and pay path. **No source file was modified.** The
only thing this pass added to the repo is this `audit/` directory.

Start at [`00-INDEX.md`](./00-INDEX.md).

## What was done

24 independent `cursor-agent` runs, all read-only (`--mode ask`, which has no
edit tool). Reports were captured by shell redirection, not written by the
agents.

| Wave | Agents | What |
|---|---|---|
| A — ground truth | 3 | Route map (161 endpoints → service → table), money/time inventory, live production schema via Supabase MCP |
| B — finders | 12 | Hours math, pay math, authz ×2, concurrency, state machines, jobs/cron/push, wire contract, mobile render, observability, test quality, shipping risk |
| C — verifiers | 9 | Every S0/S1 finding re-checked by a **different model family**, prompted to refute, defaulting to REFUTED when it could not reproduce the trace |
| D — synthesis | 2 | Ranked index, invariant register |

**77 raw findings → 40 sent to adversarial verification → 27 CONFIRMED, 13
REFUTED.**

## Files

| File | What |
|---|---|
| `00-INDEX.md` | **The deliverable.** Confirmed defects deduplicated by root cause, S0 first, plus systemic themes and a suggested fix order. |
| `INVARIANTS.md` | The properties that must always hold for hours and pay, each mapped to where it is enforced (or `NOWHERE`) and whether a test covers it. This is what makes future changes checkable. |
| `CLOSURE-TABLE.md` | Every confirmed finding mapped to the fix and the test that proves it, plus the rounds where a fix was reopened by review. |
| `RESIDUAL-RISK.md` | **What is still true after all of it** — the seven deliberately accepted ceilings with their money impact, why QA closes only half the verification gap, and what would close the other half. Read this before trusting "everything is fixed". |
| `APPENDIX-REFUTED.md` | The 13 findings that did not survive verification, with the guard that killed each. Kept on the record on purpose. |
| `reports/A1–A3` | Ground truth. `A3` doubles as the production-drift report. |
| `reports/B*` | Raw finder output, unedited, so any conclusion traces back to `path:line`. |
| `verify/V-B*` | Raw verdicts with the verifier's independent reasoning. |

## Caveats — read before trusting a number

1. **Model tier was degraded.** The Cursor account hit its usage limit on
   `gpt-5.3-codex-*` and `claude-*-thinking-*` mid-run. Everything here was
   produced by `composer-2.5` and `cursor-grok-4.5-high`. Cross-family
   verification still held, but the deepest reasoning tier was unavailable.
   Re-running lanes B1–B4 on Codex-xhigh is the highest-value top-up.
2. **Sentry was not consulted.** Its MCP server was unauthenticated
   (`cursor-agent mcp login sentry` to fix). Lane B9's Sentry claims are from
   code only. Its PostHog claims *are* from live data.
3. **S2/S3 findings were not verified.** They are in `00-INDEX.md` under an
   explicit UNVERIFIED heading. Treat them as leads.
4. **Lanes B10/B11 assert absence** (no test, no CI step, no monitor) rather
   than a defect trace, so they were not sent to adversarial verification. The
   synthesis agent spot-checked their citations instead.
5. **Audited the working tree, not HEAD** — uncommitted migrations 047/048 and
   the push-reminder work included, since that is what would ship.
6. **The tree moved mid-audit.** Two commits landed while the agents were
   running:
   - `87914eb` committed the exact uncommitted work the audit was reading
     (reminderJob, reminderLogRepository, 047/048, the notification services).
     Findings against it are current.
   - `2ae309c` is **new** work on mobile onboarding, landed after the finders
     read those files. It touches two cited surfaces. Both re-checked by hand:
     `F-B7-1` (account-delete response shape) is **still live** — mobile still
     requires `{success, message}` at `apps/mobile/src/api/endpoints/user.ts:80`
     while the API sends `{success:true}` with the message in the envelope
     (`userController.ts:73`). `F-B11-6` is **partly addressed** — the new catch
     at `ChildrenScreen.tsx:71` resets the bootstrap ref so it retries, but
     still surfaces no error to the user.
   Any other finding citing a file in `2ae309c` should be re-checked against
   current line numbers before acting on it.

## Found while verifying, outside the agent reports

`bun run qc` is **red at HEAD**, before any audit activity: 2 failing tests in
`apps/mobile/src/domains/expenses/components/__tests__/ExpenseAddSheet.test.tsx`
(expense-kind and mileage-kind payload assertions). Those files are untouched by
the current working-tree changes, so this is pre-existing. API, shared-types and
scripts are all green (1450 / 318 / 24 passing).

## Re-running

Prompts are ephemeral (session scratchpad). The pattern was:

```sh
cursor-agent --print --output-format text --mode ask \
  --model <composer-2.5|cursor-grok-4.5-high> "<lane prompt>" \
  > audit/reports/<lane>.md
```

Every lane prompt ended with a shared rules block requiring `path:line`
citations, an end-to-end trace through to the SQL, one root cause over N
symptoms, and a concrete wrong-number scenario per finding.
