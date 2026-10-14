/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.js'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: { brand: { light: '#A78BFA', DEFAULT: '#7C3AED', dark: '#5B21B6' } },
      animation: { 'slide-in': 'slideIn 0.5s ease-out', 'pulse-gold': 'pulseGold 2s infinite' },
      keyframes: {
        slideIn: { '0%': { opacity: '0', transform: 'translateX(20px)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
        pulseGold: { '0%, 100%': { boxShadow: '0 0 0 0 rgba(234, 179, 8, 0.7)' }, '50%': { boxShadow: '0 0 0 10px rgba(234, 179, 8, 0)' } },
      },
    },
  },
  plugins: [],
}
