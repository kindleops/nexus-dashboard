/**
 * InboxCommandMap.tsx
 *
 * Full MapLibre GL command map for Inbox.
 * Shows ALL inbox threads as pulsing pins at exact property coordinates.
 * Pin colors represent seller/conversation stage.
 * Pulse intensity represents urgency.
 * Ring states represent AI/automation status.
 * No clustering — every property visible at all zoom levels.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection, Point } from 'geojson'
import type { InboxWorkflowThread } from '../../lib/data/inboxWorkflowData'
import type { MapSourceMode } from './inbox-layout-state'

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// ── Stage color map ────────────────────────────────────────────────────────

const STAGE_COLOR_MAP: Record<string, string> = {
  new: '#6b7b8d',
  uncontacted: '#6b7b8d',
  ownership_check: '#06b6d4',
  consider_selling: '#3b82f6',
  seller_asking_price: '#a855f7',
  price_question: '#a855f7',
  condition_info: '#f59e0b',
  info_gathering: '#f59e0b',
  offer_reveal: '#22c55e',
  offer_ready: '#22c55e',
  negotiation: '#eab308',
  contract_path: '#10b981',
  closed_converted: '#ffffff',
  not_interested: '#6b7280',
  wrong_number: '#4b5563',
  dnc_opt_out: '#ef4444',
  suppressed: '#ef4444',
  needs_review: '#f97316',
}

function getStageColor(thread: InboxWorkflowThread): string {
  const stage = (thread.conversationStage || thread.inboxStage || 'new') as string
  return STAGE_COLOR_MAP[stage] || STAGE_COLOR_MAP['new'] || '#6b7b8d'
}

// ── Pulse intensity ────────────────────────────────────────────────────────

type PulseIntensity = 'strong' | 'medium' | 'slow' | 'none'

function getPulseIntensity(thread: InboxWorkflowThread): PulseIntensity {
  const stage = (thread.conversationStage || thread.inboxStage || 'new') as string
  const priority = thread.priority
  const inboxStatus = thread.inboxStatus

  if (inboxStatus === 'suppressed' || stage === 'dnc_opt_out' || stage === 'suppressed' || stage === 'wrong_number') {
    return 'none'
  }

  if (priority === 'urgent' || stage === 'negotiation' || stage === 'contract_path') {
    return 'strong'
  }

  if (inboxStatus === 'new_reply' || inboxStatus === 'needs_review' || stage === 'offer_reveal' || stage === 'offer_ready') {
    return 'medium'
  }

  return 'slow'
}

// ── Ring state ─────────────────────────────────────────────────────────────

type RingState = 'purple' | 'cyan' | 'amber' | 'red' | 'none'

function getRingState(thread: InboxWorkflowThread): RingState {
  const inboxStatus = thread.inboxStatus
  const stage = (thread.conversationStage || thread.inboxStage || 'new') as string

  if (inboxStatus === 'suppressed' || stage === 'dnc_opt_out' || stage === 'suppressed') {
    return 'red'
  }

  if (inboxStatus === 'needs_review') {
    return 'amber'
  }

  if (inboxStatus === 'ai_draft_ready' || (thread as any).offerDryRun) {
    return 'purple'
  }

  if (inboxStatus === 'queued') {
    return 'cyan'
  }

  return 'none'
}

const RING_COLOR_MAP: Record<string, string> = {
  purple: '#a855f7',
  cyan: '#06b6d4',
  amber: '#f59e0b',
  red: '#ef4444',
  none: 'transparent',
}

// ── Unique list of stages for legend ───────────────────────────────────────

const LEGEND_STAGES = [
  { label: 'New', color: '#6b7b8d', stages: ['new', 'uncontacted'] },
  { label: 'Interest', color: '#06b6d4', stages: ['ownership_check', 'consider_selling'] },
  { label: 'Price', color: '#a855f7', stages: ['seller_asking_price', 'price_question'] },
  { label: 'Offer', color: '#22c55e', stages: ['offer_reveal', 'offer_ready', 'condition_info', 'info_gathering'] },
  { label: 'Negotiation', color: '#eab308', stages: ['negotiation'] },
  { label: 'Contract', color: '#10b981', stages: ['contract_path'] },
  { label: 'Suppressed', color: '#ef4444', stages: ['dnc_opt_out', 'suppressed', 'wrong_number', 'not_interested'] },
]

// ── Pin feature props ──────────────────────────────────────────────────────

interface PinFeatureProps {
  id: string
  ownerName: string
  address: string
  marketId: string
  priority: string
  stage: string
  stageColor: string
  pulseIntensity: PulseIntensity
  ringState: RingState
  ringColor: string
  selected: 0 | 1
}

function isValidCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat !== 0 && lng !== 0 &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

function getThreadLat(t: InboxWorkflowThread): number {
  return Number((t as any).lat ?? (t as any).latitude ?? 0)
}

function getThreadLng(t: InboxWorkflowThread): number {
  return Number((t as any).lng ?? (t as any).longitude ?? 0)
}

function buildPinsGeoJSON(
  threads: InboxWorkflowThread[],
  selectedId: string | undefined,
): FeatureCollection<Point, PinFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: threads
      .filter((t) => isValidCoord(getThreadLat(t), getThreadLng(t)))
      .map((t) => {
        const stage = (t.conversationStage || t.inboxStage || 'new') as string
        const stageColor = getStageColor(t)
        const pulseIntensity = getPulseIntensity(t)
        const ringState = getRingState(t)
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [getThreadLng(t), getThreadLat(t)] },
          properties: {
            id: t.id,
            ownerName: t.ownerName || 'Unknown',
            address: t.propertyAddress || t.subject || 'No Address',
            marketId: t.marketId || 'unknown',
            priority: t.priority,
            stage,
            stageColor,
            pulseIntensity,
            ringState,
            ringColor: RING_COLOR_MAP[ringState] || 'transparent',
            selected: t.id === selectedId ? 1 : 0,
          },
        }
      }),
  }
}

function resolveStyle(): string {
  const envStyle = (import.meta.env as Record<string, string>).VITE_MAP_STYLE_URL
  return typeof envStyle === 'string' && envStyle.length > 0 ? envStyle : MAP_STYLE
}

function getMarketCenter(threads: InboxWorkflowThread[]): [number, number] | null {
  const withCoords = threads.filter((t) => isValidCoord(getThreadLat(t), getThreadLng(t)))
  if (withCoords.length === 0) return null
  let sumLat = 0
  let sumLng = 0
  for (const t of withCoords) {
    sumLat += getThreadLat(t)
    sumLng += getThreadLng(t)
  }
  return [sumLng / withCoords.length, sumLat / withCoords.length]
}

function getSelectedCoord(thread: InboxWorkflowThread | null): [number, number] | null {
  if (!thread) return null
  const lat = getThreadLat(thread)
  const lng = getThreadLng(thread)
  return isValidCoord(lat, lng) ? [lng, lat] : null
}

function getBoundsForPins(
  threads: InboxWorkflowThread[],
): [number, number][] | null {
  const withCoords = threads
    .filter((t) => isValidCoord(getThreadLat(t), getThreadLng(t)))
    .map((t) => [getThreadLng(t), getThreadLat(t)] as [number, number])
  if (withCoords.length === 0) return null
  return withCoords
}

// ── Props ──────────────────────────────────────────────────────────────────

interface Props {
  threads: InboxWorkflowThread[]
  visibleThreads: InboxWorkflowThread[]
  selectedThread: InboxWorkflowThread | null
  zoomedIn: boolean
  sourceMode: MapSourceMode
  onSelectThreadId?: (threadId: string) => void
}

export function InboxCommandMap({ threads, visibleThreads, selectedThread, zoomedIn, sourceMode, onSelectThreadId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const mapReadyRef = useRef(false)
  const selectedIdRef = useRef<string | undefined>(selectedThread?.id)
  const pFrame = useRef(0)
  const pAnim = useRef(0)
  const [hasRenderedPins, setHasRenderedPins] = useState(false)

  const mapThreads = useMemo(() => {
    if (sourceMode === 'visible_threads') return visibleThreads
    if (sourceMode === 'all_active_coordinate_threads') return threads
    return threads
  }, [threads, visibleThreads, sourceMode])

  const withCoords = mapThreads.filter((t) => {
    const lat = getThreadLat(t)
    const lng = getThreadLng(t)
    return isValidCoord(lat, lng)
  })

  const pinsGeoJSON = useMemo(
    () => buildPinsGeoJSON(mapThreads, selectedThread?.id),
    [mapThreads, selectedThread?.id],
  )

  useEffect(() => {
    selectedIdRef.current = selectedThread?.id
  }, [selectedThread?.id])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const visibleWithCoords = visibleThreads.filter((t) => isValidCoord(getThreadLat(t), getThreadLng(t))).length
      const loadedWithCoords = threads.filter((t) => isValidCoord(getThreadLat(t), getThreadLng(t))).length
      const allMapWithCoords = pinsGeoJSON.features.length
      const selectedHasCoords = selectedThread ? isValidCoord(getThreadLat(selectedThread), getThreadLng(selectedThread)) : false

      console.log('[InboxMapSource]', {
        sourceMode,
        visibleThreadCount: visibleThreads.length,
        loadedThreadCount: threads.length,
        allMapThreadCount: mapThreads.length,
        visibleWithCoords,
        loadedWithCoords,
        allMapWithCoords,
        selectedThreadHasCoords: selectedHasCoords,
      })
    }
  }, [sourceMode, threads, visibleThreads, mapThreads, pinsGeoJSON.features.length, selectedThread])

  if (threads.length === 0) {
    return (
      <div className="nx-icm">
        <div className="nx-icm__empty">
          <div className="nx-icm__empty-title">Loading threads...</div>
          <div className="nx-icm__empty-sub">Waiting for inbox data to load</div>
        </div>
      </div>
    )
  }

  useEffect(() => {
    if (!containerRef.current) return

    const selectedCoord = getSelectedCoord(selectedThread)
    const bounds = getBoundsForPins(mapThreads)
    const marketCenter = getMarketCenter(mapThreads)

    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
      mapReadyRef.current = false
    }

    const center = selectedCoord ?? marketCenter ?? [-96, 37.5]
    const baseZoom = zoomedIn ? 12 : 6

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: resolveStyle(),
      center,
      zoom: baseZoom,
      minZoom: 2,
      maxZoom: 17,
      interactive: true,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,
    })

    mapRef.current = map
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

    map.on('load', () => {
      mapReadyRef.current = true

      map.addSource('pins', {
        type: 'geojson',
        data: pinsGeoJSON,
      })

      map.addLayer({
        id: 'pin-glow',
        type: 'circle',
        source: 'pins',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'selected'], 1], 22, 14],
          'circle-blur': 0.9,
          'circle-opacity': ['case', ['==', ['get', 'selected'], 1], 0.50, 0.18],
          'circle-color': ['get', 'stageColor'],
        },
      })

      map.addLayer({
        id: 'pin-pulse',
        type: 'circle',
        source: 'pins',
        paint: {
          'circle-radius': ['match', ['get', 'pulseIntensity'], 'strong', 18, 'medium', 14, 'slow', 12, 10],
          'circle-blur': 0.6,
          'circle-opacity': ['match', ['get', 'pulseIntensity'], 'strong', 0.22, 'medium', 0.18, 'slow', 0.12, 0.06],
          'circle-color': ['get', 'stageColor'],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': ['get', 'stageColor'],
          'circle-stroke-opacity': ['match', ['get', 'pulseIntensity'], 'strong', 0.35, 'medium', 0.18, 'slow', 0.12, 0.06],
        },
      })

      map.addLayer({
        id: 'pin-ring',
        type: 'circle',
        source: 'pins',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'selected'], 1], 13, 8],
          'circle-blur': 0,
          'circle-opacity': ['case', ['==', ['get', 'ringColor'], 'transparent'], 0, 0.7],
          'circle-color': 'transparent',
          'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 3, 2],
          'circle-stroke-color': ['case', ['==', ['get', 'selected'], 1], '#ffffff', ['get', 'ringColor']],
          'circle-stroke-opacity': ['case', ['==', ['get', 'ringColor'], 'transparent'], 0, 0.85],
        },
      })

      map.addLayer({
        id: 'pin-core',
        type: 'circle',
        source: 'pins',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'selected'], 1], 9, 5.5],
          'circle-color': ['get', 'stageColor'],
          'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 2.5, 1],
          'circle-stroke-color': ['case', ['==', ['get', 'selected'], 1], '#ffffff', 'rgba(255,255,255,0.26)'],
          'circle-opacity': 0.95,
        },
      })

      setHasRenderedPins(pinsGeoJSON.features.length > 0)

      if (selectedCoord) {
        map.flyTo({ center: selectedCoord, zoom: Math.max(baseZoom, 12), duration: 1000 })
      } else if (bounds && bounds.length > 1) {
        const padding = 80
        map.fitBounds(
          [
            [Math.min(...bounds.map((c) => c[0])), Math.min(...bounds.map((c) => c[1]))],
            [Math.max(...bounds.map((c) => c[0])), Math.max(...bounds.map((c) => c[1]))],
          ],
          { padding, duration: 800 },
        )
      }

      const pulseConfig: Record<string, { baseRadius: number; maxAdd: number; baseOpacity: number }> = {
        strong: { baseRadius: 10, maxAdd: 9, baseOpacity: 0.28 },
        medium: { baseRadius: 8, maxAdd: 6, baseOpacity: 0.20 },
        slow: { baseRadius: 6, maxAdd: 4, baseOpacity: 0.14 },
        none: { baseRadius: 5, maxAdd: 2, baseOpacity: 0.04 },
      }

      const animate = () => {
        if (!mapReadyRef.current || !mapRef.current) return
        pFrame.current = (pFrame.current + 1) % 150
        const t = pFrame.current / 150
        const wave = Math.sin(t * Math.PI)
        const scale = 1 + wave * 2.2
        const baseOpacity = 0.28 * (1 - t * 0.8)

        try {
          map.setPaintProperty('pin-pulse', 'circle-radius', [
            'match', ['get', 'pulseIntensity'],
            'strong', pulseConfig.strong.baseRadius + scale * pulseConfig.strong.maxAdd,
            'medium', pulseConfig.medium.baseRadius + scale * pulseConfig.medium.maxAdd,
            'slow', pulseConfig.slow.baseRadius + scale * pulseConfig.slow.maxAdd,
            pulseConfig.none.baseRadius + scale * pulseConfig.none.maxAdd,
          ])
          map.setPaintProperty('pin-pulse', 'circle-opacity', [
            'match', ['get', 'pulseIntensity'],
            'strong', baseOpacity,
            'medium', baseOpacity * 0.7,
            'slow', baseOpacity * 0.4,
            baseOpacity * 0.15,
          ])
        } catch { /* removed */ }
        pAnim.current = requestAnimationFrame(animate)
      }
      pAnim.current = requestAnimationFrame(animate)

      map.on('click', 'pin-core', (e) => {
        const feat = e.features?.[0]
        if (!feat) return
        const clickedId = feat.properties?.id as string | undefined
        if (!clickedId) return
        const coords = (feat.geometry as Point).coordinates as [number, number]
        map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 12), duration: 800 })

        const src = map.getSource('pins') as maplibregl.GeoJSONSource | undefined
        src?.setData(buildPinsGeoJSON(mapThreads, clickedId))

        if (onSelectThreadId) {
          onSelectThreadId(clickedId)
        }
      })

      map.on('mouseenter', 'pin-core', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'pin-core', () => { map.getCanvas().style.cursor = '' })
    })

    return () => {
      mapReadyRef.current = false
      if (pAnim.current) cancelAnimationFrame(pAnim.current)
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!mapReadyRef.current || !mapRef.current) return
    const src = mapRef.current.getSource('pins') as maplibregl.GeoJSONSource | undefined
    src?.setData(pinsGeoJSON)
  }, [pinsGeoJSON])

  useEffect(() => {
    if (!mapReadyRef.current || !mapRef.current) return
    const target = zoomedIn ? 12 : 6
    const coord = getSelectedCoord(selectedThread)
    if (coord) {
      mapRef.current.flyTo({ center: coord, zoom: Math.max(mapRef.current.getZoom(), target), duration: 600 })
    } else {
      const bounds = getBoundsForPins(mapThreads)
      if (bounds && bounds.length > 1) {
        const padding = 80
        mapRef.current.fitBounds(
          [
            [Math.min(...bounds.map((c) => c[0])), Math.min(...bounds.map((c) => c[1]))],
            [Math.max(...bounds.map((c) => c[0])), Math.max(...bounds.map((c) => c[1]))],
          ],
          { padding, duration: 400 },
        )
      } else {
        mapRef.current.easeTo({ zoom: target, duration: 400 })
      }
    }
  }, [zoomedIn, selectedThread, mapThreads])

  const threadCount = pinsGeoJSON.features.length
  const isEmpty = !hasRenderedPins && threads.length > 0

  return (
    <div className="nx-icm">
      <div ref={containerRef} className="nx-icm__canvas" />
      {isEmpty && (
        <div className="nx-icm__empty">
          <div className="nx-icm__empty-title">No coordinates found for this map scope.</div>
          <div className="nx-icm__empty-sub">
            {threads.length} threads loaded, but {withCoords.length} have valid lat/lng.
            Check [InboxCoords] logs for property coordinate fetch status.
          </div>
        </div>
      )}
      <div className="nx-icm__card" aria-label="Map context">
        <div className="nx-icm__card-row nx-icm__card-row--head">
          <span className="nx-icm__card-subject">
            {selectedThread ? (selectedThread.propertyAddress || selectedThread.subject || 'All Properties') : 'All Properties'}
          </span>
          <span className="nx-icm__card-badge" style={{ '--icm-badge-color': '#38d0f0' } as React.CSSProperties}>
            {threadCount} pins
          </span>
        </div>
        {selectedThread && (
          <>
            <div className="nx-icm__card-row">
              <span className="nx-icm__card-label">Seller</span>
              <span className="nx-icm__card-value">{selectedThread.ownerName || selectedThread.sellerName || 'Unknown'}</span>
            </div>
            <div className="nx-icm__card-row">
              <span className="nx-icm__card-label">Market</span>
              <span className="nx-icm__card-value">{selectedThread.marketName || selectedThread.marketId || 'Unknown'}</span>
            </div>
            <div className="nx-icm__card-row">
              <span className="nx-icm__card-label">Priority</span>
              <span className="nx-icm__card-value">{selectedThread.priority}</span>
            </div>
          </>
        )}
      </div>

      <div className="nx-icm__legend" aria-label="Stage Map Legend">
        <div className="nx-icm__legend-title">Stage Map</div>
        {LEGEND_STAGES.map((entry) => (
          <div key={entry.label} className="nx-icm__legend-row">
            <span className="nx-icm__legend-chip" style={{ backgroundColor: entry.color }} />
            <span className="nx-icm__legend-label">{entry.label}</span>
          </div>
        ))}
      </div>

      <div className="nx-icm__attribution">© CARTO · © OSM</div>
    </div>
  )
}
