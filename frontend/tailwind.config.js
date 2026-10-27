/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Brand: indigo. Primary actions, active navigation, focus rings, AI accents.
        // (Green is reserved for success / healthy / enabled states: see `status` below.)
        brand: {
          50: '#EEF2FF', // Subtle brand background
          100: '#E0E7FF',
          200: '#C7D2FE',
          300: '#A5B4FC',
          400: '#818CF8', // Brand on dark surfaces
          500: '#6366F1',
          600: '#4F46E5', // Primary
          700: '#4338CA', // Primary hover
          800: '#3730A3',
          900: '#312E81',
          950: '#1E1B4B',
        },
        // Neutral (light mode): slate. 50 = app background, 300 = border, 500/600 = secondary text, 900 = primary text.
        warm: {
          50: '#F8FAFC',  // App background
          100: '#F1F5F9', // Subtle fills / hover
          200: '#E9EEF4', // Dividers
          300: '#E2E8F0', // Borders
          400: '#CBD5E1', // Strong borders
          500: '#64748B', // Secondary / muted text (4.8:1 on white)
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A', // Primary text
          950: '#020617',
        },
        // Neutral (dark mode): slate, no green cast.
        charcoal: {
          950: '#0B1120', // Background
          900: '#0F172A', // Surface
          850: '#151E32', // Elevated surface
          800: '#1E293B', // Hover surface
          750: '#273449', // Border
          700: '#334155', // Strong border
          600: '#475569',
          500: '#8190A5', // Muted text
          400: '#94A3B8', // Secondary text
          300: '#CBD5E1',
          200: '#E2E8F0',
          100: '#F1F5F9', // Primary text
        },
        // Semantic status colours (the only place green appears)
        status: {
          success: '#059669',
          'success-dark': '#34D399',
          warning: '#D97706',
          'warning-dark': '#F59E0B',
          danger: '#DC2626',
          'danger-dark': '#F87171',
          ai: '#4F46E5',
          'ai-dark': '#818CF8',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'Courier New', 'monospace'],
      },
      boxShadow: {
        'subtle': '0 1px 2px 0 rgba(0, 0, 0, 0.04)',
        'card': '0 1px 3px 0 rgba(0, 0, 0, 0.06), 0 1px 2px -1px rgba(0, 0, 0, 0.06)',
        'elevated': '0 4px 6px -1px rgba(0, 0, 0, 0.07), 0 2px 4px -2px rgba(0, 0, 0, 0.07)',
      },
    },
  },
  plugins: [],
}
