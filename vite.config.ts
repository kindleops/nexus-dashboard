import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const tslibShim = fileURLToPath(new URL('./src/lib/tslib-shim.ts', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  resolve: {
    alias: {
      tslib: tslibShim,
    },
  },
})
