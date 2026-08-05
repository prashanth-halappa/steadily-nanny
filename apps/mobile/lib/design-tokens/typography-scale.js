/**
 * Tailwind fontSize scale — plain JS so tailwind.config.js can require it.
 * Values mirror lib/design-tokens/typography.ts; parity-tested in
 * __tests__/typography-parity.test.ts.
 */

/** PostScript / family name for the embedded Figtree Variable font. */
const FONT_FAMILY = 'Figtree';

module.exports = {
  FONT_FAMILY,
  typographyFontSize: {
    xs: ['12px', { lineHeight: '16px' }],
    sm: ['14px', { lineHeight: '21px' }],
    base: ['16px', { lineHeight: '24px' }],
    lg: ['18px', { lineHeight: '28px' }],
    xl: ['20px', { lineHeight: '28px' }],
    '2xl': ['24px', { lineHeight: '32px' }],
    '3xl': ['32px', { lineHeight: '40px' }],
    '4xl': ['32px', { lineHeight: '40px' }],
    // Semantic aliases — match typography.ts token sizes
    body: ['16px', { lineHeight: '24px' }],
    'body-lg': ['18px', { lineHeight: '28px' }],
    'body-sm': ['14px', { lineHeight: '21px' }],
    caption: ['14px', { lineHeight: '21px' }],
    label: ['14px', { lineHeight: '21px', fontWeight: '500' }],
    button: ['16px', { lineHeight: '24px', fontWeight: '600' }],
    display: ['32px', { lineHeight: '40px', fontWeight: '800' }],
  },
};
