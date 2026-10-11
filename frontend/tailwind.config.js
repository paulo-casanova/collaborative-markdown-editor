/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        cme: {
          bg: {
            base: 'var(--cme-bg-base)',
            subtle: 'var(--cme-bg-subtle)',
            surface: 'var(--cme-bg-surface)',
            hover: 'var(--cme-bg-hover)',
            active: 'var(--cme-bg-active)',
          },
          text: {
            base: 'var(--cme-text-base)',
            muted: 'var(--cme-text-muted)',
            subtle: 'var(--cme-text-subtle)',
            inverse: 'var(--cme-text-inverse)',
          },
          border: {
            base: 'var(--cme-border-base)',
            subtle: 'var(--cme-border-subtle)',
            strong: 'var(--cme-border-strong)',
          },
          primary: {
            DEFAULT: 'var(--cme-primary)',
            hover: 'var(--cme-primary-hover)',
            subtle: 'var(--cme-primary-subtle)',
          },
          accent: {
            DEFAULT: 'var(--cme-accent)',
            subtle: 'var(--cme-accent-subtle)',
          },
          status: {
            green: '#22c55e',
            yellow: '#eab308',
            red: '#ef4444',
            blue: '#3b82f6',
          }
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      }
    },
  },
  plugins: [],
}
