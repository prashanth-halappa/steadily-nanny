# audit-cx — CX and design-system audit

**What this is.** A read-only audit of every user-facing surface in `apps/mobile` against the
design system in `docs/design/`, run by an independent non-Claude model (agy / Gemini 3.1 Pro)
plus a deterministic `ripgrep` sweep.

**Captured:** 2026-08-19 · working tree at `7106af19`.

**What was not done.** Nothing was executed. No source file was modified, no test was run, no app
was launched, no database was queried. The working tree was byte-identical before and after —
`logs/baseline.txt` holds the pre-run `git status --porcelain`.

---

## The numbers

| | |
|---|---|
| Files audited | **305 / 305** — every one accounted for |
| agy runs | 47 (plus 5 re-runs after a fabrication quarantine) |
| Raw findings | 271 |
| Evidence-verified | **257** |
| Refuted / unverifiable | 14 (`APPENDIX-REFUTED.md`) |
| Mechanical rules swept | 10 (`MECHANICAL.md`) |
| Reached S0 (false statement, blocked action, hidden state) | **0** |

## Files

| File | What it holds |
|---|---|
| `00-INDEX.md` | The deliverable — findings grouped by theme, with `path:line` and cited clause |
| `GAPS.md` | Where the system has no answer or no enforcement — the "why it will happen again" |
| `RECOMMENDATIONS.md` | Ranked by leverage, with a sequencing order |
| `COVERAGE.md` | Ledger of all 305 files → run → finding or clean |
| `MECHANICAL.md` | The deterministic `ripgrep` sweep, verbatim |
| `APPENDIX-REFUTED.md` | Findings that failed verification, and why |
| `reports/` | Raw model output, unedited, one file per run |
| `logs/` | Per-run stderr, the verification table, the quarantined run, the tree baseline |

## Method

**Two layers, because they have different economics.** Ten design rules are exactly greppable —
an LLM adds nothing there but false negatives, so those were swept with `ripgrep` and every hit
is a finding on its own. The judgment work — hierarchy rungs, spec conformance, voice, colour
registers — went to agy.

**Partitioned, then chunked.** All 305 files were partitioned across audit clusters with zero
unassigned, then split so no run exceeded ~1,150 lines. Each run was told to read
`00-FOUNDATIONS` + `01-LAWS` + `02-VOICE` plus its own screen spec, and to close with a `CLEAN:`
line naming every audited file it found defect-free. That closing line is what makes coverage
provable rather than asserted.

**Every finding must carry verbatim evidence.** Each finding quotes the code at the line it
cites; `verify.py` string-matches that quote against the file and grades it `EXACT` / `NEAR` /
`ELSEWHERE` / `ABSENT`. This was added after the first round, and it is the single change that
made the output trustworthy — see the rate table in `APPENDIX-REFUTED.md`.

## Caveats — read before trusting a number

1. **`EXACT` means the code exists, not that the finding is correct.** Rule misapplication is a
   separate failure mode that no string match can catch. Two confirmed cases are documented in
   `APPENDIX-REFUTED.md`; findings were read against source before entering `00-INDEX.md`, but
   257 findings did not each get a full manual adjudication.
2. **Severities in `reports/` are the model's and are not calibrated.** It graded 135 of its
   first 141 findings `S1` and issued no `S0`. `00-INDEX.md` states the regrade basis.
3. **One run fabricated 12 of 19 findings** from a stock shadcn template — and it was the run
   covering the shared primitives, the highest-leverage files in the audit. It was quarantined
   and re-run one file per prompt. Chunk size is a correctness control, not just a speed knob.
4. **Line numbers are working-tree-at-time-of-writing** (`7106af19`).
5. **Spacing-rhythm findings are the weakest class.** Several cite a clause that states no
   specific value; those were dropped rather than reported.
6. **No adversarial verification pass was run** — this was a single-model sweep by choice.
   Findings were not independently re-derived by a second model family.
7. **Scope was mobile + widgets + push copy.** The API, the data model, and the nanny landing
   page were not audited.

## Reproducing

The harness lives in the session scratchpad, not in the repo: `run.sh` / `run2.sh` (quota-aware,
watchdogged, never `--mode accept-edits`), `driver3.sh` (rolling pool), `verify.py`, and the
per-run prompts. Notes that matter if you re-run it:

- agy exits `0` on timeout, so exit code is never the verdict — require non-empty output, no
  leading `Error:`, and a `CLEAN:` line.
- Quota errors land on **stderr**. `2>/dev/null` turns quota exhaustion into what looks like a
  hang; capture stderr to its own file.
- Quota is account-wide, so a multi-model fallback burns all three instantly. Parse
  `Resets in Nm Ns` and sleep it off instead.
- Concurrency 8 exhausted the quota; 3 was sustainable.
