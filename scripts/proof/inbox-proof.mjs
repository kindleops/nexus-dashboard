import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const BASE_URL = process.env.NEXUS_URL || 'http://localhost:5173'
const route = process.env.NEXUS_ROUTE || '/inbox'

const outDir = path.resolve('proof/inbox')
fs.mkdirSync(outDir, { recursive: true })

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const screenshotPath = path.join(outDir, `inbox-${stamp}.png`)

const browser = await chromium.launch({ headless: true })

const page = await browser.newPage({
  viewport: { width: 1728, height: 1117 },
  deviceScaleFactor: 1,
})

page.on('console', msg => {
  const text = msg.text()

  if (
    text.includes('[NexusInbox') ||
    text.includes('[NexusInboxCounts') ||
    text.includes('[NexusInboxNameResolution') ||
    text.includes('[InboxCoords') ||
    text.includes('[InboxEnrichment') ||
    text.includes('[InboxMap]') ||
    text.includes('[InboxMapSource]') ||
    text.includes('[InboxPage]') ||
    text.includes('[NexusInboxAddressResolution')
  ) {
    console.log(`[browser-console] ${text}`)
  }
})

await page.goto(`${BASE_URL}${route}`, {
  waitUntil: 'networkidle',
  timeout: 60_000,
})

await page.waitForTimeout(2000)

await page.screenshot({
  path: screenshotPath,
  fullPage: true,
})

console.log(`✅ Inbox screenshot saved: ${screenshotPath}`)

const mapOutDir = path.resolve('proof/inbox')
const mapStamp = new Date().toISOString().replace(/[:.]/g, '-')
const mapScreenshotPath = path.join(mapOutDir, `inbox-map-${mapStamp}.png`)

await page.keyboard.down('Meta')
await page.keyboard.press('m')
await page.keyboard.up('Meta')

await page.waitForTimeout(3000)

await page.screenshot({
  path: mapScreenshotPath,
  fullPage: true,
})

console.log(`✅ Inbox map screenshot saved: ${mapScreenshotPath}`)

await browser.close()
