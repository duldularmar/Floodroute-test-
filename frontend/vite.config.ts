import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// dev proxy forwards /api/* to the FastAPI backend so the frontend can use
// a same-origin base URL by default (override with VITE_API_BASE_URL).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
