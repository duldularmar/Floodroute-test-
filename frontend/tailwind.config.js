/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        ops: {
          // light / clean theme
          bg: '#f8fafc', // page background (slate-50)
          panel: '#ffffff', // cards, sidebars, header
          edge: '#e2e8f0', // borders (slate-200)
          text: '#0f172a', // primary text (slate-900)
          muted: '#64748b', // secondary text (slate-500)
          accent: '#2563eb', // primary action (blue-600)
          ok: '#059669', // success (emerald-600)
          warn: '#d97706', // caution (amber-600)
          danger: '#dc2626', // danger (red-600)
        },
      },
      boxShadow: {
        card: '0 1px 3px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.04)',
        overlay: '0 8px 24px rgba(15, 23, 42, 0.16)',
        'accent-glow': '0 4px 14px rgba(37, 99, 235, 0.35)',
        'warn-glow': '0 4px 14px rgba(217, 119, 6, 0.30)',
        'ok-glow': '0 4px 14px rgba(5, 150, 105, 0.30)',
      },
      keyframes: {
        'fr-pulse-ring': {
          '0%': { transform: 'scale(0.6)', opacity: '0.8' },
          '100%': { transform: 'scale(1.8)', opacity: '0' },
        },
        'fr-shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'fr-rise': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fr-spin': {
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'pulse-ring': 'fr-pulse-ring 1.6s cubic-bezier(0.2, 0.6, 0.4, 1) infinite',
        shimmer: 'fr-shimmer 2.4s linear infinite',
        rise: 'fr-rise 0.35s ease-out both',
        'rise-1': 'fr-rise 0.35s ease-out 0.05s both',
        'rise-2': 'fr-rise 0.35s ease-out 0.1s both',
        spin: 'fr-spin 0.9s linear infinite',
      },
    },
  },
  plugins: [],
}
