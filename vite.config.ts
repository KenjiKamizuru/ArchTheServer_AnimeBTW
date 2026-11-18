import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    fs: {
      strict: true,
      deny: ['.env', '.env.*', '*.{crt,pem}', 'data/**', 'library/**', 'server/**'],
    },
    watch: {
      ignored: ['**/library/**', '**/data/**', '**/.incomplete/**'],
    },
  },
  build: {
    target: 'es2022',
    cssMinify: true,
  },
})
