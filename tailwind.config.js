/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        azulPrincipal: "#0056b3",
        verdeAhorro: "#16a34a",
        rojoGasto: "#dc2626",
      }
    },
  },
  plugins: [],
}
