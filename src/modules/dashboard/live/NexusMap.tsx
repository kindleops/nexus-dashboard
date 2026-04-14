/**
 * NexusMap.tsx
 *
 * Real MapLibre GL geographic property map for the NEXUS command center.
 * Atmospheric intelligence layer with live event pulses, pressure fields,
 * and premium basemap with cities, roads, and neighborhood detail.
 *
 * Tile provider: CartoCDN dark-matter (free, no API key required)
 * Override with VITE_MAP_STYLE_URL env var for a custom tile provider.
 *
 * Attribution required: © CARTO  © OpenStreetMap contributors
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection, Point } from 'geojson'
import type { ExpressionSpecification } from 'maplibre-gl'
import type { LiveActivity, LiveLead, LiveMarket } from './live-dashboard.adapter'
import { loadSettings, resolveMapStyleUrl } from '../../../shared/settings'
import { playSound } from '../../../shared/sounds'

// ─── Types ────────────────────────────────────────────────────────────────

type MapMode = 'leads' | 'distress' | 'heat' | 'stage' | 'pressure' | 'closings'
type DrawerType = 'market' | 'lead' | 'agent' | null

type PinTier = 'hot' | 'warm' | 'neutral' | 'cold'

// GeoJSON feature property shapes ─────────────────────────────────────────

interface LeadFeatureProps {
  id: string
  ownerName: string
  address: string
  marketId: string
  marketLabel: string
  urgencyScore: number
  pinTier: PinTier
  selected: 0 | 1
}

interface MarketFeatureProps {
  id: string
  name: string
  label: string
  heat: string
  campaignStatus: string
  selected: 0 | 1
}

// ─── Coordinate guard ─────────────────────────────────────────────────────

const isValidCoord = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat !== 0 && lng !== 0 &&
  lat >= -90 && lat <= 90 &&
  lng >= -180 && lng <= 180

// ─── Pin tier computation ─────────────────────────────────────────────────

function computePinTier(lead: LiveLead, mode: MapMode): PinTier {
  switch (mode) {
    case 'leads':
      return lead.sentiment as PinTier
    case 'distress': {
      const tiers: Partial<Record<LiveLead['ownerType'], PinTier>> = {
        'tax-delinquent': 'hot',
        estate: 'warm',
        absentee: 'warm',
        corporate: 'neutral',
        'owner-occupied': 'cold',
      }
      return tiers[lead.ownerType] ?? 'neutral'
    }
    case 'heat':
      return lead.urgencyScore >= 80 ? 'hot'
        : lead.urgencyScore >= 60 ? 'warm'
        : lead.urgencyScore >= 40 ? 'neutral'
        : 'cold'
    case 'stage': {
      const tiers: Partial<Record<LiveLead['pipelineStage'], PinTier>> = {
        'under-contract': 'hot',
        negotiating: 'hot',
        responding: 'warm',
        contacted: 'neutral',
        new: 'cold',
      }
      return tiers[lead.pipelineStage] ?? 'neutral'
    }
    case 'pressure':
      return lead.outboundAttempts >= 7 ? 'hot'
        : lead.outboundAttempts >= 5 ? 'warm'
        : lead.outboundAttempts >= 3 ? 'neutral'
        : 'cold'
    case 'closings':
      return lead.pipelineStage === 'under-contract' ||
        lead.pipelineStage === 'negotiating'
        ? 'hot' : 'cold'
  }
}

// ─── GeoJSON builders ─────────────────────────────────────────────────────

function buildLeadsGeoJSON(
  leads: LiveLead[],
  mode: MapMode,
  selectedLeadId: string | undefined,
): FeatureCollection<Point, LeadFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: leads
      .filter((l) => isValidCoord(l.lat, l.lng))
      .map((lead) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [lead.lng, lead.lat],
        },
        properties: {
          id: lead.id,
          ownerName: lead.ownerName,
          address: lead.address,
          marketId: lead.marketId,
          marketLabel: lead.marketLabel,
          urgencyScore: lead.urgencyScore,
          pinTier: computePinTier(lead, mode),
          selected: lead.id === selectedLeadId ? 1 : 0,
        } satisfies LeadFeatureProps,
      })),
  }
}

function buildMarketsGeoJSON(
  markets: LiveMarket[],
  selectedMarketId: string | undefined,
): FeatureCollection<Point, MarketFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: markets
      .filter((m) => isValidCoord(m.lat, m.lng))
      .map((market) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [market.lng, market.lat],
        },
        properties: {
          id: market.id,
          name: market.name,
          label: market.label,
          heat: market.heat,
          campaignStatus: market.campaignStatus,
          selected: market.id === selectedMarketId ? 1 : 0,
        } satisfies MarketFeatureProps,
      })),
  }
}

// ─── Map style ────────────────────────────────────────────────────────────
// CartoCDN dark-matter (WITH labels) — free, no API key, rich detail at
// all zoom levels including cities, streets, neighborhoods, POIs.
// Override via VITE_MAP_STYLE_URL for a custom tile provider.

function getMapStyleUrl(): string {
  const settings = loadSettings()
  return resolveMapStyleUrl(settings.mapTheme)
}

// ─── Heat palette presets ─────────────────────────────────────────────────

type HeatColorStops = Array<[number, string]>

const HEAT_PALETTES: Record<string, HeatColorStops> = {
  default: [
    [0,    'rgba(0,0,0,0)'],
    [0.03, 'rgba(8,14,36,0.12)'],
    [0.08, 'rgba(12,28,68,0.22)'],
    [0.15, 'rgba(16,52,110,0.35)'],
    [0.25, 'rgba(24,90,160,0.45)'],
    [0.38, 'rgba(56,208,240,0.52)'],
    [0.50, 'rgba(80,220,210,0.58)'],
    [0.62, 'rgba(180,190,80,0.62)'],
    [0.74, 'rgba(216,149,48,0.72)'],
    [0.86, 'rgba(212,64,76,0.82)'],
    [1.0,  'rgba(220,40,60,0.92)'],
  ],
  infrared: [
    [0,    'rgba(0,0,0,0)'],
    [0.05, 'rgba(20,8,40,0.15)'],
    [0.15, 'rgba(60,10,80,0.30)'],
    [0.30, 'rgba(120,20,100,0.45)'],
    [0.45, 'rgba(180,40,60,0.55)'],
    [0.60, 'rgba(220,80,30,0.65)'],
    [0.75, 'rgba(240,140,20,0.75)'],
    [0.90, 'rgba(255,200,60,0.85)'],
    [1.0,  'rgba(255,240,140,0.95)'],
  ],
  ocean: [
    [0,    'rgba(0,0,0,0)'],
    [0.05, 'rgba(4,12,30,0.12)'],
    [0.12, 'rgba(8,24,60,0.22)'],
    [0.22, 'rgba(12,48,100,0.35)'],
    [0.35, 'rgba(20,80,140,0.45)'],
    [0.50, 'rgba(32,120,180,0.55)'],
    [0.65, 'rgba(56,180,220,0.62)'],
    [0.80, 'rgba(100,220,240,0.72)'],
    [0.92, 'rgba(160,240,250,0.82)'],
    [1.0,  'rgba(220,255,255,0.90)'],
  ],
  arctic: [
    [0,    'rgba(0,0,0,0)'],
    [0.05, 'rgba(6,10,20,0.10)'],
    [0.15, 'rgba(16,30,60,0.22)'],
    [0.30, 'rgba(30,60,120,0.35)'],
    [0.45, 'rgba(60,120,200,0.48)'],
    [0.60, 'rgba(120,180,240,0.58)'],
    [0.75, 'rgba(180,220,255,0.68)'],
    [0.90, 'rgba(220,240,255,0.80)'],
    [1.0,  'rgba(240,250,255,0.90)'],
  ],
}

function buildHeatColorExpr(): ExpressionSpecification {
  const settings = loadSettings()
  const palette = HEAT_PALETTES[settings.heatPalette] ?? HEAT_PALETTES.default
  const flat: Array<number | string> = []
  for (const [stop, color] of palette) {
    flat.push(stop, color)
  }
  return ['interpolate', ['linear'], ['heatmap-density'], ...flat] as ExpressionSpecification
}

// ─── Event pulse system ───────────────────────────────────────────────────
// Queued from timeline events, rendered as expanding color-coded rings

interface EventPulse {
  lng: number
  lat: number
  color: string
  startTime: number
  duration: number
}

const EVENT_COLOR: Record<string, string> = {
  conversation: '#38d0f0',  // cyan
  alert:        '#d4404c',  // red
  deal:         '#2cb87a',  // green
  ai:           '#9966ff',  // purple
  autopilot:    '#9966ff',  // purple
  system:       '#d89530',  // amber
}

const PULSE_DURATION = 3200  // ms — slower, more cinematic ring expansion

// ─── Paint expressions ────────────────────────────────────────────────────

const PIN_COLOR_EXPR: ExpressionSpecification = [
  'match', ['get', 'pinTier'],
  'hot',     '#d4404c',
  'warm',    '#d89530',
  'neutral', '#38d0f0',
  /* default (cold) */ '#4e6e88',
]

// ─── Component ────────────────────────────────────────────────────────────

export interface NexusMapProps {
  leads: LiveLead[]
  markets: LiveMarket[]
  timeline: LiveActivity[]
  selectedLeadId: string | undefined
  selectedMarketId: string | undefined
  mapMode: MapMode
  activeDrawer: DrawerType
  onOpenLead: (id: string) => void
  onSelectMarket: (id: string) => void
}

export const NexusMap = ({
  leads,
  markets,
  timeline,
  selectedLeadId,
  selectedMarketId,
  mapMode,
  activeDrawer,
  onOpenLead,
  onSelectMarket,
}: NexusMapProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const mapReadyRef = useRef(false)
  const eventPulsesRef = useRef<EventPulse[]>([])
  const lastTimelineCountRef = useRef(0)

  // Stable refs for callbacks — avoid stale closures in map event listeners
  const onOpenLeadRef = useRef(onOpenLead)
  const onSelectMarketRef = useRef(onSelectMarket)
  onOpenLeadRef.current = onOpenLead
  onSelectMarketRef.current = onSelectMarket

  // Latest prop values for use inside the async `load` handler
  const leadsRef = useRef(leads)
  const marketsRef = useRef(markets)
  const mapModeRef = useRef(mapMode)
  const selectedLeadIdRef = useRef(selectedLeadId)
  const selectedMarketIdRef = useRef(selectedMarketId)
  leadsRef.current = leads
  marketsRef.current = markets
  mapModeRef.current = mapMode
  selectedLeadIdRef.current = selectedLeadId
  selectedMarketIdRef.current = selectedMarketId

  // ── Mount / unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const settings = loadSettings()

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getMapStyleUrl(),
      center: [-96, 37.5],
      zoom: settings.defaultZoom,
      minZoom: 2,
      maxZoom: 17,
      attributionControl: false,
      renderWorldCopies: false,
      pitchWithRotate: false,
      dragRotate: false,
      fadeDuration: 350,  // smoother tile/feature transitions
    })

    mapRef.current = map

    // Compact attribution for CARTO/OSM compliance
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right',
    )

    map.on('load', () => {
      // Read from refs so we always get latest props, even if they changed
      // during the async style load
      const curLeads = leadsRef.current
      const curMarkets = marketsRef.current
      const curMode = mapModeRef.current
      const curSelectedLead = selectedLeadIdRef.current
      const curSelectedMarket = selectedMarketIdRef.current

      // ── Sources ─────────────────────────────────────────────────
      map.addSource('leads', {
        type: 'geojson',
        data: buildLeadsGeoJSON(curLeads, curMode, curSelectedLead),
        cluster: true,
        clusterMaxZoom: 9,
        clusterRadius: 42,
      })

      map.addSource('markets', {
        type: 'geojson',
        data: buildMarketsGeoJSON(curMarkets, curSelectedMarket),
      })

      // ── Heatmap ─────────────────────────────────────────────────
      // Atmospheric pressure layer with settings-driven palette.
      // Wider radius creates blended fields rather than isolated circles.
      const heatIntensity = settings.heatIntensity
      map.addLayer({
        id: 'leads-heat',
        type: 'heatmap',
        source: 'leads',
        maxzoom: 11,
        paint: {
          'heatmap-weight': [
            'interpolate', ['linear'],
            ['get', 'urgencyScore'], 0, 0.12 * heatIntensity, 100, 2.2 * heatIntensity,
          ],
          'heatmap-intensity': [
            'interpolate', ['linear'],
            ['zoom'], 3, 0.6 * heatIntensity, 10, 2.4 * heatIntensity,
          ],
          'heatmap-color': buildHeatColorExpr(),
          'heatmap-radius': [
            'interpolate', ['exponential', 1.5],
            ['zoom'], 3, 32, 6, 52, 10, 80,
          ],
          'heatmap-opacity': [
            'interpolate', ['linear'],
            ['zoom'], 3, 0.78, 10, 0.52,
          ],
        },
      })

      // ── Cluster circles ─────────────────────────────────────────
      map.addLayer({
        id: 'leads-clusters',
        type: 'circle',
        source: 'leads',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step', ['get', 'point_count'],
            '#1e4d7a',   5,   // 2–4: slate-blue
            '#1d4ed8',   15,  // 5–14: indigo
            '#7c3aed',        // 15+: violet
          ],
          'circle-radius': [
            'step', ['get', 'point_count'],
            16, 5, 22, 15, 28,
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(255,255,255,0.20)',
          'circle-opacity': 0.90,
        },
      })

      map.addLayer({
        id: 'leads-cluster-count',
        type: 'symbol',
        source: 'leads',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
          'text-size': 11,
        },
        paint: { 'text-color': '#ffffff' },
      })

      // ── Individual property pins ─────────────────────────────────
      // Outer glow halo — tier-colored blur ring
      map.addLayer({
        id: 'leads-pin-glow',
        type: 'circle',
        source: 'leads',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': [
            'case', ['==', ['get', 'selected'], 1], 22, 14,
          ],
          'circle-blur': 0.9,
          'circle-opacity': [
            'case', ['==', ['get', 'selected'], 1], 0.50, 0.18,
          ],
          'circle-color': PIN_COLOR_EXPR,
        },
      })

      // Activity pulse ring — visible on hot pins for live activity feel
      map.addLayer({
        id: 'leads-pulse-ring',
        type: 'circle',
        source: 'leads',
        filter: ['all',
          ['!', ['has', 'point_count']],
          ['in', ['get', 'pinTier'], ['literal', ['hot', 'warm']]],
        ],
        paint: {
          'circle-radius': [
            'match', ['get', 'pinTier'],
            'hot', 18,
            'warm', 14,
            10,
          ],
          'circle-blur': 0.6,
          'circle-opacity': [
            'match', ['get', 'pinTier'],
            'hot', 0.22,
            'warm', 0.12,
            0,
          ],
          'circle-color': PIN_COLOR_EXPR,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': PIN_COLOR_EXPR,
          'circle-stroke-opacity': [
            'match', ['get', 'pinTier'],
            'hot', 0.35,
            'warm', 0.18,
            0,
          ],
        },
      })

      // Core dot
      map.addLayer({
        id: 'leads-pins',
        type: 'circle',
        source: 'leads',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': [
            'case', ['==', ['get', 'selected'], 1], 9.0, 5.5,
          ],
          'circle-color': PIN_COLOR_EXPR,
          'circle-stroke-width': [
            'case', ['==', ['get', 'selected'], 1], 2.5, 1.0,
          ],
          'circle-stroke-color': [
            'case',
            ['==', ['get', 'selected'], 1], '#ffffff',
            'rgba(255,255,255,0.26)',
          ],
          'circle-opacity': 0.95,
        },
      })

      // ── Market centroids ─────────────────────────────────────────
      // Wide glow bloom
      map.addLayer({
        id: 'markets-glow',
        type: 'circle',
        source: 'markets',
        paint: {
          'circle-radius': [
            'case', ['==', ['get', 'selected'], 1], 38, 28,
          ],
          'circle-color': '#38d0f0',
          'circle-opacity': [
            'case', ['==', ['get', 'selected'], 1], 0.13, 0.06,
          ],
          'circle-blur': 1.2,
        },
      })

      // Core ring
      map.addLayer({
        id: 'markets-core',
        type: 'circle',
        source: 'markets',
        paint: {
          'circle-radius': [
            'case', ['==', ['get', 'selected'], 1], 11, 7,
          ],
          'circle-color': '#38d0f0',
          'circle-stroke-width': 2,
          'circle-stroke-color': [
            'case', ['==', ['get', 'selected'], 1],
            '#ffffff',
            'rgba(56,208,240,0.50)',
          ],
          'circle-opacity': [
            'case', ['==', ['get', 'selected'], 1], 1.0, 0.85,
          ],
        },
      })

      // Market name label
      map.addLayer({
        id: 'markets-label',
        type: 'symbol',
        source: 'markets',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
          'text-size': 11,
          'text-offset': [0, -1.5],
          'text-anchor': 'bottom',
          'text-optional': true,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#8ac8e0',
          'text-halo-color': 'rgba(3,4,8,0.94)',
          'text-halo-width': 2,
        },
      })

      // ── Event pulse layer (empty source, populated dynamically) ──
      map.addSource('event-pulses', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      map.addLayer({
        id: 'event-pulse-rings',
        type: 'circle',
        source: 'event-pulses',
        paint: {
          'circle-radius': ['get', 'radius'],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['get', 'opacity'],
          'circle-blur': 0.6,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-opacity': ['*', ['get', 'opacity'], 0.6],
        },
      })

      // ── Interactions ─────────────────────────────────────────────

      // Click unclustered property pin → open right-side dossier
      map.on('click', 'leads-pins', (e) => {
        e.preventDefault()
        const feature = e.features?.[0]
        if (!feature?.properties) return
        onOpenLeadRef.current(feature.properties.id as string)
      })

      // Click cluster → expand (zoom into cluster bounds)
      map.on('click', 'leads-clusters', (e) => {
        e.preventDefault()
        const feature = e.features?.[0]
        if (!feature?.geometry || feature.geometry.type !== 'Point') return
        const clusterId = feature.properties?.cluster_id as number
        const coords = feature.geometry.coordinates as [number, number]
        const source = map.getSource('leads') as maplibregl.GeoJSONSource
        void source.getClusterExpansionZoom(clusterId).then((zoom) => {
          map.easeTo({ center: coords, zoom: zoom + 0.5, duration: 700 })
        })
      })

      // Click market centroid → select market (drives left rail + overlay card)
      map.on('click', 'markets-core', (e) => {
        e.preventDefault()
        e.originalEvent.stopPropagation()
        const feature = e.features?.[0]
        if (!feature?.properties) return
        onSelectMarketRef.current(feature.properties.id as string)
      })

      // Pointer cursors
      const clickableLayers = ['leads-pins', 'leads-clusters', 'markets-core'] as const
      for (const layer of clickableLayers) {
        map.on('mouseenter', layer, () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = ''
        })
      }

      mapReadyRef.current = true

      // ── Live pulse animation — pulsing hot pins + event pulses ──
      let pulseFrame = 0
      let lastPulseTime = performance.now()

      const animatePulse = () => {
        if (!mapReadyRef.current) return
        const now = performance.now()

        // Pin pulse — smoother sinusoidal expansion cycle
        pulseFrame = (pulseFrame + 1) % 150
        const t = pulseFrame / 150
        // Sine-based easing: smooth rise and fall
        const wave = Math.sin(t * Math.PI)
        const scale = 1 + wave * 2.2
        const opacity = 0.28 * (1 - t * 0.8)
        try {
          map.setPaintProperty('leads-pulse-ring', 'circle-radius', [
            'match', ['get', 'pinTier'],
            'hot', 10 + scale * 9,
            'warm', 8 + scale * 6,
            6,
          ])
          map.setPaintProperty('leads-pulse-ring', 'circle-opacity', [
            'match', ['get', 'pinTier'],
            'hot', opacity,
            'warm', opacity * 0.45,
            0,
          ])
        } catch {
          // Layer may have been removed during cleanup
        }

        // Event pulse rendering — throttled to 33ms (~30fps) for smooth rings
        if (now - lastPulseTime > 33) {
          lastPulseTime = now
          const activePulses = eventPulsesRef.current
          if (activePulses.length > 0) {
            const features = activePulses
              .map((p) => {
                const elapsed = now - p.startTime
                const progress = Math.min(elapsed / p.duration, 1)
                if (progress >= 1) return null
                const eased = 1 - Math.pow(1 - progress, 4) // ease-out quartic — slower start, cinematic tail
                return {
                  type: 'Feature' as const,
                  geometry: {
                    type: 'Point' as const,
                    coordinates: [p.lng, p.lat],
                  },
                  properties: {
                    radius: 6 + eased * 52,
                    color: p.color,
                    opacity: 0.40 * Math.pow(1 - progress, 1.5),
                  },
                }
              })
              .filter(Boolean)

            // Prune expired pulses
            eventPulsesRef.current = activePulses.filter(
              (p) => now - p.startTime < p.duration,
            )

            try {
              const source = map.getSource('event-pulses') as maplibregl.GeoJSONSource | undefined
              source?.setData({
                type: 'FeatureCollection',
                features: features as Array<GeoJSON.Feature<Point>>,
              })
            } catch {
              // Source may be removed
            }
          }
        }

        requestAnimationFrame(animatePulse)
      }
      requestAnimationFrame(animatePulse)
    })

    return () => {
      mapReadyRef.current = false
      map.remove()
      mapRef.current = null
    }
    // Mount/unmount only — prop changes handled by update effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Update lead GeoJSON (on leads, mapMode, or selectedLeadId change) ───
  useEffect(() => {
    if (!mapReadyRef.current || !mapRef.current) return
    const source = mapRef.current.getSource('leads') as maplibregl.GeoJSONSource | undefined
    source?.setData(buildLeadsGeoJSON(leads, mapMode, selectedLeadId))
  }, [leads, mapMode, selectedLeadId])

  // ── Update market GeoJSON (on markets or selectedMarketId change) ────────
  useEffect(() => {
    if (!mapReadyRef.current || !mapRef.current) return
    const source = mapRef.current.getSource('markets') as maplibregl.GeoJSONSource | undefined
    source?.setData(buildMarketsGeoJSON(markets, selectedMarketId))
  }, [markets, selectedMarketId])

  // ── FlyTo selected lead when drawer opens (drawer-aware offset) ──────────
  useEffect(() => {
    if (!mapReadyRef.current || !mapRef.current) return
    if (!activeDrawer || !selectedLeadId) return
    const lead = leads.find((l) => l.id === selectedLeadId)
    if (!lead || !isValidCoord(lead.lat, lead.lng)) return
    const currentZoom = mapRef.current.getZoom()
    mapRef.current.flyTo({
      center: [lead.lng, lead.lat],
      zoom: Math.max(currentZoom, 11.5),
      // Offset left: shifts map center so the lead pin appears right-of-center,
      // leaving clear space for the right-side drawer
      offset: [-200, 20],
      duration: 1200,
      essential: true,
    })
  }, [activeDrawer, selectedLeadId, leads])

  // ── Timeline → event pulse sync ──────────────────────────────────────────
  // When new timeline events arrive, create visual pulses on the map at
  // the geographic position of the event's market centroid.
  useEffect(() => {
    if (!mapReadyRef.current) return
    const settings = loadSettings()
    const count = timeline.length
    if (count <= lastTimelineCountRef.current) {
      lastTimelineCountRef.current = count
      return
    }
    // New events since last render
    const newEvents = timeline.slice(0, count - lastTimelineCountRef.current)
    lastTimelineCountRef.current = count

    const pulseDensity = settings.pulseDensity
    const now = performance.now()

    for (const evt of newEvents) {
      // Skip based on density setting (random threshold)
      if (Math.random() > pulseDensity) continue

      // Find geographic position via related market
      const market = markets.find((m) => m.id === evt.marketId)
      if (!market || !isValidCoord(market.lat, market.lng)) continue

      const color = EVENT_COLOR[evt.kind] ?? EVENT_COLOR.system
      eventPulsesRef.current.push({
        lng: market.lng + (Math.random() - 0.5) * 0.3,
        lat: market.lat + (Math.random() - 0.5) * 0.2,
        color,
        startTime: now,
        duration: PULSE_DURATION,
      })

      // Play sound for certain event types
      if (evt.kind === 'alert' && evt.severity === 'critical') {
        playSound('alert-triggered')
      } else if (evt.kind === 'conversation') {
        playSound('inbound-reply')
      } else if (evt.kind === 'ai') {
        playSound('ai-response')
      } else if (evt.kind === 'deal') {
        playSound('contract-milestone')
      }
    }
  }, [timeline, markets])

  // ── Debug counts ─────────────────────────────────────────────────────────
  const validCount = leads.filter((l) => isValidCoord(l.lat, l.lng)).length

  return (
    <div className="cc-nexus-map-wrap">
      {/* MapLibre canvas host — fills the .cc-map container */}
      <div ref={containerRef} className="cc-nexus-map" />

      {/* Debug badge — property count vs. valid geo coords */}
      <div className="cc-map__debug" aria-hidden="true">
        {validCount} / {leads.length} properties plotted
      </div>

      {/* Empty state — shown when filter returns leads but none have coords */}
      {validCount === 0 && leads.length > 0 ? (
        <div className="cc-map__empty-overlay" role="status">
          <span className="cc-map__empty-icon">⌀</span>
          <span>No geo coordinates available for current filter</span>
        </div>
      ) : null}
    </div>
  )
}
