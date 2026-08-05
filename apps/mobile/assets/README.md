# App assets

Branded artwork for Steadily Nanny (Daylight palette). See [`docs/design/art-direction.md`](../../docs/design/art-direction.md).

| File | Purpose | Recommended size |
|------|---------|------------------|
| `icon.png` | App icon (iOS + fallback) | 1024×1024 |
| `adaptive-icon.png` | Android adaptive icon foreground | 1024×1024 (safe zone centered) |
| `splash.png` | Splash screen logo (shown centered at 200px wide) | 512×512+ transparent |
| `favicon.png` | Web/dev favicon | 48×48 |
| `illustrations/*.png` | Welcome, onboarding, empty states | 480×480 |

Paths are wired in `app.config.js` and `assets/illustrations/index.ts`. Keep filenames or update both.

**Transparency:** AI exports often use a fake gray/white checkerboard. Re-run:

```bash
python3 apps/mobile/assets/scripts/make_transparent.py apps/mobile/assets/illustrations
```

See `fonts/README.md` for the font setup.
