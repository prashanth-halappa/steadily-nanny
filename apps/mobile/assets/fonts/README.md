# Fonts

Daylight ships one embedded typeface: **Figtree Variable** (`Figtree.ttf`,
OFL-licensed — see `OFL.txt`). It is a single variable font file covering the
whole `wght` axis (300–900), registered natively via the `expo-font` config
plugin in `apps/mobile/app.config.js` (`UIAppFonts` on iOS).

**Use `fontFamily: 'Figtree'`** — never `'Figtree Light'` or `'Figtree-Light'`.

Weight is still selected via numeric `fontWeight` (or Tailwind `font-medium` /
`font-semibold` / etc.), same as before — the variable font's continuous
`wght` axis is what makes that keep working. See `GOLDEN-FIXES.md` #3.

## Why not `'Figtree Light'` or `'Figtree-Light'` — the naming trap

This font's name table has an unusual shape because its default named instance
(`wght=300`) is Light, not Regular:

| name ID | value | what it is |
|---|---|---|
| 1 (Family) | `Figtree Light` | legacy "compatible" family — scoped to the Light instance only |
| 6 (PostScript) | `Figtree-Light` | exact name of the Light instance only |
| 16 (Typographic Family) | `Figtree` | the true family, spanning all 7 weight instances (Light…Black) |

Passing `fontFamily: 'Figtree Light'` (nameID 1) or `'Figtree-Light'` (nameID
6) resolves to the single Light face directly — React Native/CoreText then has
no family of weights to interpolate across, so **every** numeric `fontWeight`
silently renders as Light. No error, no crash — it just looks like faux-thin
text everywhere. `'Figtree'` (nameID 16) is the family CoreText groups all
weight instances under, which is what lets `fontWeight` trait-matching work.

## Do not reintroduce static per-weight font files

Commit 9e5bd83 removed the previous typeface (Sora) specifically because
per-weight static files make numeric `fontWeight` a no-op or produce
faux-bold on iOS — see `GOLDEN-FIXES.md` #3. Figtree Variable avoids that bug
because it's one file with a continuous weight axis. If a redesign ever swaps
typefaces again, it must be another **variable** font, not a set of statics.
