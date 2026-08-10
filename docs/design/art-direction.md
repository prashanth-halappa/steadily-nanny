# Steadily Nanny — Art Direction

Companion to [`daylight-v2.md`](./daylight-v2.md). Visual reference:
[`docs/screenshots/ux-reference/`](../screenshots/ux-reference/).

Assets are generated via Higgsfield and land in
`apps/mobile/assets/illustrations/`, registered in that folder's `index.ts`.
**Every in-app asset is a transparent PNG.** The only baked background is the
store icon.

---

## Brand mark

- **Concept:** Rounded home + clock hand — domestic coordination without literal
  faces or text.
- **Palette:** Plum `#5B3E5D` (primary shape), apricot `#E8823C` (accent
  dot/hand), ground `#F5F1F2` (icon background).
- **Constraints:** Legible at 29×29pt; no typography; no photorealism; square
  safe zone for the Android adaptive icon (key detail in the centre 66%).

Unchanged in v2.

---

## Illustration style lock

Carried over from v1 and still binding:

- Soft flat vector. **2–3 tone fills per shape, no gradients, no texture, no
  outline strokes.**
- Corner radius ~20px equivalent on shapes — matches the Daylight card radius.
- Figures are abstract, inclusive silhouettes. **No faces, no facial features,
  no skin-tone specificity, no text inside the art.**
- Transparent background for everything in-app.

### v2 additions

- **Palette is closed.** Only these values may appear:
  `#5B3E5D` plum · `#7C5A7F` plum light · `#6A4C77` lavender · `#4C7A6A` sage ·
  `#A85E6E` rose · `#F0E9ED` muted · `#EDE5EA` secondary · `#E8823C` apricot.
  No other hue. If a prompt returns a colour outside this list, regenerate.
- **Apricot obeys register 3.** In the UI, apricot means "a person is on the
  clock right now." Illustration must not undermine that: apricot appears
  **only** in `today-here` and `welcome-hero`, and only on the element that
  represents a person being present. Every other asset is plum / lavender / sage
  / rose / muted. This is the same discipline the interface follows and it is
  what keeps the live signal meaningful.
- **One idea per asset.** A single clear metaphor, centred, generous margin. No
  scenes with three simultaneous subjects.
- **Optical weight ≤ 35% ink coverage.** These sit on a warm ground under a
  plum wash; a dense illustration reads as a hole in the page.
- **Illustrations sit on a `chipPlum` `#EBE8EC` circle** in every `EmptyState`
  (v2 §6.8), at 1.6× the art's width. Compose art to sit comfortably inside a
  circle, not to bleed to the frame edge.

---

## Size specs

All assets are authored at **@3x** and downsampled by the bundler. This is a
change from v1, which specified @2x for empty states.

| Use | Display | Asset (@3x) |
|-----|---------|-------------|
| Today hero spot | 104×104 pt | **312×312** PNG |
| Welcome hero | 280×280 pt | **840×840** PNG |
| Onboarding step | 220×220 pt | **660×660** PNG |
| Empty state (default) | 240×240 pt | **720×720** PNG |
| Empty state (inline) | 160×160 pt | **480×480** PNG |
| App icon | — | 1024×1024 PNG, no alpha |
| Splash logo | 200 pt wide | 512×512 PNG, transparent |
| Favicon | — | 48×48 PNG |

---

## Placements — where illustration is allowed

| Screen | Placement | Asset |
|---|---|---|
| **Today** | Hero band, right-aligned, 104×104pt, behind the wash fade | `today-quiet` / `today-here` / `today-done`, state-driven |
| **Today** | Inline empty state, no household | `empty-today` |
| **Schedule** | **No hero.** Empty state only | `empty-schedule` |
| **Hours** | **No hero.** Inline empty week only | `empty-hours` |
| **Settings** | **None on the tab root.** Pushed screens' empty states only | `empty-children`, `empty-pay`, `empty-time-off`, `empty-household`, `empty-no-carer` |
| Welcome | Hero, 280×280pt | `welcome-hero` |
| Onboarding | Per-step hero, 220×220pt | `onboarding-role`, `onboarding-calendar`, `onboarding-notifications` |
| Inbox | Empty state | `empty-inbox` |
| Pending schedule | Empty state | `empty-pending` |

**Why Hours and Schedule get no hero.** On Hours the figure is the hero and an
image beside a number someone is paid on is the one place decoration costs
credibility. On Schedule a hero image pushes the first real row below the fold
on a screen that exists to be scanned.

---

## Asset list

### New for v2 — 3 assets

| Filename | Display | @3x | Placement | Prompt-ready description |
|---|---|---|---|---|
| `today-quiet.png` | 104pt | 312×312 | Today hero, nobody on the clock | Soft flat vector, transparent background. A single empty rounded armchair seen three-quarter on, plum `#5B3E5D` body with muted `#F0E9ED` cushion, a small lavender `#6A4C77` mug on a low side table beside it, and three short sage `#4C7A6A` lines suggesting morning light from the upper left. No people. No faces. No text. Flat fills only, no gradients, rounded 20px corners on every shape, generous margin, composition fits inside a circle. |
| `today-here.png` | 104pt | 312×312 | Today hero, someone is live | Soft flat vector, transparent background. Two abstract faceless silhouettes — one adult-height, one child-height — seated at a small rounded table with a plum `#5B3E5D` top. The adult figure in lavender `#6A4C77`, the child in rose `#A85E6E`, one warm apricot `#E8823C` circle above them suggesting a lamp or sun. No facial features. No text. Flat fills only, no gradients, rounded shapes, generous margin, composition fits inside a circle. |
| `today-done.png` | 104pt | 312×312 | Today hero, all cover finished | Soft flat vector, transparent background. The same empty rounded armchair, plum `#5B3E5D`, with a folded sage `#4C7A6A` blanket draped over one arm and a lavender `#6A4C77` crescent moon shape in the upper right. No people. No faces. No text. Flat fills only, no gradients, rounded 20px corners, generous margin, composition fits inside a circle. |

### Restyle to the v2 closed palette — 14 existing assets

Regenerate each with the same metaphor and the v2 palette rule (no apricot
except `welcome-hero`). Filenames and `index.ts` keys are unchanged, so nothing
in the app needs rewiring.

| Filename | Metaphor to keep | Palette |
|---|---|---|
| `welcome-hero.png` | Parent and nanny silhouettes beside a cozy home and a weekly calendar | plum + apricot + muted |
| `onboarding-role.png` | Two doors / a fork in a path | plum + lavender |
| `onboarding-calendar.png` | A week grid with two marked days | plum + sage |
| `onboarding-notifications.png` | A bell inside a rounded card | plum + lavender |
| `empty-schedule.png` | An open, unmarked calendar | plum + lavender |
| `empty-inbox.png` | An empty tray, lid open | plum + sage |
| `empty-hours.png` | A simple clock face, no hands | plum + sage |
| `empty-pay.png` | Stacked coins / a folded receipt | plum + sage |
| `empty-time-off.png` | An hourglass | plum + lavender |
| `empty-household.png` | A rounded house outline | plum + rose |
| `empty-today.png` | A low sun over a horizon line | plum + rose |
| `empty-no-carer.png` | An envelope with an outbound arrow | plum + lavender |
| `empty-children.png` | Three stacked rounded blocks | lavender + sage + rose |
| `empty-pending.png` | A calendar block with a small clock corner | plum + lavender |

---

## Higgsfield prompt seeds

**Global suffix — append to every in-app prompt:**

> Soft flat vector illustration, transparent background, flat fills only, no
> gradients, no outlines, no shadows, no texture, rounded 20px corners on all
> shapes, abstract and faceless, no text, no letters, no numbers, generous
> margin, centred composition, minimal, warm domestic feeling. Colours limited
> to: `#5B3E5D`, `#7C5A7F`, `#6A4C77`, `#4C7A6A`, `#A85E6E`, `#F0E9ED`,
> `#EDE5EA`.

For `today-here` and `welcome-hero` only, add `#E8823C` to that colour list.

**Icon (recraft_v4_1, vector):**
> Minimal app icon for childcare scheduling. Soft flat vector. Rounded house
> shape with a simple clock hand inside. Plum purple `#5B3E5D` main, apricot
> `#E8823C` accent, cream background `#F5F1F2`. No text, no faces. Centred,
> readable at small size.

**Splash:** Same mark, transparent background, logo only.

**Empty states and Today spots (gpt_image_2, ref icon):** use the per-asset
description from the tables above, then the global suffix.

---

## Acceptance checks before an asset ships

1. Background is genuinely transparent (no white matte at the corners).
2. No colour outside the closed palette. Sample three points and check.
3. No apricot unless the asset is `today-here` or `welcome-hero`.
4. No faces, no text, no numerals anywhere in the art.
5. Legible as a silhouette at 104pt — squint at it; if the metaphor is gone, the
   art is too detailed.
6. Ink coverage under ~35% of the frame.
7. Composition survives being masked to a circle at 1.6× width.
