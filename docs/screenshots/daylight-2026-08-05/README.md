# Daylight visual-quality pass — 5 Aug 2026

Captured on **iPhone 17 Pro Max · iOS 26.5**, from a native build made with
`xcodebuild` (Debug, iphonesimulator) against a live API and the standard seed.

**This is a spot-check, not a full tour.** Five surfaces, chosen because they carry the
findings that were fixed. The app has 43 routes and ~30 sheet/dialog surfaces; a complete
recapture is still outstanding. Do not treat this directory as a coverage baseline.

The grey gear top-right is the **expo-dev-client bubble**, not app chrome.

| File | Surface | What it evidences |
|---|---|---|
| `01-nanny-today.png` | Today (nanny, off the clock) | Figtree rendering; role-aware handoff copy — reads *"Tap what your **family** should know"* on the nanny's own screen; the nanny now sees her scheduled `1:00 AM–9:00 AM` when off the clock |
| `02-nanny-hours.png` | Hours | The week total is now the hero (`Display` 32/800) with the screen title demoted to `H4` 18/27; **empty days collapsed** — the five repeated "Not yet / 0m" rows are gone; reimbursements carry elevation and a called-out total |
| `03-shifts-agenda.png` | Shifts — Agenda | Elevated rows, status pills, consistent 22px gutter |
| `04-shifts-week-grid.png` | Shifts — Week grid | **Day names no longer wrap mid-word** ("Mon Tue Wed…", previously "Monda/y", "Wedne/sday"). The visible hour range is now computed rather than a fixed 0–23 — it shows 0–21 here because this week's seed data genuinely contains a 01:47–06:17 shift, so the range expanded to cover it. With ordinary daytime shifts it bounds to 6–20 |
| `05-settings.png` | Settings | Row elevation, Daylight radii |

## Font

Figtree **Variable** (OFL) is embedded natively via the `expo-font` config plugin —
`UIAppFonts` in `Info.plist`, verified present in the installed `.app`, not just the source
tree. It must stay variable: per-weight static files make numeric `fontWeight` a no-op on
iOS, which is why Sora was removed in `9e5bd83` (see `GOLDEN-FIXES.md` #3).

The `wght` axis is 300–900 and the file's `nameID 1` is "Figtree Light", so a wrong family
string would silently render the whole app in Light with no error. Weights render correctly
in these captures, confirming `FONT_FAMILY = 'Figtree'` resolves.

## Comparing against older sets

- `docs/screenshots/tour/` is **pre-Daylight** — blue `#3B6FF5` primary and the Sora
  typeface, both long deleted. Not a valid comparison.
- `docs/screenshots/daylight-2026-08/` is Daylight but predates this pass by ~80 commits and
  several fix passes. Some findings visible there were already fixed before this work began.
