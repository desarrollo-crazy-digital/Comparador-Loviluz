import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html')
      }
    }
  },
  server: {
    proxy: {
      // En dev, evita que Vite sirva `/api/*.js` como archivo estático y reenvía al servidor local.
      '/api': {
        target: 'http://127.0.0.1:3004',
        changeOrigin: true,
      },
    },
  },
})
