/** @type {import('tailwindcss').Config} */

// Every colour resolves through a CSS variable defined in src/theme.css, so
// the same class names render correctly in both the dark and light themes.
const token = (name) => `rgb(var(${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // `ink` is ordered by contrast against the page, not by lightness:
        // 950 is always the page background, 100 always the strongest text.
        ink: {
          950: token('--ink-950'),
          900: token('--ink-900'),
          850: token('--ink-850'),
          800: token('--ink-800'),
          750: token('--ink-750'),
          700: token('--ink-700'),
          600: token('--ink-600'),
          500: token('--ink-500'),
          400: token('--ink-400'),
          300: token('--ink-300'),
          200: token('--ink-200'),
          100: token('--ink-100'),
        },
        accent: {
          DEFAULT: token('--accent'),
          dim: token('--accent-dim'),
          deep: token('--accent-deep'),
        },
        media: token('--media'),
        control: token('--control'),
        good: token('--good'),
        warn: token('--warn'),
        bad: token('--bad'),
      },
      boxShadow: {
        panel: 'var(--shadow-panel)',
        raised: 'var(--shadow-raised)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-md)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      spacing: {
        panel: 'var(--space-panel)',
        row: 'var(--row-height)',
      },
      maxWidth: {
        content: 'var(--content-max)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
      },
      fontFamily: {
        // No webfont: the app is meant to run fully offline, and a half-loaded
        // Inter (declared but never fetched) was the reason small text looked
        // muddy. The native UI stack is well hinted at these sizes.
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        // Every step is one notch larger than before. Micro-labels at ~11px
        // were the main readability complaint.
        '2xs': ['0.75rem', { lineHeight: '1.05rem', letterSpacing: '0.01em' }],
        xs: ['0.8125rem', { lineHeight: '1.15rem' }],
        sm: ['0.9375rem', { lineHeight: '1.45rem' }],
        base: ['1rem', { lineHeight: '1.6rem' }],
        lg: ['1.125rem', { lineHeight: '1.65rem' }],
        xl: ['1.3125rem', { lineHeight: '1.8rem' }],
        // Page titles only. Tight tracking keeps a two-word title from
        // reading like a banner.
        display: ['1.625rem', { lineHeight: '2.05rem', letterSpacing: '-0.015em' }],
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '100%': { transform: 'scale(1.8)', opacity: '0' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'flow-dash': {
          to: { strokeDashoffset: '-16' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.2s ease-out infinite',
        'slide-in': 'slide-in 140ms ease-out',
        'flow-dash': 'flow-dash 600ms linear infinite',
      },
    },
  },
  plugins: [],
}
