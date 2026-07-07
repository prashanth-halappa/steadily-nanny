// NativeWind 4 + Tailwind config skeleton.
//
// Design-token strategy: colors are NOT hardcoded here. Every semantic color
// reads an HSL CSS variable defined in `global.css` (`:root` for light,
// `.dark:root` for dark). Tailwind tokens are the stable *names*; global.css
// owns the *values* and the light/dark switch. This indirection lets the whole
// app re-theme by toggling a single `dark` class on a root <View>.
//
// Swap the generic palette below for your brand. Keep the structure:
// fonts (custom family), an 8pt spacing grid + `touch` target, colors via
// `hsl(var(--token))`, pill/card border radii, and a small shadow scale.
const { hairlineWidth } = require('nativewind/theme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/domains/**/*.{ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      // Custom font family loaded via expo-font (see app.json + root _layout).
      // Map each weight to its loaded font name. Replace "AppFont" with yours.
      fontFamily: {
        sans: ['AppFont-Regular'],
        'app-light': ['AppFont-Light'],
        'app-medium': ['AppFont-Medium'],
        'app-semibold': ['AppFont-SemiBold'],
        'app-bold': ['AppFont-Bold'],
      },
      fontSize: {
        // Body minimum 16px for readability; line-heights ~1.5x.
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['14px', { lineHeight: '21px' }],
        base: ['16px', { lineHeight: '24px' }], // body default (MINIMUM)
        lg: ['18px', { lineHeight: '27px' }],
        xl: ['20px', { lineHeight: '30px' }], // H3
        '2xl': ['24px', { lineHeight: '36px' }], // H2
        '3xl': ['28px', { lineHeight: '42px' }], // H1
        '4xl': ['32px', { lineHeight: '48px' }], // Display
        // Semantic aliases
        body: ['16px', { lineHeight: '24px' }],
        caption: ['14px', { lineHeight: '21px' }],
        button: ['16px', { lineHeight: '24px', fontWeight: '500' }],
        display: ['32px', { lineHeight: '48px', fontWeight: '600' }],
      },
      spacing: {
        // 8pt grid — prefer these over arbitrary values.
        0.5: '2px',
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px', // screen padding
        5: '20px',
        6: '24px', // section gap
        7: '28px',
        8: '32px',
        12: '48px',
        16: '64px',
        touch: '44px', // platform minimum touch target
      },
      colors: {
        // Base tokens (values live in global.css CSS variables)
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',

        primary: {
          DEFAULT: 'hsl(var(--primary))',
          light: 'hsl(var(--primary-light))',
          dark: 'hsl(var(--primary-dark))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        success: 'hsl(var(--success-state))',
        warning: 'hsl(var(--warning))',

        // Adaptive neutral scale (inverted in dark mode via global.css).
        gray: {
          50: 'hsl(var(--gray-50))',
          100: 'hsl(var(--gray-100))',
          200: 'hsl(var(--gray-200))',
          300: 'hsl(var(--gray-300))',
          400: 'hsl(var(--gray-400))',
          500: 'hsl(var(--gray-500))',
          600: 'hsl(var(--gray-600))',
          700: 'hsl(var(--gray-700))',
          800: 'hsl(var(--gray-800))',
          900: 'hsl(var(--gray-900))',
        },

        // Skeleton shimmer (adaptive)
        skeleton: {
          base: 'hsl(var(--skeleton-base))',
          highlight: 'hsl(var(--skeleton-highlight))',
        },
      },
      borderWidth: {
        hairline: hairlineWidth(),
      },
      borderRadius: {
        sm: '16px',
        DEFAULT: '24px',
        md: '24px',
        lg: '24px',
        xl: '24px',
        '2xl': '24px',
        '3xl': '32px',
        // Semantic aliases
        card: '24px',
        button: '9999px', // pill
        chip: '9999px',
      },
      boxShadow: {
        // Use sparingly — prefer borders for subtle separation.
        sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        DEFAULT:
          '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
        md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        card: '0 2px 8px 0 rgba(0, 0, 0, 0.08)',
        none: 'none',
      },
    },
  },
  plugins: [],
};
