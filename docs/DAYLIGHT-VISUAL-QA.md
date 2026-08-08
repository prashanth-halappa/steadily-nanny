# Daylight visual QA — Maestro instruction

**Task:** drive the app through every meaningful screen with the Maestro MCP tools, capture a screenshot of each, and save them to a single folder so the Ledger → Daylight migration can be reviewed by eye.

This is **visual** QA. `bun run qc` is already green (1007 mobile tests, 567 API, lint/format/typecheck clean), so nothing here is about correctness — it is about whether the new design system actually *looks* right on device. The automated suite cannot see a shadow, and there is no visual-regression harness in this repo.

---

## Why this matters more than usual

The migration replaced Ledger (hairline rules, no shadows, tight 4–6px radii, deep blue) with Daylight (soft plum-tinted shadows, **no borders**, 20px card radii, plum + apricot). The central inversion is **separation by shadow instead of by rule**. That is precisely the kind of change that:

- passes every test while looking wrong, and
- renders differently on Android than iOS, because Daylight uses React Native's multi-layer `boxShadow` array (RN 0.86+), which is a newer code path on Android.

So the screenshots are the deliverable, not a formality.

---

## Setup

| | |
|---|---|
| App ID | `com.jetto.steadily.nanny` |
| Existing flows | `apps/mobile/.maestro/00-smoke.yaml`, `apps/mobile/.maestro/01-sign-in-parent.yaml` |
| Maestro config | `apps/mobile/.maestro/config.yaml` (`screenshotDirectory: screenshots`, `assertTimeout: 10000`) |
| Test users | `parent@steadilynanny.test` and `nanny@steadilynanny.test` — password `SteadilyTest!2026` (see `scripts/seed-test-users.ts`; run `bun run seed` if they don't exist). **Local stack only** — the script refuses to run against anything but `127.0.0.1`/`localhost`/`::1`, since `apps/api/.env` (which it reads for `SUPABASE_URL`) points at production. Start the local stack first (`supabase start`) and export its URL before running `bun run seed`. |
| Dev server | `cd apps/mobile && bun run dev` — tails to `apps/mobile/logs/dev.log` |

**Save screenshots to `docs/screenshots/daylight-2026-08/`.** Create it. Do **not** write into `apps/mobile/screenshots/` (gitignored, and Maestro's own scratch dir) and do **not** overwrite the existing `docs/screenshots/*.png` — those are pre-Daylight captures that `PROJECT-STATUS.md` still references as historical.

Name files `NN-role-screen-state.png`, e.g. `04-nanny-today-on-the-clock.png`. Zero-pad so they sort.

**Drive by `testID`, never by visible text.** The app ships English and Spanish; text selectors break on a locale change. `01-sign-in-parent.yaml` has the correct pattern. Use `mcp__maestro__inspect_view_hierarchy` when you need to discover an id.

---

## The one pair that matters most

Capture these two **back to back, same session, nothing else changed**:

1. `nanny-today-off-the-clock` — no running time entry
2. `nanny-today-on-the-clock` — after tapping `today-clock-in`

Daylight's entire thesis is *"while a nanny is on the clock, the screen itself warms."* Between those two frames you should see **four** things change:

- an apricot gradient wash appears behind the content (`today-live-wash`, fading out by 62% of screen height)
- a 7px apricot dot appears (`today-live-dot`) next to an apricot "on the clock" label
- the clock card's shadow shifts from neutral plum to **apricot** (`today-clock-card`)
- the elapsed timer appears (`today-live-timer`), 44px, tabular figures that must not jitter as they tick

**If the wash is present but the card still looks neutral, that's the bug the migration was fixing — flag it loudly.** The card is supposed to carry the signal; the wash is its echo.

---

## Screens to capture

Sign in as **parent** for the first block, then as **nanny** for the second.

### Unauthenticated
1. Welcome (`welcome-screen`) — plum primary button, 14px button radius
2. Login (`login-screen`) — input radius 16px, ghost button border is **1.5px** and must be visible against the warm grey ground

### Parent
3. Today — the parent's view. If a nanny is clocked in, `today-nanny-live-status` shows with the apricot dot and apricot shadow
4. Schedule / pending (`schedule-pending-screen`) — **filled status pills**, sentence case, not uppercase. Confirmed green, Pending ochre, Declined brick, Short notice terracotta
5. Shift detail (`shift-detail-screen`) — change-request rows: `rounded-row`, **no border**, subtle shadow
6. Schedule respond (day rows) — same row treatment
7. Hours (`hours-screen`) — `WeekTotal` card, tabular figures
8. Calendar views — `calendar-agenda-view` (check `DayGroup` headers are 17px sentence case, **not** uppercase micro-labels), plus `calendar-week-ribbon-view` and `calendar-coverage-lanes-view`
9. Time off (`TimeOffScreen`) — compact rows
10. Settings (`(tabs)/settings`) — list rows and the 22px screen gutter
11. **An alert dialog open** (e.g. the withdraw confirm on the pending screen) — it should now **lift with a shadow** and have no border
12. **A loading state** — any screen mid-fetch, so a `skeleton-card` is on screen. Its radius/padding/shadow must match a real card exactly; if the skeleton and the loaded card don't line up, the transition visibly jumps

### Nanny
13. Today off the clock *(the pair above)*
14. Today on the clock *(the pair above)*
15. Clock-out sheet (`clockout-sheet`) — bottom sheet over scrim
16. This week's shifts — `today-shifts-card`
17. Setup / role fork (`RoleOptionCard`) — this one **keeps a 2px border**; that border is a selection affordance, not surface separation, so it is correct and expected

---

## What "correct" looks like

Check these against every screenshot:

- **No card or row has a border.** The only legitimate borders left are `RoleOptionCard`'s selection ring, form-field inputs, and chips (Daylight chips do carry a 1px rule). Everything else with a hairline is a regression — `Card`'s accent bar was a documented exception to this rule; it was removed after user feedback on device and a genuine rendering defect (a 4px-wide element can't carry the card's 20px corner radius), so the rule is now unqualified.
- **Every card sits on a soft shadow.** If a surface has 20px corners but no lift, it was hand-rolled instead of using `<Card>` — report the screen.
- **Shadows are plum-tinted, not grey/black.** Neutral-black shadows mean something bypassed `useElevation()`.
- **Radii:** cards 20px, buttons 14px, rows 16px, pills/chips fully round, week-strip cells 12px.
- **Nothing is UPPERCASE.** Daylight has no uppercase micro-label style. Any uppercase text is a leftover Ledger idiom.
- **Screen gutters are 22px**, and cards breathe (22px interior padding).
- **Apricot appears only** on live state — the dot, the on-the-clock label, the wash, the live card's shadow. Apricot anywhere else is wrong; plum is the primary.

---

## Also do

- **Run both platforms if you can.** iOS simulator first, then an Android emulator, and capture at minimum the Today on/off pair on both. Android is where the multi-layer `boxShadow` path is least proven — look specifically for a shadow that is missing, too dark, or bleeding through a translucent background.
- **Watch `apps/mobile/logs/dev.log`** while driving. NativeWind **silently drops unknown utility classes** — a typo'd class produces no error and no style, so a missing radius may look like a design bug when it's actually a dropped class.
- **Don't flip dark mode.** It's authored but hard-disabled in `apps/mobile/lib/useColorScheme.ts` and has never been designed. Anything you see there is meaningless.

---

## Report back

Write `docs/screenshots/daylight-2026-08/README.md` containing:

1. The screenshot index — filename → what it shows.
2. Device/OS/build for each run.
3. **Anything that violates the "what correct looks like" list**, with the filename and the specific screen. Be concrete: "the pending-schedule card on `05-parent-schedule-pending.png` has a visible border" beats "looks a bit off."
4. Any screen you could **not** reach, and why. Do not silently skip — an uncaptured screen is an unreviewed screen, and saying so is more useful than a gap nobody notices.

If a screen is broken enough that the screenshot isn't worth taking, say so and move on to the next one. Don't stop the whole run on one failure, and don't retry the same failing tap more than two or three times — report it and continue.
