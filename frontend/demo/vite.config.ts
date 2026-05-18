import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/assets': 'http://127.0.0.1:5000',
      '/knowledge-stores': 'http://127.0.0.1:5000',
      '/responses': 'http://127.0.0.1:5000',
      '/highlight-reels': 'http://127.0.0.1:5000',
      '/games': 'http://127.0.0.1:5000',
    },
  },
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },
})
