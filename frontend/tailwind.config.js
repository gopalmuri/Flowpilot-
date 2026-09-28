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
        // Operational Brand Palette (Forest green in light mode, emerald in dark mode)
        brand: {
          50: '#F0F9F5',
          100: '#E0F0E8', // Soft Brand in Light Mode
          200: '#C2E2D3',
          300: '#8ECBB1',
          400: '#49CC96', // Brand Hover in Dark Mode
          500: '#35B982', // Brand in Dark Mode
          600: '#176B4D', // Brand in Light Mode
          700: '#12553D', // Brand Hover in Light Mode
          800: '#0D3F2D',
          900: '#16372B', // Soft Brand in Dark Mode
          950: '#091A13',
        },
        // Warm Neutral Palette (Light mode foundation - high contrast)
        warm: {
          50: '#FAF9F6',  // Elevated Surface in Light Mode
          100: '#F5F3EE', // Light Mode Page Background
          200: '#EAE7DF', // Light Mode Secondary Surface / Hover
          300: '#D9DDD8', // Light Mode Border
          400: '#B5BCB6', // Borders Strong
          500: '#7B847E', // Light Mode Muted Text
          600: '#59645E', // Light Mode Secondary Text
          700: '#35403A', // Light Mode High-Contrast Subheaders
          800: '#222B26', // Near-Black
          900: '#18201C', // Light Mode Primary Text (High Contrast)
          950: '#0E1411',
        },
        // Deep Charcoal Palette (Dark mode foundation - NO NAVY / NO BLUE)
        charcoal: {
          950: '#101513', // Dark Mode Background
          900: '#171D1A', // Dark Mode Surface
          850: '#1D2521', // Dark Mode Elevated Surface
          800: '#242E29', // Dark Mode Hover Surface
          750: '#2A332E', // Dark Mode Border
          700: '#3B4740', // Dark Mode Strong Border
          600: '#55635B',
          500: '#7E8982', // Dark Mode Muted Text
          400: '#A5AEA8', // Dark Mode Secondary Text
          300: '#C8D0CB',
          200: '#E1E6E3',
          100: '#F1F4EF', // Dark Mode Primary Text (High Contrast)
        },
        // Semantic Operations Colors
        status: {
          success: '#16845A',
          'success-dark': '#35B982',
          warning: '#B7791F',
          'warning-dark': '#F59E0B',
          danger: '#C24141',
          'danger-dark': '#EF4444',
          ai: '#0D9488',
          'ai-dark': '#2DD4BF',
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
