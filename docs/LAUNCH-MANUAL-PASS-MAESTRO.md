# Launch pass — Maestro driver guide

**Audience: Claude Code, driving one booted iOS simulator.**

Companion to [`LAUNCH-MANUAL-PASS.md`](./LAUNCH-MANUAL-PASS.md), which is the
human's four-device checklist. This file is the automatable subset of the same
five scenarios: what the existing suite already proves, what it doesn't, and
the rules that make a Maestro run here trustworthy rather than green-by-luck.

Read [`docs/09-TESTING.md`](./09-TESTING.md) for the harness, and this file for
the launch-pass specifics.

---

## 1. Hard rules — violating any of these produces a false verdict

These are all paid for. Do not re-derive them.

1. **Exactly ONE booted simulator.** Two booted sims make Maestro drive the
   wrong one and `--udid` does **not** help. This has produced a false
   regression report before. Check first, every time:
   ```bash
   xcrun simctl list devices booted
   ```
2. **The exit code is the only verdict.** A flow that reports `COMPLETED` may
   have tapped nothing. Never conclude "it worked" from a screenshot or from
   Maestro's own step log.
3. **THE OCCLUSION CLASS.** Maestro's visibility is derived from the
   accessibility tree, not from what is physically on top. Taps land on the
   keyboard, the QuickType predictions bar, or the tab bar and are reported
   `COMPLETED`. **Every tap must be followed by an assertion that the tap's
   effect happened** — never by the next tap.
4. **`- back` is a no-op on iOS.** To leave a screen, deep-link to the
   destination (`openLink: steadilynanny:///(private)/settings`).
5. **`maestro test` ignores shell exports.** Exported vars arrive as the
   literal string `undefined`. Pass `-e KEY=VALUE`, one flag per pair — and in
   `zsh`, never word-split a single string into those flags.
6. **Run the CLI from `apps/mobile/.maestro/`.** The MCP server mangles
   absolute flow paths, and flows reference `../flows/...` relative to
   themselves. Use `mcp__maestro__*` tools only for `inspect_view_hierarchy`
   and one-off `tap_on` probing, never for a scored run.
7. **A `testID` on an iOS `<Modal>` is invisible** to the hierarchy. Assert on
   text inside the sheet, or on the state change behind it.
8. **Never `clearState` in the normal path.** It re-arms the expo-dev-client
   intro sheet, which pops asynchronously seconds later, replaces the entire
   a11y tree, and swallows every deep link. `flows/reset-to-welcome.yaml` is
   the one canonical reset.
9. **Never reload the bundle mid-session.** `ExpoFabricView.injectInitializer`
   asserts and the app dies. Only `reset-to-welcome.yaml`'s launcher-recovery
   arm may force a bundle load, and only when neither tabs nor welcome are up.
10. **Sweep for stale servers before blaming the app.** A second API process on
    `:8080` from an earlier session will serve prod data into a local run:
    ```bash
    lsof -ti:8080 -ti:8081
    ```

---

## 2. Preflight

Run in order. Do not start a flow until every line is green.

```bash
# 1. one sim, and only one
xcrun simctl list devices booted

# 2. local stack up, every migration applied (goes red if the DB is behind)
scripts/dev-local.sh migrate

# 3. cast seeded
scripts/dev-local.sh seed

# 4. API and Metro, in their own terminals
scripts/dev-local.sh api
scripts/dev-local.sh mobile

# 5. credentials for the flows
test -f apps/mobile/.env.maestro || cp apps/mobile/.env.maestro.example apps/mobile/.env.maestro
#    JOB_API_KEY in that file MUST match apps/api/.env or the job curls 401
```

Then prove you are on the local stack, not prod: `parent@steadilynanny.test`
exists **only** locally, so `tests/01-sign-in-parent.yaml` passing is the
proof. If it fails on credentials, a client is pointed at production — stop.

The two simulator-prep steps (`disable_ios_quicktype`,
`suppress_dev_menu_intro`) are already inside `run-phase4.sh` and
`apps/mobile/scripts/run-maestro.sh`. Prefer those runners over a bare
`maestro test` so you get them for free. If you must run bare, note that
`EXDevMenuIsOnboardingFinished` has to be written into the **app container**
plist with `plutil` — `simctl spawn … defaults write` looks right and is
useless.

---

## 3. Running what already exists

```bash
# everything, with .env.maestro auto-converted into -e flags
apps/mobile/scripts/run-maestro.sh

# one flow
apps/mobile/scripts/run-maestro.sh .maestro/tests/21-usual-week-handoff.yaml

# the ordered cross-cutting batch (seeds fixtures, fires the expiry job mid-run)
apps/mobile/.maestro/run-phase4.sh
```

`run-phase4.sh`'s order is load-bearing — 07 creates the arrangement 09/11/12
price against, 11 approves the week 12 pays, and the `cover-ask-expiry` curl
must sit between 13a and 13b. Do not reorder it to "save time".

---

## 4. Coverage map — scenario → flow

`LAUNCH-MANUAL-PASS.md` §4–§8. **Covered** means an existing flow asserts it.
**Gap** means a human does it on the four devices, or you write the flow in §5.

### S1 — one parent, one nanny, one child

| Step | Flow |
|---|---|
| Sign in, session survives | `01-sign-in-parent` |
| App shell reachable from cold | `00-smoke` |
| Invite carrying a pay offer → nanny accepts | `16-parent-offer-nanny-accept` |
| …→ nanny declines | `17-parent-offer-nanny-decline` |
| Terms setup, overtime + cancellation terms | `07-terms-setup-and-ca-ot-week` |
| Money is unreachable before terms are accepted | `19-terms-gate-blocked` |
| Usual week built → sent → accepted → materialised | `21-usual-week-handoff` |
| Two blocks on one weekday (split shift) | `25-audit-two-block-week` |
| Today's pinned slot | `18-today-pinned-slot` |
| **Gap** | Parent-first onboarding from Register (role → household → children → permissions). `cx-onboarding-tour` walks the screens but does not create a household. |
| **Gap** | Denying a permission mid-wizard and still finishing |

### S2 — co-parent, and the nanny-first door

| Step | Flow |
|---|---|
| Nanny-first draft household | `14-onboarding-nanny-first` |
| Draft keeps all four tabs usable | `20-draft-keeps-tabs` |
| Parent absorbs the draft, drafted work survives | `15-onboarding-absorption` |
| **Gap** | Parent-role invite actually mints `role: parent` (it silently minted `nanny` once — see `InviteScreen.tsx` header) |
| **Gap** | `approval_mode: ask_other` — co-parent asked, approves |
| **Gap** | …co-parent declines |
| **Gap** | …nobody answers, `approval_timeout_minutes` sends it anyway |
| **Gap** | `owner_only` refuses the co-parent |
| **Gap** | Second child appears on the nanny's side |

Approval-mode flows need two sessions. Chain them by role the way `run-phase4.sh`
does — `login.yaml` then `login-nanny.yaml` — rather than trying to hold two
sessions at once. For the timeout arm, do not sleep: set
`approval_timeout_minutes` low via SQL, or drive the elapsed state directly.

### S3 — two nannies in one household

Entirely uncovered. The highest-value gap in the pass: it is the only scenario
where a per-carer bug can silently pay the wrong person.

| Step | Flow |
|---|---|
| **Gap** | Second nanny joins the same household |
| **Gap** | Second, *different* pay arrangement; each carer's terms stay separate |
| **Gap** | Nanny 2 accepting a week does **not** supersede Nanny 1's accepted week |
| **Gap** | In-household overlap between two carers is **refused** |
| **Gap** | Nanny 1 cannot see Nanny 2's rate anywhere |

### S4 — the nanny with two families

| Step | Flow |
|---|---|
| Six surfaces, no cross-family bleed (clock card, inbox, proposal, Hours deep link, pending schedule, active household) | `22-audit-two-family-nanny` |
| Household switcher + a second household on a Sunday week | `10-sunday-workweek-hours` |
| **Gap** | Cross-household overlap is an **advisory**, not a refusal |
| **Gap** | Parent A sees "unavailable" with no nameable reason |

`scripts/seed-second-household.ts` seeds household B with deliberately
distinctive `LEAKCANARY` strings — assert on that substring; if it ever renders
in household A, the anonymity promise is broken and the screenshot proves it.

### S5 — the change-and-money week

Best-covered scenario. Run `run-phase4.sh` and these:

| Step | Flow |
|---|---|
| Parent edits a confirmed shift → demote → re-confirm | `03-parent-edit-demote-reconfirm` |
| Nanny accepts an extra shift | `02-nanny-accept-extra-shift` |
| Time off over booked shifts | `06-time-off-over-booked-shifts`, `cx-timeoff-back-check` |
| Sick day cancels a shift | `08-sick-timeoff-cancels-shift` |
| Cover ask awaiting → expired/declined | `13a`, `13b` (+ the expiry job between) |
| Query thread → withdraw → approve | `11-query-thread-withdraw-approve`, `04-timesheet-query-correct-approve` |
| Hours week deep link | `05-timesheet-deeplink-hours-week` |
| Overtime + double time in one week | `07-terms-setup-and-ca-ot-week` |
| Worked-holiday premium | `09-holiday-premium-week` |
| Record payment → correct → export | `12-payment-record-correct-export` |
| Reopening a paid week is refused | `23a-audit-reopen-refusal` |
| Money surfaces degrade on a dead API, and recover | `23b`, `23c` |
| Today degrades on a dead API, and recovers | `24a`, `24b` |
| **Gap** | Nanny clocks out into an already-paid week → flagged, not re-priced |
| **Gap** | Parent cover clears uncovered care and is not payable |
| **Gap** | Household closure over a booked day |
| **Gap** | Care hours wider than the booked week → uncovered row |

`23b`/`24a` kill the API deliberately. Run them last in any batch, and restart
the API before anything else.

---

## 5. Writing a new flow for a gap

1. **Get the real testIDs first.** Never guess one. Either
   `mcp__maestro__inspect_view_hierarchy` with the screen up, or grep the
   component: `rg 'testID=' apps/mobile/src/domains/<domain>`.
2. **Copy an adjacent flow's skeleton**, not a blank file.
   `22-audit-two-family-nanny.yaml` is the model for a multi-surface assertion
   flow; `21-usual-week-handoff.yaml` for a two-role handoff.
3. **Start with a role flow**, never with `launchApp`:
   ```yaml
   appId: com.jetto.steadily.nanny
   ---
   - runFlow: ../flows/login.yaml        # or login-nanny.yaml
   ```
   Both call `reset-to-welcome.yaml` first, so a wrong start state fails loudly
   instead of silently running as the previous flow's role.
4. **Navigate by deep link**, not by tapping through (`- back` is a no-op):
   `openLink: steadilynanny:///(private)/settings/pay`.
5. **Assert after every tap** (rule 3). Prefer
   `extendedWaitUntil: visible: … timeout:` over a bare `assertVisible` for
   anything that follows a network round trip.
6. **Screenshot the money and the leak checks** —
   `takeScreenshot: s3-b2-carer-rates-separate`. Screenshots are evidence for
   the human's pass, not the verdict.
7. **Fixtures:** prefer creating state through the app when the creation *is*
   the test; otherwise seed it. `seed-phase4-fixtures.ts` emits `KEY=VALUE`
   lines after an `# --- eval me` marker and `run-phase4.sh` eval's them into
   `-e` flags — follow that contract for anything new. Note that local shift
   fixtures die on every `scripts/dev-local.sh reset`; re-seed after one.
8. **New flows go in `apps/mobile/.maestro/tests/`**, numbered, with a header
   comment saying what the flow proves and which fixtures it needs. Add it to a
   runner only once it passes twice in a row.

---

## 6. Reporting

- Exit code is the verdict. Report per-flow pass/fail, never a summary that
  smooths over a failure.
- On a failure, capture `maestro hierarchy` at the failing step before
  re-running — a re-run often lands in a different state and destroys the
  evidence.
- Distinguish **app defect** from **harness defect**. Occlusion, a re-armed
  dev-menu sheet, a stale `:8080` server and a two-sim run are harness
  failures; do not log them as product bugs. When unsure, re-run that one flow
  in isolation on a freshly reset app.
- Log real defects in `docs/DEFECT-LOG.md` with the flow name and the
  screenshot path.
- Anything Maestro cannot reach — push notifications, cold deep links from
  outside the app, Android, the store build — goes back to the human's
  four-device checklist in `LAUNCH-MANUAL-PASS.md`.
