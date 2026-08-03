const { hairlineWidth } = require('nativewind/theme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Tailwind only generates classes it can SEE. A file outside these globs still
  // compiles and renders, but every `className` on it silently does nothing —
  // which looks like a layout bug, not a config bug.
  //
  // `./src/domains/**` was missing, and it cost real time to find: the onboarding
  // progress bar sets `className="h-1"`, that class was used nowhere else so it
  // was never generated, the bar therefore had no height, expanded to fill all
  // 956px of the screen, and pushed the title and CTA out of view. The screen
  // looked blank while being perfectly mounted and laid out.
  //
  // `src/domains/` is where CLAUDE.md tells you to put every feature, so this
  // would have broken each one in the same invisible way. Root `lib/` is
  // included for the same reason (StaggeredFadeIn and the icon registry use
  // className).
  //
  // Rule of thumb: if you add a directory that renders JSX, add it here.
  content: [
    './lib/**/*.{ts,tsx}',
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/domains/**/*.{ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      fontSize: {
        // Design system typography scale.
        // Body text minimum 16px for readability.
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['14px', { lineHeight: '21px' }], // Caption, label (1.5x line height)
        base: ['16px', { lineHeight: '24px' }], // Body default (MINIMUM)
        lg: ['18px', { lineHeight: '27px' }], // Body large
        xl: ['20px', { lineHeight: '30px' }], // H3
        '2xl': ['24px', { lineHeight: '36px' }], // H2
        '3xl': ['28px', { lineHeight: '42px' }], // H1
        '4xl': ['32px', { lineHeight: '48px' }], // Display
        // Semantic aliases for design tokens
        body: ['16px', { lineHeight: '24px' }],
        'body-lg': ['18px', { lineHeight: '27px' }],
        'body-sm': ['14px', { lineHeight: '21px' }],
        caption: ['14px', { lineHeight: '21px' }],
        label: ['14px', { lineHeight: '21px', fontWeight: '500' }],
        button: ['16px', { lineHeight: '24px', fontWeight: '500' }],
        display: ['32px', { lineHeight: '48px', fontWeight: '600' }],
      },
      spacing: {
        // Design system 8pt grid — use these instead of arbitrary values.
        0.5: '2px',
        1: '4px', // xs
        2: '8px', // sm
        3: '12px', // card gap
        4: '16px', // md - screen padding
        5: '20px',
        // Daylight's card interior / screen gutter. Off the 8pt grid on
        // purpose — the direction specifies 22px and rounding it to 20 or 24
        // loses the roominess that distinguishes it from Ledger.
        5.5: '22px',
        6: '24px', // lg - section gap
        7: '28px',
        8: '32px', // xl
        12: '48px', // xxl
        16: '64px', // xxxl
        // Component-specific
        touch: '44px', // iOS minimum touch target
      },
      colors: {
        // Base tokens (from CSS variables)
        border: {
          DEFAULT: 'hsl(var(--border))',
          strong: 'hsl(var(--border-strong))',
        },
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        scrim: 'hsl(var(--scrim))',

        // Primary brand color (use for CTAs only)
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          light: 'hsl(var(--primary-light))',
          dark: 'hsl(var(--primary-dark))',
          foreground: 'hsl(var(--primary-foreground))',
        },

        // Secondary
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },

        // Destructive/Error
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        error: 'hsl(var(--destructive))', // Same as destructive

        // Muted/Neutral backgrounds
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },

        // Accent — subtle hover ground
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },

        // Highlight — apricot brand accent
        highlight: {
          DEFAULT: 'hsl(var(--highlight))',
          foreground: 'hsl(var(--highlight-foreground))',
        },

        // Popover
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },

        // Card
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // Category accent colors
        category: {
          accent1: 'hsl(var(--category-accent1))',
          accent2: 'hsl(var(--category-accent2))',
          accent3: 'hsl(var(--category-accent3))',
        },

        // Semantic states
        state: {
          success: 'hsl(var(--success-state))',
        },
        success: 'hsl(var(--success-state))',
        warning: 'hsl(var(--warning))',
        'warning-strong': 'hsl(var(--warning-strong))',
        warningForeground: 'hsl(var(--warning-foreground))',
        'short-notice': 'hsl(var(--short-notice))',
        'short-notice-strong': 'hsl(var(--short-notice-strong))',
        neutral: 'hsl(var(--neutral))',

        // Neutral palette (adaptive via CSS variables, inverted in dark mode)
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

        // Specialty tokens (adaptive via CSS variables)
        skeleton: {
          base: 'hsl(var(--skeleton-base))',
          highlight: 'hsl(var(--skeleton-highlight))',
        },
        'error-inline': {
          bg: 'hsl(var(--error-inline-bg))',
          border: 'hsl(var(--error-inline-border))',
          text: 'hsl(var(--error-inline-text))',
        },
      },
      borderWidth: {
        hairline: hairlineWidth(),
        1.5: '1.5px',
      },
      borderRadius: {
        // Daylight — soft domestic geometry
        sm: '8px',
        DEFAULT: '12px',
        md: '12px',
        lg: '16px',
        xl: '16px',
        '2xl': '20px',
        '3xl': '24px',
        card: '20px',
        button: '14px',
        chip: '999px',
        row: '16px',
        cell: '12px',
      },
      boxShadow: {
        // Still all 'none', deliberately: NativeWind's box-shadow parser is broken
        // (react-native-css-interop 0.2.6 — reads shadowRadius from spread, bails on
        // multi-layer, falls through into aspect-ratio). Daylight elevation lives in
        // lib/design-tokens/elevation.ts as RN inline styles.
        sm: 'none',
        DEFAULT: 'none',
        md: 'none',
        lg: 'none',
        card: 'none',
        none: 'none',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down':
          'accordion-down 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'accordion-up': 'accordion-up 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [],
};
