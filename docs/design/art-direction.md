# Steadily Nanny — Art Direction

Visual reference: [`docs/screenshots/ux-reference/`](../screenshots/ux-reference/) (Daylight UI captures).

## Brand mark

- **Concept:** Rounded home + clock hand — domestic coordination without literal faces or text.
- **Palette:** Plum `#5B3E5D` (primary shape), apricot `#E8823C` (accent dot/hand), ground `#F5F1F2` (icon background).
- **Constraints:** Legible at 29×29pt; no typography; no photorealism; square safe zone for Android adaptive icon (key detail in center 66%).

## Illustration style

- Soft flat vector; 2–3 tone fills, no gradients.
- Corner radius ~20px equivalent on shapes; matches Daylight cards.
- Figures: abstract, inclusive silhouettes (no identifiable faces).
- Palette: plum, apricot, `#F0E9ED` muted, `#4C7A6A` sage accent, `#6A4C77` lavender accent.
- Background: transparent PNG for in-app; warm ground `#F5F1F2` only when baked into store icon.

## Size specs

| Use | Display | Asset |
|-----|---------|-------|
| Welcome hero | ~280×280 pt | 560×560 PNG |
| Empty state (default) | 240×240 pt | 480×480 PNG |
| Empty state (inline) | 160×160 pt | 320×320 PNG |
| App icon | — | 1024×1024 PNG, no alpha |
| Splash logo | 200 pt wide | 512×512 PNG, transparent |
| Favicon | — | 48×48 PNG |

## Asset inventory

| Filename | Use |
|----------|-----|
| `icon.png` | iOS + store |
| `adaptive-icon.png` | Android foreground |
| `splash.png` | Expo splash + AnimatedSplash |
| `favicon.png` | Web/dev |
| `illustrations/welcome-hero.png` | Welcome screen |
| `illustrations/onboarding-role.png` | Role fork |
| `illustrations/empty-schedule.png` | Schedule empty |
| `illustrations/empty-inbox.png` | Inbox caught up |
| `illustrations/empty-hours.png` | Hours / timesheet |
| `illustrations/empty-pay.png` | Pay arrangement |
| `illustrations/empty-time-off.png` | Time off |
| `illustrations/empty-household.png` | Household members |
| `illustrations/empty-today.png` | Today off-day |
| `illustrations/empty-no-carer.png` | Invite nanny first |
| `illustrations/empty-children.png` | Add children |
| `illustrations/empty-pending.png` | Pending schedule |

## Higgsfield prompt seeds

**Icon (recraft_v4_1, vector):**
> Minimal app icon for childcare scheduling. Soft flat vector. Rounded house shape with simple clock hand inside. Plum purple #5B3E5D main, apricot #E8823C accent, cream background #F5F1F2. No text, no faces. Centered, readable at small size.

**Splash:** Same mark, transparent background, logo only.

**Welcome hero (gpt_image_2, ref icon):**
> Soft flat vector illustration. Parent and nanny silhouettes beside a cozy home and weekly calendar. Plum #5B3E5D and apricot #E8823C on transparent background. Warm domestic, minimal, no text.

**Empty states (gpt_image_2, ref icon):** Same style; single clear metaphor per file (calendar, inbox tray, clock, coins, calendar block, home, sun, invite envelope, child blocks, hourglass).
