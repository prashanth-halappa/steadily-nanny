# Fonts

The template's default font is **Sora** (OFL-licensed, free for commercial use).
It is NOT bundled here — download it and drop the `.ttf` files into this folder:

1. Get Sora from Google Fonts: https://fonts.google.com/specimen/Sora
   (or `https://github.com/google/fonts/tree/main/ofl/sora`)
2. Place these exact files in `assets/fonts/`:
   - `Sora-Regular.ttf`
   - `Sora-Light.ttf`
   - `Sora-ExtraLight.ttf`
   - `Sora-Medium.ttf`
   - `Sora-SemiBold.ttf`
   - `Sora-Bold.ttf`
   - `Sora-ExtraBold.ttf`

The files are referenced by the `expo-font` plugin in `app.config.ts`, and the
family names are mapped to Tailwind weights in `tailwind.config.js`.

## Swapping the font

GOTCHA: on iOS, a font weight is selected by the **font family name**
(e.g. `Sora-Bold`, `Sora-SemiBold`) — NOT by a numeric `fontWeight`. Setting
`fontWeight: '700'` on a custom font is a no-op (or renders a faux-bold). So to
swap fonts you must:

1. add your `.ttf` files here and to the `expo-font` plugin list in `app.config.ts`;
2. update the `fontFamily` entries in `tailwind.config.js` to your family names;
3. keep the design-token typography using family names, not numeric weights.
