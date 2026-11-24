# LEGAL-ACCEPTANCE-PLAN.md — accept Terms + Privacy before using the app

Written 2026-11-24. Owner decision: **Option C** — after Apple/Google sign-in, a
full-screen "review and accept" step blocks the whole app until the user accepts
the current Terms of Service and Privacy Policy. The same screen re-appears when
the legal version is bumped, so existing users and future terms changes are
covered by one mechanism.

Legal pages: `https://nanny.getsteadily.app/terms` and `/privacy`
(`infra/nanny-site/public/{terms,privacy}.html`, "last updated" 2026-11-24).

> **Naming:** the repo already has a `termsProposal` domain — that is PAY terms
> between a family and a nanny. This feature is named **`legal`** everywhere
> (`legal_acceptances`, `CURRENT_LEGAL_VERSION`, `domains/legal/`) so the two can
> never be confused. Never call it "terms" in code identifiers.

## Behaviour (the contract every wave implements)

1. `CURRENT_LEGAL_VERSION = '2026-11-24'` lives in shared-types. It matches the
   "last updated" date on both pages. Bumping it (with the pages) re-prompts every user.
2. Signed-in user whose latest accepted version !== current → the app shows
   `/legal-accept` and nothing else. Applies to brand-new users (before
   onboarding) and existing users (before tabs), and to deep links into
   `(private)` or `onboarding` (both layouts gate, not just `app/index.tsx`).
3. `/legal-accept` screen: title, two-sentence summary incl. the beta / keep-a-
   backup line, tappable links to Terms and Privacy (existing `openExternalUrl`),
   primary **"Agree and continue"**, secondary **"Not now"** → `signOut()`.
   Accepting is the explicit act (clickwrap); no pre-ticked anything.
4. Loading → neutral spinner shell (never flash the screen or the app).
   Status fetch error → `ErrorState variant="network"` with retry. **Fail closed:**
   an unknown status never lets the user through.
5. Server records each acceptance append-only: `user_id, version, accepted_at`
   (server clock, `toISOString()`), `ip` (`cf-connecting-ip`), `user_agent`,
   `platform`, `app_version`. `UNIQUE(user_id, version)`; re-posting the same
   version is idempotent (200, original row kept). Rows cascade on account delete
   (the Privacy Policy promises deletion).
6. Server rejects any `version` other than `CURRENT_LEGAL_VERSION` with **409**
   `LEGAL_VERSION_MISMATCH` (a stale client must not record acceptance of terms
   it didn't show).

Out of scope (deliberate): server-side enforcement that blocks API calls from
non-accepted users (pre-launch, no old clients in the wild; revisit before the
first terms bump after launch); web acceptance; showing the acceptance date in
Settings.

## Wire contract

```
GET  /api/v1/legal/acceptance        (auth)
  200 { data: { currentVersion: string, acceptedVersion: string | null,
                acceptedAt: string | null, needsAcceptance: boolean } }
POST /api/v1/legal/acceptance        (auth)
  body { version: string, platform?: 'ios'|'android'|'web', appVersion?: string }
  200 { data: <same status shape, needsAcceptance:false> }
  409 code CONFLICT, metadata.reason LEGAL_VERSION_MISMATCH   400 validation
```

## Waves (serial — agy writes into the main checkout, so never two at once)

Each wave: agy (file-aware, `--mode accept-edits`), strict file allowlist,
strict TDD (RED pasted verbatim, then GREEN). Claude verifies every wave by
reading `git diff` and running the tests itself before the next wave starts.

| # | Scope | Files (allowlist) | Reference to copy |
|---|---|---|---|
| W1 | Shared contract | `packages/shared-types/src/schemas/legal.schema.ts` (new), `packages/shared-types/src/index.ts` (one export line), test `packages/shared-types/src/schemas/__tests__/legal.schema.test.ts` | `schemas/timesheet.schema.ts` |
| W2 | DB table + migration + repository | `apps/api/src/db/schema/legal.ts` (new), `apps/api/src/db/schema/index.ts`, `apps/api/migrations/0003_*.sql` + `meta/` (via `bunx drizzle-kit generate`), `apps/api/src/domains/legal/repositories/legalAcceptanceRepository.ts`, test `apps/api/tests/unit/domains/legal/repositories/legalAcceptanceRepository.test.ts` | `db/schema/timesheet.ts`, `timesheetRepository.ts`, `docs/09-TESTING.md` §4.5 |
| W3 | Service, errors, controller, routes, mount | `apps/api/src/domains/legal/{services,errors,controllers,routes}/*`, `apps/api/src/domains/legal/index.ts`, `apps/api/src/routes/index.ts` (one line), tests under `apps/api/tests/unit/domains/legal/{services,routes}/` | timesheet domain |
| W4 | Mobile data layer | `apps/mobile/src/api/endpoints/legal.ts`, `apps/mobile/src/api/queryKeys.ts` (`legal:` block), `hooks/queries/useLegalStatus.ts`, `hooks/mutations/useAcceptLegal.ts`, tests in `__tests__/` beside each | `endpoints/timesheets.ts`, `useWeekTimesheet.ts`, `useApproveTimesheet.ts` |
| W5 | Screen + route + copy | `apps/mobile/src/domains/legal/components/LegalAcceptScreen.tsx` + `__tests__/`, `apps/mobile/src/app/legal-accept.tsx` (thin route), `i18n/locales/{en,es}/auth.json` (`legalGate.*` keys) | `app/welcome.tsx` (links), `docs/design/02-VOICE.md` |
| W6 | The gate | `apps/mobile/src/hooks/useLegalGate.ts` + test, `app/index.tsx`, `app/(private)/_layout.tsx`, `app/onboarding/_layout.tsx`, their `__tests__` | `hooks/useSignedOutRedirect.ts` |

Verification (Claude, after W6): full diff review against this contract, sweep
for strays (`*.patch|*.rej|*.orig|*.bak|patch*.js`), `bun run qc` green, then a
local end-to-end check: `wrangler d1 migrations apply --local`, API dev server,
curl GET→POST→GET, 409 on a wrong version, idempotent re-POST.

## Deploy order (owner approval needed — prod)

1. `wrangler d1 migrations apply steadily-nanny --remote` (additive table only).
2. `wrangler deploy` (API).
3. Ship the mobile build (EAS). Until then nothing is gated.

## Status (2026-11-24)

W1–W6 implemented by agy (Gemini 4 Neon High), each wave diff-reviewed and
re-tested by Claude. Additions by Claude: overlay spinner centering;
`packages/shared-types/tests/legal.pagesInSync.test.ts` (fails if
`CURRENT_LEGAL_VERSION` drifts from the pages' "Effective and last updated"
date — GOLDEN-FIXES #20); schema table-count pin 42 → 43.
Verified: `bun run qc` green; local D1 + `wrangler dev` end-to-end (new user
needsAcceptance:true; stale version 409 CONFLICT/LEGAL_VERSION_MISMATCH; empty
body 400; accept 200 + row with ip/UA/platform/app_version; re-POST idempotent,
original accepted_at kept; no auth 401; account delete cascades the row).
Simulator (iPhone 17 Pro Max, dev client, local API): 7/7 Maestro scenarios PASS — gate on sign-in, Not now signs out, Terms link opens, Agree records an ios row and continues, relaunch skips the gate, accepted user never sees it, private deep links stay behind the gate. Seeded test users (scripts/lib/localDb.ts ensureUser) now accept the current version so existing Maestro flows pass the gate.
