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
        '/assets': backendUrl,
        '/knowledge-stores': backendUrl,
        '/responses': backendUrl,
        '/highlight-reels': backendUrl,
        '/games': backendUrl,
        '/health': backendUrl,
      },
    },
    css: {
      postcss: {
        plugins: [tailwindcss(), autoprefixer()],
      },
    },
  }
})
