import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import type { Plugin } from 'vite'

const tslibShim = fileURLToPath(new URL('./src/lib/tslib-shim.ts', import.meta.url))

const translateApiPlugin = (): Plugin => ({
  name: 'nexus-translate-api',
  configureServer(server) {
    server.middlewares.use('/api/translate', async (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Method not allowed' }))
        return
      }

      let rawBody = ''
      req.on('data', (chunk) => {
        rawBody += chunk
      })

      req.on('end', async () => {
        try {
          const parsed = JSON.parse(rawBody || '{}') as {
            text?: unknown
            targetLanguage?: unknown
            sourceLanguage?: unknown
          }

          const text = typeof parsed.text === 'string' ? parsed.text.trim() : ''
          const targetLanguage = typeof parsed.targetLanguage === 'string' && parsed.targetLanguage.trim()
            ? parsed.targetLanguage.trim().toLowerCase()
            : 'en'
          const sourceLanguage = typeof parsed.sourceLanguage === 'string' && parsed.sourceLanguage.trim()
            ? parsed.sourceLanguage.trim().toLowerCase()
            : 'auto'

          if (!text) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Missing text payload' }))
            return
          }

          const upstream = await fetch(
            `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sourceLanguage)}&tl=${encodeURIComponent(targetLanguage)}&dt=t&q=${encodeURIComponent(text)}`,
          )

          if (!upstream.ok) {
            res.statusCode = 502
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: `Translation provider failed (${upstream.status})` }))
            return
          }

          const payload = await upstream.json() as unknown
          const top = Array.isArray(payload) ? payload : []
          const sentenceRows = Array.isArray(top[0]) ? top[0] as unknown[] : []
          const translatedText = sentenceRows
            .map((row) => (Array.isArray(row) && typeof row[0] === 'string' ? row[0] : ''))
            .join('')
            .trim()
          const detectedLanguage = typeof top[2] === 'string' ? top[2] : null

          if (!translatedText) {
            res.statusCode = 502
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Empty translation response' }))
            return
          }

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            translatedText,
            detectedLanguage,
            targetLanguage,
          }))
        } catch (error) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : 'Translation failed',
          }))
        }
      })
    })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), translateApiPlugin()],
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
