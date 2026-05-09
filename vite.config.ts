import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import type { Plugin } from 'vite'

const tslibShim = fileURLToPath(new URL('./src/lib/tslib-shim.ts', import.meta.url))

/* ── Underwriting Logic (Shared with API) ────────────────────────── */

const SFR_MIN_PROFIT = 20000
const MF_MIN_PROFIT = 50000
const MF_PERCENT_PROFIT = 0.05

function calculateWholesaleDeal(input: any) {
  const { propertyType, arv, repairs, askingPrice } = input
  let minAssignmentFee = SFR_MIN_PROFIT
  if (propertyType?.startsWith('multifamily')) {
    minAssignmentFee = Math.max(MF_MIN_PROFIT, arv * MF_PERCENT_PROFIT)
  }
  const mao = (arv * 0.70) - repairs - minAssignmentFee
  const maoCeiling = (arv * 0.75) - repairs - minAssignmentFee
  const equity = arv - repairs - (askingPrice || mao)
  const marginPercent = askingPrice ? ((mao - askingPrice) / mao) * 100 : 0
  let score = 50
  if (askingPrice) {
    if (askingPrice <= mao) score += 30
    if (askingPrice <= mao * 0.9) score += 20
  }
  let verdict = 'maybe'
  if (score >= 80) verdict = 'strong-buy'
  else if (score >= 60) verdict = 'buy'
  else if (score < 40) verdict = 'pass'

  return {
    mao: Math.max(0, Math.floor(mao)),
    maoCeiling: Math.max(0, Math.floor(maoCeiling)),
    assignmentFee: minAssignmentFee,
    equity: Math.floor(equity),
    marginPercent: parseFloat(marginPercent.toFixed(2)),
    verdict,
    score
  }
}

async function fetchUnderwritingResearch(address: string, propertyType: string, apiKey: string) {
  const prompt = `You are an expert Real Estate Acquisitions Analyst. Your goal is to provide deep-dive research and comparables for a property address.

ADDRESS: ${address}
PROPERTY TYPE: ${propertyType}

RESEARCH SOURCE PRIORITY:
- SFR Comps: 1. Zillow Sold, 2. Redfin Sold, 3. Realtor.com Sold, 4. County Assessor/Recorder, 5. Google Maps.
- Rental Comps: 1. Zillow Rentals, 2. Rentometer, 3. Apartments.com, 4. Realtor.
- Multifamily Comps: 1. Crexi, 2. LoopNet, 3. Apartments.com, 4. County Records, 5. Local broker listings.

STRICT RULES:
1. SOLD COMPS ONLY for ARV. Sold comps override active listings.
2. PUBLIC RECORDS override estimates. NEVER use Zestimate or Redfin Estimate as the final ARV.
3. PROXIMITY: Prefer comps within 0.5 miles and 6 months. Expand to 1 mile and 12 months ONLY if needed.
4. MATCHING: Match property type, beds, baths, sqft, year built, and condition.
5. EVIDENCE: Provide a source_url for EVERY comp.
6. WEAK COMPS: Flag any comp further than 1 mile or older than 12 months as a "Weak Comp" in the market_context.

Return ONLY a valid JSON object matching the requested schema.`

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: 'application/json' }
      })
    }
  )

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Gemini API failed: ${err}`)
  }

  const result = await response.json() as any
  const content = result.candidates?.[0]?.content?.parts?.[0]?.text
  if (!content) throw new Error('Empty response from Gemini')
  return JSON.parse(content)
}

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

const underwriteApiPlugin = (env: Record<string, string>): Plugin => ({
  name: 'nexus-underwrite-api',
  configureServer(server) {
    server.middlewares.use('/api/internal/offers/underwrite', async (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Method not allowed' }))
        return
      }

      let rawBody = ''
      req.on('data', (chunk) => { rawBody += chunk })
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(rawBody || '{}')
          const { address, propertyType = 'sfh', askingPrice } = parsed
          const apiKey = env.GEMINI_API_KEY

          if (!apiKey) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'GEMINI_API_KEY not configured in .env.local' }))
            return
          }

          if (!address) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Address is required' }))
            return
          }

          const research = await fetchUnderwritingResearch(address, propertyType, apiKey)
          const financialAnalysis = calculateWholesaleDeal({
            propertyType,
            arv: research.valuation.arv_estimate,
            repairs: research.valuation.repair_estimate,
            askingPrice: askingPrice ? parseFloat(askingPrice) : null
          })

          const payload = {
            address,
            property_info: research.property_info,
            valuation: { ...research.valuation, ...financialAnalysis },
            comps: research.comps,
            market_context: research.market_context,
            underwritten_at: new Date().toISOString(),
            version: '1.0.0-dev'
          }

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(payload))
        } catch (error) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Underwriting failed' }))
        }
      })
    })
  }
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), translateApiPlugin(), underwriteApiPlugin(env)],
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
  }
})
