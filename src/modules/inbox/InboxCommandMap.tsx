import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection, Point } from 'geojson'
import type { InboxWorkflowThread } from '../../lib/data/inboxWorkflowData'
import type { MapSourceMode } from './inbox-layout-state'
import { buildConversationDecision } from './inbox-decisioning'
import { buildStreetViewUrl } from './inbox-normalization'

const DARK_MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const SATELLITE_MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
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
type MapStyleMode = 'dark' | 'satellite'

export type InboxMapActivityMode = 'threads' | 'sends' | 'follow_ups'

type ThreadMapState = 'new_replies' | 'needs_review' | 'waiting_on_seller' | 'negotiating' | 'follow_up_due' | 'suppressed'
type SendMapState = 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'replied' | 'opted_out' | 'queue_blocked'
type FollowUpMapState = 'due_now' | 'due_later_today' | 'due_tomorrow' | 'overdue' | 'stale_no_response'
type PinActivityState = ThreadMapState | SendMapState | FollowUpMapState

type MapFilterState = {
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

const cls = (...tokens: Array<string | false | null | undefined>) => tokens.filter(Boolean).join(' ')
const text = (value: unknown): string => String(value ?? '').trim()
const lower = (value: unknown): string => text(value).toLowerCase()
const num = (value: unknown): number | null => {
  const n = Number(String(value ?? '').replace(/[,$\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

const stageColor = (pin: CommandMapPin): string => {
  if (pin.activity_mode === 'sends') {
    if (pin.activity_state === 'queued') return '#5d6a7b'
    if (pin.activity_state === 'sending' || pin.activity_state === 'sent') return '#3b82f6'
    if (pin.activity_state === 'delivered') return '#30d158'
    if (pin.activity_state === 'failed' || pin.activity_state === 'opted_out' || pin.activity_state === 'queue_blocked') return '#ff453a'
    if (pin.activity_state === 'replied') return '#38bdf8'
  }
  if (pin.activity_mode === 'follow_ups') {
    if (pin.activity_state === 'overdue') return '#ff453a'
    if (pin.activity_state === 'due_now') return '#ffb000'
    if (pin.activity_state === 'due_later_today') return '#5bb6ff'
    if (pin.activity_state === 'due_tomorrow') return '#14b8a6'
    if (pin.activity_state === 'stale_no_response') return '#7d8795'
  }
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
  if (pin.activity_mode === 'sends') {
    if (pin.activity_state === 'sending') return 'continuous'
    if (pin.activity_state === 'sent' || pin.activity_state === 'delivered' || pin.activity_state === 'replied' || pin.activity_state === 'opted_out') return 'ripple'
    if (pin.activity_state === 'failed') return 'triple'
    return 'none'
  }
  if (pin.activity_mode === 'follow_ups') {
    if (pin.activity_state === 'overdue') return 'continuous'
    if (pin.activity_state === 'due_now') return 'continuous'
    return 'none'
  }
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
      activityMode === 'threads'
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
): FeatureCollection<Point, PinFeatureProps> => {
  const features: FeatureCollection<Point, PinFeatureProps>['features'] = []

  pins.forEach((pin) => {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [pin.lng, pin.lat] },
      properties: {
        ...pin,
        featureType: 'pin',
        selected: pin.conversation_id === selectedConversationId ? 1 : 0,
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

const buildThreadModeKpis = (pins: CommandMapPin[]) => ({
  newReplies: pins.filter((pin) => pin.activity_state === 'new_replies').length,
  review: pins.filter((pin) => pin.activity_state === 'needs_review').length,
  waiting: pins.filter((pin) => pin.activity_state === 'waiting_on_seller').length,
  negotiating: pins.filter((pin) => pin.activity_state === 'negotiating').length,
  due: pins.filter((pin) => pin.activity_state === 'follow_up_due').length,
  suppressed: pins.filter((pin) => pin.activity_state === 'suppressed').length,
})

const buildSendModeKpis = (pins: CommandMapPin[]) => {
  const queued = pins.filter((pin) => pin.activity_state === 'queued').length
  const sending = pins.filter((pin) => pin.activity_state === 'sending').length
  const sentToday = pins.filter((pin) => ['sent', 'delivered', 'replied', 'failed'].includes(pin.activity_state) && (minutesBetween(pin.last_outbound_at) ?? Infinity) <= 1440).length
  const deliveredToday = pins.filter((pin) => pin.activity_state === 'delivered' && (minutesBetween(pin.last_outbound_at) ?? Infinity) <= 1440).length
  const failedToday = pins.filter((pin) => pin.activity_state === 'failed' && (minutesBetween(pin.last_outbound_at) ?? Infinity) <= 1440).length
  const repliesToday = pins.filter((pin) => pin.activity_state === 'replied' && (minutesBetween(pin.last_inbound_at) ?? Infinity) <= 1440).length
  const optOutsToday = pins.filter((pin) => pin.activity_state === 'opted_out' && (minutesBetween(pin.last_activity_at) ?? Infinity) <= 1440).length
  const deliveryRate = sentToday > 0 ? (deliveredToday / sentToday) * 100 : 0
  const replyRate = sentToday > 0 ? (repliesToday / sentToday) * 100 : 0
  const optOutRate = sentToday > 0 ? (optOutsToday / sentToday) * 100 : 0
  return { queued, sending, sentToday, deliveredToday, failedToday, repliesToday, optOutsToday, deliveryRate, replyRate, optOutRate }
}

const buildFollowUpModeKpis = (pins: CommandMapPin[]) => ({
  dueNow: pins.filter((pin) => pin.activity_state === 'due_now').length,
  laterToday: pins.filter((pin) => pin.activity_state === 'due_later_today').length,
  tomorrow: pins.filter((pin) => pin.activity_state === 'due_tomorrow').length,
  overdue: pins.filter((pin) => pin.activity_state === 'overdue').length,
  stale: pins.filter((pin) => pin.activity_state === 'stale_no_response').length,
})

const buildLiveTickerItems = (pins: CommandMapPin[]) => {
  return pins
    .map((pin) => {
      const label =
        pin.activity_state === 'sent' ? 'sent'
          : pin.activity_state === 'delivered' ? 'delivered'
            : pin.activity_state === 'failed' ? 'failed'
              : pin.activity_state === 'replied' ? 'reply received'
                : pin.activity_state === 'opted_out' ? 'opt-out'
                  : pin.activity_state === 'queue_blocked' ? 'queue blocked'
                    : pin.activity_state === 'queued' && pin.next_follow_up_at ? 'follow-up scheduled'
                      : pin.activity_state
      const timestamp = pin.activity_state === 'replied' ? pin.last_inbound_at : pin.last_outbound_at || pin.last_activity_at
      return { id: `${pin.conversation_id}:${pin.activity_state}`, label, subject: pin.seller_name, market: pin.market, timestamp }
    })
    .sort((left, right) => new Date(right.timestamp || 0).getTime() - new Date(left.timestamp || 0).getTime())
    .slice(0, 10)
}

const resolveStyle = (styleMode: MapStyleMode) => {
  const envStyle = (import.meta.env as Record<string, string>).VITE_MAP_STYLE_URL
  if (styleMode === 'satellite') return SATELLITE_MAP_STYLE
  return typeof envStyle === 'string' && envStyle.length > 0 ? envStyle : DARK_MAP_STYLE
}

const buildHoverCardMarkup = (pin: CommandMapPin): string => {
  const imageUrl = pin.streetview_image || buildStreetViewUrl(pin.address) || ''
  const metric = (label: string, value: string) => `<div class="nx-icm-hover__metric"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`
  return `
    <article class="nx-icm-hover">
      ${imageUrl ? `<div class="nx-icm-hover__media"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(pin.address)} street view" loading="lazy" /></div>` : ''}
      <div class="nx-icm-hover__body">
        <div class="nx-icm-hover__head">
          <div>
            <p class="nx-icm-hover__eyebrow">${escapeHtml(pin.activity_label)}</p>
            <h4>${escapeHtml(pin.seller_name)}</h4>
          </div>
          <span class="nx-icm-hover__stage">${escapeHtml(formatLabel(pin.conversation_stage))}</span>
        </div>
        <p class="nx-icm-hover__address">${escapeHtml(pin.address)}</p>
        <div class="nx-icm-hover__stats">
          ${metric('Beds', formatInteger(pin.beds))}
          ${metric('Baths', formatInteger(pin.baths))}
          ${metric('Sqft', formatInteger(pin.sqft))}
          ${metric('Units', formatInteger(pin.units))}
          ${metric('Value', formatCurrency(pin.estimated_value))}
          ${metric('Repairs', formatCurrency(pin.repair_estimate))}
          ${metric('Equity', formatPercent(pin.equity_percent ?? NaN))}
          ${metric('Status', formatLabel(pin.conversation_status))}
        </div>
        <div class="nx-icm-hover__message">
          <span>Last Message</span>
          <p>${escapeHtml(pin.last_message || 'No recent message')}</p>
        </div>
      </div>
    </article>
  `
}

interface Props {
  threads: InboxWorkflowThread[]
  visibleThreads: InboxWorkflowThread[]
  selectedThread: InboxWorkflowThread | null
  zoomedIn: boolean
  sourceMode: MapSourceMode
  onSelectThreadId?: (threadId: string) => void
  fullHeight?: boolean
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
  zoomedIn,
  sourceMode,
  onSelectThreadId,
  fullHeight = false,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const animationRef = useRef<number | null>(null)
  const hoverPopupRef = useRef<maplibregl.Popup | null>(null)
  const geojsonRef = useRef<FeatureCollection<Point, PinFeatureProps>>(featureCollectionForPins([], null))
  const activityModeRef = useRef<InboxMapActivityMode>('threads')
  const [activityMode, setActivityMode] = useState<InboxMapActivityMode>('threads')
  const [filters, setFilters] = useState<MapFilterState>(defaultFilters)
  const [selectedPinId, setSelectedPinId] = useState<string | null>(selectedThread?.id ?? null)
  const [showSelectedHidden, setShowSelectedHidden] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [dockTier, setDockTier] = useState<'mini' | 'compact' | 'full'>('full')
  const [mapStyleMode, setMapStyleMode] = useState<MapStyleMode>('dark')
  const [mapDimension, setMapDimension] = useState<'2d' | '3d'>('2d')

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
  const geojson = useMemo(
    () => featureCollectionForPins(visiblePins, selectedPin?.conversation_id ?? null),
    [visiblePins, selectedPin?.conversation_id],
  )
  const threadModeKpis = useMemo(() => buildThreadModeKpis(visiblePins), [visiblePins])
  const sendModeKpis = useMemo(() => buildSendModeKpis(visiblePins), [visiblePins])
  const followUpModeKpis = useMemo(() => buildFollowUpModeKpis(visiblePins), [visiblePins])
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

  useEffect(() => {
    setShowSelectedHidden(false)
  }, [selectedThread?.id, activityMode])

  useEffect(() => {
    setSelectedPinId(selectedThread?.id ?? null)
  }, [selectedThread?.id])

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
      const clusteredMode = nextMode !== 'sends'
      setLayerVisibility(map, RAW_LAYER_IDS, !clusteredMode)
      setLayerVisibility(map, CLUSTER_POINT_LAYER_IDS, clusteredMode)
      setLayerVisibility(map, CLUSTER_LAYER_IDS, clusteredMode)
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
              'circle-opacity': ['case', ['==', ['get', 'glowStrength'], 1], 0.44, ['>=', ['get', 'glowStrength'], 0.8], 0.32, ['>=', ['get', 'glowStrength'], 0.52], 0.22, 0.12],
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
              'circle-opacity': ['case', ['==', ['get', 'pulseMode'], 'none'], 0, ['match', ['get', 'pulseTier'], 'fast', 0.28, 'medium_fast', 0.22, 'medium', 0.18, 'slow', 0.12, 'very_slow', 0, 0]],
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
              'circle-stroke-opacity': 0.94,
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
              'circle-stroke-opacity': 0.96,
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
              'circle-stroke-opacity': 0.92,
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
              'circle-opacity': ['case', ['==', ['get', 'lockState'], 1], 0.9, 0.98],
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
      style: resolveStyle(mapStyleMode),
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

      const handlePinClick = (event: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        const feature = event.features?.[0]
        if (!feature) return
        const id = String(feature.properties?.conversation_id || '')
        if (!id) return
        hoverPopupRef.current?.remove()
        setSelectedPinId(id)
        onSelectThreadId?.(id)
        map.easeTo({ center: (feature.geometry as Point).coordinates as [number, number], zoom: Math.max(map.getZoom(), 12), duration: 700 })
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
          .setHTML(buildHoverCardMarkup(props))
          .addTo(map)
        hoverPopupRef.current = popup
      }

      const clearPinHover = () => {
        hoverPopupRef.current?.remove()
      }

      map.on('click', 'command-pin-core-raw', handlePinClick)
      map.on('click', 'command-pin-core-clustered', handlePinClick)
      map.on('click', 'command-pin-cluster-core', handleClusterClick)
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
              'case',
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
    })

    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current)
      hoverPopupRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [onSelectThreadId, selectedPin, zoomedIn])

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
    const clusteredMode = activityMode !== 'sends'
    RAW_LAYER_IDS.forEach((layerId) => {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', clusteredMode ? 'none' : 'visible')
    })
    CLUSTER_POINT_LAYER_IDS.forEach((layerId) => {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', clusteredMode ? 'visible' : 'none')
    })
    CLUSTER_LAYER_IDS.forEach((layerId) => {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', clusteredMode ? 'visible' : 'none')
    })
  }, [activityMode])

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
        ? { top: 120, right: 168, bottom: 108, left: 360 }
        : dockTier === 'compact'
          ? { top: 88, right: 116, bottom: 84, left: 70 }
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

  return (
    <div ref={rootRef} className={cls('nx-icm', `nx-icm--${dockTier}`, fullHeight && 'nx-icm--full')}>
      <div className="nx-icm__toolbar">
        <div className="nx-icm__header">
          <div className="nx-icm__activity-tabs">
            {([
              ['threads', 'Threads'],
              ['sends', 'Sends'],
              ['follow_ups', 'Follow-Ups'],
            ] as Array<[InboxMapActivityMode, string]>).map(([value, label]) => (
              <button key={value} type="button" className={cls('nx-icm__mode-tab', activityMode === value && 'is-active')} onClick={() => setActivityMode(value)}>
                {label}
              </button>
            ))}
          </div>
          <div ref={controlsRef} className="nx-icm__header-actions">
            <button type="button" className={cls('nx-icm__mode-tab', filtersOpen && 'is-active')} onClick={() => setFiltersOpen((open) => !open)}>
              Map Controls
            </button>
          </div>
        </div>
        {filtersOpen && (
          <div className="nx-icm__controls-popover">
            <div className="nx-icm__controls-group">
              <span className="nx-icm__controls-label">Map View</span>
              <div className="nx-icm__controls-segment">
                <button type="button" className={cls('nx-icm__mode-tab', mapStyleMode === 'dark' && 'is-active')} onClick={() => setMapStyleMode('dark')}>
                  Dark
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
            <div className="nx-icm__controls-actions">
              <button type="button" className="nx-icm__mode-tab" onClick={() => setFilters(defaultFilters)}>
                Clear Filters
              </button>
              <button type="button" className="nx-icm__mode-tab is-active" onClick={() => setFiltersOpen(false)}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>

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

      {dockTier === 'full' && <div className="nx-icm__overlay-kpis" aria-label="Map mode KPIs">
        {activityMode === 'threads' && (
          <>
            <div className="nx-icm__overlay-kpi"><span>New Replies</span><strong>{threadModeKpis.newReplies}</strong></div>
            <div className="nx-icm__overlay-kpi"><span>Needs Review</span><strong>{threadModeKpis.review}</strong></div>
            <div className="nx-icm__overlay-kpi"><span>Waiting</span><strong>{threadModeKpis.waiting}</strong></div>
            <div className="nx-icm__overlay-kpi"><span>Negotiating</span><strong>{threadModeKpis.negotiating}</strong></div>
            <div className="nx-icm__overlay-kpi"><span>Follow-Up Due</span><strong>{threadModeKpis.due}</strong></div>
            <div className="nx-icm__overlay-kpi"><span>Suppressed</span><strong>{threadModeKpis.suppressed}</strong></div>
          </>
        )}
        {activityMode === 'sends' && (
          <>
            <div className="nx-icm__overlay-kpi"><span>Queued</span><strong>{sendModeKpis.queued}</strong></div>
            <div className="nx-icm__overlay-kpi"><span>Sending</span><strong>{sendModeKpis.sending}</strong></div>
            <div className="nx-icm__overlay-kpi"><span>Sent Today</span><strong>{sendModeKpis.sentToday}</strong></div>
            <div className="nx-icm__overlay-kpi"><span>Delivered</span><strong>{sendModeKpis.deliveredToday}</strong></div>
            <div className="nx-icm__overlay-kpi"><span>Failed</span><strong>{sendModeKpis.failedToday}</strong></div>
            <div className="nx-icm__overlay-kpi"><span>Replies</span><strong>{sendModeKpis.repliesToday}</strong></div>
            <div className="nx-icm__overlay-kpi"><span>Opt-Outs</span><strong>{sendModeKpis.optOutsToday}</strong></div>
            <div className="nx-icm__overlay-kpi"><span>Delivery Rate</span><strong>{formatPercent(sendModeKpis.deliveryRate)}</strong></div>
            <div className="nx-icm__overlay-kpi"><span>Reply Rate</span><strong>{formatPercent(sendModeKpis.replyRate)}</strong></div>
            <div className="nx-icm__overlay-kpi"><span>Opt-Out Rate</span><strong>{formatPercent(sendModeKpis.optOutRate)}</strong></div>
          </>
        )}
        {activityMode === 'follow_ups' && (
          <>
            <div className="nx-icm__overlay-kpi"><span>Due Now</span><strong>{followUpModeKpis.dueNow}</strong></div>
            <div className="nx-icm__overlay-kpi"><span>Later Today</span><strong>{followUpModeKpis.laterToday}</strong></div>
            <div className="nx-icm__overlay-kpi"><span>Tomorrow</span><strong>{followUpModeKpis.tomorrow}</strong></div>
            <div className="nx-icm__overlay-kpi"><span>Overdue</span><strong>{followUpModeKpis.overdue}</strong></div>
            <div className="nx-icm__overlay-kpi"><span>Stale</span><strong>{followUpModeKpis.stale}</strong></div>
          </>
        )}
      </div>}
      {selectedPin && (
        <div className="nx-icm__card nx-icm__card--actionable">
          <div className="nx-icm__card-row nx-icm__card-row--head">
            <span className="nx-icm__card-subject">{selectedPin.seller_name}</span>
            <span className="nx-icm__card-badge" style={{ '--icm-badge-color': badgeColor(selectedPin) } as CSSProperties}>{selectedPin.activity_label}</span>
          </div>
          <div className="nx-icm__card-row"><span className="nx-icm__card-label">Address</span><span className="nx-icm__card-value">{selectedPin.address}</span></div>
          <div className="nx-icm__card-row"><span className="nx-icm__card-label">Stage</span><span className="nx-icm__card-value">{formatLabel(selectedPin.conversation_stage)}</span></div>
          <div className="nx-icm__card-row"><span className="nx-icm__card-label">Status</span><span className="nx-icm__card-value">{formatLabel(selectedPin.conversation_status)}</span></div>
          <div className="nx-icm__card-row"><span className="nx-icm__card-label">Last Message</span><span className="nx-icm__card-value">{selectedPin.last_message || 'No recent message'}</span></div>
          <div className="nx-icm__card-row"><span className="nx-icm__card-label">Next Action</span><span className="nx-icm__card-value">{selectedPin.next_action}</span></div>
          <div className="nx-icm__actions">
            <button type="button" onClick={() => onSelectThreadId?.(selectedPin.conversation_id)}>Open Thread</button>
            <button type="button">Open Dossier</button>
            <button type="button">Snooze</button>
            <button type="button">Suppress</button>
          </div>
        </div>
      )}

      {(dockTier === 'full' || dockTier === 'compact') && <div className="nx-icm__legend" aria-label="Command Map Legend">
        <div className="nx-icm__legend-title">{activityMode === 'threads' ? 'Thread States' : activityMode === 'sends' ? 'Send States' : 'Follow-Up States'}</div>
        {(activityMode === 'threads'
          ? [
              ['New', '#7d8795'],
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
            : [
                ['Due Now', '#ffb000'],
                ['Later Today', '#5bb6ff'],
                ['Tomorrow', '#14b8a6'],
                ['Overdue', '#ff453a'],
                ['Stale', '#7d8795'],
              ]).map(([label, color]) => (
          <div key={label} className="nx-icm__legend-row">
            <span className="nx-icm__legend-chip" style={{ backgroundColor: color }} />
            <span className="nx-icm__legend-label">{label}</span>
          </div>
        ))}
      </div>}

      {dockTier === 'mini' && (
        <div className="nx-icm__legend nx-icm__legend--mini" aria-label="Mini map legend">
          <div className="nx-icm__legend-title">{activityMode === 'threads' ? 'Threads' : activityMode === 'sends' ? 'Sends' : 'Follow-Ups'}</div>
          <div className="nx-icm__legend-row">
            <span className="nx-icm__legend-chip" style={{ backgroundColor: selectedPin ? stageColor(selectedPin) : '#7d8795' }} />
            <span className="nx-icm__legend-label">{selectedPin?.activity_label || 'No selection'}</span>
          </div>
        </div>
      )}

      {dockTier === 'full' && activityMode === 'sends' && liveTickerItems.length > 0 && (
        <div className="nx-icm__ticker" aria-label="Outbound live ticker">
          {liveTickerItems.map((item) => (
            <div key={item.id} className="nx-icm__ticker-item">
              <span className="nx-icm__ticker-label">{item.label}</span>
              <span className="nx-icm__ticker-subject">{item.subject}</span>
              <span className="nx-icm__ticker-meta">{item.market} • {formatRelative(item.timestamp)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="nx-icm__attribution">Deterministic command map</div>
    </div>
  )
}
