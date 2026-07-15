import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// The README's setup flow puts a single .env at the repo root. Vite only
// reads .env files from envDir, so fall back to the repo root unless a
// frontend-local .env exists (which then takes precedence as usual).
const envDir = fs.existsSync(path.resolve(__dirname, '.env'))
  ? __dirname
  : path.resolve(__dirname, '..')

export default defineConfig({
  plugins: [react()],
  envDir,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
