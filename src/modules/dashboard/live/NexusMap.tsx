/**
 * NexusMap.tsx
 *
 * Real MapLibre GL geographic property map for the NEXUS command center.
 * Replaces the previous SVG pseudo-map with a true interactive geo map.
 *
 * Tile provider: CartoCDN dark-matter-nolabels (free, no API key required)
 * Override with VITE_MAP_STYLE_URL env var for a custom tile provider.
 *
 * Attribution required: © CARTO  © OpenStreetMap contributors
 */

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection, Point } from 'geojson'
import type { ExpressionSpecification } from 'maplibre-gl'
import type { LiveLead, LiveMarket } from './live-dashboard.adapter'

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
// CartoCDN dark-matter (no labels) — free, no API key, NEXUS-appropriate dark
// aesthetic. Override via VITE_MAP_STYLE_URL for a custom tile provider.

const DEFAULT_MAP_STYLE =
  'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json'

const MAP_STYLE_URL: string =
  (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) ?? DEFAULT_MAP_STYLE

// ─── Paint expressions ────────────────────────────────────────────────────

const PIN_COLOR_EXPR: ExpressionSpecification = [
  'match', ['get', 'pinTier'],
  'hot',     '#ef4444',
  'warm',    '#f59e0b',
  'neutral', '#48d5ff',
  /* default (cold) */ '#6e92b4',
]

// ─── Component ────────────────────────────────────────────────────────────

export interface NexusMapProps {
  leads: LiveLead[]
  markets: LiveMarket[]
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

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [-96, 37.5],
      zoom: 4.0,
      minZoom: 2,
      maxZoom: 17,
      attributionControl: false,
      renderWorldCopies: false,
      pitchWithRotate: false,
      dragRotate: false,
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
      // Always-on density layer using urgencyScore as weight.
      // Transitions from pure density at low zoom to individual dots at z ≥ 11.
      map.addLayer({
        id: 'leads-heat',
        type: 'heatmap',
        source: 'leads',
        maxzoom: 11,
        paint: {
          'heatmap-weight': [
            'interpolate', ['linear'],
            ['get', 'urgencyScore'], 0, 0.08, 100, 2.0,
          ],
          'heatmap-intensity': [
            'interpolate', ['linear'],
            ['zoom'], 3, 0.4, 10, 2.0,
          ],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,    'rgba(0,0,0,0)',
            0.12, 'rgba(72,213,255,0.10)',
            0.30, 'rgba(90,166,255,0.42)',
            0.55, 'rgba(245,158,11,0.62)',
            0.75, 'rgba(239,68,68,0.80)',
            1.0,  'rgba(239,68,68,0.96)',
          ],
          'heatmap-radius': [
            'interpolate', ['linear'],
            ['zoom'], 3, 14, 10, 44,
          ],
          'heatmap-opacity': 0.62,
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
            'case', ['==', ['get', 'selected'], 1], 20, 13,
          ],
          'circle-blur': 0.82,
          'circle-opacity': [
            'case', ['==', ['get', 'selected'], 1], 0.45, 0.16,
          ],
          'circle-color': PIN_COLOR_EXPR,
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
          'circle-color': '#48d5ff',
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
          'circle-color': '#48d5ff',
          'circle-stroke-width': 2,
          'circle-stroke-color': [
            'case', ['==', ['get', 'selected'], 1],
            '#ffffff',
            'rgba(72,213,255,0.50)',
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
          'text-color': '#9ed4f2',
          'text-halo-color': 'rgba(5,10,17,0.92)',
          'text-halo-width': 2,
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
          map.easeTo({ center: coords, zoom: zoom + 0.5, duration: 500 })
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
      duration: 950,
      essential: true,
    })
  }, [activeDrawer, selectedLeadId, leads])

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
