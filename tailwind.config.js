/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        blue: {
          50: '#fff3eb',
          100: '#ffe6d5',
          200: '#ffd0b3',
          300: '#ffb380',
          400: '#ff964d',
          500: '#ff7d1a',
          600: '#ff6b00',
          700: '#e65c00',
          800: '#b34700',
          900: '#803300',
          950: '#4d1f00',
        },
        azulPrincipal: "#ff6b00",
        verdeAhorro: "#16a34a",
        rojoGasto: "#dc2626",
      },
      fontFamily: {
        sans: ['Outfit', 'Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
