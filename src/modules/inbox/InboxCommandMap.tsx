/**
 * InboxCommandMap.tsx
 *
 * Lightweight MapLibre-powered property/market context map for Inbox.
 * Uses the same CartoCDN dark-matter tile set as NexusMap.
 * Designed as a compact command map inside the Inbox dossier panel.
 */

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { InboxThread } from './inbox.adapter'

// ─── Market coordinate lookup ─────────────────────────────────────────────

const MARKET_COORDS: Record<string, [number, number]> = {
  'm-dallas':      [-96.797,  32.7767],
  'm-houston':     [-95.3698, 29.7604],
  'm-atlanta':     [-84.388,  33.749 ],
  'm-minneapolis': [-93.265,  44.9778],
  'm-phoenix':     [-112.074, 33.4484],
}

// Known market display names
const MARKET_LABELS: Record<string, string> = {
  'm-dallas':      'Dallas, TX',
  'm-houston':     'Houston, TX',
  'm-atlanta':     'Atlanta, GA',
  'm-minneapolis': 'Minneapolis, MN',
  'm-phoenix':     'Phoenix, AZ',
}

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// ─── Nearby mock point generator (stable per coords) ─────────────────────

function getNearbyPoints(
  center: [number, number],
  count = 6,
): Array<[number, number]> {
  const pts: Array<[number, number]> = []
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + 0.3
    const dist = 0.018 + (i % 3) * 0.012
    pts.push([
      center[0] + Math.cos(angle) * dist,
      center[1] + Math.sin(angle) * dist * 0.72,
    ])
  }
  return pts
}

// ─── Pin color by sentiment/priority ─────────────────────────────────────

function getPinColor(thread: InboxThread): string {
  if (thread.priority === 'urgent' || thread.sentiment === 'hot') return '#d4404c'
  if (thread.sentiment === 'warm') return '#d89530'
  if (thread.sentiment === 'cold') return '#6b7280'
  return '#38d0f0'
}

// ─── Custom HTML marker elements ──────────────────────────────────────────

function createPulseMarker(color: string): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'nx-icm-pin'
  wrapper.style.setProperty('--pin-color', color)

  const dot = document.createElement('div')
  dot.className = 'nx-icm-pin__dot'

  const ring = document.createElement('div')
  ring.className = 'nx-icm-pin__ring'

  wrapper.appendChild(ring)
  wrapper.appendChild(dot)
  return wrapper
}

function createContextDot(opacity = 0.45): HTMLElement {
  const el = document.createElement('div')
  el.className = 'nx-icm-dot'
  el.style.opacity = String(opacity)
  return el
}

// ─── Map style override URL (env or default) ──────────────────────────────

function resolveStyle(): string {
  const envStyle = (import.meta.env as Record<string, string>).VITE_MAP_STYLE_URL
  return typeof envStyle === 'string' && envStyle.length > 0 ? envStyle : MAP_STYLE
}

// ─── Helper: format market label ─────────────────────────────────────────

function fmtMarket(marketId: string): string {
  return (
    MARKET_LABELS[marketId] ??
    marketId
      .replace(/^m-/, '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
  )
}

// ─── Props ────────────────────────────────────────────────────────────────

interface Props {
  thread: InboxThread
  zoomedIn: boolean
}

// ─── Component ────────────────────────────────────────────────────────────

export function InboxCommandMap({ thread, zoomedIn }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])

  const coords = MARKET_COORDS[thread.marketId] ?? null
  const pinColor = getPinColor(thread)
  const baseZoom = zoomedIn ? 13 : 10

  // ── Init / re-init map when thread changes ──────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !coords) return

    // Clean up previous instance
    for (const m of markersRef.current) m.remove()
    markersRef.current = []
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: resolveStyle(),
      center: coords,
      zoom: baseZoom,
      interactive: true,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,
    })

    mapRef.current = map

    map.on('load', () => {
      // Nearby context dots
      for (const pt of getNearbyPoints(coords, 6)) {
        const el = createContextDot()
        const m = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(pt)
          .addTo(map)
        markersRef.current.push(m)
      }

      // Selected property pulse marker
      const el = createPulseMarker(pinColor)
      const m = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat(coords)
        .addTo(map)
      markersRef.current.push(m)
    })

    return () => {
      for (const m of markersRef.current) m.remove()
      markersRef.current = []
      map.remove()
      mapRef.current = null
    }
    // Re-init only when thread changes (id or marketId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id, thread.marketId])

  // ── Zoom level responds to zoomedIn prop ───────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !coords) return
    mapRef.current.easeTo({ zoom: zoomedIn ? 13 : 10, duration: 400 })
  }, [zoomedIn, coords])

  // ── No coords: empty state ──────────────────────────────────────────────
  if (!coords) {
    return (
      <div className="nx-icm nx-icm--empty">
        <p className="nx-icm__empty-msg">No property location available for this thread.</p>
      </div>
    )
  }

  const priorityLabel =
    thread.priority === 'urgent' ? 'P0 · Urgent'
    : thread.priority === 'high' ? 'P1 · High'
    : thread.priority === 'normal' ? 'P2 · Normal'
    : 'P3 · Low'

  return (
    <div className="nx-icm">
      {/* Map canvas */}
      <div ref={containerRef} className="nx-icm__canvas" />

      {/* Context card overlay */}
      <div className="nx-icm__card" aria-label="Property context">
        <div className="nx-icm__card-row nx-icm__card-row--head">
          <span className="nx-icm__card-subject" title={thread.subject}>
            {thread.subject}
          </span>
          <span
            className="nx-icm__card-badge"
            style={{ '--icm-badge-color': pinColor } as React.CSSProperties}
          >
            {thread.sentiment}
          </span>
        </div>
        <div className="nx-icm__card-row">
          <span className="nx-icm__card-label">Market</span>
          <span className="nx-icm__card-value">{fmtMarket(thread.marketId)}</span>
        </div>
        <div className="nx-icm__card-row">
          <span className="nx-icm__card-label">Priority</span>
          <span className="nx-icm__card-value">{priorityLabel}</span>
        </div>
        <div className="nx-icm__card-row">
          <span className="nx-icm__card-label">Last Active</span>
          <span className="nx-icm__card-value">{thread.lastMessageLabel}</span>
        </div>
      </div>

      {/* Attribution (required for CartoCDN) */}
      <div className="nx-icm__attribution">© CARTO · © OSM</div>
    </div>
  )
}
