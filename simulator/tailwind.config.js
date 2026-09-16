/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Slate-based engineering-tool palette. `panel` shades are the
        // chrome; `accent` is the single interactive hue.
        ink: {
          950: '#080b12',
          900: '#0b1018',
          850: '#0f1520',
          800: '#141c29',
          750: '#1a2433',
          700: '#222e40',
          600: '#324054',
          500: '#4a5a72',
          400: '#6b7d96',
          300: '#94a3b8',
          200: '#c3cddb',
          100: '#e6ecf4',
        },
        accent: {
          DEFAULT: '#38bdf8',
          dim: '#0ea5e9',
          deep: '#0369a1',
        },
        media: '#22d3ee',
        control: '#a78bfa',
        good: '#34d399',
        warn: '#fbbf24',
        bad: '#f87171',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
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
