import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection, Point } from 'geojson'
import type { ThreadMessage } from '../../lib/data/inboxData'
import type { InboxWorkflowThread } from '../../lib/data/inboxWorkflowData'
import type { MapSourceMode } from './inbox-layout-state'
import { buildConversationDecision } from './inbox-decisioning'
import { buildStreetViewUrl } from './inbox-normalization'
import { formatRelativeTime } from '../../shared/formatters'
import { Icon } from '../../shared/icons'

const DARK_MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const CARTO_GLYPHS_URL = 'https://basemaps.cartocdn.com/gl/positron-gl-style/fonts/{fontstack}/{range}.pbf'
const CARTO_SPRITE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/sprite'
const SATELLITE_MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: CARTO_GLYPHS_URL,
  sprite: CARTO_SPRITE_URL,
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Esri World Imagery',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'satellite',
      type: 'raster',
      source: 'satellite',
    },
  ],
}

const RAW_SOURCE_ID = 'command-pins-raw'
const CLUSTER_SOURCE_ID = 'command-pins-clustered'
const RAW_LAYER_IDS = [
  'command-pin-glow-raw',
  'command-pin-pulse-raw',
  'command-pin-unread-ring-raw',
  'command-pin-offer-ring-raw',
  'command-pin-contract-ring-raw',
  'command-pin-core-raw',
  'command-pin-warning-badge-raw',
] as const
const CLUSTER_POINT_LAYER_IDS = [
  'command-pin-glow-clustered',
  'command-pin-pulse-clustered',
  'command-pin-unread-ring-clustered',
  'command-pin-offer-ring-clustered',
  'command-pin-contract-ring-clustered',
  'command-pin-core-clustered',
  'command-pin-warning-badge-clustered',
] as const
const CLUSTER_LAYER_IDS = [
  'command-pin-cluster-glow',
  'command-pin-cluster-core',
  'command-pin-cluster-count',
] as const
export type MapStyleMode = 'dark' | 'satellite' | 'red'
export type MapOverlayToggles = {
  roads: boolean
  cities: boolean
  poi: boolean
  zip: boolean
}

type StyleLayerLike = maplibregl.LayerSpecification & {
  id: string
  type: string
  source?: string
  'source-layer'?: string
  layout?: Record<string, unknown>
  paint?: Record<string, unknown>
}

export type InboxMapActivityMode = 'all' | 'threads' | 'sends' | 'follow_ups'

type ThreadMapState = 'new_replies' | 'needs_review' | 'waiting_on_seller' | 'negotiating' | 'follow_up_due' | 'suppressed'
type SendMapState = 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'replied' | 'opted_out' | 'queue_blocked'
type FollowUpMapState = 'due_now' | 'due_later_today' | 'due_tomorrow' | 'overdue' | 'stale_no_response'
type PinActivityState = ThreadMapState | SendMapState | FollowUpMapState

export type MapFilterState = {
  market: string
  stage: string
  status: string
  leadTemperature: string
  automationStatus: string
  messageDirection: string
  unreadOnly: boolean
  followUpDue: boolean
  highEquity: boolean
  propertyType: string
  offerStatus: string
  contractStatus: string
  suppressionStatus: string
  dateRange: string
}

type UnmappedItem = {
  id: string
  conversation_id: string
  seller_name: string
  address: string
  reason: 'missing_coordinates'
}

type CommandMapPin = {
  id: string
  conversation_id: string
  property_id: string
  master_owner_id: string
  seller_name: string
  address: string
  city: string
  state: string
  zip: string
  lat: number
  lng: number
  market: string
  property_type: string
  beds: number | null
  baths: number | null
  sqft: number | null
  units: number | null
  estimated_value: number | null
  equity_percent: number | null
  repair_estimate: number | null
  streetview_image: string | null
  last_message: string
  last_message_direction: 'inbound' | 'outbound' | 'unknown'
  last_activity_at: string
  unread: boolean
  conversation_stage: string
  conversation_status: string
  inbox_bucket: string
  lead_temperature: string
  priority_score: number
  automation_status: string
  suppression_status: string
  next_action: string
  offer_status: string
  contract_status: string
  next_follow_up_at: string | null
  review_reason: string | null
  confidence: number
  last_inbound_at: string | null
  last_outbound_at: string | null
  queue_status: string | null
  delivery_status: string | null
  activity_mode: InboxMapActivityMode
  activity_state: PinActivityState
  activity_label: string
}

type PinFeatureProps = CommandMapPin & {
  featureType: 'pin' | 'market_cluster'
  selected: 0 | 1
  focusOpacity: number
  stageColor: string
  pulseTier: 'fast' | 'medium_fast' | 'medium' | 'slow' | 'very_slow' | 'none'
  pulseMode: 'none' | 'continuous' | 'ripple' | 'triple'
  glowStrength: number
  unreadRingColor: string
  offerRingColor: string
  contractRingColor: string
  badgeColor: string
  pinCount: number
  lockState: 0 | 1
  needsReviewBadge: 0 | 1
  followUpDueBadge: 0 | 1
  suppressedBadge: 0 | 1
  queueBlockedBadge: 0 | 1
}

type MapKpiFilterKey =
  | ThreadMapState
  | SendMapState
  | FollowUpMapState
  | 'contract_active'
  | 'offer_ready'

type MapKpiChip = {
  key: MapKpiFilterKey
  label: string
  count: number
  tone: string
}

type TickerDensity = 'minimal' | 'compact' | 'expanded'

type LiveTickerItem = {
  id: string
  threadId: string
  lng: number
  lat: number
  eventType:
    | 'new_reply'
    | 'hot_lead'
    | 'needs_review'
    | 'send_queued'
    | 'send_sent'
    | 'send_delivered'
    | 'send_failed'
    | 'follow_up_due'
    | 'follow_up_scheduled'
    | 'suppressed'
    | 'opt_out'
    | 'price_given'
    | 'offer_requested'
    | 'underwriting_complete'
  badge: string
  sellerName: string
  location: string
  timeAgo: string
  timestamp: string
  preview?: string
  address?: string
  statusLabel?: string
  stageLabel?: string
  tone: 'accent' | 'danger' | 'success' | 'warning' | 'neutral' | 'premium'
  disabledReply?: boolean
  detailLabel?: string
}

const cls = (...tokens: Array<string | false | null | undefined>) => tokens.filter(Boolean).join(' ')
const text = (value: unknown): string => String(value ?? '').trim()
const lower = (value: unknown): string => text(value).toLowerCase()
const num = (value: unknown): number | null => {
  const n = Number(String(value ?? '').replace(/[,$\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

const stageColor = (pin: CommandMapPin): string => {
  if (pin.activity_state === 'queued') return '#5d6a7b'
  if (pin.activity_state === 'sending' || pin.activity_state === 'sent') return '#3b82f6'
  if (pin.activity_state === 'delivered') return '#30d158'
  if (pin.activity_state === 'failed' || pin.activity_state === 'opted_out' || pin.activity_state === 'queue_blocked') return '#ff453a'
  if (pin.activity_state === 'replied') return '#38bdf8'
  if (pin.activity_state === 'overdue') return '#ff453a'
  if (pin.activity_state === 'due_now') return '#ffb000'
  if (pin.activity_state === 'due_later_today') return '#5bb6ff'
  if (pin.activity_state === 'due_tomorrow') return '#14b8a6'
  if (pin.activity_state === 'stale_no_response') return '#7d8795'
  if (pin.suppression_status !== 'clear') return '#ff453a'
  const stage = lower(pin.conversation_stage)
  if (stage.includes('contract')) return '#14b8a6'
  if (stage.includes('offer_ready') || stage.includes('offer_sent') || stage.includes('offer')) return '#30d158'
  if (stage.includes('negotiat') || stage.includes('seller_counter')) return '#ffb000'
  if (stage.includes('price_received')) return '#a855f7'
  if (stage.includes('price_discussion') || stage.includes('underwriting')) return '#a855f7'
  if (stage.includes('interest') || stage.includes('ownership')) return '#38bdf8'
  if (stage.includes('new')) return '#97a3b6'
  return '#97a3b6'
}

const glowStrength = (priorityScore: number): number => {
  if (priorityScore >= 90) return 1
  if (priorityScore >= 70) return 0.8
  if (priorityScore >= 40) return 0.52
  return 0.2
}

const badgeColor = (pin: CommandMapPin): string => {
  if (pin.suppression_status !== 'clear') return '#ff453a'
  if (lower(pin.contract_status).includes('active')) return '#14b8a6'
  if (lower(pin.offer_status).includes('ready')) return '#30d158'
  return stageColor(pin)
}

const pulseModeFor = (pin: CommandMapPin): PinFeatureProps['pulseMode'] => {
  if (pin.activity_state === 'sending') return 'continuous'
  if (pin.activity_state === 'sent' || pin.activity_state === 'delivered' || pin.activity_state === 'replied' || pin.activity_state === 'opted_out') return 'ripple'
  if (pin.activity_state === 'failed') return 'triple'
  if (pin.activity_state === 'overdue' || pin.activity_state === 'due_now') return 'continuous'
  if (pin.activity_state === 'due_later_today' || pin.activity_state === 'due_tomorrow') return 'ripple'
  if (pin.activity_mode === 'follow_ups' || pin.activity_mode === 'sends') return 'none'
  return pulseTierFor(pin.last_activity_at) === 'none' ? 'none' : 'continuous'
}

const pulseTierFor = (lastActivityAt: string): PinFeatureProps['pulseTier'] => {
  const ts = new Date(lastActivityAt).getTime()
  if (!Number.isFinite(ts)) return 'none'
  const ageMinutes = (Date.now() - ts) / 60000
  if (ageMinutes <= 5) return 'fast'
  if (ageMinutes <= 30) return 'medium_fast'
  if (ageMinutes <= 240) return 'medium'
  if (ageMinutes <= 1440) return 'slow'
  if (ageMinutes <= 10080) return 'very_slow'
  return 'none'
}

const isValidCoord = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0 && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180

const formatLabel = (value: string): string => value.replace(/_/g, ' ')
const minutesBetween = (older: string | null, newer = new Date().toISOString()): number | null => {
  if (!older) return null
  const a = new Date(older).getTime()
  const b = new Date(newer).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return (b - a) / 60000
}
const sameDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()
const dayKey = (value: Date): string => `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`
const formatPercent = (value: number): string => {
  if (!Number.isFinite(value) || value < 0 || value > 100) return '—'
  return `${Math.round(value * 10) / 10}%`
}
const formatRelative = (value: string | null): string => {
  if (!value) return 'Unknown'
  const deltaMinutes = minutesBetween(value)
  if (deltaMinutes === null) return 'Unknown'
  if (deltaMinutes < 1) return 'Just now'
  if (deltaMinutes < 60) return `${Math.max(1, Math.floor(deltaMinutes))}m ago`
  if (deltaMinutes < 1440) return `${Math.floor(deltaMinutes / 60)}h ago`
  return `${Math.floor(deltaMinutes / 1440)}d ago`
}
const formatCurrency = (value: number | null): string => {
  if (!Number.isFinite(value ?? NaN)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value as number)
}

const defaultMapOverlays: MapOverlayToggles = {
  roads: true,
  cities: true,
  poi: true,
  zip: true,
}

let darkStyleSpecPromise: Promise<maplibregl.StyleSpecification | null> | null = null

const fetchDarkStyleSpec = async (): Promise<maplibregl.StyleSpecification | null> => {
  if (!darkStyleSpecPromise) {
    darkStyleSpecPromise = fetch(DARK_MAP_STYLE)
      .then(async (response) => {
        if (!response.ok) return null
        return await response.json() as maplibregl.StyleSpecification
      })
      .catch(() => null)
  }
  return darkStyleSpecPromise
}

const ownLayerPrefix = 'command-pin-'
const hybridLayerPrefix = 'nx-icm-hybrid-'

const classifyBaseLayer = (layer: StyleLayerLike): Array<keyof MapOverlayToggles> => {
  const id = lower(layer.id)
  const sourceLayer = lower(layer['source-layer'])
  const token = `${id} ${sourceLayer}`
  const matches: Array<keyof MapOverlayToggles> = []

  const isRoad =
    layer.type === 'line'
    || token.includes('road')
    || token.includes('street')
    || token.includes('highway')
    || token.includes('transport')
    || token.includes('bridge')
    || token.includes('tunnel')
  if (isRoad) matches.push('roads')

  const isCity =
    layer.type === 'symbol'
    && (
      token.includes('place')
      || token.includes('settlement')
      || token.includes('city')
      || token.includes('town')
      || token.includes('village')
      || token.includes('state_label')
      || token.includes('country_label')
    )
  if (isCity) matches.push('cities')

  const isPoi =
    layer.type === 'symbol'
    && (
      token.includes('poi')
      || token.includes('landmark')
      || token.includes('attraction')
      || token.includes('transit_stop')
      || token.includes('airport')
      || token.includes('railway')
    )
  if (isPoi) matches.push('poi')

  const isZip =
    layer.type === 'symbol'
    && (
      token.includes('postal')
      || token.includes('postcode')
      || token.includes('zip')
    )
  if (isZip) matches.push('zip')

  return matches
}

const cloneLayerWithId = (layer: StyleLayerLike, id: string): StyleLayerLike => {
  return {
    ...layer,
    id,
    layout: layer.layout ? { ...layer.layout } : undefined,
    paint: layer.paint ? { ...layer.paint } : undefined,
  }
}

const hybridOverlayLayerId = (layerId: string) => `${hybridLayerPrefix}${layerId}`
const formatInteger = (value: number | null): string => {
  if (!Number.isFinite(value ?? NaN)) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value as number)
}
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const getLat = (thread: InboxWorkflowThread): number => Number((thread as any).lat ?? (thread as any).latitude ?? 0)
const getLng = (thread: InboxWorkflowThread): number => Number((thread as any).lng ?? (thread as any).longitude ?? 0)
const get = (thread: InboxWorkflowThread, ...keys: string[]): unknown => {
  const row = thread as unknown as Record<string, unknown>
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && `${value}`.trim() !== '') return value
  }
  return undefined
}

const buildMapPin = (thread: InboxWorkflowThread): { pin: CommandMapPin | null; unmapped: UnmappedItem | null } => {
  const lat = getLat(thread)
  const lng = getLng(thread)
  const decision = buildConversationDecision(thread)
  const base = {
    id: thread.id,
    conversation_id: thread.id,
    property_id: text(get(thread, 'propertyId', 'property_id')),
    master_owner_id: text(get(thread, 'ownerId', 'master_owner_id')),
    seller_name: text(get(thread, 'ownerName', 'sellerName', 'ownerDisplayName')) || 'Unknown Seller',
    address: text(get(thread, 'propertyAddress', 'propertyAddressFull', 'subject')) || 'Unknown Address',
    city: text(get(thread, 'property_address_city', 'city')),
    state: text(get(thread, 'property_address_state', 'state')),
    zip: text(get(thread, 'property_address_zip', 'zip')),
    lat,
    lng,
    market: text(get(thread, 'market', 'marketName', 'marketId')) || 'Unknown',
    property_type: text(get(thread, 'propertyType', 'property_type', 'propertyClass')) || 'Unknown',
    beds: num(get(thread, 'beds', 'bedrooms', 'total_bedrooms')),
    baths: num(get(thread, 'baths', 'bathrooms', 'total_baths')),
    sqft: num(get(thread, 'sqft', 'livingAreaSqft', 'building_square_feet')),
    units: num(get(thread, 'units', 'unit_count', 'units_count', 'number_of_units')),
    estimated_value: num(get(thread, 'estimatedValue', 'estimated_value')),
    equity_percent: num(get(thread, 'equityPercent', 'equity_percent')),
    repair_estimate: num(get(thread, 'estimatedRepairCost', 'estimated_repair_cost')),
    streetview_image: text(get(thread, 'streetview_image', 'streetviewImage')) || null,
    last_message: text(get(thread, 'lastMessageBody', 'latestMessageBody', 'preview')),
    last_message_direction: decision.last_message_direction,
    last_activity_at: thread.lastMessageAt || thread.lastMessageIso || new Date().toISOString(),
    unread: decision.unread,
    conversation_stage: decision.conversation_stage,
    conversation_status: decision.conversation_status,
    inbox_bucket: decision.inbox_bucket,
    lead_temperature: decision.lead_temperature,
    priority_score: decision.priority_score,
    automation_status: decision.automation_status,
    suppression_status: decision.suppression_status,
    next_action: decision.next_action,
    offer_status: lower(decision.conversation_status).includes('offer') ? 'ready' : text(get(thread, 'offer_status', 'offerStatus')) || 'none',
    contract_status: lower(decision.conversation_status).includes('contract') ? 'active' : text(get(thread, 'contract_status', 'contractStatus')) || 'none',
    next_follow_up_at: decision.next_follow_up_at,
    review_reason: decision.review_reason,
    confidence: decision.confidence,
    last_inbound_at: thread.lastInboundAt || null,
    last_outbound_at: thread.lastOutboundAt || null,
    queue_status: text(get(thread, 'queueStatus', 'queue_status', 'deliveryState')) || null,
    delivery_status: text(get(thread, 'deliveryStatus', 'delivery_status', 'providerDeliveryStatus', 'provider_delivery_status')) || null,
    activity_mode: 'threads' as const,
    activity_state: (decision.suppression_status !== 'clear' ? 'suppressed' : 'new_replies') as PinActivityState,
    activity_label: decision.suppression_status !== 'clear' ? 'Suppressed' : 'New Replies',
  }

  if (!isValidCoord(lat, lng)) {
    return {
      pin: null,
      unmapped: {
        id: thread.id,
        conversation_id: thread.id,
        seller_name: base.seller_name,
        address: base.address,
        reason: 'missing_coordinates',
      },
    }
  }

  return {
    pin: {
      ...base,
      lat,
      lng,
    },
    unmapped: null,
  }
}

const deriveThreadState = (pin: CommandMapPin): ThreadMapState => {
  if (pin.suppression_status !== 'clear') return 'suppressed'
  if (pin.inbox_bucket === 'new_replies') return 'new_replies'
  if (pin.inbox_bucket === 'needs_review') return 'needs_review'
  if (pin.inbox_bucket === 'waiting_on_seller') return 'waiting_on_seller'
  if (pin.inbox_bucket === 'negotiating') return 'negotiating'
  if (pin.inbox_bucket === 'follow_up_due') return 'follow_up_due'
  if (pin.review_reason) return 'needs_review'
  if (pin.last_message_direction === 'outbound') return 'waiting_on_seller'
  if (pin.conversation_status === 'underwriting' || pin.conversation_status === 'offer_ready' || pin.conversation_status === 'contract_ready') return 'negotiating'
  return 'new_replies'
}

const deriveSendState = (pin: CommandMapPin): SendMapState | null => {
  const queueStatus = lower(pin.queue_status)
  const deliveryStatus = lower(pin.delivery_status)
  const outboundAt = pin.last_outbound_at ? new Date(pin.last_outbound_at).getTime() : 0
  const inboundAt = pin.last_inbound_at ? new Date(pin.last_inbound_at).getTime() : 0

  if (pin.suppression_status !== 'clear') return 'opted_out'
  if (queueStatus.includes('blocked')) return 'queue_blocked'
  if (inboundAt > outboundAt && outboundAt > 0) return 'replied'
  if (deliveryStatus.includes('failed') || queueStatus.includes('failed')) return 'failed'
  if (deliveryStatus.includes('delivered') || queueStatus.includes('delivered')) return 'delivered'
  if (queueStatus.includes('sending') || queueStatus.includes('processing') || queueStatus.includes('running')) return 'sending'
  if (deliveryStatus.includes('sent') || queueStatus.includes('sent')) return 'sent'
  if (queueStatus.includes('queued') || queueStatus.includes('scheduled') || queueStatus.includes('approval') || queueStatus.includes('ready')) return 'queued'
  if (outboundAt > 0) return 'sent'
  return null
}

const deriveFollowUpState = (pin: CommandMapPin): FollowUpMapState | null => {
  if (pin.suppression_status !== 'clear') return null
  const now = new Date()
  const nextTs = pin.next_follow_up_at ? new Date(pin.next_follow_up_at).getTime() : NaN
  if (Number.isFinite(nextTs)) {
    const next = new Date(nextTs)
    const deltaMinutes = (nextTs - now.getTime()) / 60000
    if (deltaMinutes < 0) return 'overdue'
    if (deltaMinutes <= 60) return 'due_now'
    if (sameDay(next, now)) return 'due_later_today'
    const tomorrow = new Date(now)
    tomorrow.setDate(now.getDate() + 1)
    if (dayKey(next) === dayKey(tomorrow)) return 'due_tomorrow'
  }

  const outboundTs = pin.last_outbound_at ? new Date(pin.last_outbound_at).getTime() : 0
  const inboundTs = pin.last_inbound_at ? new Date(pin.last_inbound_at).getTime() : 0
  const coldThresholdHours = 72
  if (outboundTs > 0 && inboundTs < outboundTs && now.getTime() - outboundTs >= coldThresholdHours * 3600_000) {
    return 'stale_no_response'
  }
  return null
}

const deriveAllState = (pin: CommandMapPin): PinActivityState => {
  if (pin.suppression_status !== 'clear') return 'suppressed'
  const threadState = deriveThreadState(pin)
  if (threadState === 'new_replies' || threadState === 'needs_review' || threadState === 'negotiating') return threadState

  const sendState = deriveSendState(pin)
  if (sendState === 'queue_blocked' || sendState === 'failed' || sendState === 'replied' || sendState === 'sending' || sendState === 'queued') {
    return sendState
  }

  const followUpState = deriveFollowUpState(pin)
  if (followUpState === 'overdue' || followUpState === 'due_now' || followUpState === 'due_later_today' || followUpState === 'due_tomorrow') {
    return followUpState
  }

  if (sendState) return sendState
  if (followUpState) return followUpState
  return threadState
}

const activityLabelFor = (activityState: PinActivityState): string => {
  if (activityState === 'new_replies') return 'New Replies'
  if (activityState === 'needs_review') return 'Needs Review'
  if (activityState === 'waiting_on_seller') return 'Waiting on Seller'
  if (activityState === 'follow_up_due') return 'Follow-Up Due'
  if (activityState === 'stale_no_response') return 'Stale / No Response'
  if (activityState === 'queue_blocked') return 'Queue Blocked'
  if (activityState === 'due_now') return 'Due Now'
  if (activityState === 'due_later_today') return 'Later Today'
  if (activityState === 'due_tomorrow') return 'Due Tomorrow'
  if (activityState === 'opted_out') return 'Opted Out'
  return formatLabel(activityState)
}

const toActivityPins = (pins: CommandMapPin[], activityMode: InboxMapActivityMode): CommandMapPin[] => {
  return pins.flatMap((pin) => {
    const activityState =
      activityMode === 'all'
        ? deriveAllState(pin)
        : activityMode === 'threads'
        ? deriveThreadState(pin)
        : activityMode === 'sends'
          ? deriveSendState(pin)
          : deriveFollowUpState(pin)
    if (!activityState) return []
    return [{
      ...pin,
      activity_mode: activityMode,
      activity_state: activityState,
      activity_label: activityLabelFor(activityState),
    }]
  })
}

const matchesFilters = (pin: CommandMapPin, filters: MapFilterState): boolean => {
  if (filters.market && pin.market !== filters.market) return false
  if (filters.stage && pin.conversation_stage !== filters.stage) return false
  if (filters.status && pin.conversation_status !== filters.status) return false
  if (filters.leadTemperature && pin.lead_temperature !== filters.leadTemperature) return false
  if (filters.automationStatus && pin.automation_status !== filters.automationStatus) return false
  if (filters.messageDirection && pin.last_message_direction !== filters.messageDirection) return false
  if (filters.unreadOnly && !pin.unread) return false
  if (filters.followUpDue && pin.inbox_bucket !== 'follow_up_due') return false
  if (filters.highEquity && (pin.equity_percent ?? 0) < 50) return false
  if (filters.propertyType && pin.property_type !== filters.propertyType) return false
  if (filters.offerStatus && pin.offer_status !== filters.offerStatus) return false
  if (filters.contractStatus && pin.contract_status !== filters.contractStatus) return false
  if (filters.suppressionStatus && pin.suppression_status !== filters.suppressionStatus) return false
  if (filters.dateRange) {
    const days = Number(filters.dateRange)
    const ts = new Date(pin.last_activity_at).getTime()
    if (Number.isFinite(days) && Number.isFinite(ts)) {
      if (Date.now() - ts > days * 86400000) return false
    }
  }
  return true
}

const featureCollectionForPins = (
  pins: CommandMapPin[],
  selectedConversationId: string | null,
  activeKpiFilter: MapKpiFilterKey | null,
): FeatureCollection<Point, PinFeatureProps> => {
  const features: FeatureCollection<Point, PinFeatureProps>['features'] = []

  pins.forEach((pin) => {
    const selected = pin.conversation_id === selectedConversationId ? 1 : 0
    const focusMatch = matchesKpiFilter(pin, activeKpiFilter)
    const focusOpacity = selected ? 1 : activeKpiFilter ? (focusMatch ? 1 : 0.16) : 1
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [pin.lng, pin.lat] },
      properties: {
        ...pin,
        featureType: 'pin',
        selected,
        focusOpacity,
        stageColor: stageColor(pin),
        pulseTier:
          pin.activity_mode === 'sends'
            ? (pin.activity_state === 'sending'
              ? 'fast'
              : pin.activity_state === 'sent' || pin.activity_state === 'delivered' || pin.activity_state === 'replied' || pin.activity_state === 'opted_out'
                ? 'medium_fast'
                : pin.activity_state === 'failed'
                  ? 'fast'
                  : 'none')
            : pin.activity_mode === 'follow_ups'
              ? (pin.activity_state === 'overdue'
                ? 'medium'
                : pin.activity_state === 'due_now'
                  ? 'slow'
                  : 'none')
              : pulseTierFor(pin.last_activity_at),
        pulseMode: pulseModeFor(pin),
        glowStrength: glowStrength(pin.priority_score),
        unreadRingColor: pin.unread && pin.last_message_direction === 'inbound' ? '#3b82f6' : 'transparent',
        offerRingColor: lower(pin.offer_status).includes('ready') || lower(pin.offer_status).includes('sent') ? '#30d158' : 'transparent',
        contractRingColor: lower(pin.contract_status).includes('active') ? '#14b8a6' : 'transparent',
        badgeColor: badgeColor(pin),
        pinCount: 1,
        lockState: pin.suppression_status !== 'clear' ? 1 : 0,
        needsReviewBadge: pin.inbox_bucket === 'needs_review' ? 1 : 0,
        followUpDueBadge: pin.inbox_bucket === 'follow_up_due' || pin.activity_state === 'due_now' || pin.activity_state === 'due_later_today' || pin.activity_state === 'due_tomorrow' || pin.activity_state === 'overdue' ? 1 : 0,
        suppressedBadge: pin.suppression_status !== 'clear' ? 1 : 0,
        queueBlockedBadge: pin.activity_state === 'queue_blocked' ? 1 : 0,
      },
    })
  })
  return { type: 'FeatureCollection', features }
}

const matchesKpiFilter = (pin: CommandMapPin, filter: MapKpiFilterKey | null): boolean => {
  if (!filter) return true
  if (filter === 'contract_active') return lower(pin.contract_status).includes('active')
  if (filter === 'offer_ready') return lower(pin.offer_status).includes('ready') || lower(pin.offer_status).includes('sent')
  return pin.activity_state === filter
}

const buildKpiChips = (pins: CommandMapPin[], activityMode: InboxMapActivityMode): MapKpiChip[] => {
  const build = (key: MapKpiFilterKey, label: string, tone: string) => ({
    key,
    label,
    tone,
    count: pins.filter((pin) => matchesKpiFilter(pin, key)).length,
  })

  if (activityMode === 'threads') {
    return [
      build('new_replies', 'New Replies', '#5bb6ff'),
      build('needs_review', 'Needs Review', '#f5b94c'),
      build('waiting_on_seller', 'Waiting', '#9ec3ff'),
      build('negotiating', 'Negotiating', '#b188ff'),
      build('follow_up_due', 'Follow-Up Due', '#3ed8a5'),
      build('suppressed', 'Suppressed', '#ff6b63'),
    ]
  }
  if (activityMode === 'sends') {
    return [
      build('queued', 'Queued', '#8f9bad'),
      build('sending', 'Sending', '#4d8fff'),
      build('delivered', 'Delivered', '#4fe18a'),
      build('replied', 'Replies', '#62d3ff'),
      build('failed', 'Failed', '#ff6b63'),
      build('queue_blocked', 'Routing Blocked', '#ff9d57'),
    ]
  }
  if (activityMode === 'follow_ups') {
    return [
      build('due_now', 'Due Now', '#ffb44d'),
      build('due_later_today', 'Later Today', '#5bb6ff'),
      build('due_tomorrow', 'Tomorrow', '#4fe18a'),
      build('overdue', 'Overdue', '#ff6b63'),
      build('stale_no_response', 'Stale', '#97a3b6'),
    ]
  }
  return [
    build('new_replies', 'New Replies', '#5bb6ff'),
    build('needs_review', 'Needs Review', '#f5b94c'),
    build('waiting_on_seller', 'Waiting', '#9ec3ff'),
    build('queued', 'Queued', '#8f9bad'),
    build('offer_ready', 'Offer Ready', '#4fe18a'),
    build('contract_active', 'Contracts', '#30d5c8'),
  ]
}

const buildLiveTickerItems = (pins: CommandMapPin[], threadsById: Map<string, InboxWorkflowThread>): LiveTickerItem[] => {
  return pins
    .map((pin) => {
      const thread = threadsById.get(pin.conversation_id) || null
      const sellerName = [
        text((thread as any)?.seller_name),
        text((thread as any)?.ownerDisplayName),
        text((thread as any)?.owner_display_name),
        text((thread as any)?.ownerName),
        text((thread as any)?.owner_name),
        text((thread as any)?.prospect_name),
        text((thread as any)?.contact_name),
        text(pin.seller_name),
      ].find((value) => value && lower(value) !== 'unknown seller') || 'Property Thread'
      const hydratedAddress = [
        text((thread as any)?.propertyAddress),
        text((thread as any)?.propertyAddressFull),
        text((thread as any)?.property_address),
        text((thread as any)?.property_address_full),
        text((thread as any)?.address),
        text((thread as any)?.situs_address),
        text(pin.address),
      ].find(Boolean) || 'Property Unknown'
      const marketLine = [
        text((thread as any)?.market),
        text((thread as any)?.marketName),
        [text((thread as any)?.city || (thread as any)?.property_address_city || pin.city), text((thread as any)?.state || (thread as any)?.property_address_state || pin.state)].filter(Boolean).join(', '),
        [text(pin.city), text(pin.state)].filter(Boolean).join(', '),
      ].find(Boolean) || 'Market Unknown'
      const lastMessage = [
        text((thread as any)?.message_body),
        text((thread as any)?.latestMessageBody),
        text((thread as any)?.latest_message_body),
        text((thread as any)?.lastMessageBody),
        text((thread as any)?.preview),
        text(pin.last_message),
      ].find(Boolean) || ''
      const lowerStage = lower(pin.conversation_stage)
      const lowerStatus = lower(pin.conversation_status)
      const lowerMessage = lower(lastMessage)

      let eventType: LiveTickerItem['eventType'] = 'new_reply'
      let badge = 'New Reply'
      let tone: LiveTickerItem['tone'] = 'accent'
      let detailLabel = 'Message'

      if (pin.suppression_status !== 'clear') {
        eventType = lowerMessage.includes('stop') || lowerMessage.includes('opt out') ? 'opt_out' : 'suppressed'
        badge = eventType === 'opt_out' ? 'Opt-Out' : 'Suppressed'
        tone = 'danger'
        detailLabel = 'Reason'
      } else if (pin.inbox_bucket === 'needs_review' || pin.activity_state === 'needs_review') {
        eventType = 'needs_review'
        badge = 'Needs Review'
        tone = 'warning'
        detailLabel = 'Review'
      } else if ((pin.priority_score ?? 0) >= 92) {
        eventType = 'hot_lead'
        badge = 'Hot Lead'
        tone = 'premium'
        detailLabel = 'Signal'
      } else if (lowerStage.includes('price') || lowerStatus.includes('price') || /\$\d/.test(lastMessage)) {
        eventType = 'price_given'
        badge = 'Price Given'
        tone = 'premium'
        detailLabel = 'Price'
      } else if (lowerStage.includes('offer') || lowerStatus.includes('offer') || lower(pin.offer_status).includes('ready') || lower(pin.offer_status).includes('sent')) {
        eventType = 'offer_requested'
        badge = 'Offer Requested'
        tone = 'premium'
        detailLabel = 'Offer'
      } else if (lowerStatus.includes('underwriting')) {
        eventType = 'underwriting_complete'
        badge = 'Underwriting'
        tone = 'success'
        detailLabel = 'Summary'
      } else if (pin.activity_state === 'queued') {
        eventType = pin.next_follow_up_at ? 'follow_up_scheduled' : 'send_queued'
        badge = pin.next_follow_up_at ? 'Follow-Up Scheduled' : 'Send Queued'
        tone = 'neutral'
        detailLabel = pin.next_follow_up_at ? 'Next Follow-Up' : 'Queued'
      } else if (pin.activity_state === 'sending' || pin.activity_state === 'sent') {
        eventType = 'send_sent'
        badge = 'Send Sent'
        tone = 'accent'
        detailLabel = 'Outbound'
      } else if (pin.activity_state === 'delivered') {
        eventType = 'send_delivered'
        badge = 'Delivered'
        tone = 'success'
        detailLabel = 'Delivery'
      } else if (pin.activity_state === 'failed' || pin.activity_state === 'queue_blocked') {
        eventType = 'send_failed'
        badge = pin.activity_state === 'queue_blocked' ? 'Routing Blocked' : 'Send Failed'
        tone = 'danger'
        detailLabel = 'Failure'
      } else if (pin.activity_state === 'due_now' || pin.activity_state === 'overdue' || pin.activity_state === 'follow_up_due') {
        eventType = 'follow_up_due'
        badge = 'Follow-Up Due'
        tone = 'warning'
        detailLabel = 'Follow-Up'
      } else if (pin.activity_state === 'new_replies' || pin.activity_state === 'replied') {
        eventType = 'new_reply'
        badge = 'New Reply'
        tone = 'accent'
        detailLabel = 'Inbound'
      }

      const timestamp =
        eventType === 'new_reply' || eventType === 'price_given'
          ? (pin.last_inbound_at || pin.last_activity_at)
          : (pin.last_outbound_at || pin.next_follow_up_at || pin.last_activity_at)

      const preview =
        eventType === 'send_failed'
          ? pin.next_action || pin.conversation_status || 'Message send blocked.'
          : eventType === 'follow_up_scheduled'
            ? pin.next_follow_up_at ? `Scheduled ${formatRelative(pin.next_follow_up_at)}` : pin.next_action || ''
            : eventType === 'underwriting_complete'
              ? `Value ${formatCurrency(pin.estimated_value)} • Repairs ${formatCurrency(pin.repair_estimate)} • Equity ${formatPercent(pin.equity_percent ?? NaN)}`
              : eventType === 'price_given'
                ? `${lastMessage || 'Seller price shared.'}${Number.isFinite(pin.estimated_value ?? NaN) ? ` • Value ${formatCurrency(pin.estimated_value)}` : ''}`
                : lastMessage || undefined

      return {
        id: `${pin.conversation_id}:${eventType}:${timestamp}`,
        threadId: pin.conversation_id,
        lng: pin.lng,
        lat: pin.lat,
        eventType,
        badge,
        sellerName,
        location: marketLine,
        timeAgo: formatRelative(timestamp),
        timestamp: timestamp || pin.last_activity_at,
        preview,
        address: hydratedAddress,
        statusLabel: formatLabel(pin.conversation_status || 'Unknown'),
        stageLabel: formatLabel(pin.conversation_stage || 'Unknown'),
        tone,
        disabledReply: eventType === 'suppressed' || eventType === 'opt_out',
        detailLabel,
      }
    })
    .sort((left, right) => new Date(right.timestamp || 0).getTime() - new Date(left.timestamp || 0).getTime())
    .slice(0, 20)
}

const resolveStyle = (styleMode: MapStyleMode) => {
  const envStyle = (import.meta.env as Record<string, string>).VITE_MAP_STYLE_URL
  if (styleMode === 'satellite') return SATELLITE_MAP_STYLE
  return typeof envStyle === 'string' && envStyle.length > 0 ? envStyle : DARK_MAP_STYLE
}

const mapCardThemeVariants: Record<MapStyleMode, Record<string, string>> = {
  dark: {
    '--nx-card-accent': '#63d7ff',
    '--nx-card-accent-rgb': '99, 215, 255',
    '--nx-card-accent-soft': 'rgba(99, 215, 255, 0.18)',
    '--nx-card-shell-top': 'rgba(8, 14, 24, 0.96)',
    '--nx-card-shell-bottom': 'rgba(5, 10, 18, 0.94)',
    '--nx-card-border': 'rgba(132, 191, 255, 0.18)',
    '--nx-card-glow': 'rgba(42, 118, 255, 0.22)',
    '--nx-card-shadow': 'rgba(4, 12, 28, 0.58)',
    '--nx-card-tile': 'rgba(255, 255, 255, 0.045)',
    '--nx-card-tile-border': 'rgba(167, 204, 255, 0.08)',
    '--nx-card-message': 'rgba(255, 255, 255, 0.038)',
    '--nx-card-live': '#68d9ff',
    '--nx-card-input': 'rgba(10, 16, 28, 0.82)',
  },
  red: {
    '--nx-card-accent': '#ff6b63',
    '--nx-card-accent-rgb': '255, 107, 99',
    '--nx-card-accent-soft': 'rgba(255, 107, 99, 0.16)',
    '--nx-card-shell-top': 'rgba(15, 8, 10, 0.97)',
    '--nx-card-shell-bottom': 'rgba(10, 5, 8, 0.95)',
    '--nx-card-border': 'rgba(255, 118, 118, 0.2)',
    '--nx-card-glow': 'rgba(191, 29, 29, 0.28)',
    '--nx-card-shadow': 'rgba(24, 3, 5, 0.62)',
    '--nx-card-tile': 'rgba(255, 107, 99, 0.045)',
    '--nx-card-tile-border': 'rgba(255, 137, 128, 0.1)',
    '--nx-card-message': 'rgba(255, 255, 255, 0.03)',
    '--nx-card-live': '#ff6b63',
    '--nx-card-input': 'rgba(18, 10, 14, 0.84)',
  },
  satellite: {
    '--nx-card-accent': '#e5edf8',
    '--nx-card-accent-rgb': '229, 237, 248',
    '--nx-card-accent-soft': 'rgba(229, 237, 248, 0.12)',
    '--nx-card-shell-top': 'rgba(14, 16, 18, 0.9)',
    '--nx-card-shell-bottom': 'rgba(10, 12, 14, 0.84)',
    '--nx-card-border': 'rgba(218, 230, 244, 0.12)',
    '--nx-card-glow': 'rgba(16, 18, 20, 0.2)',
    '--nx-card-shadow': 'rgba(0, 0, 0, 0.52)',
    '--nx-card-tile': 'rgba(255, 255, 255, 0.03)',
    '--nx-card-tile-border': 'rgba(255, 255, 255, 0.07)',
    '--nx-card-message': 'rgba(255, 255, 255, 0.026)',
    '--nx-card-live': '#f4f7fb',
    '--nx-card-input': 'rgba(18, 20, 22, 0.8)',
  },
}

const cardThemeVars = (styleMode: MapStyleMode): CSSProperties => mapCardThemeVariants[styleMode] as CSSProperties
const cardThemeStyleAttr = (styleMode: MapStyleMode): string => Object.entries(mapCardThemeVariants[styleMode]).map(([key, value]) => `${key}:${value}`).join(';')

const statusToneForPin = (pin: Pick<CommandMapPin, 'suppression_status' | 'inbox_bucket' | 'conversation_status' | 'contract_status' | 'offer_status'>): 'danger' | 'warning' | 'success' | 'accent' | 'neutral' => {
  if (pin.suppression_status !== 'clear') return 'danger'
  if (pin.inbox_bucket === 'needs_review') return 'warning'
  if (lower(pin.contract_status).includes('active')) return 'success'
  if (lower(pin.offer_status).includes('ready') || lower(pin.offer_status).includes('sent')) return 'success'
  if (pin.inbox_bucket === 'new_replies') return 'accent'
  if (pin.inbox_bucket === 'waiting_on_seller') return 'neutral'
  return 'accent'
}

const statusLabelForPin = (pin: Pick<CommandMapPin, 'suppression_status' | 'inbox_bucket' | 'conversation_status' | 'conversation_stage' | 'contract_status' | 'offer_status'>): string => {
  if (pin.suppression_status !== 'clear') return 'Suppressed'
  if (pin.inbox_bucket === 'new_replies') return 'New Reply'
  if (pin.inbox_bucket === 'needs_review') return 'Needs Review'
  if (pin.inbox_bucket === 'waiting_on_seller') return 'Waiting'
  if (lower(pin.contract_status).includes('active')) return 'Contract Active'
  if (lower(pin.offer_status).includes('ready') || lower(pin.offer_status).includes('sent')) return 'Offer Ready'
  return formatLabel(pin.conversation_stage || pin.conversation_status || 'Unknown')
}

const statIconMarkup = (icon: 'beds' | 'baths' | 'sqft' | 'units' | 'value' | 'repairs' | 'equity' | 'status') => {
  const icons: Record<string, string> = {
    beds: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5h16v6H4zM6 10V7.5A1.5 1.5 0 0 1 7.5 6h3A1.5 1.5 0 0 1 12 7.5V10m1 0V8.2A1.2 1.2 0 0 1 14.2 7h2.6A1.2 1.2 0 0 1 18 8.2V10" /></svg>',
    baths: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6.5a2.5 2.5 0 1 1 5 0v6.5m-6 0h10m-8.5 0v2.2a3.5 3.5 0 0 0 7 0V13" /><path d="M5 13h14" /></svg>',
    sqft: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16H7z" /><path d="M9.5 7.5h5m-5 4h5m-5 4h5" /></svg>',
    units: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V6.2L12 3l7 3.2V20" /><path d="M9 20v-4h6v4M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01" /></svg>',
    value: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v17M16 7.2c0-1.6-1.8-2.7-4-2.7s-4 1.1-4 2.7 1.4 2.4 4 2.9 4 1.2 4 3-1.8 3.1-4 3.1-4-1.2-4-2.8" /></svg>',
    repairs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 7 4 4m-2 2-3.5 3.5a1.4 1.4 0 0 0 2 2L10 15m4.6-8.6a3 3 0 0 0 3.8 3.8L13 15.6l-4.6-4.6z" /></svg>',
    equity: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.2 19 8v8l-7 3.8L5 16V8z" /><path d="m9 12 2 2 4-4" /></svg>',
    status: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5" /><path d="M12 8v4l2.8 2.2" /></svg>',
  }
  return icons[icon]
}

const buildHoverCardMarkup = (pin: CommandMapPin, styleMode: MapStyleMode): string => {
  const imageUrl = pin.streetview_image || buildStreetViewUrl(pin.address) || ''
  const statusTone = statusToneForPin(pin)
  const statusLabel = statusLabelForPin(pin)
  const metric = (label: string, icon: string, value: string) => `
    <div class="nx-icm-hover__metric ${statusTone === 'danger' ? 'is-danger' : statusTone === 'accent' ? 'is-accent' : ''}">
      <span class="nx-icm-hover__metric-icon">${statIconMarkup(icon as any)}</span>
      <div class="nx-icm-hover__metric-copy">
        <span>${label}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    </div>
  `
  return `
    <article class="nx-icm-hover nx-icm-hover--${styleMode}" style="${cardThemeStyleAttr(styleMode)}">
      ${imageUrl ? `<div class="nx-icm-hover__media">
        <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(pin.address)} street view" loading="lazy" />
        <div class="nx-icm-hover__media-scrim"></div>
        <span class="nx-icm-hover__media-badge">Owner</span>
      </div>` : '<div class="nx-icm-hover__media nx-icm-hover__media--empty"><span>No image available</span></div>'}
      <div class="nx-icm-hover__body">
        <div class="nx-icm-hover__head">
          <div>
            <p class="nx-icm-hover__eyebrow">${escapeHtml(pin.activity_label || 'Lead')}</p>
            <h4>${escapeHtml(pin.seller_name)}</h4>
          </div>
          <span class="nx-icm-hover__status nx-icm-hover__status--${statusTone}">${escapeHtml(statusLabel)}</span>
        </div>
        <p class="nx-icm-hover__address"><span class="nx-icm-hover__address-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s6-5 6-10a6 6 0 0 0-12 0c0 5 6 10 6 10Z" /><circle cx="12" cy="10" r="2.2" /></svg></span>${escapeHtml(pin.address || 'Property Unknown')}</p>
        <div class="nx-icm-hover__stats">
          ${metric('Beds', 'beds', formatInteger(pin.beds))}
          ${metric('Baths', 'baths', formatInteger(pin.baths))}
          ${metric('Sqft', 'sqft', formatInteger(pin.sqft))}
          ${metric('Units', 'units', formatInteger(pin.units))}
          ${metric('Value', 'value', formatCurrency(pin.estimated_value))}
          ${metric('Repairs', 'repairs', formatCurrency(pin.repair_estimate))}
          ${metric('Equity', 'equity', formatPercent(pin.equity_percent ?? NaN))}
          ${metric('Status', 'status', formatLabel(pin.conversation_status || 'Unknown'))}
        </div>
        <div class="nx-icm-hover__message">
          <div class="nx-icm-hover__message-head">
            <span>Last Message</span>
            <small>${escapeHtml(formatRelative(pin.last_activity_at))}</small>
          </div>
          <p>${escapeHtml(pin.last_message || 'No recent message')}</p>
        </div>
      </div>
    </article>
  `
}

const MiniThreadPopup = ({
  thread,
  messages,
  loading,
  draftText,
  disabled,
  onDraftChange,
  onSend,
  onClose,
  styleMode,
}: {
  thread: InboxWorkflowThread | null
  messages: ThreadMessage[]
  loading: boolean
  draftText: string
  disabled: boolean
  onDraftChange: (value: string) => void
  onSend: () => void
  onClose: () => void
  styleMode: MapStyleMode
}) => (
  <article className={cls('nx-icm-thread', `nx-icm-thread--${styleMode}`)} style={cardThemeVars(styleMode)} onClick={(event) => event.stopPropagation()}>
    <div className="nx-icm-thread__flip-shell">
      <header className="nx-icm-thread__header">
        <div className="nx-icm-thread__header-main">
          <p className="nx-icm-thread__eyebrow"><span className="nx-icm-thread__live-dot" />Live SMS</p>
          <div className="nx-icm-thread__identity">
            <div className="nx-icm-thread__thumb">
              {thread?.propertyAddress ? <img src={buildStreetViewUrl(thread.propertyAddress) || ''} alt={thread.propertyAddress} loading="lazy" /> : <span>SMS</span>}
            </div>
            <div className="nx-icm-thread__identity-copy">
              <h4>{thread?.ownerName || 'Unknown Seller'}</h4>
              <span>{thread?.propertyAddress || thread?.subject || 'Property Unknown'}</span>
            </div>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close mini SMS view">
          <Icon name="close" />
        </button>
      </header>
      <div className="nx-icm-thread__meta">
        <span className={cls('nx-icm-thread__status-pill', `is-${statusToneForPin({
          suppression_status: String((thread as any)?.suppressionStatus || 'clear'),
          inbox_bucket: String((thread as any)?.inboxBucket || ''),
          conversation_status: String((thread as any)?.conversationStatus || ''),
          contract_status: String((thread as any)?.contractStatus || ''),
          offer_status: String((thread as any)?.offerStatus || ''),
        })}`)}>
          {statusLabelForPin({
            suppression_status: String((thread as any)?.suppressionStatus || 'clear'),
            inbox_bucket: String((thread as any)?.inboxBucket || ''),
            conversation_status: String((thread as any)?.conversationStatus || ''),
            conversation_stage: String((thread as any)?.conversationStage || ''),
            contract_status: String((thread as any)?.contractStatus || ''),
            offer_status: String((thread as any)?.offerStatus || ''),
          })}
        </span>
        <small>{String(thread?.conversationStage || '').replace(/_/g, ' ') || 'Unknown stage'}</small>
      </div>
      <div className="nx-icm-thread__messages">
        {loading && <div className="nx-icm-thread__empty">Syncing conversation…</div>}
        {!loading && messages.length === 0 && <div className="nx-icm-thread__empty">No messages yet.</div>}
        {messages.map((message, index) => {
          const currentDate = new Date(message.createdAt || message.timelineAt || '')
          const previous = messages[index - 1]
          const previousDate = previous ? new Date(previous.createdAt || previous.timelineAt || '') : null
          const showTodayDivider = index === 0 || !previousDate || currentDate.toDateString() !== previousDate.toDateString()
          const isToday = currentDate.toDateString() === new Date().toDateString()
          return (
            <div key={message.id} className="nx-icm-thread__message-group">
              {showTodayDivider && (
                <div className="nx-icm-thread__day-divider">
                  <span>{isToday ? 'Today' : currentDate.toLocaleDateString()}</span>
                </div>
              )}
              <article className={cls('nx-icm-thread__bubble', message.direction === 'outbound' && 'is-outbound')}>
                <p>{message.body || 'Not available'}</p>
                <small>
                  {formatRelativeTime(message.createdAt || message.timelineAt || '')}
                  {message.direction === 'outbound' && message.deliveryStatus ? ` · ${message.deliveryStatus}` : ''}
                </small>
              </article>
            </div>
          )
        })}
      </div>
      <form
        className="nx-icm-thread__composer"
        onSubmit={(event) => {
          event.preventDefault()
          if (!draftText.trim() || disabled) return
          onSend()
        }}
      >
        <input
          value={draftText}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={disabled ? 'Messaging disabled' : 'Type your message…'}
          disabled={disabled}
        />
        <button type="submit" disabled={!draftText.trim() || disabled} aria-label="Send quick reply">
          <Icon name="send" />
        </button>
      </form>
    </div>
  </article>
)

interface Props {
  threads: InboxWorkflowThread[]
  visibleThreads: InboxWorkflowThread[]
  selectedThread: InboxWorkflowThread | null
  selectedThreadMessages?: ThreadMessage[]
  selectedThreadMessagesLoading?: boolean
  quickReplyDraft?: string
  onQuickReplyDraftChange?: (value: string) => void
  onQuickReplySend?: (value: string) => void | Promise<void>
  quickReplyDisabled?: boolean
  zoomedIn: boolean
  sourceMode: MapSourceMode
  onSourceModeChange?: (mode: MapSourceMode) => void
  onSelectThreadId?: (threadId: string) => void
  onBackgroundClick?: () => void
  fullHeight?: boolean
  commandMode?: boolean
  initialActivityMode?: InboxMapActivityMode
  initialMapStyleMode?: MapStyleMode
  initialFilters?: Partial<MapFilterState>
  initialMapOverlays?: Partial<MapOverlayToggles>
  onStateChange?: (state: {
    activityMode: InboxMapActivityMode
    mapStyleMode: MapStyleMode
    filters: MapFilterState
    mapOverlays: MapOverlayToggles
  }) => void
}

const defaultFilters: MapFilterState = {
  market: '',
  stage: '',
  status: '',
  leadTemperature: '',
  automationStatus: '',
  messageDirection: '',
  unreadOnly: false,
  followUpDue: false,
  highEquity: false,
  propertyType: '',
  offerStatus: '',
  contractStatus: '',
  suppressionStatus: '',
  dateRange: '',
}

export function InboxCommandMap({
  threads,
  visibleThreads,
  selectedThread,
  selectedThreadMessages = [],
  selectedThreadMessagesLoading = false,
  quickReplyDraft = '',
  onQuickReplyDraftChange,
  onQuickReplySend,
  quickReplyDisabled = false,
  zoomedIn,
  sourceMode,
  onSourceModeChange,
  onSelectThreadId,
  onBackgroundClick,
  fullHeight = false,
  commandMode = false,
  initialActivityMode = 'threads',
  initialMapStyleMode = 'dark',
  initialFilters,
  initialMapOverlays,
  onStateChange,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const animationRef = useRef<number | null>(null)
  const hoverPopupRef = useRef<maplibregl.Popup | null>(null)
  const threadPopupRef = useRef<maplibregl.Popup | null>(null)
  const threadPopupRootRef = useRef<Root | null>(null)
  const threadPopupHostRef = useRef<HTMLDivElement | null>(null)
  const activeThreadPopupRef = useRef<{ id: string; coordinates: [number, number] } | null>(null)
  const activeKpiFilterRef = useRef<MapKpiFilterKey | null>(null)
  const onSelectThreadIdRef = useRef<Props['onSelectThreadId']>(onSelectThreadId)
  const onBackgroundClickRef = useRef<Props['onBackgroundClick']>(onBackgroundClick)
  const mapStyleModeRef = useRef<MapStyleMode>(initialMapStyleMode)
  const mapOverlaysRef = useRef<MapOverlayToggles>({ ...defaultMapOverlays, ...initialMapOverlays })
  const geojsonRef = useRef<FeatureCollection<Point, PinFeatureProps>>(featureCollectionForPins([], null, null))
  const activityModeRef = useRef<InboxMapActivityMode>('threads')
  const [activityMode, setActivityMode] = useState<InboxMapActivityMode>(initialActivityMode)
  const [filters, setFilters] = useState<MapFilterState>({ ...defaultFilters, ...initialFilters })
  const [selectedPinId, setSelectedPinId] = useState<string | null>(selectedThread?.id ?? null)
  const [showSelectedHidden, setShowSelectedHidden] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [dockTier, setDockTier] = useState<'mini' | 'compact' | 'full'>('full')
  const [mapStyleMode, setMapStyleMode] = useState<MapStyleMode>(initialMapStyleMode)
  const [mapDimension, setMapDimension] = useState<'2d' | '3d'>('2d')
  const [mapOverlays, setMapOverlays] = useState<MapOverlayToggles>({ ...defaultMapOverlays, ...initialMapOverlays })
  const [activeThreadPopup, setActiveThreadPopup] = useState<{ id: string; coordinates: [number, number] } | null>(null)
  const [showKpiBadges, setShowKpiBadges] = useState(true)
  const [activeKpiFilter, setActiveKpiFilter] = useState<MapKpiFilterKey | null>(null)
  const [tickerDensity, setTickerDensity] = useState<TickerDensity>('compact')

  const hydratedThreadsById = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread])),
    [threads],
  )
  const hydratedThreadsByKey = useMemo(
    () => new Map(threads.map((thread) => [String((thread as any).threadKey || thread.id), thread])),
    [threads],
  )
  const visibleHydratedThreads = useMemo(() => (
    visibleThreads
      .map((thread) => hydratedThreadsById.get(thread.id) || hydratedThreadsByKey.get(String((thread as any).threadKey || thread.id)) || thread)
  ), [hydratedThreadsById, hydratedThreadsByKey, visibleThreads])
  const selectedHydratedThread = useMemo(() => {
    if (!selectedThread) return null
    return hydratedThreadsById.get(selectedThread.id)
      || hydratedThreadsByKey.get(String((selectedThread as any).threadKey || selectedThread.id))
      || selectedThread
  }, [hydratedThreadsById, hydratedThreadsByKey, selectedThread])
  const baseThreads = useMemo(
    () => sourceMode === 'visible_threads' ? visibleHydratedThreads : threads,
    [sourceMode, threads, visibleHydratedThreads],
  )
  const pinPipeline = useMemo(() => {
    const mapped: CommandMapPin[] = []
    const unmapped: UnmappedItem[] = []
    baseThreads.forEach((thread) => {
      const result = buildMapPin(thread)
      if (result.pin) mapped.push(result.pin)
      if (result.unmapped) unmapped.push(result.unmapped)
    })
    return { mapped, unmapped }
  }, [baseThreads])
  const allPins = useMemo(() => toActivityPins(pinPipeline.mapped, activityMode), [activityMode, pinPipeline.mapped])
  const filteredPins = useMemo(
    () => allPins.filter((pin) => matchesFilters(pin, filters)),
    [allPins, filters],
  )
  const selectedBasePin = useMemo(() => {
    if (!selectedHydratedThread) return null
    return buildMapPin(selectedHydratedThread).pin
  }, [selectedHydratedThread])
  const selectedHiddenByFilters = useMemo(
    () => Boolean(selectedBasePin && !filteredPins.some((pin) => pin.conversation_id === selectedBasePin.conversation_id)),
    [filteredPins, selectedBasePin],
  )
  const visiblePins = useMemo(() => {
    if (!selectedBasePin || !showSelectedHidden || !selectedHiddenByFilters) return filteredPins
    const selectedActivityPins = toActivityPins([selectedBasePin], activityMode)
    if (selectedActivityPins.length === 0) return filteredPins
    if (filteredPins.some((pin) => pin.conversation_id === selectedBasePin.conversation_id)) return filteredPins
    return [...filteredPins, ...selectedActivityPins]
  }, [activityMode, filteredPins, selectedBasePin, selectedHiddenByFilters, showSelectedHidden])
  const selectedPin = useMemo(
    () => visiblePins.find((pin) => pin.conversation_id === (selectedPinId || selectedHydratedThread?.id))
      ?? filteredPins.find((pin) => pin.conversation_id === (selectedPinId || selectedHydratedThread?.id))
      ?? visiblePins[0]
      ?? filteredPins[0]
      ?? selectedBasePin,
    [filteredPins, selectedBasePin, selectedPinId, selectedHydratedThread?.id, visiblePins],
  )
  const kpiChips = useMemo(() => buildKpiChips(visiblePins, activityMode), [activityMode, visiblePins])
  const popupThread = useMemo(() => {
    if (!activeThreadPopup?.id) return null
    return hydratedThreadsById.get(activeThreadPopup.id)
      || hydratedThreadsByKey.get(activeThreadPopup.id)
      || threads.find((thread) => thread.id === activeThreadPopup.id || String((thread as any).threadKey || '') === activeThreadPopup.id)
      || null
  }, [activeThreadPopup?.id, hydratedThreadsById, hydratedThreadsByKey, threads])
  const geojson = useMemo(
    () => featureCollectionForPins(visiblePins, selectedPin?.conversation_id ?? null, activeKpiFilter),
    [activeKpiFilter, visiblePins, selectedPin?.conversation_id],
  )
  const liveTickerItems = useMemo(() => buildLiveTickerItems(visiblePins), [visiblePins])
  const debugStats = useMemo(() => ({
    allPinsCount: allPins.length,
    filteredPinsCount: filteredPins.length,
    visiblePinsCount: visiblePins.length,
    unmappedCount: pinPipeline.unmapped.length,
    activeMode: activityMode,
    activeFilters: filters,
  }), [activityMode, allPins.length, filteredPins.length, filters, pinPipeline.unmapped.length, visiblePins.length])

  geojsonRef.current = geojson
  activityModeRef.current = activityMode
  activeThreadPopupRef.current = activeThreadPopup
  activeKpiFilterRef.current = activeKpiFilter
  onSelectThreadIdRef.current = onSelectThreadId
  onBackgroundClickRef.current = onBackgroundClick
  mapStyleModeRef.current = mapStyleMode
  mapOverlaysRef.current = mapOverlays

  useEffect(() => {
    setShowSelectedHidden(false)
  }, [selectedThread?.id, activityMode])

  useEffect(() => {
    if (!activeKpiFilter) return
    if (!kpiChips.some((chip) => chip.key === activeKpiFilter)) {
      setActiveKpiFilter(null)
    }
  }, [activeKpiFilter, kpiChips])

  useEffect(() => {
    setSelectedPinId(selectedThread?.id ?? null)
  }, [selectedThread?.id])

  useEffect(() => {
    if (!selectedThread || activeThreadPopup?.id !== selectedThread.id) return
    const pin = visiblePins.find((item) => item.conversation_id === selectedThread.id)
      || filteredPins.find((item) => item.conversation_id === selectedThread.id)
      || selectedBasePin
    if (!pin) return
    setActiveThreadPopup((current) => (
      current?.id === selectedThread.id
        ? { ...current, coordinates: [pin.lng, pin.lat] }
        : current
    ))
  }, [activeThreadPopup?.id, filteredPins, selectedBasePin, selectedThread, visiblePins])

  useEffect(() => {
    setActivityMode(initialActivityMode)
  }, [initialActivityMode])

  useEffect(() => {
    setMapStyleMode(initialMapStyleMode)
  }, [initialMapStyleMode])

  useEffect(() => {
    setFilters({ ...defaultFilters, ...initialFilters })
  }, [initialFilters])

  useEffect(() => {
    setMapOverlays({ ...defaultMapOverlays, ...initialMapOverlays })
  }, [initialMapOverlays])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !activeThreadPopup) {
      threadPopupRootRef.current?.unmount()
      threadPopupRootRef.current = null
      threadPopupHostRef.current = null
      threadPopupRef.current?.remove()
      threadPopupRef.current = null
      return
    }

    if (!threadPopupHostRef.current) {
      threadPopupHostRef.current = document.createElement('div')
      threadPopupHostRef.current.className = 'nx-icm-thread-popup-host'
    }
    if (!threadPopupRootRef.current && threadPopupHostRef.current) {
      const host = threadPopupHostRef.current
      threadPopupRootRef.current = createRoot(host)
    }
    if (!threadPopupRootRef.current || !threadPopupHostRef.current) return

    const isSelectedThreadActive = selectedThread?.id === activeThreadPopup.id
    const popupMessages = isSelectedThreadActive ? selectedThreadMessages : []
    const popupLoading = isSelectedThreadActive ? selectedThreadMessagesLoading : true
    const popupDraft = isSelectedThreadActive ? quickReplyDraft : ''
    const popupDisabled = !isSelectedThreadActive || quickReplyDisabled

    if (!threadPopupRootRef.current) return
    threadPopupRootRef.current.render(
      <MiniThreadPopup
        thread={popupThread}
        messages={popupMessages}
        loading={popupLoading}
        draftText={popupDraft}
        disabled={popupDisabled}
        styleMode={mapStyleMode}
        onDraftChange={(value) => {
          if (!isSelectedThreadActive) return
          onQuickReplyDraftChange?.(value)
        }}
        onSend={() => {
          if (!isSelectedThreadActive || !popupDraft.trim()) return
          void onQuickReplySend?.(popupDraft)
        }}
        onClose={() => setActiveThreadPopup(null)}
      />,
    )

    const popup = threadPopupRef.current ?? new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      closeOnMove: false,
      offset: 18,
      className: 'nx-icm-thread-popup',
      maxWidth: '360px',
      focusAfterOpen: false,
    })

    popup
      .setLngLat(activeThreadPopup.coordinates)
      .setDOMContent(threadPopupHostRef.current)
      .addTo(map)

    threadPopupRef.current = popup
  }, [
    activeThreadPopup,
    onQuickReplyDraftChange,
    onQuickReplySend,
    popupThread,
    quickReplyDisabled,
    quickReplyDraft,
    selectedThread?.id,
    selectedThreadMessages,
    selectedThreadMessagesLoading,
  ])

  useEffect(() => {
    onStateChange?.({
      activityMode,
      mapStyleMode,
      filters,
      mapOverlays,
    })
  }, [activityMode, filters, mapOverlays, mapStyleMode, onStateChange])

  useEffect(() => {
    if (!filtersOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!controlsRef.current?.contains(event.target as Node)) setFiltersOpen(false)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFiltersOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [filtersOpen])

  useEffect(() => {
    if (!rootRef.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setDockTier(width <= 360 ? 'mini' : width <= 760 ? 'compact' : 'full')
    })
    observer.observe(rootRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    console.log('[InboxCommandMap]', debugStats)
  }, [debugStats])

  useEffect(() => {
    if (!containerRef.current) return
    if (mapRef.current) return

    const setLayerVisibility = (map: maplibregl.Map, layerIds: readonly string[], visible: boolean) => {
      layerIds.forEach((layerId) => {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
        }
      })
    }

    const syncLayerVisibility = (map: maplibregl.Map, nextMode: InboxMapActivityMode) => {
      const clusteredMode = nextMode !== 'sends' && !activeKpiFilterRef.current
      setLayerVisibility(map, RAW_LAYER_IDS, !clusteredMode)
      setLayerVisibility(map, CLUSTER_POINT_LAYER_IDS, clusteredMode)
      setLayerVisibility(map, CLUSTER_LAYER_IDS, clusteredMode)
    }

    const applyOverlayVisibility = (map: maplibregl.Map) => {
      const overlayState = mapOverlaysRef.current
      const layers = map.getStyle()?.layers ?? []
      layers.forEach((layer) => {
        const typedLayer = layer as StyleLayerLike
        if (!typedLayer.id || typedLayer.id.startsWith(ownLayerPrefix)) return
        const categories = classifyBaseLayer(typedLayer)
        if (categories.length === 0) return
        const visible = categories.every((category) => overlayState[category])
        if (map.getLayer(typedLayer.id)) {
          map.setLayoutProperty(typedLayer.id, 'visibility', visible ? 'visible' : 'none')
        }
      })
    }

    const applyRedOpsTheme = (map: maplibregl.Map) => {
      const layers = map.getStyle()?.layers ?? []
      layers.forEach((layer) => {
        const typedLayer = layer as StyleLayerLike
        if (!typedLayer.id || typedLayer.id.startsWith(ownLayerPrefix)) return
        const id = lower(typedLayer.id)
        const sourceLayer = lower(typedLayer['source-layer'])
        const token = `${id} ${sourceLayer}`

        try {
          if (typedLayer.type === 'background') {
            map.setPaintProperty(typedLayer.id, 'background-color', '#14080a')
          }
          if (typedLayer.type === 'fill') {
            if (token.includes('water')) map.setPaintProperty(typedLayer.id, 'fill-color', '#24090d')
            else if (token.includes('park') || token.includes('landcover') || token.includes('landuse')) map.setPaintProperty(typedLayer.id, 'fill-color', '#1b0d10')
            else map.setPaintProperty(typedLayer.id, 'fill-color', '#18090b')
            map.setPaintProperty(typedLayer.id, 'fill-opacity', 0.92)
          }
          if (typedLayer.type === 'line') {
            const roadColor = token.includes('road') || token.includes('transport') || token.includes('highway') ? '#8f2e34' : '#5a1d22'
            map.setPaintProperty(typedLayer.id, 'line-color', roadColor)
            if (token.includes('road') || token.includes('highway')) {
              map.setPaintProperty(typedLayer.id, 'line-opacity', 0.94)
            }
          }
          if (typedLayer.type === 'symbol') {
            const textColor =
              token.includes('postal') || token.includes('zip') ? '#ffb7a8'
                : token.includes('poi') ? '#f28f82'
                  : token.includes('place') || token.includes('city') || token.includes('town') ? '#ffd4c9'
                    : '#d8898d'
            if (typedLayer.paint && 'text-color' in typedLayer.paint) map.setPaintProperty(typedLayer.id, 'text-color', textColor)
            if (typedLayer.paint && 'text-halo-color' in typedLayer.paint) map.setPaintProperty(typedLayer.id, 'text-halo-color', 'rgba(20,8,10,0.92)')
            if (typedLayer.paint && 'icon-color' in typedLayer.paint) map.setPaintProperty(typedLayer.id, 'icon-color', '#ff7a72')
          }
          if (typedLayer.type === 'raster') {
            map.setPaintProperty(typedLayer.id, 'raster-saturation', -0.42)
            map.setPaintProperty(typedLayer.id, 'raster-contrast', 0.18)
            map.setPaintProperty(typedLayer.id, 'raster-brightness-max', 0.88)
            map.setPaintProperty(typedLayer.id, 'raster-hue-rotate', 325)
          }
        } catch {
          // Keep map resilient when a style layer lacks a property.
        }
      })
    }

    const ensureSatelliteHybridOverlay = async (map: maplibregl.Map) => {
      if (mapStyleModeRef.current !== 'satellite') return
      const darkStyle = await fetchDarkStyleSpec()
      if (!darkStyle) return

      if (darkStyle.glyphs && !map.getStyle().glyphs) {
        // No runtime setter exists; retained through the base style spec above.
      }

      Object.entries(darkStyle.sources ?? {}).forEach(([sourceId, source]) => {
        if (sourceId === 'satellite') return
        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, source as any)
        }
      })

      const candidateLayers = (darkStyle.layers ?? [])
        .map((layer) => layer as StyleLayerLike)
        .filter((layer) => !layer.id.startsWith(ownLayerPrefix))
        .filter((layer) => classifyBaseLayer(layer).length > 0)

      candidateLayers.forEach((layer) => {
        const nextId = hybridOverlayLayerId(layer.id)
        if (map.getLayer(nextId)) return
        try {
          map.addLayer(
            cloneLayerWithId(layer, nextId) as maplibregl.AddLayerObject,
            map.getLayer('command-pin-cluster-glow') ? 'command-pin-cluster-glow' : undefined,
          )
        } catch {
          // Skip incompatible overlay layers but keep the hybrid map alive.
        }
      })
    }

    const syncBasemapPresentation = async (map: maplibregl.Map) => {
      await ensureSatelliteHybridOverlay(map)
      applyOverlayVisibility(map)
      if (mapStyleModeRef.current === 'red') applyRedOpsTheme(map)
    }

    const addMapLayers = (map: maplibregl.Map) => {
      const rawData = geojsonRef.current

      if (!map.getSource(RAW_SOURCE_ID)) {
        map.addSource(RAW_SOURCE_ID, {
          type: 'geojson',
          data: rawData,
        })
      }

      if (!map.getSource(CLUSTER_SOURCE_ID)) {
        map.addSource(CLUSTER_SOURCE_ID, {
          type: 'geojson',
          data: rawData,
          cluster: true,
          clusterRadius: 54,
          clusterMaxZoom: 11,
        })
      }

      if (!map.getLayer('command-pin-cluster-glow')) {
        map.addLayer({
          id: 'command-pin-cluster-glow',
          type: 'circle',
          source: CLUSTER_SOURCE_ID,
          filter: ['has', 'point_count'],
          paint: {
            'circle-radius': ['step', ['get', 'point_count'], 20, 20, 28, 80, 36, 200, 46, 500, 56],
            'circle-color': '#38bdf8',
            'circle-opacity': 0.18,
            'circle-blur': 0.9,
          },
        })
      }

      if (!map.getLayer('command-pin-cluster-core')) {
        map.addLayer({
          id: 'command-pin-cluster-core',
          type: 'circle',
          source: CLUSTER_SOURCE_ID,
          filter: ['has', 'point_count'],
          paint: {
            'circle-radius': ['step', ['get', 'point_count'], 14, 20, 18, 80, 22, 200, 26, 500, 30],
            'circle-color': '#0f1726',
            'circle-stroke-color': 'rgba(91, 182, 255, 0.92)',
            'circle-stroke-width': 1.8,
            'circle-opacity': 0.96,
          },
        })
      }

      if (!map.getLayer('command-pin-cluster-count')) {
        map.addLayer({
          id: 'command-pin-cluster-count',
          type: 'symbol',
          source: CLUSTER_SOURCE_ID,
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-size': 12,
            'text-font': ['Open Sans Bold'],
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': '#f8fbff',
            'text-halo-color': 'rgba(8,10,15,0.92)',
            'text-halo-width': 1.2,
          },
        })
      }

      const addPointLayers = (suffix: 'raw' | 'clustered', sourceId: string, filter?: any) => {
        const layerFilter = filter ?? true
        if (!map.getLayer(`command-pin-glow-${suffix}`)) {
          map.addLayer({
            id: `command-pin-glow-${suffix}`,
            type: 'circle',
            source: sourceId,
            ...(filter ? { filter: layerFilter } : {}),
            paint: {
              'circle-radius': ['+', 14, ['*', ['get', 'glowStrength'], 18]],
              'circle-blur': 1,
              'circle-opacity': ['*', ['case', ['==', ['get', 'glowStrength'], 1], 0.44, ['>=', ['get', 'glowStrength'], 0.8], 0.32, ['>=', ['get', 'glowStrength'], 0.52], 0.22, 0.12], ['get', 'focusOpacity']],
              'circle-color': ['get', 'stageColor'],
            },
          })
        }

        if (!map.getLayer(`command-pin-pulse-${suffix}`)) {
          map.addLayer({
            id: `command-pin-pulse-${suffix}`,
            type: 'circle',
            source: sourceId,
            ...(filter ? { filter: layerFilter } : {}),
            paint: {
              'circle-radius': ['match', ['get', 'pulseTier'], 'fast', 20, 'medium_fast', 18, 'medium', 16, 'slow', 14, 'very_slow', 12, 10],
              'circle-opacity': ['*', ['case', ['==', ['get', 'pulseMode'], 'none'], 0, ['match', ['get', 'pulseTier'], 'fast', 0.28, 'medium_fast', 0.22, 'medium', 0.18, 'slow', 0.12, 'very_slow', 0, 0]], ['get', 'focusOpacity']],
              'circle-color': ['get', 'stageColor'],
              'circle-stroke-width': ['case', ['==', ['get', 'pulseMode'], 'none'], 0, ['match', ['get', 'pulseTier'], 'fast', 1.8, 'medium_fast', 1.5, 'medium', 1.3, 'slow', 1.1, 'very_slow', 0, 0]],
              'circle-stroke-color': ['get', 'stageColor'],
            },
          })
        }

        if (!map.getLayer(`command-pin-unread-ring-${suffix}`)) {
          map.addLayer({
            id: `command-pin-unread-ring-${suffix}`,
            type: 'circle',
            source: sourceId,
            ...(filter ? { filter: layerFilter } : {}),
            paint: {
              'circle-radius': 12.5,
              'circle-color': 'transparent',
              'circle-stroke-width': ['case', ['==', ['get', 'unreadRingColor'], 'transparent'], 0, 2.1],
              'circle-stroke-color': ['get', 'unreadRingColor'],
              'circle-stroke-opacity': ['*', 0.94, ['get', 'focusOpacity']],
            },
          })
        }

        if (!map.getLayer(`command-pin-offer-ring-${suffix}`)) {
          map.addLayer({
            id: `command-pin-offer-ring-${suffix}`,
            type: 'circle',
            source: sourceId,
            ...(filter ? { filter: layerFilter } : {}),
            paint: {
              'circle-radius': 14.5,
              'circle-color': 'transparent',
              'circle-stroke-width': ['case', ['==', ['get', 'offerRingColor'], 'transparent'], 0, 2.2],
              'circle-stroke-color': ['get', 'offerRingColor'],
              'circle-stroke-opacity': ['*', 0.96, ['get', 'focusOpacity']],
            },
          })
        }

        if (!map.getLayer(`command-pin-contract-ring-${suffix}`)) {
          map.addLayer({
            id: `command-pin-contract-ring-${suffix}`,
            type: 'circle',
            source: sourceId,
            ...(filter ? { filter: layerFilter } : {}),
            paint: {
              'circle-radius': 16.5,
              'circle-color': 'transparent',
              'circle-stroke-width': ['case', ['==', ['get', 'contractRingColor'], 'transparent'], 0, 2.2],
              'circle-stroke-color': ['get', 'contractRingColor'],
              'circle-stroke-opacity': ['*', 0.92, ['get', 'focusOpacity']],
            },
          })
        }

        if (!map.getLayer(`command-pin-core-${suffix}`)) {
          map.addLayer({
            id: `command-pin-core-${suffix}`,
            type: 'circle',
            source: sourceId,
            ...(filter ? { filter: layerFilter } : {}),
            paint: {
              'circle-radius': ['case', ['==', ['get', 'selected'], 1], 7.8, 6.6],
              'circle-color': ['get', 'stageColor'],
              'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 2.6, 1.3],
              'circle-stroke-color': ['case', ['==', ['get', 'selected'], 1], '#ffffff', 'rgba(255,255,255,0.4)'],
              'circle-opacity': ['*', ['case', ['==', ['get', 'lockState'], 1], 0.9, 0.98], ['get', 'focusOpacity']],
            },
          })
        }

        if (!map.getLayer(`command-pin-warning-badge-${suffix}`)) {
          map.addLayer({
            id: `command-pin-warning-badge-${suffix}`,
            type: 'symbol',
            source: sourceId,
            ...(filter ? { filter: layerFilter } : {}),
            layout: {
              'text-field': ['case', ['==', ['get', 'queueBlockedBadge'], 1], '⛔', ['==', ['get', 'needsReviewBadge'], 1], '⚠', ['==', ['get', 'followUpDueBadge'], 1], '⏰', ['==', ['get', 'suppressedBadge'], 1], '🔒', ''],
              'text-size': 11,
              'text-offset': [1.05, -1.05],
              'text-allow-overlap': true,
            },
            paint: {
              'text-color': ['case', ['==', ['get', 'suppressedBadge'], 1], '#ff6b63', ['==', ['get', 'queueBlockedBadge'], 1], '#ff6b63', ['==', ['get', 'followUpDueBadge'], 1], '#ffd166', '#ffd166'],
              'text-halo-color': 'rgba(8,10,15,0.92)',
              'text-halo-width': 1.4,
              'text-opacity': ['get', 'focusOpacity'],
            },
          })
        }
      }

      addPointLayers('raw', RAW_SOURCE_ID)
      addPointLayers('clustered', CLUSTER_SOURCE_ID, ['!', ['has', 'point_count']])
      syncLayerVisibility(map, activityModeRef.current)
    }

    const center: [number, number] = selectedPin ? [selectedPin.lng, selectedPin.lat] : [-96, 37.8]
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: resolveStyle(mapStyleModeRef.current),
      center,
      zoom: zoomedIn ? 10.5 : 4.4,
      minZoom: 2,
      maxZoom: 18,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    })
    mapRef.current = map
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

    map.on('load', () => {
      addMapLayers(map)
      void syncBasemapPresentation(map)

      const handlePinClick = (event: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        const feature = event.features?.[0]
        if (!feature) return
        const id = String(feature.properties?.conversation_id || '')
        if (!id) return
        hoverPopupRef.current?.remove()
        threadPopupRef.current?.remove()
        setSelectedPinId(id)
        onSelectThreadIdRef.current?.(id)
        const coordinates = (feature.geometry as Point).coordinates as [number, number]
        setActiveThreadPopup({ id, coordinates })
        map.easeTo({ center: coordinates, zoom: Math.max(map.getZoom(), 12), duration: 700 })
      }

      const handleClusterClick = (event: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        const feature = event.features?.[0]
        if (!feature) return
        const clusterId = Number(feature.properties?.cluster_id)
        const source = map.getSource(CLUSTER_SOURCE_ID) as (maplibregl.GeoJSONSource & {
          getClusterExpansionZoom?: (id: number, cb: (error: Error | null, zoom: number) => void) => void
        }) | undefined
        if (!source?.getClusterExpansionZoom || !Number.isFinite(clusterId)) return
        source.getClusterExpansionZoom(clusterId, (error, zoom) => {
          if (error) return
          map.easeTo({
            center: (feature.geometry as Point).coordinates as [number, number],
            zoom,
            duration: 500,
          })
        })
      }

      const handlePinHover = (event: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        if (activeThreadPopupRef.current) return
        const feature = event.features?.[0]
        if (!feature?.properties) return
        const props = feature.properties as unknown as CommandMapPin
        const coordinates = (feature.geometry as Point).coordinates as [number, number]
        const popup = hoverPopupRef.current ?? new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 18,
          className: 'nx-icm-hover-popup',
          maxWidth: '360px',
        })
        popup
          .setLngLat(coordinates)
          .setHTML(buildHoverCardMarkup(props, mapStyleModeRef.current))
          .addTo(map)
        hoverPopupRef.current = popup
      }

      const clearPinHover = () => {
        if (activeThreadPopupRef.current) return
        hoverPopupRef.current?.remove()
      }

      map.on('click', 'command-pin-core-raw', handlePinClick)
      map.on('click', 'command-pin-core-clustered', handlePinClick)
      map.on('click', 'command-pin-cluster-core', handleClusterClick)
      map.on('click', (event) => {
        const rendered = map.queryRenderedFeatures(event.point, {
          layers: ['command-pin-core-raw', 'command-pin-core-clustered', 'command-pin-cluster-core'],
        })
        if (rendered.length === 0) {
          setActiveThreadPopup(null)
          onBackgroundClickRef.current?.()
        }
      })
      map.on('mouseenter', 'command-pin-core-raw', handlePinHover)
      map.on('mouseenter', 'command-pin-core-clustered', handlePinHover)
      map.on('mouseleave', 'command-pin-core-raw', clearPinHover)
      map.on('mouseleave', 'command-pin-core-clustered', clearPinHover)

      const pulseConfig: Record<PinFeatureProps['pulseTier'], { baseRadius: number; maxAdd: number; baseOpacity: number; speed: number }> = {
        fast: { baseRadius: 13, maxAdd: 8, baseOpacity: 0.26, speed: 1.65 },
        medium_fast: { baseRadius: 12, maxAdd: 6.5, baseOpacity: 0.2, speed: 1.2 },
        medium: { baseRadius: 11, maxAdd: 5, baseOpacity: 0.15, speed: 0.85 },
        slow: { baseRadius: 10, maxAdd: 3.5, baseOpacity: 0.1, speed: 0.55 },
        very_slow: { baseRadius: 9, maxAdd: 1.5, baseOpacity: 0, speed: 0 },
        none: { baseRadius: 8, maxAdd: 0, baseOpacity: 0, speed: 0 },
      }

      let frame = 0
      const animate = () => {
        if (!mapRef.current) return
        frame = (frame + 1) % 360
        const makeRadiusExpr = (tier: PinFeatureProps['pulseTier'], modeValue: PinFeatureProps['pulseMode']) => {
          const cfg = pulseConfig[tier]
          const phase = frame / 60
          const wave =
            modeValue === 'triple'
              ? Math.max(0, Math.sin(phase * 3.2))
              : cfg.speed === 0
                ? 0
                : (Math.sin(phase * cfg.speed) + 1) / 2
          return cfg.baseRadius + wave * cfg.maxAdd
        }
        const makeOpacityExpr = (tier: PinFeatureProps['pulseTier'], modeValue: PinFeatureProps['pulseMode']) => {
          const cfg = pulseConfig[tier]
          const phase = frame / 60
          const wave =
            modeValue === 'triple'
              ? Math.max(0, Math.sin(phase * 3.2))
              : cfg.speed === 0
                ? 0
                : (Math.sin(phase * cfg.speed) + 1) / 2
          return cfg.baseOpacity * (1 - wave * 0.55)
        }
        try {
          ;(['command-pin-pulse-raw', 'command-pin-pulse-clustered'] as const).forEach((layerId) => {
            if (!map.getLayer(layerId)) return
            map.setPaintProperty(layerId, 'circle-radius', [
              'case',
              ['==', ['get', 'pulseMode'], 'none'], 8,
              ['==', ['get', 'pulseMode'], 'ripple'], makeRadiusExpr('medium_fast', 'ripple'),
              ['==', ['get', 'pulseMode'], 'triple'], makeRadiusExpr('fast', 'triple'),
              ['match', ['get', 'pulseTier'],
                'fast', makeRadiusExpr('fast', 'continuous'),
                'medium_fast', makeRadiusExpr('medium_fast', 'continuous'),
                'medium', makeRadiusExpr('medium', 'continuous'),
                'slow', makeRadiusExpr('slow', 'continuous'),
                'very_slow', makeRadiusExpr('very_slow', 'continuous'),
                makeRadiusExpr('none', 'continuous'),
              ],
            ])
            map.setPaintProperty(layerId, 'circle-opacity', [
              '*',
              ['case',
                ['==', ['get', 'pulseMode'], 'none'], 0,
                ['==', ['get', 'pulseMode'], 'ripple'], makeOpacityExpr('medium_fast', 'ripple'),
                ['==', ['get', 'pulseMode'], 'triple'], makeOpacityExpr('fast', 'triple'),
                ['match', ['get', 'pulseTier'],
                  'fast', makeOpacityExpr('fast', 'continuous'),
                  'medium_fast', makeOpacityExpr('medium_fast', 'continuous'),
                  'medium', makeOpacityExpr('medium', 'continuous'),
                  'slow', makeOpacityExpr('slow', 'continuous'),
                  'very_slow', 0,
                  0,
                ],
              ],
              ['get', 'focusOpacity'],
            ])
          })
        } catch {
          return
        }
        animationRef.current = requestAnimationFrame(animate)
      }
      animationRef.current = requestAnimationFrame(animate)

      ;(['command-pin-core-raw', 'command-pin-core-clustered', 'command-pin-cluster-core'] as const).forEach((layerId) => {
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = '' })
      })
    })

    map.on('style.load', () => {
      addMapLayers(map)
      void syncBasemapPresentation(map)
    })

    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current)
      hoverPopupRef.current?.remove()
      threadPopupRootRef.current?.unmount()
      threadPopupRootRef.current = null
      threadPopupHostRef.current = null
      threadPopupRef.current?.remove()
      threadPopupRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const rawSource = mapRef.current?.getSource(RAW_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    const clusterSource = mapRef.current?.getSource(CLUSTER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    rawSource?.setData(geojson)
    clusterSource?.setData(geojson)
  }, [geojson])

  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.setStyle(resolveStyle(mapStyleMode))
  }, [mapStyleMode])

  useEffect(() => {
    if (!mapRef.current?.isStyleLoaded()) return
    const layers = mapRef.current.getStyle()?.layers ?? []
    layers.forEach((layer) => {
      const typedLayer = layer as StyleLayerLike
      if (!typedLayer.id || typedLayer.id.startsWith(ownLayerPrefix)) return
      const categories = classifyBaseLayer(typedLayer)
      if (categories.length === 0) return
      const visible = categories.every((category) => mapOverlays[category])
      if (mapRef.current?.getLayer(typedLayer.id)) {
        mapRef.current.setLayoutProperty(typedLayer.id, 'visibility', visible ? 'visible' : 'none')
      }
    })
  }, [mapOverlays])

  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.easeTo({
      pitch: mapDimension === '3d' ? 58 : 0,
      bearing: mapDimension === '3d' ? -18 : 0,
      duration: 550,
    })
  }, [mapDimension])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const clusteredMode = activityMode !== 'sends' && !activeKpiFilter
    RAW_LAYER_IDS.forEach((layerId) => {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', clusteredMode ? 'none' : 'visible')
    })
    CLUSTER_POINT_LAYER_IDS.forEach((layerId) => {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', clusteredMode ? 'visible' : 'none')
    })
    CLUSTER_LAYER_IDS.forEach((layerId) => {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', clusteredMode ? 'visible' : 'none')
    })
  }, [activeKpiFilter, activityMode])

  useEffect(() => {
    if (!mapRef.current || visiblePins.length === 0) return
    if (selectedPin) {
      mapRef.current.easeTo({
        center: [selectedPin.lng, selectedPin.lat],
        zoom: Math.max(mapRef.current.getZoom(), zoomedIn ? 13 : 11.25),
        duration: 680,
        offset: dockTier === 'full' ? [150, 0] : [0, 0],
      })
      return
    }
    const uniqueCoords = new Map<string, [number, number]>()
    visiblePins.forEach((pin) => {
      uniqueCoords.set(`${pin.lng}:${pin.lat}`, [pin.lng, pin.lat])
    })
    const coords = Array.from(uniqueCoords.values())
    const padding =
      dockTier === 'full'
        ? { top: 116, right: 72, bottom: 118, left: 36 }
        : dockTier === 'compact'
          ? { top: 92, right: 64, bottom: 90, left: 24 }
          : { top: 72, right: 24, bottom: 132, left: 24 }

    if (coords.length === 1) {
      mapRef.current.easeTo({ center: coords[0], zoom: zoomedIn ? 12 : 8, duration: 500 })
      return
    }
    const bounds = coords.reduce(
      (acc, [lng, lat]) => ({
        minLng: Math.min(acc.minLng, lng),
        maxLng: Math.max(acc.maxLng, lng),
        minLat: Math.min(acc.minLat, lat),
        maxLat: Math.max(acc.maxLat, lat),
      }),
      { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity },
    )
    mapRef.current.fitBounds([[bounds.minLng, bounds.minLat], [bounds.maxLng, bounds.maxLat]], {
      padding,
      duration: 550,
      maxZoom: zoomedIn ? 13 : 11,
    })
  }, [dockTier, selectedPin, visiblePins, zoomedIn])

  const markets = Array.from(new Set(allPins.map((pin) => pin.market).filter(Boolean))).sort()
  const stages = Array.from(new Set(allPins.map((pin) => pin.conversation_stage).filter(Boolean))).sort()
  const statuses = Array.from(new Set(allPins.map((pin) => pin.conversation_status).filter(Boolean))).sort()
  const temperatures = Array.from(new Set(allPins.map((pin) => pin.lead_temperature).filter(Boolean))).sort()
  const automationStatuses = Array.from(new Set(allPins.map((pin) => pin.automation_status).filter(Boolean))).sort()
  const propertyTypes = Array.from(new Set(allPins.map((pin) => pin.property_type).filter(Boolean))).sort()
  const selectedUnmapped = useMemo(
    () => selectedHydratedThread ? buildMapPin(selectedHydratedThread).unmapped : null,
    [selectedHydratedThread],
  )
  const emptyStateMessage = useMemo(() => {
    if (visiblePins.length > 0) return null
    if (filteredPins.length === 0 && allPins.length > 0) {
      return `No mapped pins match the current filters.${pinPipeline.unmapped.length > 0 ? ` ${pinPipeline.unmapped.length} conversations are missing coordinates.` : ''}`
    }
    if (allPins.length === 0 && pinPipeline.unmapped.length > 0) {
      return `No mapped pins found. ${pinPipeline.unmapped.length} conversations are missing coordinates.`
    }
    if (allPins.length === 0) {
      return 'No mapped pins found for the current inbox mode.'
    }
    return 'No visible pins found.'
  }, [allPins.length, filteredPins.length, pinPipeline.unmapped.length, visiblePins.length])

  const handleTickerSelect = (item: LiveTickerItem) => {
    setSelectedPinId(item.threadId)
    onSelectThreadId?.(item.threadId)
    setActiveThreadPopup({ id: item.threadId, coordinates: [item.lng, item.lat] })
    mapRef.current?.easeTo({
      center: [item.lng, item.lat],
      zoom: Math.max(mapRef.current.getZoom(), 12.4),
      duration: 620,
    })
  }

  return (
    <div ref={rootRef} className={cls('nx-icm', `nx-icm--${dockTier}`, fullHeight && 'nx-icm--full')}>
      {!commandMode && <div ref={controlsRef} className="nx-icm__toolbar">
        <div className="nx-icm__header">
          <div className="nx-icm__header-badge">
            <span>Live Map</span>
            <strong>{visiblePins.length}</strong>
          </div>
          <div className="nx-icm__header-actions">
            <button type="button" className={cls('nx-icm__mode-tab', filtersOpen && 'is-active')} onClick={() => setFiltersOpen((open) => !open)}>
              Map Controls
            </button>
          </div>
        </div>
        {filtersOpen && (
          <div className="nx-icm__controls-popover">
            <div className="nx-icm__controls-group">
              <span className="nx-icm__controls-label">View Mode</span>
              <div className="nx-icm__controls-segment">
                {([
                  ['all', 'All'],
                  ['threads', 'Threads'],
                  ['sends', 'Sends'],
                  ['follow_ups', 'Follow-Ups'],
                ] as Array<[InboxMapActivityMode, string]>).map(([value, label]) => (
                  <button key={value} type="button" className={cls('nx-icm__mode-tab', activityMode === value && 'is-active')} onClick={() => setActivityMode(value)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="nx-icm__controls-group">
              <span className="nx-icm__controls-label">Pin Scope</span>
              <div className="nx-icm__controls-segment">
                <button type="button" className={cls('nx-icm__mode-tab', sourceMode === 'all_active_coordinate_threads' && 'is-active')} onClick={() => onSourceModeChange?.('all_active_coordinate_threads')}>
                  All Pins
                </button>
                <button type="button" className={cls('nx-icm__mode-tab', sourceMode === 'visible_threads' && 'is-active')} onClick={() => onSourceModeChange?.('visible_threads')}>
                  Filtered Pins
                </button>
              </div>
            </div>
            <div className="nx-icm__controls-group">
              <div className="nx-icm__controls-headerline">
                <span className="nx-icm__controls-label">KPI Focus</span>
                <label className="nx-icm__checkbox">
                  <input type="checkbox" checked={showKpiBadges} onChange={(event) => setShowKpiBadges(event.target.checked)} />
                  KPI Badges
                </label>
              </div>
              <div className="nx-icm__controls-segment">
                {kpiChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    className={cls('nx-icm__kpi-chip', activeKpiFilter === chip.key && 'is-active')}
                    onClick={() => setActiveKpiFilter((current) => current === chip.key ? null : chip.key)}
                    style={{ '--icm-kpi-tone': chip.tone } as CSSProperties}
                  >
                    <span>{chip.label}</span>
                    <strong>{chip.count}</strong>
                  </button>
                ))}
              </div>
            </div>
            <div className="nx-icm__controls-group">
              <span className="nx-icm__controls-label">Map View</span>
              <div className="nx-icm__controls-segment">
                <button type="button" className={cls('nx-icm__mode-tab', mapStyleMode === 'dark' && 'is-active')} onClick={() => setMapStyleMode('dark')}>
                  Dark
                </button>
                <button type="button" className={cls('nx-icm__mode-tab', mapStyleMode === 'red' && 'is-active')} onClick={() => setMapStyleMode('red')}>
                  Red Ops
                </button>
                <button type="button" className={cls('nx-icm__mode-tab', mapStyleMode === 'satellite' && 'is-active')} onClick={() => setMapStyleMode('satellite')}>
                  Satellite
                </button>
                <button type="button" className={cls('nx-icm__mode-tab', mapDimension === '2d' && 'is-active')} onClick={() => setMapDimension('2d')}>
                  2D
                </button>
                <button type="button" className={cls('nx-icm__mode-tab', mapDimension === '3d' && 'is-active')} onClick={() => setMapDimension('3d')}>
                  3D
                </button>
              </div>
            </div>
            <div className="nx-icm__controls-group">
              <span className="nx-icm__controls-label">Map Layers</span>
              <div className="nx-icm__controls-segment">
                <label className="nx-icm__checkbox"><input type="checkbox" checked={mapOverlays.roads} onChange={(e) => setMapOverlays((current) => ({ ...current, roads: e.target.checked }))} />Roads</label>
                <label className="nx-icm__checkbox"><input type="checkbox" checked={mapOverlays.cities} onChange={(e) => setMapOverlays((current) => ({ ...current, cities: e.target.checked }))} />Cities</label>
                <label className="nx-icm__checkbox"><input type="checkbox" checked={mapOverlays.poi} onChange={(e) => setMapOverlays((current) => ({ ...current, poi: e.target.checked }))} />POI</label>
                <label className="nx-icm__checkbox"><input type="checkbox" checked={mapOverlays.zip} onChange={(e) => setMapOverlays((current) => ({ ...current, zip: e.target.checked }))} />ZIP</label>
              </div>
            </div>
            <div className="nx-icm__controls-group">
              <span className="nx-icm__controls-label">Filters</span>
              <div className="nx-icm__filter-grid">
                <select value={filters.market} onChange={(e) => setFilters((current) => ({ ...current, market: e.target.value }))}>
                  <option value="">All Markets</option>
                  {markets.map((market) => <option key={market} value={market}>{market}</option>)}
                </select>
                <select value={filters.stage} onChange={(e) => setFilters((current) => ({ ...current, stage: e.target.value }))}>
                  <option value="">All Stages</option>
                  {stages.map((stage) => <option key={stage} value={stage}>{stage.replace(/_/g, ' ')}</option>)}
                </select>
                <select value={filters.status} onChange={(e) => setFilters((current) => ({ ...current, status: e.target.value }))}>
                  <option value="">All Statuses</option>
                  {statuses.map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}
                </select>
                <select value={filters.leadTemperature} onChange={(e) => setFilters((current) => ({ ...current, leadTemperature: e.target.value }))}>
                  <option value="">All Temperatures</option>
                  {temperatures.map((temperature) => <option key={temperature} value={temperature}>{temperature.replace(/_/g, ' ')}</option>)}
                </select>
                <select value={filters.automationStatus} onChange={(e) => setFilters((current) => ({ ...current, automationStatus: e.target.value }))}>
                  <option value="">All Automation</option>
                  {automationStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
                <select value={filters.propertyType} onChange={(e) => setFilters((current) => ({ ...current, propertyType: e.target.value }))}>
                  <option value="">All Property Types</option>
                  {propertyTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <label className="nx-icm__checkbox"><input type="checkbox" checked={filters.unreadOnly} onChange={(e) => setFilters((current) => ({ ...current, unreadOnly: e.target.checked }))} />Unread</label>
                <label className="nx-icm__checkbox"><input type="checkbox" checked={filters.followUpDue} onChange={(e) => setFilters((current) => ({ ...current, followUpDue: e.target.checked }))} />Follow-Up Due</label>
                <label className="nx-icm__checkbox"><input type="checkbox" checked={filters.highEquity} onChange={(e) => setFilters((current) => ({ ...current, highEquity: e.target.checked }))} />High Equity</label>
              </div>
            </div>
            <div className="nx-icm__controls-group">
              <span className="nx-icm__controls-label">Map Key</span>
              <div className="nx-icm__legend-grid">
                {(activityMode === 'threads'
                  ? [
                      ['New', '#97a3b6'],
                      ['Interest', '#38bdf8'],
                      ['Price', '#a855f7'],
                      ['Offer', '#30d158'],
                      ['Negotiation', '#ff9f0a'],
                      ['Contract', '#14b8a6'],
                      ['Suppressed', '#ff453a'],
                    ]
                  : activityMode === 'sends'
                    ? [
                        ['Queued', '#5d6a7b'],
                        ['Sending', '#3b82f6'],
                        ['Delivered', '#30d158'],
                        ['Replied', '#38bdf8'],
                        ['Failed', '#ff453a'],
                      ]
                    : activityMode === 'follow_ups'
                      ? [
                          ['Due Now', '#ffb000'],
                          ['Later Today', '#5bb6ff'],
                          ['Tomorrow', '#14b8a6'],
                          ['Overdue', '#ff453a'],
                          ['Stale', '#7d8795'],
                        ]
                      : [
                          ['Replies', '#38bdf8'],
                          ['Review', '#ffb000'],
                          ['Queued', '#5d6a7b'],
                          ['Offers', '#30d158'],
                          ['Contracts', '#14b8a6'],
                          ['Blocked', '#ff453a'],
                        ]).map(([label, color]) => (
                  <div key={label} className="nx-icm__legend-row">
                    <span className="nx-icm__legend-chip" style={{ backgroundColor: color }} />
                    <span className="nx-icm__legend-label">{label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="nx-icm__controls-actions">
              <button type="button" className="nx-icm__mode-tab" onClick={() => {
                setFilters(defaultFilters)
                setActiveKpiFilter(null)
              }}>
                Clear Filters
              </button>
              <button type="button" className="nx-icm__mode-tab is-active" onClick={() => setFiltersOpen(false)}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>}

      <div ref={containerRef} className="nx-icm__canvas" />

      {emptyStateMessage && (
        <div className="nx-icm__empty" style={{ pointerEvents: 'auto' }}>
          <div className="nx-icm__empty-title">No Visible Pins</div>
          <p className="nx-icm__empty-sub">{emptyStateMessage}</p>
          {selectedHiddenByFilters && selectedBasePin && (
            <button type="button" className="nx-icm__mode-tab is-active" onClick={() => setShowSelectedHidden(true)}>
              Show Selected
            </button>
          )}
        </div>
      )}

      {selectedUnmapped && (
        <div className="nx-icm__empty" style={{ top: '56px', left: '50%', transform: 'translateX(-50%)', padding: '12px 16px', pointerEvents: 'auto' }}>
          <div className="nx-icm__empty-title">Selected Conversation Is Unmapped</div>
          <p className="nx-icm__empty-sub">No coordinates are available for {selectedUnmapped.seller_name || 'this conversation'}.</p>
        </div>
      )}

      {selectedHiddenByFilters && selectedBasePin && !showSelectedHidden && (
        <div className="nx-icm__empty" style={{ top: '56px', left: '50%', transform: 'translateX(-50%)', padding: '12px 16px', pointerEvents: 'auto' }}>
          <div className="nx-icm__empty-title">Selected Hidden By Filters</div>
          <p className="nx-icm__empty-sub">The selected conversation has coordinates but is excluded by the current filters.</p>
          <button type="button" className="nx-icm__mode-tab is-active" onClick={() => setShowSelectedHidden(true)}>
            Show Selected
          </button>
        </div>
      )}

      {dockTier === 'full' && showKpiBadges && !filtersOpen && !commandMode && <div className="nx-icm__overlay-kpis" aria-label="Map mode KPIs">
        {kpiChips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className={cls('nx-icm__overlay-kpi', activeKpiFilter === chip.key && 'is-active')}
            onClick={() => setActiveKpiFilter((current) => current === chip.key ? null : chip.key)}
            style={{ '--icm-kpi-tone': chip.tone } as CSSProperties}
          >
            <span>{chip.label}</span>
            <strong>{chip.count}</strong>
          </button>
        ))}
      </div>}

      {dockTier === 'full' && liveTickerItems.length > 0 && !commandMode && (
        <div className={cls('nx-icm__ticker', `is-${mapStyleMode}`, `is-${tickerDensity}`)} style={cardThemeVars(mapStyleMode)} aria-label="Live activity ticker">
          <div className="nx-icm__ticker-toolbar">
            <div className="nx-icm__ticker-heading">
              <span className="nx-icm__ticker-heading-dot" />
              <strong>Live Activity</strong>
            </div>
            <div className="nx-icm__ticker-density" role="group" aria-label="Ticker density">
              {(['minimal', 'compact', 'expanded'] as TickerDensity[]).map((density) => (
                <button
                  key={density}
                  type="button"
                  className={cls('nx-icm__ticker-density-btn', tickerDensity === density && 'is-active')}
                  onClick={() => setTickerDensity(density)}
                >
                  {density}
                </button>
              ))}
            </div>
          </div>
          <div className="nx-icm__ticker-viewport">
          <div className="nx-icm__ticker-track">
            {[...liveTickerItems, ...liveTickerItems].map((item, index) => (
              <article
                key={`${item.id}:${index}`}
                className={cls('nx-icm__ticker-item', `is-${item.tone}`)}
                role="button"
                tabIndex={0}
                onClick={() => handleTickerSelect(item)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    handleTickerSelect(item)
                  }
                }}
              >
                <div className="nx-icm__ticker-item-head">
                  <span className="nx-icm__ticker-label">{item.badge}</span>
                  <span className="nx-icm__ticker-meta">{item.timeAgo}</span>
                </div>
                <strong className="nx-icm__ticker-subject">{item.sellerName}</strong>
                <span className="nx-icm__ticker-locale">{item.location}</span>
                <div className="nx-icm__ticker-reveal">
                  {item.preview && (
                    <div className="nx-icm__ticker-detail-block">
                      <span className="nx-icm__ticker-detail-label">{item.detailLabel || 'Detail'}</span>
                      <p className="nx-icm__ticker-detail">{item.preview}</p>
                    </div>
                  )}
                  {item.address && <p className="nx-icm__ticker-address">{item.address}</p>}
                  <div className="nx-icm__ticker-pills">
                    {item.stageLabel && <span className="nx-icm__ticker-pill">{item.stageLabel}</span>}
                    {item.statusLabel && <span className="nx-icm__ticker-pill is-muted">{item.statusLabel}</span>}
                  </div>
                  {!item.disabledReply && (
                    <div className="nx-icm__ticker-actions">
                      <button
                        type="button"
                        className="nx-icm__ticker-action"
                        onClick={(event) => {
                          event.stopPropagation()
                          handleTickerSelect(item)
                        }}
                      >
                        Open Thread
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
          </div>
        </div>
      )}
    </div>
  )
}
