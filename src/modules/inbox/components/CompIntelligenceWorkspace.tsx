import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import '../comp-intelligence.css'

// ── Types ──────────────────────────────────────────────────────────────────

interface SoldComp {
  id: string
  address: string
  salePrice: number
  saleDate: string
  daysAgo: number
  distance: number
  sqft: number
  beds: number
  baths: number
  yearBuilt: number
  condition: 'excellent' | 'good' | 'average' | 'fair'
  lat: number
  lng: number
  ppsf: number
  similarity: number
  selected: boolean
  excluded: boolean
  excludeReason: string | null
}

interface ArvStats {
  arv: number
  low: number
  high: number
  avgPpsf: number
  arvPpsf: number
  confidence: number
  count: number
}

interface ArvMethods {
  ppsfModel: number
  medianModel: number
  simModel: number
  recencyModel: number
}

interface ConfidenceExplanation {
  strengths: string[]
  weaknesses: string[]
  flags: string[]
}

type MapMode = 'sold_comps' | 'heat_map' | 'hybrid'
type RadiusMiles = 0.25 | 0.5 | 1 | 1.5

// ── Constants ──────────────────────────────────────────────────────────────

const MAPS_API_KEY = (import.meta.env as Record<string, string | undefined>).VITE_GOOGLE_MAPS_API_KEY
  || 'AIzaSyAhOk7KZkduU4qywmrlq5ZqSOtgktHYiFk'

const DARK_MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://basemaps.cartocdn.com/gl/positron-gl-style/fonts/{fontstack}/{range}.pbf',
  sprite: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/sprite',
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256, attribution: 'Esri', maxzoom: 19,
    },
  },
  layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
}

const STREET_NAMES = ['Oak', 'Elm', 'Pine', 'Maple', 'Cedar', 'Birch', 'Walnut', 'Cypress', 'Willow', 'Magnolia', 'Peach', 'Peachtree']
const STREET_TYPES = ['St', 'Ave', 'Dr', 'Ln', 'Blvd', 'Way', 'Ct', 'Pl']
const CONDITIONS: SoldComp['condition'][] = ['excellent', 'good', 'average', 'fair']
const EXCLUDE_REASONS = ['Too far', 'Low similarity', 'Outlier price', 'Stale sale', 'Size mismatch', 'Condition mismatch', 'Different bed count']

// ── Pure utilities ─────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
const fmtK = (n: number) => `$${Math.round(n / 1000)}k`
const fmtPpsf = (n: number) => `$${n}/sf`

function computeMedian(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

function formatRelativeMin(date: Date): string {
  const diff = Math.round((Date.now() - date.getTime()) / 60000)
  if (diff < 1) return 'just now'
  if (diff < 60) return `${diff}m ago`
  return `${Math.round(diff / 60)}h ago`
}

function seededRand(seed: number): () => number {
  let s = (seed >>> 0) || 1
  return () => { s = Math.imul(1664525, s) + 1013904223; return (s >>> 0) / 0xffffffff }
}

function makeHashSeed(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193)
  return (h >>> 0) || 1
}

function makeStreetviewUrl(lat: number, lng: number, size: string): string {
  return `https://maps.googleapis.com/maps/api/streetview?size=${size}&location=${lat},${lng}&pitch=5&fov=90&key=${MAPS_API_KEY}`
}

// ── Data generation ────────────────────────────────────────────────────────

function generateComps(arv: number, sqft: number, beds: number, baths: number, lat: number, lng: number, count = 9, seed = 42): SoldComp[] {
  const rnd = seededRand(seed)
  const now = Date.now()
  const result: SoldComp[] = []
  const currentYear = new Date().getFullYear()

  for (let i = 0; i < count; i++) {
    const angle = rnd() * 2 * Math.PI
    const distMiles = 0.08 + rnd() * 1.4
    const latOffset = (distMiles / 69) * Math.cos(angle)
    const lngOffset = (distMiles / (69 * Math.cos((lat * Math.PI) / 180))) * Math.sin(angle)

    const priceRatio = 0.82 + rnd() * 0.36
    const salePrice = Math.round((arv * priceRatio) / 1000) * 1000

    const sqftRatio = 0.72 + rnd() * 0.54
    const compSqft = Math.max(600, Math.round((sqft * sqftRatio) / 10) * 10)

    const daysAgo = Math.floor(rnd() * 360) + 5
    const saleDate = new Date(now - daysAgo * 86400000).toISOString().split('T')[0]

    const compBeds = Math.max(1, Math.min(6, beds + Math.floor(rnd() * 3) - 1))
    const compBaths = Math.max(1, Math.round((baths + (rnd() * 2 - 1)) * 2) / 2)
    const ppsf = Math.round(salePrice / compSqft)
    const yearBuilt = currentYear - Math.floor(10 + rnd() * 60)
    const condition = CONDITIONS[Math.floor(rnd() * CONDITIONS.length)]

    const priceSim = 100 - Math.abs(salePrice / arv - 1) * 80
    const distSim = 100 - distMiles * 26
    const sqftSim = 100 - Math.abs(compSqft / sqft - 1) * 55
    const recencySim = 100 - (daysAgo / 360) * 28
    const similarity = Math.round(Math.max(20, Math.min(99, priceSim * 0.35 + distSim * 0.3 + sqftSim * 0.2 + recencySim * 0.15)))

    const sn = STREET_NAMES[Math.floor(rnd() * STREET_NAMES.length)]
    const st = STREET_TYPES[Math.floor(rnd() * STREET_TYPES.length)]
    const num = 100 + Math.floor(rnd() * 9800)

    const autoSelected = similarity >= 72 && distMiles <= 0.75
    let excludeReason: string | null = null
    if (!autoSelected) {
      if (distMiles > 1.0) excludeReason = 'Too far'
      else if (daysAgo > 180) excludeReason = 'Stale sale'
      else if (salePrice / arv > 1.28 || salePrice / arv < 0.72) excludeReason = 'Outlier price'
      else if (Math.abs(compSqft - sqft) / sqft > 0.4) excludeReason = 'Size mismatch'
      else if (similarity < 55) excludeReason = 'Low similarity'
      else excludeReason = EXCLUDE_REASONS[Math.floor(rnd() * EXCLUDE_REASONS.length)]
    }

    result.push({
      id: `comp-${i}`,
      address: `${num} ${sn} ${st}`,
      salePrice, saleDate, daysAgo,
      distance: Math.round(distMiles * 10) / 10,
      sqft: compSqft, beds: compBeds, baths: compBaths, yearBuilt, condition,
      lat: lat + latOffset, lng: lng + lngOffset,
      ppsf, similarity,
      selected: autoSelected,
      excluded: false,
      excludeReason,
    })
  }

  return result.sort((a, b) => b.similarity - a.similarity)
}

// ── ARV computation ────────────────────────────────────────────────────────

function computeArvStats(comps: SoldComp[], sqft: number): ArvStats | null {
  const active = comps.filter(c => c.selected && !c.excluded)
  if (!active.length) return null

  const weights = active.map(c => (c.similarity / 100) * Math.max(0.3, 1 - c.daysAgo / 365))
  const totalW = weights.reduce((a, b) => a + b, 0)
  const weightedAvg = active.reduce((sum, c, i) => sum + c.salePrice * weights[i], 0) / totalW

  const prices = active.map(c => c.salePrice).sort((a, b) => a - b)
  const avgPpsf = Math.round(active.reduce((s, c) => s + c.ppsf, 0) / active.length)
  const arvPpsf = sqft ? Math.round(weightedAvg / sqft) : avgPpsf

  const avgSim = active.reduce((s, c) => s + c.similarity, 0) / active.length
  const avgRecency = active.reduce((s, c) => s + Math.max(0, 1 - c.daysAgo / 180), 0) / active.length
  const confidence = Math.round(Math.min(97, avgSim * 0.5 + avgRecency * 22 + Math.min(22, active.length * 5) + 10))

  return {
    arv: Math.round(weightedAvg / 1000) * 1000,
    low: prices[0],
    high: prices[prices.length - 1],
    avgPpsf, arvPpsf, confidence,
    count: active.length,
  }
}

function computeArvMethods(comps: SoldComp[], sqft: number): ArvMethods | null {
  const active = comps.filter(c => c.selected && !c.excluded)
  if (!active.length) return null

  const avgPpsf = active.reduce((s, c) => s + c.ppsf, 0) / active.length
  const ppsfModel = sqft ? Math.round(avgPpsf * sqft / 1000) * 1000 : Math.round(active.reduce((s, c) => s + c.salePrice, 0) / active.length / 1000) * 1000

  const sorted = [...active].sort((a, b) => a.salePrice - b.salePrice)
  const mid = Math.floor(sorted.length / 2)
  const medianModel = sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1].salePrice + sorted[mid].salePrice) / 2 / 1000) * 1000
    : Math.round(sorted[mid].salePrice / 1000) * 1000

  const simWeights = active.map(c => c.similarity / 100)
  const simTotal = simWeights.reduce((a, b) => a + b, 0)
  const simModel = Math.round(active.reduce((s, c, i) => s + c.salePrice * simWeights[i], 0) / simTotal / 1000) * 1000

  const recWeights = active.map(c => Math.max(0.1, 1 - c.daysAgo / 365))
  const recTotal = recWeights.reduce((a, b) => a + b, 0)
  const recencyModel = Math.round(active.reduce((s, c, i) => s + c.salePrice * recWeights[i], 0) / recTotal / 1000) * 1000

  return { ppsfModel, medianModel, simModel, recencyModel }
}

function computeConfidenceExplanation(comps: SoldComp[], arvStats: ArvStats | null): ConfidenceExplanation | null {
  const active = comps.filter(c => c.selected && !c.excluded)
  if (!active.length || !arvStats) return null

  const strengths: string[] = []
  const weaknesses: string[] = []
  const flags: string[] = []

  if (active.length >= 6) strengths.push(`${active.length} selected comps provide strong statistical support.`)
  else if (active.length <= 3) weaknesses.push(`Only ${active.length} comp${active.length === 1 ? '' : 's'} selected — confidence is limited.`)

  const avgSim = active.reduce((s, c) => s + c.similarity, 0) / active.length
  if (avgSim >= 78) strengths.push('High average similarity — comps closely match subject size and attributes.')
  else if (avgSim < 62) weaknesses.push('Lower average similarity — comps differ from subject in key characteristics.')

  const medianDays = Math.round(computeMedian(active.map(c => c.daysAgo)))
  if (medianDays <= 60) strengths.push(`Median sale recency is ${medianDays}d — comp data is fresh and market-relevant.`)
  else if (medianDays > 120) weaknesses.push(`Median recency ${medianDays}d — some comps may not reflect current market conditions.`)

  const avgDist = computeMedian(active.map(c => c.distance))
  if (avgDist <= 0.35) strengths.push('Comps are tightly clustered near subject property.')
  else if (avgDist > 0.75) weaknesses.push('Higher average comp distance — location comparability may be reduced.')

  const spread = (arvStats.high - arvStats.low) / arvStats.arv
  if (spread < 0.18) strengths.push('Tight price convergence across selected comps — valuation is well-supported.')
  else if (spread > 0.35) flags.push('Wide price spread — consider excluding outlier-priced comps to tighten the range.')

  const outliers = comps.filter(c => c.selected && !c.excluded && (c.salePrice / arvStats.arv > 1.28 || c.salePrice / arvStats.arv < 0.72))
  if (outliers.length) flags.push(`${outliers.length} potential outlier comp${outliers.length === 1 ? '' : 's'} included — may affect accuracy.`)

  return { strengths, weaknesses, flags }
}

// ── Map helpers ────────────────────────────────────────────────────────────

function makeRadiusGeoJson(center: [number, number], radiusMiles: number) {
  const coords: [number, number][] = []
  for (let i = 0; i < 64; i++) {
    const angle = (i / 64) * 2 * Math.PI
    coords.push([
      center[0] + (radiusMiles / (69 * Math.cos((center[1] * Math.PI) / 180))) * Math.sin(angle),
      center[1] + (radiusMiles / 69) * Math.cos(angle),
    ])
  }
  coords.push(coords[0])
  return { type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: [coords] }, properties: {} }
}

function makeHeatmapData(comps: SoldComp[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: comps.map(c => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
      properties: { price: c.salePrice, similarity: c.similarity },
    })),
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StreetviewThumb({ lat, lng, size }: { lat: number; lng: number; size: 'row' | 'popover' | 'subject' }) {
  const [err, setErr] = useState(false)
  const dims = size === 'row' ? '120x80' : size === 'popover' ? '320x180' : '200x130'
  const url = makeStreetviewUrl(lat, lng, dims)
  if (err || !lat || !lng) {
    return <div className={`ci-sv-placeholder ci-sv-placeholder--${size}`} aria-hidden><span>☐</span></div>
  }
  return <img src={url} alt="" className={`ci-sv-img ci-sv-img--${size}`} loading="lazy" onError={() => setErr(true)} />
}

function MetricCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="ci-metric-card">
      <span className="ci-metric-card__label">{label}</span>
      <strong className={`ci-metric-card__value${accent ? ` is-${accent}` : ''}`}>{value}</strong>
    </div>
  )
}

function CompConfidenceBadge({ confidence }: { confidence: number }) {
  const color = confidence >= 78 ? '#34d399' : confidence >= 58 ? '#fbbf24' : '#ef4444'
  const circ = 138.23
  return (
    <div className="ci-conf-badge">
      <svg viewBox="0 0 56 56" aria-label={`Confidence ${confidence}`}>
        <circle cx="28" cy="28" r="22" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
        <circle cx="28" cy="28" r="22" fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${(confidence / 100) * circ} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 28 28)" style={{ transition: 'stroke-dasharray 0.4s, stroke 0.3s' }} />
      </svg>
      <div className="ci-conf-badge__inner">
        <strong>{confidence}</strong>
        <span>/ 100</span>
        <small>CONF</small>
      </div>
    </div>
  )
}

function ArvMethodBreakdown({ methods, blended }: { methods: ArvMethods; blended: number }) {
  const all = [methods.ppsfModel, methods.medianModel, methods.simModel, methods.recencyModel, blended]
  const minV = Math.min(...all)
  const maxV = Math.max(...all)
  const range = Math.max(maxV - minV, 1)
  const pct = (v: number) => Math.max(8, ((v - minV) / range) * 100)

  const rows = [
    { label: 'PPSF Model', value: methods.ppsfModel },
    { label: 'Median Model', value: methods.medianModel },
    { label: 'Similarity Model', value: methods.simModel },
    { label: 'Recency Model', value: methods.recencyModel },
  ]

  return (
    <div className="ci-method-breakdown">
      <div className="ci-section-eyebrow">ARV Method Breakdown</div>
      <div className="ci-method-rows">
        {rows.map(r => (
          <div key={r.label} className="ci-method-row">
            <span className="ci-method-row__label">{r.label}</span>
            <div className="ci-method-row__track">
              <div className="ci-method-row__fill" style={{ width: `${pct(r.value)}%` }} />
            </div>
            <strong className="ci-method-row__val">{fmtK(r.value)}</strong>
          </div>
        ))}
        <div className="ci-method-row is-final">
          <span className="ci-method-row__label">Final Blend</span>
          <div className="ci-method-row__track">
            <div className="ci-method-row__fill is-final" style={{ width: `${pct(blended)}%` }} />
          </div>
          <strong className="ci-method-row__val">{fmtK(blended)}</strong>
        </div>
      </div>
    </div>
  )
}

function MiniChart({
  title,
  bars,
  insight,
  refLine,
}: {
  title: string
  bars: Array<{ id: string; value: number; tone: string }>
  insight: string
  refLine?: { pct: number; label: string }
}) {
  const max = Math.max(...bars.map(b => b.value), 1)
  return (
    <div className="ci-mini-chart">
      <div className="ci-mini-chart__title">{title}</div>
      <div className="ci-mini-chart__plot">
        {bars.map(b => (
          <div key={b.id} className={`ci-mini-chart__bar is-${b.tone}`}
            style={{ height: `${Math.max(5, (b.value / max) * 100)}%` }} />
        ))}
        {refLine && (
          <div className="ci-mini-chart__ref" style={{ bottom: `${refLine.pct}%` }} title={refLine.label} />
        )}
      </div>
      <p className="ci-mini-chart__insight">{insight}</p>
    </div>
  )
}

function ConfidenceCard({ explanation, confidence }: { explanation: ConfidenceExplanation; confidence: number }) {
  const tier = confidence >= 78 ? 'strong' : confidence >= 58 ? 'moderate' : 'weak'
  const tierLabel = tier === 'strong' ? 'Strong Confidence' : tier === 'moderate' ? 'Moderate Confidence' : 'Low Confidence'
  return (
    <div className={`ci-conf-card ci-conf-card--${tier}`}>
      <div className="ci-conf-card__head">
        <div className="ci-conf-card__verdict">Valuation Verdict</div>
        <div className="ci-conf-card__tier">{tierLabel} · {confidence}/100</div>
      </div>
      {explanation.strengths.length > 0 && (
        <div className="ci-conf-section">
          <div className="ci-conf-section__label ci-conf-section__label--strength">Strengths</div>
          {explanation.strengths.map(s => (
            <div key={s} className="ci-conf-item ci-conf-item--strength">
              <span className="ci-conf-item__dot" />{s}
            </div>
          ))}
        </div>
      )}
      {explanation.weaknesses.length > 0 && (
        <div className="ci-conf-section">
          <div className="ci-conf-section__label ci-conf-section__label--weakness">Risks</div>
          {explanation.weaknesses.map(w => (
            <div key={w} className="ci-conf-item ci-conf-item--weakness">
              <span className="ci-conf-item__dot" />{w}
            </div>
          ))}
        </div>
      )}
      {explanation.flags.length > 0 && (
        <div className="ci-conf-section">
          <div className="ci-conf-section__label ci-conf-section__label--flag">Adjustment Flags</div>
          {explanation.flags.map(f => (
            <div key={f} className="ci-conf-item ci-conf-item--flag">
              <span className="ci-conf-item__dot" />{f}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SubjectPropertyStrip({ t, arv, sqft, beds, baths, address, lat, lng }: {
  t: Record<string, unknown>
  arv: number; sqft: number; beds: number; baths: number
  address: string; lat: number; lng: number
}) {
  const yearBuilt = Number(t?.effective_year_built || t?.year_built || 0)
  const lotSqft = Number(t?.lot_square_feet || 0)
  const repairCost = Number(t?.estimatedRepairCost || 0)
  const rehabLevel = String(t?.rehab_level || '')
  const equity = Number(t?.equityPercent || 0)
  const score = Number(t?.finalAcquisitionScore || t?.owner_priority_score || 0)
  const ownerName = String(t?.prospect_full_name || t?.displayName || '')
  const propertyType = String(t?.property_type_majority || t?.style || 'Residential')
  const market = String(t?.market || t?.displayMarket || '')
  const existingSv = String(t?.streetview_image || '')

  return (
    <div className="ci-subject-card">
      <div className="ci-subject-card__img">
        {existingSv
          ? <img src={existingSv} alt="Subject property" className="ci-sv-img ci-sv-img--subject" />
          : <StreetviewThumb lat={lat} lng={lng} size="subject" />}
      </div>
      <div className="ci-subject-card__content">
        <div className="ci-subject-card__top">
          <div className="ci-subject-card__addr-line">
            <span className="ci-subject-card__addr">{address}</span>
            {score > 0 && (
              <span className={`ci-subject-card__score-badge${score >= 70 ? ' is-green' : score >= 50 ? ' is-amber' : ''}`}>
                {Math.round(score)}
              </span>
            )}
          </div>
          <div className="ci-subject-card__specs">
            {sqft > 0 && <span>{sqft.toLocaleString()} sf</span>}
            {beds > 0 && <span>{beds} bd / {baths} ba</span>}
            {yearBuilt > 0 && <span>Built {yearBuilt}</span>}
            {propertyType && <span>{propertyType}</span>}
            {market && <span className="ci-market-badge">{market}</span>}
          </div>
          {ownerName && <div className="ci-subject-card__owner">{ownerName}</div>}
        </div>
        <div className="ci-subject-card__bottom">
          <div className="ci-subject-card__pills">
            {repairCost > 0 && <span className="ci-pill is-amber">Repairs {fmtK(repairCost)}</span>}
            {rehabLevel && <span className="ci-pill is-blue">Rehab {rehabLevel}</span>}
            {equity > 0 && <span className="ci-pill is-green">{Math.round(equity)}% equity</span>}
            {lotSqft > 0 && <span className="ci-pill">Lot {lotSqft.toLocaleString()} sf</span>}
          </div>
          <div className="ci-subject-card__arv">
            <span>Target ARV</span>
            <strong>{arv ? fmt(arv) : '—'}</strong>
          </div>
        </div>
      </div>
    </div>
  )
}

function SoldCompRow({ comp, isHovered, isOpen, arvStats, onEnter, onLeave, onClick, onToggleSelected, onToggleExcluded }: {
  comp: SoldComp
  isHovered: boolean
  isOpen: boolean
  arvStats: ArvStats | null
  onEnter: () => void
  onLeave: () => void
  onClick: () => void
  onToggleSelected: () => void
  onToggleExcluded: () => void
}) {
  const isActive = comp.selected && !comp.excluded
  const contribution = isActive && arvStats
    ? Math.round((comp.salePrice / arvStats.arv) * 100)
    : null

  return (
    <div
      className={[
        'ci-comp-row',
        isActive ? 'is-selected' : '',
        comp.excluded ? 'is-excluded' : '',
        isHovered ? 'is-hover' : '',
        isOpen ? 'is-open' : '',
      ].filter(Boolean).join(' ')}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      aria-pressed={isActive}
      aria-label={`${comp.address}: ${fmt(comp.salePrice)}`}
    >
      {/* Thumbnail */}
      <div className="ci-comp-row__thumb">
        <StreetviewThumb lat={comp.lat} lng={comp.lng} size="row" />
        {isActive && <div className="ci-comp-row__thumb-badge is-in">In ARV</div>}
        {comp.excluded && <div className="ci-comp-row__thumb-badge is-out">Excluded</div>}
      </div>

      {/* Body */}
      <div className="ci-comp-row__body">
        <div className="ci-comp-row__top">
          <span className="ci-comp-row__addr">{comp.address}</span>
          <span className="ci-comp-row__price">{fmt(comp.salePrice)}</span>
        </div>
        <div className="ci-comp-row__specs">
          <span>{comp.sqft.toLocaleString()} sf</span>
          <span>{comp.beds} bd / {comp.baths} ba</span>
          <span>{comp.yearBuilt}</span>
          <span>{fmtPpsf(comp.ppsf)}</span>
          <span className="is-dim">{comp.distance} mi</span>
          <span className="ci-comp-row__date">{comp.daysAgo}d ago</span>
        </div>
        <div className="ci-comp-row__tags">
          <span className={`ci-sim-badge ${comp.similarity >= 80 ? 'is-hi' : comp.similarity >= 65 ? 'is-mid' : 'is-lo'}`}>
            {comp.similarity}/100 sim
          </span>
          <span className={`ci-cond-badge ci-cond-badge--${comp.condition}`}>{comp.condition}</span>
          {contribution !== null && (
            <span className="ci-contrib-badge">{contribution}% ARV weight</span>
          )}
          {comp.excluded && comp.excludeReason && (
            <span className="ci-exclude-reason-badge">{comp.excludeReason}</span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="ci-comp-row__actions">
        <button
          type="button"
          className={`ci-row-btn${isActive ? ' is-on' : ''}`}
          onClick={e => { e.stopPropagation(); onToggleSelected() }}
          aria-label={isActive ? 'Remove from ARV' : 'Add to ARV'}
          title={isActive ? 'Remove from ARV' : 'Add to ARV'}
        >
          {isActive ? '✓' : '+'}
        </button>
        <button
          type="button"
          className={`ci-row-btn is-x${comp.excluded ? ' is-on' : ''}`}
          onClick={e => { e.stopPropagation(); onToggleExcluded() }}
          aria-label={comp.excluded ? 'Unexclude' : 'Exclude'}
          title={comp.excluded ? 'Unexclude' : 'Exclude'}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

function CompDetailPopover({ comp, arvStats, onClose, onToggleSelected, onToggleExcluded }: {
  comp: SoldComp
  arvStats: ArvStats | null
  onClose: () => void
  onToggleSelected: () => void
  onToggleExcluded: () => void
}) {
  const isActive = comp.selected && !comp.excluded
  const contribution = isActive && arvStats ? Math.round((comp.salePrice / arvStats.arv) * 100) : null

  const details: [string, string][] = [
    ['Sale Price', fmt(comp.salePrice)],
    ['Sale Date', comp.saleDate],
    ['PPSF', fmtPpsf(comp.ppsf)],
    ['Sqft', comp.sqft.toLocaleString()],
    ['Beds / Baths', `${comp.beds} bd / ${comp.baths} ba`],
    ['Year Built', String(comp.yearBuilt)],
    ['Condition', comp.condition.charAt(0).toUpperCase() + comp.condition.slice(1)],
    ['Distance', `${comp.distance} mi`],
    ['Days on Market', `${comp.daysAgo}d ago`],
    ['Similarity', `${comp.similarity}/100`],
    ...(contribution !== null ? [['ARV Contribution', `${contribution}%`] as [string, string]] : []),
  ]

  return (
    <div className="ci-detail-popover">
      <div className="ci-detail-popover__img">
        <StreetviewThumb lat={comp.lat} lng={comp.lng} size="popover" />
        <div className={`ci-detail-popover__state-badge ${isActive ? 'is-in' : comp.excluded ? 'is-out' : 'is-neutral'}`}>
          {isActive ? 'In ARV Calc' : comp.excluded ? 'Excluded' : 'Not Selected'}
        </div>
      </div>
      <div className="ci-detail-popover__head">
        <div>
          <strong>{comp.address}</strong>
          <span>{fmt(comp.salePrice)} · {comp.saleDate}</span>
        </div>
        <button type="button" className="ci-popover__close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="ci-detail-popover__body">
        {details.map(([label, value]) => (
          <div key={label} className="ci-detail-popover__row">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="ci-detail-popover__actions">
        <button
          type="button"
          className={`ci-pop-action${isActive ? ' is-on' : ''}`}
          onClick={() => { onToggleSelected(); onClose() }}
        >
          {isActive ? '✓ Included in ARV' : '+ Include in ARV'}
        </button>
        <button
          type="button"
          className={`ci-pop-action is-exclude${comp.excluded ? ' is-on' : ''}`}
          onClick={() => { onToggleExcluded(); onClose() }}
        >
          {comp.excluded ? 'Unexclude' : '✕ Exclude'}
        </button>
      </div>
    </div>
  )
}

function ArvEnginePanel({ comps, arvStats, sqft, radius, lastCalcTime }: {
  comps: SoldComp[]
  arvStats: ArvStats | null
  sqft: number
  radius: RadiusMiles
  lastCalcTime: Date | null
}) {
  const active = comps.filter(c => c.selected && !c.excluded)
  const methods = useMemo(() => computeArvMethods(comps, sqft), [comps, sqft])
  const confidenceExplanation = useMemo(() => computeConfidenceExplanation(comps, arvStats), [comps, arvStats])

  const selectedCount = active.length
  const excludedCount = comps.filter(c => c.excluded).length
  const medianSalePrice = computeMedian(active.map(c => c.salePrice))
  const medianDistance = computeMedian(active.map(c => c.distance))
  const medianRecency = Math.round(computeMedian(active.map(c => c.daysAgo)))
  const avgSimilarity = active.length ? Math.round(active.reduce((s, c) => s + c.similarity, 0) / active.length) : 0

  const basisText = arvStats
    ? `Based on ${selectedCount} selected comp${selectedCount === 1 ? '' : 's'} · ${radius}mi radius · median recency ${medianRecency}d ago`
    : 'Select comps above to calculate ARV'

  // ── Chart data ────────────────────────────────────────────────────────────

  const priceBars = comps.map(c => ({
    id: c.id, value: c.salePrice,
    tone: c.excluded ? 'excluded' : c.selected ? 'selected' : 'neutral',
  }))
  const priceBarsWithArv = [
    ...priceBars,
    { id: 'arv', value: arvStats?.arv || 0, tone: 'subject' },
  ]

  const ppsfBars = comps.map(c => ({
    id: c.id, value: c.ppsf,
    tone: c.excluded ? 'excluded' : c.selected ? 'selected' : 'neutral',
  }))
  const ppsfMax = Math.max(...ppsfBars.map(b => b.value), 1)
  const ppsfRefPct = arvStats && sqft ? Math.max(0, Math.min(98, (arvStats.arvPpsf / ppsfMax) * 100)) : undefined

  const recencyBars = comps.map(c => ({
    id: c.id, value: Math.max(1, 1000 - c.daysAgo * 2),
    tone: c.excluded ? 'excluded' : c.selected ? 'selected' : 'neutral',
  }))

  const simBars = comps.map(c => ({
    id: c.id, value: c.similarity,
    tone: c.excluded ? 'excluded' : c.selected ? 'selected' : 'neutral',
  }))

  const distBars = comps.map(c => ({
    id: c.id, value: Math.max(1, Math.round((1.6 - c.distance) * 100)),
    tone: c.excluded ? 'excluded' : c.selected ? 'selected' : 'neutral',
  }))

  const contribBars = active.map(c => ({
    id: c.id, value: c.salePrice, tone: 'selected',
  }))
  if (arvStats) contribBars.push({ id: 'arv', value: arvStats.arv, tone: 'subject' })

  // Chart insight lines
  const ppsfMin = active.length ? Math.min(...active.map(c => c.ppsf)) : 0
  const ppsfMaxA = active.length ? Math.max(...active.map(c => c.ppsf)) : 0
  const ppsfInsight = active.length
    ? `Selected comps span $${ppsfMin}–$${ppsfMaxA}/sf.${arvStats ? ` ARV implies $${arvStats.arvPpsf}/sf.` : ''}`
    : 'Select comps to see PPSF spread.'

  const priceInsight = active.length
    ? `${active.length} comp${active.length === 1 ? '' : 's'} support the ${fmtK(arvStats?.arv || 0)} estimate.`
    : 'Select comps to see price distribution.'

  const recencyInsight = active.length
    ? medianRecency <= 60
      ? `Median recency ${medianRecency}d — very fresh data.`
      : medianRecency <= 120
        ? `Median recency ${medianRecency}d — reasonably current.`
        : `Median recency ${medianRecency}d — some comps may be stale.`
    : 'Newer comps receive higher weighting.'

  const simInsight = active.length
    ? avgSimilarity >= 78
      ? `Avg similarity ${avgSimilarity}/100 — strong match to subject.`
      : avgSimilarity >= 62
        ? `Avg similarity ${avgSimilarity}/100 — moderate comparability.`
        : `Avg similarity ${avgSimilarity}/100 — consider better-matched comps.`
    : 'Similarity measures property match quality.'

  const avgDist = active.length ? Math.round(computeMedian(active.map(c => c.distance)) * 10) / 10 : 0
  const distInsight = active.length
    ? `Selected comps average ${avgDist}mi from subject property.`
    : 'Closer comps receive stronger distance weighting.'

  const contribInsight = active.length
    ? active.length === 1
      ? 'Single comp drives 100% of the ARV estimate.'
      : `Top comp contributes ~${Math.round((Math.max(...active.map(c => c.salePrice)) / (arvStats?.arv || 1)) * 100)}% of the blended ARV.`
    : 'Select comps to see their relative ARV contribution.'

  return (
    <div className="ci-arv-engine">
      {/* ── ARV Hero ─────────────────────────────────────────────────────── */}
      <div className="ci-arv-engine__hero">
        <div className="ci-arv-engine__hero-left">
          <div className="ci-eyebrow">Estimated ARV</div>
          <div className="ci-arv-value">{arvStats ? fmt(arvStats.arv) : '—'}</div>
          {arvStats && (
            <div className="ci-arv-range">Range {fmtK(arvStats.low)} – {fmtK(arvStats.high)}</div>
          )}
          <div className="ci-arv-basis">{basisText}</div>
          {lastCalcTime && (
            <div className="ci-arv-last-calc">Recalculated {formatRelativeMin(lastCalcTime)}</div>
          )}
        </div>
        <CompConfidenceBadge confidence={arvStats?.confidence ?? 0} />
      </div>

      {/* ── Metrics row ──────────────────────────────────────────────────── */}
      <div className="ci-metrics-row">
        <MetricCard label="Selected" value={String(selectedCount)} accent="green" />
        <MetricCard label="Excluded" value={String(excludedCount)} accent="amber" />
        <MetricCard label="Avg PPSF" value={arvStats ? fmtPpsf(arvStats.avgPpsf) : '—'} />
        <MetricCard label="ARV PPSF" value={arvStats && sqft ? fmtPpsf(arvStats.arvPpsf) : '—'} />
        <MetricCard label="Median Price" value={medianSalePrice ? fmtK(medianSalePrice) : '—'} />
        <MetricCard label="Median Dist" value={medianDistance ? `${Math.round(medianDistance * 10) / 10}mi` : '—'} />
        <MetricCard label="Med Recency" value={medianRecency ? `${medianRecency}d` : '—'} />
        <MetricCard label="Avg Sim" value={avgSimilarity ? `${avgSimilarity}/100` : '—'} />
      </div>

      {/* ── Method breakdown ─────────────────────────────────────────────── */}
      {methods && arvStats && <ArvMethodBreakdown methods={methods} blended={arvStats.arv} />}

      {/* ── Charts ───────────────────────────────────────────────────────── */}
      <div className="ci-section-eyebrow ci-section-eyebrow--charts">Valuation Charts</div>
      <div className="ci-charts-grid">
        <MiniChart title="PPSF Distribution" bars={ppsfBars} insight={ppsfInsight}
          refLine={ppsfRefPct !== undefined ? { pct: ppsfRefPct, label: `ARV PPSF $${arvStats?.arvPpsf}/sf` } : undefined} />
        <MiniChart title="Sale Price" bars={priceBarsWithArv} insight={priceInsight} />
        <MiniChart title="Recency Weight" bars={recencyBars} insight={recencyInsight} />
        <MiniChart title="Similarity Score" bars={simBars} insight={simInsight} />
        <MiniChart title="Distance Decay" bars={distBars} insight={distInsight} />
        <MiniChart title="ARV Contribution" bars={contribBars.length ? contribBars : ppsfBars.slice(0, 3)} insight={contribInsight} />
      </div>

      {/* ── Confidence card ───────────────────────────────────────────────── */}
      {confidenceExplanation && <ConfidenceCard explanation={confidenceExplanation} confidence={arvStats?.confidence ?? 0} />}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function CompIntelligenceWorkspace({ thread }: { thread: InboxWorkflowThread | null }) {
  const t = thread as unknown as Record<string, unknown>

  const arv = Number(t?.estimatedValue || t?.arv || 0)
  const sqft = Number(t?.building_square_feet || t?.sqft || 1800)
  const beds = Number(t?.total_bedrooms || t?.beds || 3)
  const baths = Number(t?.total_baths || t?.baths || 2)
  const lat = Number(t?.latitude || t?.lat || 0)
  const lng = Number(t?.longitude || t?.lng || 0)
  const address = String(t?.propertyAddress || t?.property_address || t?.subject || 'Subject Property')
  const hasCoords = Math.abs(lat) > 0.001 && Math.abs(lng) > 0.001

  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const subjectMarkerRef = useRef<maplibregl.Marker | null>(null)
  const [mapReady, setMapReady] = useState(false)

  const [mapMode, setMapMode] = useState<MapMode>('sold_comps')
  const [radius, setRadius] = useState<RadiusMiles>(0.5)
  const [comps, setComps] = useState<SoldComp[]>([])
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [openCompId, setOpenCompId] = useState<string | null>(null)
  const [lastCalcTime, setLastCalcTime] = useState<Date | null>(null)

  const threadSeed = useMemo(() => makeHashSeed(String(t?.id || t?.thread_key || 'default')), [t?.id, t?.thread_key])
  const rawComps = useMemo(
    () => arv ? generateComps(arv, sqft, beds, baths, lat || 33.749, lng || -84.388, 9, threadSeed) : [],
    [arv, sqft, beds, baths, lat, lng, threadSeed],
  )

  useEffect(() => { setComps(rawComps) }, [rawComps])

  const arvStats = useMemo(() => computeArvStats(comps, sqft), [comps, sqft])
  const prevArv = useRef<number | null>(null)
  useEffect(() => {
    if (arvStats && arvStats.arv !== prevArv.current) {
      setLastCalcTime(new Date())
      prevArv.current = arvStats.arv
    }
  }, [arvStats?.arv])

  const hoveredComp = useMemo(() => comps.find(c => c.id === hoveredId) ?? null, [comps, hoveredId])
  const openComp = useMemo(() => comps.find(c => c.id === openCompId) ?? null, [comps, openCompId])

  const toggleSelected = useCallback((id: string) => {
    setComps(prev => prev.map(c => c.id === id ? { ...c, selected: !c.selected, excluded: false } : c))
    setOpenCompId(null)
  }, [])

  const toggleExcluded = useCallback((id: string) => {
    setComps(prev => prev.map(c => c.id === id ? { ...c, excluded: !c.excluded, selected: c.excluded ? false : c.selected } : c))
    setOpenCompId(null)
  }, [])

  // ── Map init ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!mapRef.current || !hasCoords) return
    const map = new maplibregl.Map({
      container: mapRef.current, style: DARK_MAP_STYLE,
      center: [lng, lat], zoom: 13.5,
      attributionControl: false, pitchWithRotate: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
    map.on('load', () => {
      const subEl = document.createElement('div')
      subEl.className = 'ci-subject-pin'
      subEl.setAttribute('aria-label', `Subject: ${address}`)
      subEl.innerHTML = '★'
      subjectMarkerRef.current = new maplibregl.Marker({ element: subEl }).setLngLat([lng, lat]).addTo(map)

      map.addSource('ci-radius', { type: 'geojson', data: makeRadiusGeoJson([lng, lat], 0.5) })
      map.addLayer({ id: 'ci-radius-fill', type: 'fill', source: 'ci-radius', paint: { 'fill-color': 'rgba(82,138,236,0.04)' } })
      map.addLayer({ id: 'ci-radius-line', type: 'line', source: 'ci-radius', paint: { 'line-color': 'rgba(82,138,236,0.45)', 'line-width': 1.5, 'line-dasharray': [4, 3] } })

      map.addSource('ci-heatmap', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'ci-heatmap-layer', type: 'heatmap', source: 'ci-heatmap',
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'price'], 0, 0, 1500000, 1],
          'heatmap-intensity': 0.9,
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)', 0.15, 'rgba(16,50,130,0.45)', 0.4, 'rgba(40,110,240,0.65)',
            0.7, 'rgba(60,200,255,0.75)', 1, 'rgba(120,255,200,0.85)'],
          'heatmap-radius': 55, 'heatmap-opacity': 0,
        },
      })
      setMapReady(true)
    })
    mapInstanceRef.current = map
    return () => {
      markersRef.current.forEach(m => m.remove()); markersRef.current.clear()
      subjectMarkerRef.current?.remove(); subjectMarkerRef.current = null
      setMapReady(false); map.remove(); mapInstanceRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, hasCoords])

  // ── Sync markers ────────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !mapReady) return
    markersRef.current.forEach(m => m.remove()); markersRef.current.clear()

    comps.forEach(comp => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = ['ci-comp-pin', comp.selected && !comp.excluded ? 'is-selected' : '', comp.excluded ? 'is-excluded' : ''].filter(Boolean).join(' ')
      el.setAttribute('aria-label', `${comp.address}: ${fmt(comp.salePrice)}`)
      el.innerHTML = `<span>${fmtK(comp.salePrice)}</span>`
      el.addEventListener('mouseenter', () => setHoveredId(comp.id))
      el.addEventListener('mouseleave', () => setHoveredId(null))
      el.addEventListener('click', e => { e.stopPropagation(); setOpenCompId(p => p === comp.id ? null : comp.id) })
      markersRef.current.set(comp.id, new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([comp.lng, comp.lat]).addTo(map))
    })

    const heatSrc = map.getSource('ci-heatmap') as maplibregl.GeoJSONSource | undefined
    heatSrc?.setData(makeHeatmapData(comps))
    const opacity = mapMode === 'heat_map' ? 0.88 : mapMode === 'hybrid' ? 0.55 : 0
    if (map.getLayer('ci-heatmap-layer')) map.setPaintProperty('ci-heatmap-layer', 'heatmap-opacity', opacity)
  }, [comps, mapReady, mapMode])

  // ── Radius sync ─────────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !mapReady) return
    ;(map.getSource('ci-radius') as maplibregl.GeoJSONSource | undefined)?.setData(makeRadiusGeoJson([lng, lat], radius))
  }, [radius, lat, lng, mapReady])

  // ── Style switch ─────────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !mapReady) return
    const style = mapMode === 'hybrid' ? SATELLITE_STYLE : DARK_MAP_STYLE
    map.setStyle(style)
    map.once('styledata', () => {
      if (!map.getSource('ci-radius')) {
        map.addSource('ci-radius', { type: 'geojson', data: makeRadiusGeoJson([lng, lat], radius) })
        map.addLayer({ id: 'ci-radius-fill', type: 'fill', source: 'ci-radius', paint: { 'fill-color': 'rgba(82,138,236,0.04)' } })
        map.addLayer({ id: 'ci-radius-line', type: 'line', source: 'ci-radius', paint: { 'line-color': 'rgba(82,138,236,0.45)', 'line-width': 1.5, 'line-dasharray': [4, 3] } })
      }
      if (!map.getSource('ci-heatmap')) {
        map.addSource('ci-heatmap', { type: 'geojson', data: makeHeatmapData(comps) })
        map.addLayer({ id: 'ci-heatmap-layer', type: 'heatmap', source: 'ci-heatmap', paint: { 'heatmap-opacity': mapMode === 'heat_map' ? 0.88 : mapMode === 'hybrid' ? 0.55 : 0, 'heatmap-radius': 55, 'heatmap-intensity': 0.9 } })
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapMode])

  // ── Empty state ─────────────────────────────────────────────────────────

  if (!arv) {
    return (
      <div className="ci-workspace ci-workspace--empty">
        <div className="ci-empty-state">
          <div className="ci-empty-state__icon">◉</div>
          <strong>Comp Workspace Staged</strong>
          <p>Set an estimated value (ARV) on this deal to unlock the sold comp workspace — interactive map, heat map, ARV engine, and distribution charts.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="ci-workspace">
      {/* ── Map column ───────────────────────────────────────────────────── */}
      <div className="ci-workspace__map-col">
        {hasCoords
          ? <div ref={mapRef} className="ci-map-canvas" />
          : <div className="ci-map-canvas ci-map-no-coords-wrap"><span>No coordinates on file</span><p>Enrich address data to enable map.</p></div>}

        {/* Map controls */}
        <div className="ci-map-controls">
          <div className="ci-map-control-group" role="group" aria-label="Map mode">
            {(['sold_comps', 'heat_map', 'hybrid'] as MapMode[]).map(mode => (
              <button key={mode} type="button" className={`ci-map-ctrl-btn${mapMode === mode ? ' is-active' : ''}`} onClick={() => setMapMode(mode)}>
                {mode === 'sold_comps' ? 'Comps' : mode === 'heat_map' ? 'Heat Map' : 'Hybrid'}
              </button>
            ))}
          </div>
          <div className="ci-map-control-group" role="group" aria-label="Radius">
            {([0.25, 0.5, 1, 1.5] as RadiusMiles[]).map(r => (
              <button key={r} type="button" className={`ci-map-ctrl-btn${radius === r ? ' is-active' : ''}`} onClick={() => setRadius(r)}>
                {r}mi
              </button>
            ))}
          </div>
        </div>

        {/* Hover tooltip */}
        {hoveredComp && !openCompId && (
          <div className="ci-tooltip" role="tooltip">
            <strong className="ci-tooltip__addr">{hoveredComp.address}</strong>
            <div className="ci-tooltip__grid">
              <span>Sale Price</span><strong>{fmt(hoveredComp.salePrice)}</strong>
              <span>Sold</span><strong>{hoveredComp.daysAgo}d ago</strong>
              <span>Distance</span><strong>{hoveredComp.distance} mi</strong>
              <span>PPSF</span><strong>{fmtPpsf(hoveredComp.ppsf)}</strong>
              <span>Size</span><strong>{hoveredComp.sqft.toLocaleString()} sf</strong>
              <span>Beds / Baths</span><strong>{hoveredComp.beds} bd / {hoveredComp.baths} ba</strong>
              <span>Similarity</span>
              <strong className={hoveredComp.similarity >= 80 ? 'is-hi' : hoveredComp.similarity >= 65 ? 'is-mid' : ''}>
                {hoveredComp.similarity}/100
              </strong>
            </div>
          </div>
        )}

        {/* Detail popover */}
        {openComp && (
          <CompDetailPopover
            comp={openComp}
            arvStats={arvStats}
            onClose={() => setOpenCompId(null)}
            onToggleSelected={() => toggleSelected(openComp.id)}
            onToggleExcluded={() => toggleExcluded(openComp.id)}
          />
        )}
      </div>

      {/* ── Right panel ─────────────────────────────────────────────────── */}
      <div className="ci-panel">
        {/* Subject property strip */}
        <SubjectPropertyStrip t={t} arv={arv} sqft={sqft} beds={beds} baths={baths} address={address} lat={lat} lng={lng} />

        {/* ARV engine panel */}
        <ArvEnginePanel comps={comps} arvStats={arvStats} sqft={sqft} radius={radius} lastCalcTime={lastCalcTime} />

        {/* Comp list */}
        <div className="ci-list-section">
          <div className="ci-list-head">
            <span>SOLD COMPS</span>
            <span>{comps.length} total · {comps.filter(c => c.selected && !c.excluded).length} in ARV</span>
          </div>
          <div className="ci-list">
            {comps.map(comp => (
              <SoldCompRow
                key={comp.id}
                comp={comp}
                isHovered={hoveredId === comp.id}
                isOpen={openCompId === comp.id}
                arvStats={arvStats}
                onEnter={() => setHoveredId(comp.id)}
                onLeave={() => setHoveredId(null)}
                onClick={() => setOpenCompId(p => p === comp.id ? null : comp.id)}
                onToggleSelected={() => toggleSelected(comp.id)}
                onToggleExcluded={() => toggleExcluded(comp.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
