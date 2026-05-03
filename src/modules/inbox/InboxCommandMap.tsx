/**
 * InboxCommandMap.tsx
 *
 * Full MapLibre GL command map for Inbox.
 * Shows ALL inbox threads as pulsing pins at exact property coordinates.
 * No clustering — every property visible at all zoom levels.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection, Point } from 'geojson'
import type { ExpressionSpecification } from 'maplibre-gl'
import type { InboxWorkflowThread } from '../../lib/data/inboxWorkflowData'

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

const PIN_COLOR: ExpressionSpecification = [
  'match', ['get', 'pinTier'],
  'hot',     '#d4404c',
  'warm',    '#d89530',
  'neutral', '#38d0f0',
  '#4e6e88',
]

interface PinFeatureProps {
  id: string
  ownerName: string
  address: string
  marketId: string
  priority: string
  sentiment: string
  pinTier: 'hot' | 'warm' | 'neutral' | 'cold'
  selected: 0 | 1
}

function computePinTier(thread: InboxWorkflowThread): PinFeatureProps['pinTier'] {
  if (thread.priority === 'urgent') return 'hot'
  const s = (thread as any).sentiment || 'neutral'
  if (s === 'hot') return 'hot'
  if (s === 'warm') return 'warm'
  if (s === 'cold') return 'cold'
  return 'neutral'
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
      .map((t) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [getThreadLng(t), getThreadLat(t)] },
        properties: {
          id: t.id,
          ownerName: t.ownerName || 'Unknown',
          address: t.propertyAddress || t.subject || 'No Address',
          marketId: t.marketId || 'unknown',
          priority: t.priority,
          sentiment: (t as any).sentiment || 'neutral',
          pinTier: computePinTier(t),
          selected: t.id === selectedId ? 1 : 0,
        },
      })),
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

interface Props {
  threads: InboxWorkflowThread[]
  selectedThread: InboxWorkflowThread | null
  zoomedIn: boolean
  onSelectThreadId?: (threadId: string) => void
}

export function InboxCommandMap({ threads, selectedThread, zoomedIn, onSelectThreadId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const mapReadyRef = useRef(false)
  const selectedIdRef = useRef<string | undefined>(selectedThread?.id)
  const pFrame = useRef(0)
  const pAnim = useRef(0)
  const [hasRenderedPins, setHasRenderedPins] = useState(false)

  const withCoords = threads.filter((t) => {
    const lat = getThreadLat(t)
    const lng = getThreadLng(t)
    return isValidCoord(lat, lng)
  })

  const pinsGeoJSON = useMemo(
    () => buildPinsGeoJSON(threads, selectedThread?.id),
    [threads, selectedThread?.id],
  )

  useEffect(() => {
    selectedIdRef.current = selectedThread?.id
  }, [selectedThread?.id])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      console.log('[InboxMapSource]', {
        activeMapMode: 'all_loaded_threads',
        receivedThreadCount: threads.length,
        threadsWithLatLng: withCoords.length,
        pinsGeoJsonCount: pinsGeoJSON.features.length,
        selectedThreadId: selectedThread?.id ?? null,
        selectedHasCoords: selectedThread ? isValidCoord(getThreadLat(selectedThread), getThreadLng(selectedThread)) : false,
      })
    }
  }, [threads, withCoords.length, pinsGeoJSON.features.length, selectedThread])

  // Skip rendering map until threads are loaded
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
    const bounds = getBoundsForPins(threads)
    const marketCenter = getMarketCenter(threads)

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
          'circle-color': PIN_COLOR,
        },
      })

      map.addLayer({
        id: 'pin-pulse',
        type: 'circle',
        source: 'pins',
        paint: {
          'circle-radius': ['match', ['get', 'pinTier'], 'hot', 18, 'warm', 14, 'neutral', 12, 10],
          'circle-blur': 0.6,
          'circle-opacity': ['match', ['get', 'pinTier'], 'hot', 0.22, 'warm', 0.18, 'neutral', 0.12, 0.06],
          'circle-color': PIN_COLOR,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': PIN_COLOR,
          'circle-stroke-opacity': ['match', ['get', 'pinTier'], 'hot', 0.35, 'warm', 0.18, 'neutral', 0.12, 0.06],
        },
      })

      map.addLayer({
        id: 'pin-core',
        type: 'circle',
        source: 'pins',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'selected'], 1], 9, 5.5],
          'circle-color': PIN_COLOR,
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

      const animate = () => {
        if (!mapReadyRef.current || !mapRef.current) return
        pFrame.current = (pFrame.current + 1) % 150
        const t = pFrame.current / 150
        const wave = Math.sin(t * Math.PI)
        const scale = 1 + wave * 2.2
        const opacity = 0.28 * (1 - t * 0.8)
        try {
          map.setPaintProperty('pin-pulse', 'circle-radius', [
            'match', ['get', 'pinTier'],
            'hot', 10 + scale * 9,
            'warm', 8 + scale * 6,
            'neutral', 6 + scale * 4,
            5 + scale * 3,
          ])
          map.setPaintProperty('pin-pulse', 'circle-opacity', [
            'match', ['get', 'pinTier'],
            'hot', opacity,
            'warm', opacity * 0.45,
            'neutral', opacity * 0.25,
            opacity * 0.12,
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
        src?.setData(buildPinsGeoJSON(threads, clickedId))

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
      mapRef.current.easeTo({ zoom: target, duration: 400 })
    }
  }, [zoomedIn, selectedThread])

  const threadCount = pinsGeoJSON.features.length
  const isEmpty = !hasRenderedPins && threads.length > 0

  return (
    <div className="nx-icm">
      <div ref={containerRef} className="nx-icm__canvas" />
      {isEmpty && (
        <div className="nx-icm__empty">
          <div className="nx-icm__empty-title">No coordinates found</div>
          <div className="nx-icm__empty-sub">
            {threads.length} threads loaded, but {withCoords.length} have valid lat/lng.
            Check [InboxCoords] logs for property coordinate fetch status.
          </div>
        </div>
      )}
      <div className="nx-icm__card" aria-label="Map context">
        <div className="nx-icm__card-row nx-icm__card-row--head">
          <span className="nx-icm__card-subject">
            {selectedThread ? (selectedThread.propertyAddress || selectedThread.subject) : 'All Properties'}
          </span>
          <span className="nx-icm__card-badge" style={{ '--icm-badge-color': '#38d0f0' } as React.CSSProperties}>
            {threadCount} pins
          </span>
        </div>
        {selectedThread && (
          <>
            <div className="nx-icm__card-row">
              <span className="nx-icm__card-label">Market</span>
              <span className="nx-icm__card-value">{selectedThread.marketId || 'Unknown'}</span>
            </div>
            <div className="nx-icm__card-row">
              <span className="nx-icm__card-label">Priority</span>
              <span className="nx-icm__card-value">{selectedThread.priority}</span>
            </div>
          </>
        )}
      </div>
      <div className="nx-icm__attribution">© CARTO · © OSM</div>
    </div>
  )
}
