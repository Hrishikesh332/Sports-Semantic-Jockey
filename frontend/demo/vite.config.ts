import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendUrl = (env.VITE_API_BASE_URL || 'http://127.0.0.1:5000').replace(/\/$/, '')

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/assets': { target: backendUrl, changeOrigin: true, timeout: 300_000 },
        '/knowledge-stores': { target: backendUrl, changeOrigin: true, timeout: 300_000 },
        '/responses': { target: backendUrl, changeOrigin: true, timeout: 300_000 },
        '/highlight-reels': { target: backendUrl, changeOrigin: true, timeout: 300_000 },
        '/games': { target: backendUrl, changeOrigin: true, timeout: 300_000 },
        '/health': { target: backendUrl, changeOrigin: true, timeout: 300_000 },
      },
    },
    css: {
      postcss: {
        plugins: [tailwindcss(), autoprefixer()],
      },
    },
  }
})
