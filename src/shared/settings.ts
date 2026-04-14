/**
 * NEXUS Settings Store
 *
 * Reactive settings with localStorage persistence.
 * Provides map, sound, and UI customization for the entire app.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type MapTheme = 'dark-matter' | 'dark-matter-nolabels' | 'voyager-nolabels' | 'positron-nolabels'
export type HeatPalette = 'default' | 'infrared' | 'ocean' | 'arctic'
export type PulsePalette = 'default' | 'neon' | 'muted' | 'monochrome'
export type SoundProfile = 'tactical' | 'ambient' | 'minimal' | 'silent'
export type DensityMode = 'comfortable' | 'compact' | 'spacious'
export type DefaultMapMode = 'leads' | 'distress' | 'heat' | 'stage' | 'pressure' | 'closings'

export interface NexusSettings {
  // Map
  mapTheme: MapTheme
  heatPalette: HeatPalette
  heatIntensity: number         // 0.2–2.0
  pulsePalette: PulsePalette
  pulseDensity: number          // 0.1–1.0
  showLabels: boolean
  showPOIs: boolean
  showRoads: boolean
  defaultMapMode: DefaultMapMode
  defaultZoom: number           // 3–12

  // Signal layers
  layerLeadTemp: boolean
  layerMarketPressure: boolean
  layerBuyerDemand: boolean
  layerAlerts: boolean
  layerTitle: boolean
  layerContracts: boolean

  // Sound
  soundEnabled: boolean
  soundVolume: number           // 0–1
  soundProfile: SoundProfile
  soundInboundReply: boolean
  soundHotLeadEscalation: boolean
  soundAlertTriggered: boolean
  soundTitleClear: boolean
  soundClosingScheduled: boolean
  soundBuyerMatch: boolean
  soundAiResponse: boolean
  soundAutopilotAction: boolean
  soundNotification: boolean
  soundQueueIssue: boolean
  soundContractMilestone: boolean

  // UI
  densityMode: DensityMode
  showBlades: boolean
  timelineDensity: number       // 5–50 events
  eventCategories: string[]

  // Surface
  animationsEnabled: boolean
}

// ── Defaults ──────────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: NexusSettings = {
  mapTheme: 'dark-matter',
  heatPalette: 'default',
  heatIntensity: 1.0,
  pulsePalette: 'default',
  pulseDensity: 0.7,
  showLabels: true,
  showPOIs: false,
  showRoads: true,
  defaultMapMode: 'leads',
  defaultZoom: 4,
  layerLeadTemp: true,
  layerMarketPressure: true,
  layerBuyerDemand: true,
  layerAlerts: true,
  layerTitle: true,
  layerContracts: true,
  soundEnabled: false,
  soundVolume: 0.5,
  soundProfile: 'tactical',
  soundInboundReply: true,
  soundHotLeadEscalation: true,
  soundAlertTriggered: true,
  soundTitleClear: true,
  soundClosingScheduled: true,
  soundBuyerMatch: true,
  soundAiResponse: true,
  soundAutopilotAction: true,
  soundNotification: true,
  soundQueueIssue: true,
  soundContractMilestone: true,
  densityMode: 'comfortable',
  showBlades: true,
  timelineDensity: 30,
  eventCategories: ['system', 'alert', 'ai', 'deal', 'conversation', 'autopilot'],
  animationsEnabled: true,
}

// ── Storage ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'nexus-settings'

let _cache: NexusSettings | null = null
const _listeners = new Set<() => void>()

export function loadSettings(): NexusSettings {
  if (_cache) return _cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<NexusSettings>
      _cache = { ...DEFAULT_SETTINGS, ...parsed }
    } else {
      _cache = { ...DEFAULT_SETTINGS }
    }
  } catch {
    _cache = { ...DEFAULT_SETTINGS }
  }
  return _cache
}

export function saveSettings(settings: NexusSettings): void {
  _cache = settings
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // localStorage full — silently degrade
  }
  for (const fn of _listeners) fn()
}

export function updateSetting<K extends keyof NexusSettings>(
  key: K,
  value: NexusSettings[K],
): void {
  const current = loadSettings()
  saveSettings({ ...current, [key]: value })
}

export function subscribeSettings(fn: () => void): () => void {
  _listeners.add(fn)
  return () => { _listeners.delete(fn) }
}

export function resetSettings(): void {
  saveSettings({ ...DEFAULT_SETTINGS })
}

// ── Map style URL resolver ────────────────────────────────────────────────

const MAP_THEME_URLS: Record<MapTheme, string> = {
  'dark-matter': 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  'dark-matter-nolabels': 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json',
  'voyager-nolabels': 'https://basemaps.cartocdn.com/gl/voyager-nolabels-gl-style/style.json',
  'positron-nolabels': 'https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json',
}

export function resolveMapStyleUrl(theme: MapTheme): string {
  const envOverride = import.meta.env.VITE_MAP_STYLE_URL as string | undefined
  if (envOverride) return envOverride
  return MAP_THEME_URLS[theme]
}
