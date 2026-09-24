/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ops: {
          bg: '#0b1220',
          panel: '#111a2b',
          edge: '#1e2a41',
          text: '#e6edf7',
          muted: '#8fa1bb',
          accent: '#38bdf8',
          ok: '#34d399',
          warn: '#fbbf24',
          danger: '#f87171',
        },
      },
    },
  },
  plugins: [],
}
