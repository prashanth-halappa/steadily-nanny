# Settings — screen spec (Daylight v2)

Reads with [`daylight-v2.md`](./daylight-v2.md).

Owner: `apps/mobile/src/app/(private)/(tabs)/settings.tsx` and the pushed
screens under `src/app/(private)/settings/`.

---

## 1. What is wrong today

Settings is a long `ScrollView` of `H4` section headings over stacks of
`SettingsNavRow` — a `rounded-row bg-card px-4` pressable with a plum label, an
optional muted value, and a chevron (`settings.tsx:40–73`). Structurally sound.
Three problems:

1. **Every row is plum.** `<Body className="flex-1 text-primary">` at `:63` and
   `:96` paints every label in brand colour, including "Privacy policy" and
   "Terms of service". When everything is a link, nothing is emphasised, and the
   one genuinely brand-level thing on the screen — the person's own identity —
   is the only block *not* in plum (`:180–189`, muted grey). The hierarchy is
   inverted.
2. **Rows are separated by `gap-2` (8px) but sections by `gap-3` (12px) and
   `mt-8` (32px)**, and the rows carry `elevation.row` individually. Eight
   separately-lifted 44pt cards in a stack read as eight decisions, not one
   group.
3. **The one UPPERCASE label in the app lives here.** `{lang.toUpperCase()}` at
   `:243` renders `EN` / `ES` — a direction violation, and also worse copy than
   the language's own name.

There is also a genuine density problem: a parent sees **fourteen** rows across
four sections with no visual differentiation between "change my name" and
"delete my account".

---

## 2. Layout

```
┌ ScreenWash kind="brand"                                absoluteFill
│
│  ┌ HERO BAND ─────────────────────── no card, on the wash
│  │  H1 "Settings"                            32/40/600
│  │  ┌ identity row ─────────────────────────────────
│  │  │ PersonAvatar 48    H4 "Sara Ahmed"       foreground
│  │  │                    Small "sara@…"        mutedStrong
│  │  │                    StatusPill neutral "Parent"
│  │  └────────────────────────────────────────────────
│  └──────────────────────────────────────────────────
│
│  gap 24 between groups, 0 between rows within a group
│
│  GROUP  "Your household"    MetadataLabel eyebrow, mutedForeground
│    └ grouped card: one bg-card, radius-card, one elevation.card,
│      rows inside at 52pt, separated by light — no dividers
│
│  GROUP  "Account"
│  GROUP  "Language"          segmented, not chips
│  GROUP  "Legal & help"
│
│  Sign out          outline, full width
│  Delete account    ghost, destructive text
│  App version       Small mutedForeground, centred
└
```

The identity `PersonAvatar` takes the signed-in household member's `colour` (same source as CarerProfileScreen) and still renders when none is set.

### 2.1 The grouped card — the one structural change

Replace *n* individually-elevated rows with **one `Card tone="default"` per
group, containing *n* rows.** The card lifts; the rows do not. Rows are
separated by 1px of the card's own ground showing through — which on white is
invisible, and that is the point: Daylight separates by light, and inside a
single card the light is already doing its job by grouping them.

```
Card tone="default"  p-0  overflow-hidden
  Row  min-height 52  px-4  flex-row items-center gap-3
    IconChip tone="schedule"|"hours"|"people"|"brand"  (24px variant)
    Body  label            foreground      ← NOT primary
    Small value            mutedForeground  right, numberOfLines={1}
    ChevronRight 20        mutedForeground
```

Changes to `SettingsNavRow` (`settings.tsx:40–73`):

- `text-primary` → default `foreground`. **Plum is reserved for the chevron-less
  actions that actually do something brand-level** — currently none in this
  list, so no row is plum. The chevron already signals "this navigates".
- Drop `elevation.row` from the row; the containing card owns elevation.
- `minHeight` 44 → 52. 44 is the *minimum* target; a 14-row list at the minimum
  reads as cramped, and the rows are the whole screen.
- Add the 24px `IconChip`. This is where register 4 earns the most on the least
  work: household rows lavender, pay/hours rows sage, people rows rose, account
  rows plum. Fourteen identical grey rows become four scannable families.

`SettingsExternalRow` gets the same treatment with `ExternalLink` in place of
the chevron.

### 2.2 Groups and their order

Order is already correct — the comment at `:192–193` records a deliberate fix
putting Account above Language. v2 makes one further move: **Household goes
first for anyone who has one.** It is the only group a person visits more than
once a month.

| Group | Rows | Chip |
|---|---|---|
| **Your household** | Household switcher, children, invite, household settings, pay, carer availability, carer time off, closures, join a household | `schedule` lavender, except pay → `hours` sage |
| **Account** | Name, time & timezone, inbox, notifications | `brand` plum |
| **Language** | segmented control (§2.3) | — |
| **Legal & help** | Privacy, terms, get help | `people` rose |

Nanny/helper household group: availability, my pay (nanny only), time off, join
a household. Same chips.

### 2.3 Language

Replace the bordered chip row (`:224–247`) with a **segmented control** — one
`chipPlum` track, the selected segment a filled `bg-primary` pill with
`text-primary-foreground` (9.16:1), the rest `foreground` on the track. Labels
are endonyms in sentence case: `English`, `Español`. Delete `.toUpperCase()`.

This removes the last bordered non-ghost element and the last uppercase label
from the app in one edit.

---

## 3. Destructive actions

The bottom of this screen is where an account is deleted, and the current
treatment is right in a way that is worth writing down so nobody "improves" it:

- **Sign out** is `variant="outline"` — recoverable, so it is quiet.
- **Delete account** is `variant="ghost"` with `text-destructive` — it does not
  get a filled red button in the list, because a filled red button beside Sign
  out is a mis-tap waiting to happen. The consequential treatment lives in the
  confirmation, where the irreversible step is.
- The confirmation is a `BottomSheetBase`, not an `AlertDialog`, because it
  hosts a required email `Input` and `AlertDialog` has no keyboard avoidance —
  the flow is literally uncompletable otherwise (`settings.tsx:370–374`). This
  is App Store Guideline 5.1.1(v) territory. **Never migrate it back.**

v2 adds one thing: the confirm sheet's title moves `H4` → `H3`, and the two
consequence bullets move from `Small mutedForeground` to `Body mutedStrong`.
Text explaining what is about to be permanently destroyed should not be the
smallest, faintest text in the sheet.

---

## 4. Personas

The role fork at `:250–337` is correct. Parents get the household-management
rows; nannies and helpers get availability, time off, and (nanny only) my pay.
The join-a-household row sits **outside** the fork deliberately — every role can
be invited by a second family, and without that row an invite code has nowhere
to be typed (`:325–330`). Keep the comment; it is load-bearing.

Persona-visible differences in v2: none beyond the row sets. Both roles get the
same identity hero, the same grouping, the same chips.

---

## 5. States

| State | Treatment |
|---|---|
| **Loading** | Identity block skeletons (avatar circle + two bars); groups render immediately — they are static route lists and do not need the network. Today the whole screen waits on nothing, which is right; do not regress it. |
| **Row value pending** | The value slot shows a 60×14 skeleton bar, not an empty space that then jumps. |
| **Inbox badge** | `inboxBadge` (`:142–143`) renders a count as a muted value string. Promote to a `chipPlum` pill with the count in `primary` — it is the only row on the screen whose value is actionable. |
| **Error** | Settings never blanks. A failed profile read shows the email from the auth store and omits the name row's value. |
| **Offline** | Banner. Language still switches (it is applied locally first and synced best-effort — `:128–136`); do not gate it. |

---

## 6. Copy tone

- Rows are nouns, not commands: "Children", "Pay", "Time off" — not "Manage
  children".
- The identity block names the person and states their role plainly: "Parent",
  "Nanny", "Helper". No "Account type", no "Membership tier".
- "Delete account" says what it deletes and what it keeps — the two existing
  consequence strings do this and are good.
- App version is a fact, not a brand moment. `Small mutedForeground`, no logo.

**Voice:** `docs/design/screens-today.md` section 7 governs all copy in this screen, including the milestone-tier tables.

---

## 7. Illustration

**None on the main Settings screen.** A settings list is a tool and an
illustration above it is padding between a person and the row they came for.

Illustrations belong on the *pushed* settings screens in their empty states,
where they already are and should stay: `empty-children`, `empty-pay`,
`empty-time-off`, `empty-household`, `empty-no-carer`. All get the `chipPlum`
circle ground and the `H3` title from the v2 `EmptyState` restyle.
