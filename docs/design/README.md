# Design docs — routing map

Dated 2026-08-17. Read the system docs (00–03) before any screen spec — they
are the rules a screen spec is only ever applying, never restating.

| # | Doc | What you get |
|---|---|---|
| 00 | [`00-FOUNDATIONS.md`](./00-FOUNDATIONS.md) | The mechanical contract: NativeWind/tailwind tokens, the CSS-variable theme, colour registers, typography, elevation/wash, component primitives (CVA, `cn`, typography factory), the Reanimated `className` gotcha, motion. |
| 01 | [`01-LAWS.md`](./01-LAWS.md) | The L1–L4 rung model and every system rule derived from it: sections vs annotations, rhythm, the screen-header cap, the dense-list card, L1-attaches-to-a-group, the ground-channel contrast floor, affordance grammar, the border-replacement channels. |
| 02 | [`02-VOICE.md`](./02-VOICE.md) | Copy voice and tone, the milestone tier system (silent / acknowledged / receipt / moment) and which event gets which tier. |
| 03 | [`03-ART-DIRECTION.md`](./03-ART-DIRECTION.md) | Illustration style, the closed palette, asset sizes and placements, Higgsfield prompt seeds. |

## Per-screen specs

Each of these applies 00–03 to one screen or flow. They keep what's
screen-specific (state tables, route maps, copy keys, persona forks) and link
out for anything systemic — if you find a token table, a rung definition, or
a voice rule restated in one of these, that's drift; move it up to 00–03 and
leave a link.

| Doc | Screen / flow |
|---|---|
| [`screens-today.md`](./screens-today.md) | Today tab, both personas |
| [`screens-schedule.md`](./screens-schedule.md) | Schedule tab, usual-week patterns, multi-nanny |
| [`screens-hours.md`](./screens-hours.md) | Hours tab (timesheets) |
| [`screens-settings.md`](./screens-settings.md) | Settings tab and its pushed screens |
| [`screens-pay-terms.md`](./screens-pay-terms.md) | Pay & terms entry, jurisdiction presets, changes, acknowledgment |
| [`screens-onboarding-terms-proposal.md`](./screens-onboarding-terms-proposal.md) | Onboarding, nanny-authored draft terms, parent-side proposal review |
| [`attention-and-notifications.md`](./attention-and-notifications.md) | The notification matrix, inbox/attention states, dispute threads, cover-ask lifecycle |

**Why these keep their current filenames instead of moving into a `screens/`
subdirectory:** each is referenced by path from dozens to ~30 in-code
comments across `apps/` (test files, service modules, component headers).
Moving them would break every one of those comments with no code-editing
agent available to fix them in this pass. If a future pass wants the
subdirectory, do it together with an `apps/`-scoped sweep of the comments
that cite these paths.

## Elsewhere, on purpose

- `docs/07-MOBILE-UI-SYSTEM.md`, `docs/DAYLIGHT-UX-AUDIT.md` and `docs/DAYLIGHT-VISUAL-QA.md` are gone — the first is absorbed into 00 above, the other two were closed-out historical audits (see git history if you need one).
- [`../AS-BUILT-PAY-TERMS.md`](../AS-BUILT-PAY-TERMS.md), [`../AS-BUILT-SCHEDULE.md`](../AS-BUILT-SCHEDULE.md), [`../AS-BUILT-PAYMENT.md`](../AS-BUILT-PAYMENT.md) describe **behaviour as built**, a different genre from the *intent* docs here — read those when you need to know what the code actually does today, not what it should do.
- [`../12-NEED-COVERAGE.md`](../12-NEED-COVERAGE.md) is the domain model for care hours and coverage, not a design doc — read it before touching `child_commitments`, `parent_cover`, or `uncovered_care` events.
