import { formatRelativeTime } from '../../shared/formatters'
import type { InboxModel, InboxThread } from '../../modules/inbox/inbox.adapter'
import { getSupabaseClient } from '../supabaseClient'
import {
  asBoolean,
  asIso,
  asNumber,
  asString,
  getFirst,
  mapErrorMessage,
  normalizeStatus,
  safeArray,
  shouldUseSupabase,
  type AnyRecord,
} from './shared'

/**
 * Confirmed message_events schema — direct column references used below:
 *   id, message_event_key, provider_message_sid
 *   direction, event_type, message_body
 *   from_phone_number  — sender (seller for inbound, our number for outbound)
 *   to_phone_number    — recipient (our number for inbound, seller for outbound)
 *   phone_number_id, queue_id, conversation_brain_id
 *   metadata (jsonb — may contain payload.from/to/raw.From/To/Body/SmsStatus)
 *   event_timestamp, created_at, sent_at, received_at, delivered_at, failed_at
 *   error_message, property_address, message_id
 *   master_owner_id, prospect_id, property_id
 *   textgrid_number_id, sms_agent_id, template_id
 *   market_id, ai_route, source_app
 *   delivery_status, raw_carrier_status, provider_delivery_status
 *   is_final_failure, failure_bucket, failure_code, failure_reason
 *   is_opt_out, opt_out_keyword, opt_out_message
 *   stage_before, stage_after, podio_sync_status
 *
 * Thread identity: group by sellerPhone (from_phone_number for inbound,
 *   to_phone_number for outbound) + property_id / master_owner_id.
 * Do NOT use provider_message_sid or message_event_key as thread key.
 */

export interface InboxThreadFilters {
  status?: 'all' | 'unread' | 'read' | 'replied' | 'archived'
  priority?: 'all' | 'urgent' | 'high' | 'normal' | 'low'
  query?: string
  view?: string
  stage?: string
  advanced?: Record<string, any>
}

export interface InboxFetchOptions {
  signal?: AbortSignal
  maxRows?: number
  offset?: number
  filters?: InboxThreadFilters
}

export interface ThreadMessage {
  id: string
  direction: 'inbound' | 'outbound' | 'unknown'
  body: string
  createdAt: string
  timelineAt: string
  deliveredAt: string | null
  deliveryStatus: string
  fromNumber: string
  toNumber: string
  ownerId: string
  prospectId: string
  propertyId: string
  phoneNumber: string
  canonicalE164: string
  templateId: string | null
  templateName: string | null
  agentId: string | null
  source: string
  rawStatus: string
  error: string | null
  developerMeta?: Record<string, string>
}

export interface ThreadContextDebug {
  resolvedPhoneTable: string | null
  resolvedMasterOwnerTable: string | null
  resolvedOwnerTable: string | null
  resolvedPropertyTable: string | null
  resolvedProspectTable: string | null
  matchedOwnerBy: string | null
  matchedProspectBy: string | null
  matchedPropertyBy: string | null
  matchedPhoneBy: string | null
  matchedPhoneRowId: string | null
  matchedEmailBy: string | null
  matchedAiBrainBy: string | null
  matchedQueueBy: string | null
  bridgedMasterOwnerId: string | null
  bridgedProspectId: string | null
  bridgedPropertyId: string | null
}

export interface ThreadContext {
  seller: { id: string; name: string; market: string } | null
  property: { id: string; address: string; market: string } | null
  phone: string | null
  contactStack: { type: string; value: string; status: string }[]
  dealContext: { stage: string; nextAction: string } | null
  aiContext: { summary: string; intent: string; sentiment: string } | null
  queueContext: { items: { id: string; status: string; scheduleAt: string | null }[] } | null
  contextMatchQuality: 'high' | 'medium' | 'low' | 'missing'
  contextDebug: ThreadContextDebug
}

export type ThreadIntelligenceRecord = Record<string, unknown>

export interface SuggestedDraft {
  text: string
  confidence: number | null
  reason: string | null
  source: 'ai_brain' | 'send_queue' | 'template' | 'placeholder'
}

export interface QueueReplyResult {
  ok: boolean
  queueId: string | null
  status: string | null
  errorMessage: string | null
  insertPayloadKeys: string[]
}

export interface SendNowResult {
  ok: boolean
  queueId: string | null
  messageEventId: string | null
  providerMessageSid: string | null
  deliveryStatus: string | null
  errorMessage: string | null
  insertPayloadKeys: string[]
  suppressionBlocked: boolean
  sendRouteUsed: 'send_queue_queued' | 'none'
  queueProcessorEligible: boolean
}

export interface QueueProcessorHealth {
  checkedAt: string
  queuedCount: number
  queuedOlderThanLagWindow: number
  oldestQueuedAt: string | null
  latestSentAt: string | null
  processorHealthy: boolean
  status: 'healthy' | 'lagging' | 'unknown'
  summary: string
}

const QUEUE_PROCESSOR_LAG_MINUTES = 10

const DEV = Boolean(import.meta.env.DEV)
const MESSAGE_EVENTS_THREAD_PAGE_SIZE = 1000

/** Values that map 1:1 to `nexus_inbox_threads_v.stage` / `inbox_thread_state.stage`. */
export const SERVER_INBOX_THREAD_STAGE_VALUES = new Set([
  'new_reply',
  'needs_response',
  'ai_draft_ready',
  'queued_reply',
  'sent_waiting',
  'interested',
  'needs_offer',
  'needs_call',
  'nurture',
  'not_interested',
  'wrong_number',
  'dnc_opt_out',
  'archived',
  'closed_converted',
])

export const formatDisplayPhone = (raw: string): string => {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return raw.startsWith('+') ? raw : `+${digits}`
}

/**
 * Checks if a string looks like a raw E.164 phone number (e.g. +16127433952).
 * These are treated as poor display names if any real name field exists.
 */
const isRawE164 = (val: string): boolean => /^\+1\d{10}$/.test(val) || /^\+\d{10,15}$/.test(val)

export const resolveInboxSellerNameWithSource = (row: Record<string, unknown>): { value: string; source: string } => {
  const firstName = asString(row.first_name || row.firstName || row.seller_first_name || row.sellerFirstName || row.prospect_first_name || row.prospectFirstName)
  const lastName = asString(row.last_name || row.lastName || row.seller_last_name || row.sellerLastName || row.prospect_last_name || row.prospectLastName)
  const ownerFirstName = asString(row.owner_first_name || row.ownerFirstName)
  const ownerLastName = asString(row.owner_last_name || row.ownerLastName)

  const meta = (row.metadata || {}) as Record<string, unknown>

  const candidates: Array<{ val: unknown; source: string }> = [
    { val: row.owner_display_name || row.ownerDisplayName, source: 'owner_display_name' },
    { val: row.seller_display_name || row.sellerDisplayName, source: 'seller_display_name' },
    { val: row.seller_name || row.sellerName, source: 'seller_name' },
    { val: row.owner_name || row.ownerName, source: 'owner_name' },
    { val: row.prospect_full_name || row.prospectFullName, source: 'prospect_full_name' },
    { val: row.primary_owner_name || row.primaryOwnerName, source: 'primary_owner_name' },
    { val: row.contact_name || row.contactName, source: 'contact_name' },
    { val: firstName && lastName ? `${firstName} ${lastName}` : firstName || null, source: 'prospect_names' },
    { val: ownerFirstName && ownerLastName ? `${ownerFirstName} ${ownerLastName}` : ownerFirstName || null, source: 'owner_names' },
    { val: row.property_owner_name || row.propertyOwnerName, source: 'property_owner_name' },
    { val: row.prospect_cnam || row.prospectCnam, source: 'prospect_cnam' },
    { val: meta.owner_name || meta.ownerName || meta.seller_name || meta.contact_name, source: 'metadata_name' },
  ]

  for (const candidate of candidates) {
    const text = asString(candidate.val, '').trim()
    if (text && !isRawE164(text) && text.toLowerCase() !== 'unknown' && text.toLowerCase() !== 'unknown seller') {
      return { value: text, source: candidate.source }
    }
  }

  // Final fallbacks
  const phoneRaw = asString(row.phoneNumber || row.phoneNumberId || row.canonicalE164 || row.seller_phone || row.phone || row.prospect_phone, '').trim()
  if (phoneRaw) return { value: formatDisplayPhone(phoneRaw), source: 'phone_fallback' }

  return { value: 'Unknown Seller', source: 'none' }
}

export const resolveInboxSellerName = (row: Record<string, unknown>): string => 
  resolveInboxSellerNameWithSource(row).value

export const resolveInboxPropertyAddressWithSource = (row: Record<string, unknown>): { value: string; source: string } => {
  const street = asString(row.property_address_street || row.street || row.address_line_1 || row.property_street)
  const city = asString(row.property_address_city || row.property_city || row.city || row.property_city)
  const state = asString(row.property_address_state || row.property_state || row.state || row.property_state)
  const zip = asString(row.property_address_zip || row.property_zip || row.zip || row.postal_code || row.property_zip)
  
  const combined = [street, city, state, zip].map(s => s.trim()).filter(Boolean).join(', ')
  const meta = (row.metadata || {}) as Record<string, unknown>

  const candidates: Array<{ val: unknown; source: string }> = [
    { val: row.property_address_full || row.propertyAddressFull, source: 'property_address_full' },
    { val: row.property_address || row.propertyAddress, source: 'property_address' },
    { val: row.address, source: 'address' },
    { val: meta.property_address || meta.address || meta.propertyAddress, source: 'metadata_address' },
    { val: combined, source: 'combined_fields' },
  ]

  for (const candidate of candidates) {
    const text = asString(candidate.val, '').trim()
    if (text && text.toLowerCase() !== 'no address' && text.toLowerCase() !== 'unknown') {
      return { value: text, source: candidate.source }
    }
  }

  return { value: 'No Address', source: 'none' }
}

export const resolveInboxPropertyAddress = (row: Record<string, unknown>): string =>
  resolveInboxPropertyAddressWithSource(row).value

const applyInboxViewServerFilters = (query: any, view: string | undefined): any => {
  if (!view || view === 'all') return query
  let q = query
  if (view === 'priority') {
    q = q.eq('show_in_priority_inbox', true).eq('is_archived', false)
  } else if (view === 'active') {
    q = q
      .eq('is_archived', false)
      .not('priority_bucket', 'eq', 'hidden')
      .not('priority_bucket', 'eq', 'suppressed')
      .not('ui_intent', 'eq', 'outbound_waiting')
  } else if (view === 'waiting') {
    q = q.eq('ui_intent', 'outbound_waiting').eq('is_archived', false)
  } else if (view === 'archived') {
    q = q.eq('is_archived', true)
  } else if (view === 'suppressed') {
    q = q.eq('priority_bucket', 'suppressed')
  } else if (view === 'hidden') {
    q = q.eq('priority_bucket', 'hidden')
  } else if (view === 'starred') {
    q = q.eq('is_starred', true)
  } else if (view === 'pinned') {
    q = q.eq('is_pinned', true)
  } else if (view === 'sent') {
    q = q.eq('ui_intent', 'sent').eq('is_archived', false)
  } else if (view === 'queued') {
    q = q.eq('ui_intent', 'queued').eq('is_archived', false)
  } else if (view === 'failed') {
    q = q.eq('ui_intent', 'failed').eq('is_archived', false)
  }
  return q
}

const applyInboxSearchServerFilter = (query: any, text: string | undefined): any => {
  if (!text || !text.trim()) return query
  const term = `%${text.trim()}%`
  return query.or(
    `owner_display_name.ilike.${term},` +
    `prospect_full_name.ilike.${term},` +
    `property_address_full.ilike.${term},` +
    `seller_phone.ilike.${term},` +
    `thread_key.ilike.${term}`
  )
}

const applyInboxAdvancedServerFilters = (query: any, filters: Record<string, any> | undefined): any => {
  if (!filters) return query
  let q = query

  if (filters.market) q = q.ilike('market', `%${filters.market}%`)
  if (filters.state) q = q.eq('property_address_state', filters.state)
  if (filters.zip) q = q.eq('property_address_zip', filters.zip)
  if (filters.propertyType) q = q.eq('property_type', filters.propertyType)
  
  if (filters.bedsMin !== undefined) q = q.gte('beds', filters.bedsMin)
  if (filters.bathsMin !== undefined) q = q.gte('baths', filters.bathsMin)
  
  if (filters.estimatedValueMin !== undefined) q = q.gte('estimated_value', filters.estimatedValueMin)
  if (filters.estimatedValueMax !== undefined) q = q.lte('estimated_value', filters.estimatedValueMax)
  
  if (filters.repairCostMin !== undefined) q = q.gte('estimated_repair_cost', filters.repairCostMin)
  if (filters.repairCostMax !== undefined) q = q.lte('estimated_repair_cost', filters.repairCostMax)
  
  if (filters.cashOfferMin !== undefined) q = q.gte('cash_offer', filters.cashOfferMin)
  if (filters.cashOfferMax !== undefined) q = q.lte('cash_offer', filters.cashOfferMax)
  
  if (filters.householdIncomeMin !== undefined) q = q.gte('est_household_income', filters.householdIncomeMin)
  if (filters.householdIncomeMax !== undefined) q = q.lte('est_household_income', filters.householdIncomeMax)
  
  if (filters.netAssetValueMin !== undefined) q = q.gte('net_asset_value', filters.netAssetValueMin)
  if (filters.netAssetValueMax !== undefined) q = q.lte('net_asset_value', filters.netAssetValueMax)
  
  if (filters.ownerType) q = q.eq('owner_type_guess', filters.ownerType)
  if (filters.bestContactWindow) q = q.ilike('best_contact_window', `%${filters.bestContactWindow}%`)
  
  if (filters.priority) {
    const bucket = filters.priority === 'urgent' ? 'priority' : filters.priority
    q = q.eq('priority_bucket', bucket)
  }
  
  if (filters.aiScoreMin !== undefined) q = q.gte('final_acquisition_score', filters.aiScoreMin)
  if (filters.motivationMin !== undefined) q = q.gte('structured_motivation_score', filters.motivationMin)
  
  if (filters.persona) q = q.eq('agent_persona', filters.persona)
  if (filters.language) q = q.eq('best_language', filters.language)
  
  if (filters.activityDateFrom) q = q.gte('latest_message_at', filters.activityDateFrom)
  if (filters.activityDateTo) q = q.lte('latest_message_at', filters.activityDateTo)

  return q
}

export const getQueueProcessorHealth = async (): Promise<QueueProcessorHealth> => {
  const supabase = getSupabaseClient()
  const checkedAt = new Date().toISOString()
  const lagCutoffIso = new Date(Date.now() - QUEUE_PROCESSOR_LAG_MINUTES * 60 * 1000).toISOString()

  try {
    const [queuedProbe, lagProbe, oldestQueuedProbe, latestSentProbe] = await Promise.all([
      supabase
        .from('send_queue')
        .select('id', { count: 'exact', head: true })
        .eq('queue_status', 'queued'),
      supabase
        .from('send_queue')
        .select('id', { count: 'exact', head: true })
        .eq('queue_status', 'queued')
        .lt('created_at', lagCutoffIso),
      supabase
        .from('send_queue')
        .select('created_at')
        .eq('queue_status', 'queued')
        .order('created_at', { ascending: true })
        .limit(1),
      supabase
        .from('send_queue')
        .select('sent_at,updated_at,created_at')
        .eq('queue_status', 'sent')
        .order('sent_at', { ascending: false, nullsFirst: false })
        .order('updated_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(1),
    ])

    if (queuedProbe.error || lagProbe.error || oldestQueuedProbe.error || latestSentProbe.error) {
      const err = queuedProbe.error ?? lagProbe.error ?? oldestQueuedProbe.error ?? latestSentProbe.error
      return {
        checkedAt,
        queuedCount: queuedProbe.count ?? 0,
        queuedOlderThanLagWindow: lagProbe.count ?? 0,
        oldestQueuedAt: null,
        latestSentAt: null,
        processorHealthy: false,
        status: 'unknown',
        summary: mapErrorMessage(err) || 'Unable to read queue processor status',
      }
    }

    const queuedCount = queuedProbe.count ?? 0
    const queuedOlderThanLagWindow = lagProbe.count ?? 0
    const oldestQueuedRow = safeArray(oldestQueuedProbe.data as AnyRecord[])[0] ?? null
    const latestSentRow = safeArray(latestSentProbe.data as AnyRecord[])[0] ?? null

    const oldestQueuedAt = asIso(getFirst(oldestQueuedRow ?? {}, ['created_at'])) ?? null
    const latestSentAt = asIso(getFirst(latestSentRow ?? {}, ['sent_at', 'updated_at', 'created_at'])) ?? null

    if (queuedOlderThanLagWindow > 0) {
      return {
        checkedAt,
        queuedCount,
        queuedOlderThanLagWindow,
        oldestQueuedAt,
        latestSentAt,
        processorHealthy: false,
        status: 'lagging',
        summary: `${queuedOlderThanLagWindow} queued older than ${QUEUE_PROCESSOR_LAG_MINUTES}m`,
      }
    }

    return {
      checkedAt,
      queuedCount,
      queuedOlderThanLagWindow,
      oldestQueuedAt,
      latestSentAt,
      processorHealthy: true,
      status: 'healthy',
      summary: queuedCount > 0 ? `${queuedCount} queued and within normal window` : 'Queue clear',
    }
  } catch (error) {
    return {
      checkedAt,
      queuedCount: 0,
      queuedOlderThanLagWindow: 0,
      oldestQueuedAt: null,
      latestSentAt: null,
      processorHealthy: false,
      status: 'unknown',
      summary: mapErrorMessage(error) || 'Unable to read queue processor status',
    }
  }
}

// UUID v4 safety guard — prevents inserting 'ph_...' text ids into uuid columns
const isValidUUID = (v: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)

const normalizePhone = (value: unknown): string => {
  const raw = asString(value, '').trim()
  if (!raw) return ''
  const hasPlus = raw.startsWith('+')
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  return hasPlus ? `+${digits}` : digits
}

const safeFilterValue = (value: string): string => value.replace(/[(),]/g, '')

/**
 * Build phone number variants for broad field matching.
 * Returns unique non-empty strings covering:
 * - original
 * - +E.164 form (e.g. +16127433952)
 * - digits only (e.g. 16127433952)
 * - 10-digit local US (e.g. 6127433952)
 * - +1 + 10-digit (e.g. +16127433952, same as E.164 if US)
 */
const buildPhoneVariants = (phone: string): string[] => {
  if (!phone) return []
  const digits = phone.replace(/\D/g, '')
  if (!digits) return []
  const variants = new Set<string>()
  variants.add(phone)
  // E.164-style
  if (!phone.startsWith('+')) variants.add(`+${digits}`)
  else variants.add(phone)
  variants.add(digits)
  // 10-digit local US (strip leading 1 if 11 digits)
  if (digits.length === 11 && digits.startsWith('1')) {
    const local = digits.slice(1)
    variants.add(local)
    variants.add(`+1${local}`)
  }
  if (digits.length === 10) {
    variants.add(`+1${digits}`)
  }
  return Array.from(variants).filter(Boolean)
}

type PersonalizationCandidate = {
  seller_first_name?: string | null
  seller_full_name?: string | null
  seller_name_source?: string | null
  owner_display_name?: string | null
  prospect_first_name?: string | null
  prospect_full_name?: string | null
  phone_first_name?: string | null
  phone_full_name?: string | null
  primary_display_name?: string | null
  master_owner_display_name?: string | null
  property_owner_name?: string | null
  owner_name?: string | null
  first_name?: string | null
}

type SellerFirstNameResolution = {
  value: string
  source: string
}

type RenderGuardResult = {
  messageText: string
  repaired: boolean
  passed: boolean
}

const cleanFirstToken = (value: unknown): string => {
  const raw = asString(value, '').trim()
  if (!raw) return ''
  const noHonorific = raw.replace(/^(mr|mrs|ms|dr|sr|sra|srta)\.?\s+/i, '')
  const primarySegment = noHonorific.split(/[,&/]|\sand\s|\sy\s/i)[0] ?? noHonorific
  const firstToken = primarySegment.trim().split(/\s+/)[0] ?? ''
  return firstToken.replace(/^[^A-Za-z\u00C0-\u024F]+|[^A-Za-z\u00C0-\u024F'-]+$/g, '')
}

export const resolveSellerFirstName = (candidate: PersonalizationCandidate): SellerFirstNameResolution => {
  const ordered: Array<{ value: unknown; source: string }> = [
    { value: candidate.seller_first_name, source: 'candidate.seller_first_name' },
    { value: candidate.prospect_first_name, source: 'prospects.first_name' },
    { value: candidate.phone_first_name, source: 'phones.first_name' },
    { value: candidate.first_name, source: 'candidate.first_name' },
    { value: candidate.primary_display_name, source: 'candidate.primary_display_name' },
    { value: candidate.phone_full_name, source: 'phones.full_name' },
    { value: candidate.prospect_full_name, source: 'prospects.full_name' },
    { value: candidate.owner_display_name, source: 'owners.display_name' },
    { value: candidate.master_owner_display_name, source: 'master_owners.display_name' },
    { value: candidate.property_owner_name, source: 'properties.owner_name' },
    { value: candidate.owner_name, source: 'candidate.owner_name' },
  ]

  for (const item of ordered) {
    const token = cleanFirstToken(item.value)
    if (token) return { value: token, source: item.source }
  }

  return { value: '', source: 'none' }
}

const applyRenderGuard = (renderedMessage: string): RenderGuardResult => {
  const greetingCommaPattern = /^(\s*(?:hi|hey|hello|hola|ola|marhaba))\s+,/i
  const repaired = renderedMessage.replace(greetingCommaPattern, '$1,')
  return {
    messageText: repaired,
    repaired: repaired !== renderedMessage,
    passed: !/^(hi|hey|hello|hola|ola|marhaba)\s+,/i.test(repaired.trim()),
  }
}

const buildPersonalizationCandidate = (thread: InboxThread): PersonalizationCandidate => {
  const owner = asString(thread.ownerName, '')
  return {
    seller_first_name: null,
    seller_full_name: owner || null,
    seller_name_source: owner ? 'thread.ownerName' : null,
    owner_display_name: owner || null,
    prospect_first_name: null,
    prospect_full_name: null,
    phone_first_name: null,
    phone_full_name: null,
    primary_display_name: owner || null,
    master_owner_display_name: owner || null,
    property_owner_name: owner || null,
    owner_name: owner || null,
    first_name: null,
  }
}

const buildQueuePersonalization = (thread: InboxThread, messageText: string) => {
  const candidate = buildPersonalizationCandidate(thread)
  const resolved = resolveSellerFirstName(candidate)
  const renderGuard = applyRenderGuard(messageText)
  const firstNameFallback = resolved.value

  const renderVariables = {
    seller_first_name: cleanFirstToken(candidate.seller_first_name) || firstNameFallback,
    seller_name: cleanFirstToken(candidate.seller_first_name) || firstNameFallback,
    owner_first_name: cleanFirstToken(candidate.first_name) || firstNameFallback,
    first_name: cleanFirstToken(candidate.first_name) || firstNameFallback,
  }

  const candidateSnapshot = {
    phone_id: thread.phoneNumberId ?? null,
    property_id: thread.propertyId ?? null,
    seller_state: null,
    touch_number: 1,
    best_phone_id: thread.phoneNumberId ?? null,
    seller_market: thread.market ?? thread.marketId ?? null,
    master_owner_id: thread.ownerId ?? null,
    canonical_phone_masked: thread.canonicalE164 ?? null,
    seller_first_name: renderVariables.seller_first_name || null,
    seller_full_name: candidate.seller_full_name ?? null,
    seller_name_source: resolved.source,
    owner_display_name: candidate.owner_display_name ?? null,
    prospect_first_name: candidate.prospect_first_name ?? null,
    prospect_full_name: candidate.prospect_full_name ?? null,
    phone_first_name: candidate.phone_first_name ?? null,
    phone_full_name: candidate.phone_full_name ?? null,
    primary_display_name: candidate.primary_display_name ?? null,
    master_owner_display_name: candidate.master_owner_display_name ?? null,
    property_owner_name: candidate.property_owner_name ?? null,
  }

  const personalizationMeta = {
    seller_first_name: renderVariables.seller_first_name || null,
    seller_name_source: resolved.source,
    name_missing: !renderVariables.seller_first_name,
    render_guard_passed: renderGuard.passed,
    render_guard_repaired: renderGuard.repaired,
  }

  return {
    messageText: renderGuard.messageText,
    renderVariables,
    candidateSnapshot,
    personalizationMeta,
  }
}

if (DEV) {
  const check1 = resolveSellerFirstName({ prospect_first_name: 'Jose' })
  const msg1 = applyRenderGuard(`Hello ${check1.value}, this is Chris...`)

  const check2 = resolveSellerFirstName({ owner_display_name: 'Jose A Valdizon & Rocio Mendoza' })
  const msg2 = applyRenderGuard(`Hello ${check2.value}, this is Chris...`)

  const check3 = resolveSellerFirstName({})
  const msg3 = applyRenderGuard('Hello , this is Chris...')

  console.debug('[personalization-check]', {
    case_prospect_first_name: msg1.messageText,
    case_owner_display_name: msg2.messageText,
    case_missing_name_source: check3.source,
    case_missing_name: msg3.messageText,
    guard_pattern_blocked: !/^(hi|hey|hello|hola|ola|marhaba)\s+,/i.test(msg1.messageText) &&
      !/^(hi|hey|hello|hola|ola|marhaba)\s+,/i.test(msg2.messageText) &&
      !/^(hi|hey|hello|hola|ola|marhaba)\s+,/i.test(msg3.messageText),
  })
}

// All likely phone field names in the `phones` / `phone_numbers` table
const PHONE_NUMBER_FIELD_NAMES = ['phone', 'canonical_e164'] as const

// ── Table alias resolution ─────────────────────────────────────────────────
// Maps logical alias keys to ordered candidate table names.
// resolveTable tries each until one succeeds (code 42P01 = table missing).
// Results are module-scoped cached so probe queries run only once per session.
const TABLE_ALIASES: Record<string, readonly string[]> = {
  phones:       ['phones', 'phone_numbers', 'phonenumbers'],
  masterOwners: ['master_owners', 'masterowners', 'masterowners_30679234'],
  owners:       ['sub_owners', 'owners'],
  aiBrain:      ['contact_outreach_state', 'ai_conversation_brain'],
  templates:    ['sms_templates', 'templates'],
  offers:       ['property_cash_offer_snapshots', 'offers'],
}

const resolvedTableCache = new Map<string, string | null>()

const FILTER_COLUMNS_BY_ALIAS: Record<string, readonly string[]> = {
  phones: ['phone', 'canonical_e164', 'master_owner_id'],
  masterOwners: [],
  owners: [],
  prospects: ['prospect_id', 'master_owner_id', 'first_name', 'full_name'],
  emails: [],
  aiBrain: ['id', 'to_phone_number'],
  offers: [],
  send_queue: [
    'id',
    'queue_key',
    'to_phone_number',
    'from_phone_number',
    'master_owner_id',
    'prospect_id',
    'property_id',
  ],
}

/** Returns the first existing table for an alias key, or the raw key if not a known alias. */
const resolveTable = async (aliasKey: string): Promise<string> => {
  if (!(aliasKey in TABLE_ALIASES)) return aliasKey
  if (resolvedTableCache.has(aliasKey)) {
    return resolvedTableCache.get(aliasKey) ?? ''
  }
  const supabase = getSupabaseClient()
  const candidates = TABLE_ALIASES[aliasKey]!
  for (const candidate of candidates) {
    const { error } = await supabase.from(candidate).select('*').limit(1)
    // PostgreSQL 42P01 = undefined_table; any other result means the table exists
    if (!error || (error as { code?: string }).code !== '42P01') {
      resolvedTableCache.set(aliasKey, candidate)
      return candidate
    }
  }
  resolvedTableCache.set(aliasKey, null)
  if (DEV) console.warn(`[NEXUS] resolveTable: no valid table for "${aliasKey}". Tried: ${candidates.join(', ')}`)
  return ''
}



/**
 * Traverse a dot-separated path into a plain object/array tree.
 * Returns `undefined` if any segment is missing or non-traversable.
 * Example: getNestedValue(row, 'payload.from') -> row.payload?.from
 */
export const getNestedValue = (row: AnyRecord, dotPath: string): unknown => {
  const parts = dotPath.split('.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cursor: any = row
  for (const part of parts) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = cursor[part]
  }
  return cursor
}

/**
 * Try a list of top-level fields first, then fall back to dot-path nested
 * fields. Returns the first truthy value found.
 */
export const getFirstDeep = (
  row: AnyRecord,
  topLevelFields: readonly string[],
  nestedPaths: readonly string[],
): unknown => {
  for (const field of topLevelFields) {
    const val = row[field]
    if (val !== undefined && val !== null && val !== '') return val
  }
  for (const path of nestedPaths) {
    const val = getNestedValue(row, path)
    if (val !== undefined && val !== null && val !== '') return val
  }
  return undefined
}

// Top-level JSON blob keys that may contain nested phone/body/direction data
const NESTED_BLOB_KEYS = [
  'payload', 'raw_payload', 'event', 'data', 'body', 'message', 'textgrid',
  'textgrid_payload', 'webhook_payload', 'metadata', 'request_body',
  'response_body', 'raw', 'json', 'details',
] as const

/**
 * DEV-only: inspect a message_events row and log top-level keys plus any
 * nested keys found in known JSON blob fields (up to depth 2).
 */
export const inspectMessageEventShape = (row: AnyRecord): void => {
  if (!DEV) return
  const topLevelKeys = Object.keys(row)
  const nestedKeyMap: Record<string, string[]> = {}
  for (const blobKey of NESTED_BLOB_KEYS) {
    const blob = row[blobKey]
    if (blob && typeof blob === 'object' && !Array.isArray(blob)) {
      const blobRecord = blob as AnyRecord
      const keys = Object.keys(blobRecord)
      if (keys.length > 0) {
        nestedKeyMap[blobKey] = keys
        // One level deeper
        for (const k of keys) {
          const sub = blobRecord[k]
          if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
            const subRecord = sub as AnyRecord
            const subKeys = Object.keys(subRecord)
            if (subKeys.length > 0) {
              nestedKeyMap[`${blobKey}.${k}`] = subKeys
            }
          }
        }
      }
    }
  }
  // Likely fields: any key whose name resembles phone/body/direction
  const likelyRe = /phone|body|message|direction|from|to|text|content|number|e164|sender|recipient|type|event/i
  const likelyFields: Record<string, string> = {}
  for (const key of topLevelKeys) {
    if (likelyRe.test(key)) {
      const val = String(row[key] ?? '').slice(0, 160)
      likelyFields[key] = val
    }
  }
  for (const [path, keys] of Object.entries(nestedKeyMap)) {
    for (const key of keys) {
      if (likelyRe.test(key)) {
        const val = String(getNestedValue(row, `${path}.${key}`) ?? '').slice(0, 160)
        likelyFields[`${path}.${key}`] = val
      }
    }
  }
  console.log('[inspectMessageEventShape] topLevelKeys:', topLevelKeys)
  console.log('[inspectMessageEventShape] nestedKeyMap:', nestedKeyMap)
  console.log('[inspectMessageEventShape] likelyFields:', likelyFields)
}

// ── Message_events phone field candidates (kept as fallback documentation) ─
// These were used before the actual schema was confirmed. The primary fields
// are now from_phone_number and to_phone_number. These are used only in the
// direction-unknown nested fallback scan inside getSellerPhoneFromMessage.

export interface SellerPhoneResult {
  sellerPhone: string
  sellerPhoneSourceField: string
  canonicalE164: string
  ourNumber: string
  directionUsed: 'inbound' | 'outbound' | 'unknown'
}

// Business numbers to exclude when direction is unknown (env-configured)
const KNOWN_OUR_NUMBERS: Set<string> = new Set(
  [
    import.meta.env.VITE_TEXTGRID_FROM_NUMBER,
    import.meta.env.VITE_TEXTGRID_NUMBER,
  ]
    .filter(Boolean)
    .map(normalizePhone)
    .filter(Boolean),
)

// Nested paths for inbound sender phone
const NESTED_INBOUND_FROM = [
  'payload.from', 'payload.from_number', 'payload.sender', 'payload.caller_id',
  'raw_payload.from', 'raw_payload.from_number', 'raw_payload.sender',
  'raw_payload.data.from', 'raw_payload.data.from_number',
  'event.from', 'event.from_number', 'event.sender',
  'data.from', 'data.from_number', 'data.sender',
  'textgrid_payload.from', 'textgrid_payload.from_number',
  'webhook_payload.from', 'webhook_payload.from_number',
  'details.from', 'details.from_number',
] as const

// Nested paths for outbound recipient phone
const NESTED_OUTBOUND_TO = [
  'payload.to', 'payload.to_number', 'payload.recipient', 'payload.destination',
  'raw_payload.to', 'raw_payload.to_number', 'raw_payload.recipient',
  'raw_payload.data.to', 'raw_payload.data.to_number',
  'event.to', 'event.to_number', 'event.recipient',
  'data.to', 'data.to_number', 'data.recipient',
  'textgrid_payload.to', 'textgrid_payload.to_number',
  'webhook_payload.to', 'webhook_payload.to_number',
  'details.to', 'details.to_number',
] as const

// Nested paths for canonical/generic phone fields (kept for reference; not
// actively used since actual schema has from_phone_number / to_phone_number)

/**
 * Determine the seller's phone number from a message_events row.
 * Primary: from_phone_number (inbound) / to_phone_number (outbound).
 * Fallback: metadata.payload.from/to, metadata.payload.raw.From/To.
 * Returns ourNumber (the TextGrid business line) and directionUsed.
 */
export const getSellerPhoneFromMessage = (row: AnyRecord): SellerPhoneResult => {
  const direction = normalizeMessageDirection(row)
  const directionUsed = direction

  let sellerPhone = ''
  let sellerPhoneSourceField = ''
  let ourNumber = ''

  if (direction === 'inbound') {
    // Seller sent the message — their number is in from_phone_number
    const fromPhone = normalizePhone(row['from_phone_number'])
    if (fromPhone) {
      sellerPhone = fromPhone
      sellerPhoneSourceField = 'from_phone_number'
      ourNumber = normalizePhone(row['to_phone_number'])
    } else {
      // Nested metadata fallback
      const nestedFrom =
        normalizePhone(getNestedValue(row, 'metadata.payload.from')) ||
        normalizePhone(getNestedValue(row, 'metadata.payload.raw.From')) ||
        normalizePhone(getNestedValue(row, 'metadata.payload.from_number'))
      if (nestedFrom) {
        sellerPhone = nestedFrom
        sellerPhoneSourceField = 'metadata.payload.from'
      }
      ourNumber =
        normalizePhone(row['to_phone_number']) ||
        normalizePhone(getNestedValue(row, 'metadata.payload.to')) ||
        normalizePhone(getNestedValue(row, 'metadata.payload.raw.To'))
    }
  } else if (direction === 'outbound') {
    // We sent the message — seller's number is in to_phone_number
    const toPhone = normalizePhone(row['to_phone_number'])
    if (toPhone) {
      sellerPhone = toPhone
      sellerPhoneSourceField = 'to_phone_number'
      ourNumber = normalizePhone(row['from_phone_number'])
    } else {
      const nestedTo =
        normalizePhone(getNestedValue(row, 'metadata.payload.to')) ||
        normalizePhone(getNestedValue(row, 'metadata.payload.raw.To')) ||
        normalizePhone(getNestedValue(row, 'metadata.payload.to_number'))
      if (nestedTo) {
        sellerPhone = nestedTo
        sellerPhoneSourceField = 'metadata.payload.to'
      }
      ourNumber =
        normalizePhone(row['from_phone_number']) ||
        normalizePhone(getNestedValue(row, 'metadata.payload.from')) ||
        normalizePhone(getNestedValue(row, 'metadata.payload.raw.From'))
    }
  } else {
    // Direction unknown: use KNOWN_OUR_NUMBERS heuristic to pick seller side
    const fromPhone = normalizePhone(row['from_phone_number'])
    const toPhone = normalizePhone(row['to_phone_number'])

    if (fromPhone && toPhone) {
      if (!KNOWN_OUR_NUMBERS.has(fromPhone)) {
        sellerPhone = fromPhone; sellerPhoneSourceField = 'from_phone_number'; ourNumber = toPhone
      } else {
        sellerPhone = toPhone; sellerPhoneSourceField = 'to_phone_number'; ourNumber = fromPhone
      }
    } else if (fromPhone) {
      sellerPhone = fromPhone; sellerPhoneSourceField = 'from_phone_number'
    } else if (toPhone) {
      sellerPhone = toPhone; sellerPhoneSourceField = 'to_phone_number'
    } else {
      // No actual columns — full nested scan as last resort
      for (const path of NESTED_INBOUND_FROM) {
        const val = normalizePhone(getNestedValue(row, path))
        if (val && !KNOWN_OUR_NUMBERS.has(val)) { sellerPhone = val; sellerPhoneSourceField = path; break }
      }
      if (!sellerPhone) {
        for (const path of NESTED_OUTBOUND_TO) {
          const val = normalizePhone(getNestedValue(row, path))
          if (val && !KNOWN_OUR_NUMBERS.has(val)) { sellerPhone = val; sellerPhoneSourceField = path; break }
        }
      }
    }
  }

  // ── DEV warnings ──────────────────────────────────────────────────────────
  if (DEV && !sellerPhone) {
    const fromPhone = normalizePhone(row['from_phone_number'])
    const toPhone = normalizePhone(row['to_phone_number'])
    if (direction !== 'unknown' && (fromPhone || toPhone)) {
      // Direction IS known but phone extraction still failed — inspect why
      console.warn('[Inbox Seller Phone Mapping Failed]', {
        direction,
        from_phone_number: fromPhone,
        to_phone_number: toPhone,
        id: row['id'],
        message_event_key: row['message_event_key'],
      })
    } else if (!fromPhone && !toPhone) {
      // Both phone columns are empty — record not viable for phone-based grouping
      const nestedKeyMap: Record<string, string[]> = {}
      for (const blobKey of NESTED_BLOB_KEYS) {
        const blob = row[blobKey]
        if (blob && typeof blob === 'object' && !Array.isArray(blob)) {
          nestedKeyMap[blobKey] = Object.keys(blob as AnyRecord)
        }
      }
      console.warn('[Inbox Thread Identity Missing] from_phone_number and to_phone_number are both empty.', {
        id: row['id'],
        direction,
        nestedKeyMap,
        recommendation: 'message_events rows need from_phone_number / to_phone_number populated.',
      })
    }
  }

  // canonicalE164 = sellerPhone (no separate canonical_e164 column in schema)
  const canonicalE164 = sellerPhone

  return { sellerPhone, sellerPhoneSourceField, canonicalE164, ourNumber, directionUsed }
}

export const getMessageTimestamp = (row: AnyRecord): string => {
  const value = getFirstDeep(
    row,
    ['event_timestamp', 'created_at', 'timestamp', 'message_timestamp', 'sent_at', 'received_at', 'delivered_at'],
    [
      'payload.created_at', 'payload.timestamp', 'payload.sent_at', 'payload.received_at',
      'raw_payload.created_at', 'raw_payload.timestamp', 'raw_payload.sent_at',
      'event.created_at', 'event.timestamp', 'event.sent_at',
      'data.created_at', 'data.timestamp', 'data.sent_at',
      'textgrid_payload.created_at', 'textgrid_payload.timestamp',
      'webhook_payload.created_at', 'webhook_payload.timestamp',
      'details.created_at', 'details.timestamp',
    ],
  )
  return asIso(value) ?? new Date().toISOString()
}

export const getMessageBody = (row: AnyRecord): string => {
  return asString(
    getFirstDeep(
      row,
      ['message_body', 'body', 'text', 'message', 'content', 'rendered_message', 'template_text'],
      [
        'metadata.payload.message', 'metadata.payload.message_body', 'metadata.payload.raw.Body',
        'payload.body', 'payload.message', 'payload.text', 'payload.content',
        'raw_payload.body', 'raw_payload.message', 'raw_payload.text',
        'raw_payload.data.body', 'raw_payload.data.message', 'raw_payload.data.text',
        'event.body', 'event.message', 'event.text',
        'data.body', 'data.message', 'data.text',
        'textgrid_payload.body', 'textgrid_payload.message', 'textgrid_payload.text',
        'webhook_payload.body', 'webhook_payload.message', 'webhook_payload.text',
        'request_body.body', 'request_body.message', 'request_body.text',
        'details.body', 'details.message', 'details.text',
      ],
    ),
    '',
  )
}

export const normalizeMessageDirection = (row: AnyRecord): 'inbound' | 'outbound' | 'unknown' => {
  const direction = normalizeStatus(
    getFirstDeep(
      row,
      ['direction', 'message_direction'],
      [
        'metadata.payload.direction', 'metadata.payload.raw.SmsStatus', 'metadata.payload.type',
        'payload.direction', 'payload.type', 'payload.event_type', 'payload.status',
        'raw_payload.direction', 'raw_payload.type', 'raw_payload.event_type', 'raw_payload.status',
        'event.direction', 'event.type', 'event.event_type',
        'data.direction', 'data.type', 'data.event_type',
        'textgrid_payload.direction', 'textgrid_payload.type',
        'webhook_payload.direction', 'webhook_payload.type',
        'details.direction',
      ],
    ),
  )
  if (['inbound', 'incoming', 'received', 'reply', 'from_seller'].includes(direction)) return 'inbound'
  if (['outbound', 'outgoing', 'sent', 'queued', 'to_seller'].includes(direction)) return 'outbound'

  const eventType = normalizeStatus(
    getFirstDeep(
      row,
      ['event_type', 'type'],
      [
        'payload.event_type', 'raw_payload.event_type', 'event.event_type', 'data.event_type',
        'textgrid_payload.event_type', 'webhook_payload.event_type',
      ],
    ),
  )
  if (['inbound', 'incoming', 'received', 'message_received', 'reply_received'].includes(eventType)) return 'inbound'
  if (['outbound', 'outgoing', 'sent', 'message_sent', 'send'].includes(eventType)) return 'outbound'

  const deliveryStatus = normalizeStatus(getFirst(row, ['delivery_status', 'raw_carrier_status', 'provider_delivery_status']))
  if (['received', 'inbound'].includes(deliveryStatus)) return 'inbound'
  if (['queued', 'sent', 'delivered', 'outbound'].includes(deliveryStatus)) return 'outbound'

  const sourceApp = normalizeStatus(getFirst(row, ['source_app']))
  if (['inbound', 'incoming', 'seller'].includes(sourceApp)) return 'inbound'
  if (['outbound', 'outgoing', 'operator', 'ai'].includes(sourceApp)) return 'outbound'

  const fromNumber = normalizePhone(row['from_phone_number'] as unknown ?? getFirst(row, ['from_number']))
  const toNumber = normalizePhone(row['to_phone_number'] as unknown ?? getFirst(row, ['to_number']))
  const ownerPhone = normalizePhone(getFirst(row, ['phone_number', 'canonical_e164']))

  if (ownerPhone && fromNumber && ownerPhone === fromNumber) return 'inbound'
  if (ownerPhone && toNumber && ownerPhone === toNumber) return 'outbound'

  return 'unknown'
}

const getThreadKeyParts = (
  row: AnyRecord,
  indexHint: number,
): { key: string; method: string; confidence: 'high' | 'medium' | 'low' } => {
  // Direct column access — actual message_events schema
  const ownerId = asString(row['master_owner_id'], '')
  const prospectId = asString(row['prospect_id'], '')
  const propertyId = asString(row['property_id'], '')
  const { sellerPhone } = getSellerPhoneFromMessage(row)

  // The inbox conversation is keyed by seller phone. Outbound rows often carry
  // owner/property IDs while inbound webhook rows do not, so phone-first keeps
  // replies merged with the original outreach thread.
  if (sellerPhone)
    return { key: `phone:${sellerPhone}`, method: 'seller_phone', confidence: 'medium' }
  if (ownerId && propertyId)
    return { key: `owner_property:${ownerId}:${propertyId}`, method: 'master_owner_id+property_id', confidence: 'medium' }
  if (prospectId && propertyId)
    return { key: `prospect_property:${prospectId}:${propertyId}`, method: 'prospect_id+property_id', confidence: 'low' }
  if (propertyId)
    return { key: `property:${propertyId}`, method: 'property_id', confidence: 'low' }
  if (ownerId)
    return { key: `owner:${ownerId}`, method: 'master_owner_id', confidence: 'low' }
  if (prospectId)
    return { key: `prospect:${prospectId}`, method: 'prospect_id', confidence: 'low' }
  return { key: `fallback:${indexHint}`, method: 'fallback_id', confidence: 'low' }
}

export const doesMessageBelongToThread = (
  messageRow: AnyRecord,
  selectedThread: InboxThread,
): boolean => {
  // Direct column access — actual message_events schema
  const ownerId = asString(messageRow['master_owner_id'], '')
  const propertyId = asString(messageRow['property_id'], '')
  const prospectId = asString(messageRow['prospect_id'], '')
  const { sellerPhone, canonicalE164: msgCanonical } = getSellerPhoneFromMessage(messageRow)

  const selectedOwnerId = asString(selectedThread.ownerId, '')
  const selectedPropertyId = asString(selectedThread.propertyId, '')
  const selectedProspectId = asString(selectedThread.prospectId, '')
  const selectedPhone = normalizePhone(selectedThread.phoneNumber)
  const selectedCanonical = normalizePhone(selectedThread.canonicalE164)

  const keys = new Set<string>(
    [
      selectedThread.id,
      selectedThread.threadKey,
      selectedThread.leadId,
      selectedOwnerId,
      selectedPropertyId,
      selectedProspectId,
      selectedPhone,
      selectedCanonical,
    ].filter((v): v is string => Boolean(v)),
  )

  if (ownerId && keys.has(ownerId)) return true
  if (propertyId && keys.has(propertyId)) return true
  if (prospectId && keys.has(prospectId)) return true
  if (sellerPhone && keys.has(sellerPhone)) return true
  if (msgCanonical && keys.has(msgCanonical)) return true

  if (selectedThread.threadKey) {
    const derived = getThreadKeyParts(messageRow, 0)
    if (derived.key === selectedThread.threadKey) return true
  }

  return false
}

const runFilteredQuery = async (
  tableOrAlias: string,
  filters: Array<{ key: string; value: string }>,
  limit = 20,
): Promise<AnyRecord[]> => {
  const table = await resolveTable(tableOrAlias)
  if (!table) return []
  const supabase = getSupabaseClient()
  let query = supabase.from(table).select('*').limit(limit)
  const allowedColumns = FILTER_COLUMNS_BY_ALIAS[tableOrAlias]
  const valid = filters.filter((f) => f.value && (!allowedColumns || allowedColumns.includes(f.key)))
  if (valid.length > 0) {
    const orClause = valid.map((f) => `${f.key}.eq.${safeFilterValue(f.value)}`).join(',')
    query = query.or(orClause)
  } else if (filters.some((f) => f.value)) {
    return []
  }
  const { data, error } = await query
  if (error) {
    if (DEV) console.warn(`[NEXUS] ${table} lookup failed`, error.message)
    return []
  }
  return safeArray(data as AnyRecord[])
}

export const getInboxThreads = async (
  filters: InboxThreadFilters = {},
  options: InboxFetchOptions = {},
): Promise<{ threads: InboxThread[], totalAvailable: number }> => {
  const supabase = getSupabaseClient()
  const PAGE_SIZE = 1000
  const maxRows = Number.isFinite(options.maxRows ?? Number.NaN)
    ? Math.max(1, Number(options.maxRows))
    : 200
  const filterState = options.filters ?? filters
  
  // Base query for counts with filters
  let countQuery = supabase.from('nexus_inbox_threads_v').select('*', { count: 'exact', head: true })
  countQuery = applyInboxViewServerFilters(countQuery, filterState.view)
  countQuery = applyInboxSearchServerFilter(countQuery, filterState.query)
  countQuery = applyInboxAdvancedServerFilters(countQuery, filterState.advanced)

  if (
    filterState.stage &&
    filterState.stage !== 'all_stages' &&
    SERVER_INBOX_THREAD_STAGE_VALUES.has(filterState.stage)
  ) {
    countQuery = countQuery.eq('stage', filterState.stage)
  }

  const { count: totalAvailable } = await countQuery

  const startOffset = options.offset ?? 0
  const rows: AnyRecord[] = []
  let page = 0

  while (rows.length < maxRows) {
    const rangeStart = startOffset + (page * PAGE_SIZE)
    const rangeEnd = rangeStart + PAGE_SIZE - 1

    let query = supabase
      .from('nexus_inbox_threads_v')
      .select('*')
      .order('latest_message_at', { ascending: false })
      .range(rangeStart, rangeEnd)

    query = applyInboxViewServerFilters(query, filterState.view)
    query = applyInboxSearchServerFilter(query, filterState.query)
    query = applyInboxAdvancedServerFilters(query, filterState.advanced)

    if (
      filterState.stage &&
      filterState.stage !== 'all_stages' &&
      SERVER_INBOX_THREAD_STAGE_VALUES.has(filterState.stage)
    ) {
      query = query.eq('stage', filterState.stage)
    }

    if (options.signal) {
      query = query.abortSignal(options.signal)
    }

    const { data, error } = await query
    if (error) {
      throw new Error(mapErrorMessage(error))
    }

    const batch = safeArray(data as AnyRecord[])
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
    page += 1
  }

  if (DEV) {
    console.log('[NexusInboxFilterQuery]', { 
      mode: filterState.view || 'all',
      filters: filterState,
      offset: startOffset, 
      limit: maxRows, 
      returned: rows.length, 
      totalAvailable,
      queryApplied: true
    })
  }

  const boundedRows = rows.slice(0, maxRows)

  const threadKeys = boundedRows
    .map((row) => asString(row['thread_key'], ''))
    .filter(Boolean)
  const intelligenceByThreadKey = new Map<string, AnyRecord>()

  if (threadKeys.length > 0) {
    const uniqueKeys = Array.from(new Set(threadKeys))
    for (let index = 0; index < uniqueKeys.length; index += 250) {
      const keyBatch = uniqueKeys.slice(index, index + 250)
      const { data: intelligenceRows, error: intelligenceError } = await supabase
        .from('nexus_thread_intelligence_v')
        .select(`
          thread_key,
          owner_display_name,
          seller_first_name,
          seller_last_name,
          owner_type,
          contact_language,
          best_phone,
          phone_confidence,
          property_address_full,
          property_id,
          beds,
          baths,
          sqft,
          year_built,
          effective_year_built,
          estimated_value,
          cash_offer,
          equity_amount,
          equity_percent,
          estimated_repair_cost,
          final_acquisition_score,
          motivation_score,
          motivation_summary,
          deal_next_step,
          podio_tags,
          is_owner_occupied,
          is_absentee,
          is_vacant,
          has_lien,
          is_probate,
          is_tax_delinquent,
          streetview_image,
          zillow_url,
          realtor_url
        `)
        .in('thread_key', keyBatch)

      if (intelligenceError) {
        if (DEV) console.warn('[Inbox] intelligence enrichment failed', mapErrorMessage(intelligenceError))
        continue
      }

      safeArray(intelligenceRows as AnyRecord[]).forEach((row) => {
        const key = asString(row['thread_key'], '')
        if (key) intelligenceByThreadKey.set(key, row)
      })
    }
  }

  if (DEV) {
    console.log('[Inbox] nexus_inbox_threads_v rows', boundedRows.length)
  }

  const toStageFromIntent = (uiIntent: string): string => {
    if (uiIntent === 'outbound_waiting') return 'sent_waiting'
    if (uiIntent === 'opt_out' || uiIntent === 'hostile_or_legal') return 'dnc_opt_out'
    if (uiIntent === 'wrong_person') return 'wrong_number'
    if (uiIntent === 'not_interested') return 'not_interested'
    if (uiIntent === 'potential_interest') return 'interested'
    if (uiIntent === 'price_anchor') return 'needs_offer'
    if (uiIntent === 'info_request') return 'needs_response'
    if (uiIntent === 'language_switch') return 'needs_response'
    return 'needs_response'
  }

  const threads: InboxThread[] = boundedRows.map((row, index) => {
    const threadKey = asString(row['thread_key'], '') || `thread:${index}`
    const intelligenceRow = intelligenceByThreadKey.get(threadKey)
    const latestMessageIso = asIso(row['latest_message_at']) ?? new Date().toISOString()
    const latestDirection = normalizeMessageDirection({ direction: row['latest_direction'] })
    const sellerPhone = normalizePhone(row['seller_phone'])

    const mergedRow = { ...row, ...intelligenceRow }
    const nameRes = resolveInboxSellerNameWithSource(mergedRow as Record<string, unknown>)
    const addrRes = resolveInboxPropertyAddressWithSource(mergedRow as Record<string, unknown>)

    const ownerDisplayName = nameRes.value
    const propertyAddressFull = addrRes.value

    const uiIntent = normalizeStatus(row['ui_intent'] ?? 'needs_review')
    const priorityBucket = normalizeStatus(row['priority_bucket'] ?? 'priority')
    const showInPriorityInbox = asBoolean(row['show_in_priority_inbox'], false)
    const workflowStatus = normalizeStatus(row['status'] ?? 'open')
    const workflowStage = normalizeStatus(row['stage'] ?? toStageFromIntent(uiIntent))

    const isArchived = asBoolean(row['is_archived'], false) || workflowStatus === 'archived'
    const isPinned = asBoolean(row['is_pinned'], false)
    const isRead = asBoolean(row['is_read'], false)
    const unreadCount = isArchived ? 0 : (isRead ? 0 : 1)

    const priority: InboxThread['priority'] =
      priorityBucket === 'priority'
        ? 'urgent'
        : priorityBucket === 'suppressed' || priorityBucket === 'hidden'
          ? 'low'
          : 'normal'

    const sentiment: InboxThread['sentiment'] =
      uiIntent === 'potential_interest' || uiIntent === 'price_anchor'
        ? 'hot'
        : uiIntent === 'info_request' || uiIntent === 'language_switch'
          ? 'warm'
          : priorityBucket === 'hidden' || priorityBucket === 'suppressed'
            ? 'cold'
            : 'neutral'

    const status: InboxThread['status'] =
      isArchived ? 'archived' : unreadCount > 0 ? 'unread' : 'read'

    const thread: InboxThread = {
      id: threadKey,
      leadId: asString(row['property_id'], '') || asString(row['master_owner_id'], '') || threadKey,
      marketId: asString(row['market'], 'unknown') || 'unknown',
      ownerName: ownerDisplayName,
      subject: propertyAddressFull,
      preview: asString(row['latest_message_body'], '') || 'No message preview',
      status,
      priority,
      sentiment,
      messageCount: asNumber(row['inbound_message_count'], 0) + asNumber(row['outbound_message_count'], 0),
      lastMessageLabel: formatRelativeTime(latestMessageIso),
      lastMessageIso: latestMessageIso,
      unreadCount,
      aiDraft: showInPriorityInbox ? 'Draft response ready for operator review.' : null,
      labels: [asString(row['market'], 'unknown'), uiIntent],
      threadKey,
      ownerId: asString(row['master_owner_id'], '') || undefined,
      prospectId: asString(row['prospect_id'], '') || undefined,
      propertyId: asString(row['property_id'], '') || undefined,
      phoneNumber: sellerPhone || undefined,
      canonicalE164: sellerPhone || undefined,
      ourNumber: normalizePhone(row['our_number']) || undefined,
      market: asString(row['market'], 'unknown') || 'unknown',
      lastInboundAt: latestDirection === 'inbound' ? latestMessageIso : null,
      lastOutboundAt: latestDirection === 'outbound' ? latestMessageIso : null,
      needsResponse: showInPriorityInbox,
      unread: unreadCount > 0,
      uiIntent,
      priorityBucket,
      workflowStatus,
      workflowStage,
      showInPriorityInbox,
      ownerDisplayName,
      propertyAddressFull,
      latestMessageBody: asString(row['latest_message_body'], '') || undefined,
      latestMessageAt: latestMessageIso,
      cashOffer: row['cash_offer'] ?? intelligenceRow?.['cash_offer'] ?? null,
      estimatedValue: row['estimated_value'] ?? intelligenceRow?.['estimated_value'] ?? null,
      finalAcquisitionScore: row['final_acquisition_score'] ?? intelligenceRow?.['final_acquisition_score'] ?? null,
      streetviewImage: (intelligenceRow?.['streetview_image'] as string) ?? null,
      zillowUrl: (intelligenceRow?.['zillow_url'] ?? intelligenceRow?.['zillow_link'] ?? intelligenceRow?.['zillow']) as string ?? null,
      realtorUrl: (intelligenceRow?.['realtor_url'] ?? intelligenceRow?.['realtor_link'] ?? intelligenceRow?.['realtor']) as string ?? null,
      // Newly Hydrated Fields
      sellerFirstName: asString(intelligenceRow?.['seller_first_name'], ''),
      sellerLastName: asString(intelligenceRow?.['seller_last_name'], ''),
      ownerType: asString(intelligenceRow?.['owner_type'], ''),
      contactLanguage: asString(intelligenceRow?.['contact_language'], ''),
      bestPhone: asString(intelligenceRow?.['best_phone'], ''),
      phoneConfidence: asNumber(intelligenceRow?.['phone_confidence'], 0),
      beds: intelligenceRow?.['beds'] as string | number,
      baths: intelligenceRow?.['baths'] as string | number,
      sqft: intelligenceRow?.['sqft'] as string | number,
      yearBuilt: intelligenceRow?.['year_built'] as string | number,
      effectiveYear: intelligenceRow?.['effective_year_built'] as string | number,
      equityAmount: asNumber(intelligenceRow?.['equity_amount'], 0),
      equityPercent: asNumber(intelligenceRow?.['equity_percent'], 0),
      estimatedRepairCost: asNumber(intelligenceRow?.['estimated_repair_cost'], 0),
      motivationScore: asNumber(intelligenceRow?.['motivation_score'], 0),
      motivationSummary: asString(intelligenceRow?.['motivation_summary'], ''),
      dealNextStep: asString(intelligenceRow?.['deal_next_step'], ''),
      podioTags: safeArray(intelligenceRow?.['podio_tags'] as string[]),
      isOwnerOccupied: asBoolean(intelligenceRow?.['is_owner_occupied'], false),
      isAbsentee: asBoolean(intelligenceRow?.['is_absentee'], false),
      isVacant: asBoolean(intelligenceRow?.['is_vacant'], false),
      hasLien: asBoolean(intelligenceRow?.['has_lien'], false),
      isProbate: asBoolean(intelligenceRow?.['is_probate'], false),
      isTaxDelinquent: asBoolean(intelligenceRow?.['is_tax_delinquent'], false),
      threadIsPinned: isPinned,
      threadIsStarred: asBoolean(row['is_starred'], false),
      threadIsArchived: isArchived,
      threadIsRead: isRead,
      threadIsHidden: asBoolean(row['is_hidden'], false),
      threadIsSuppressed: asBoolean(row['is_suppressed'], false),
    }

    return thread
  })

  let filtered = [...threads]

  if (filters.status && filters.status !== 'all') {
    filtered = filtered.filter((thread) => thread.status === filters.status)
  }
  if (filters.priority && filters.priority !== 'all') {
    filtered = filtered.filter((thread) => thread.priority === filters.priority)
  }
  if (filters.query) {
    const q = filters.query.toLowerCase()
    filtered = filtered.filter((thread) =>
      [
        thread.ownerName,
        thread.subject,
        thread.preview,
        thread.marketId,
        thread.phoneNumber,
        thread.canonicalE164,
        thread.propertyAddress,
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(q)),
    )
  }

  filtered.sort((a, b) => {
    if ((a as any).threadIsPinned && !(b as any).threadIsPinned) return -1
    if (!(a as any).threadIsPinned && (b as any).threadIsPinned) return 1
    if ((a as unknown as AnyRecord)['showInPriorityInbox'] && !(b as unknown as AnyRecord)['showInPriorityInbox']) return -1
    if (!(a as unknown as AnyRecord)['showInPriorityInbox'] && (b as unknown as AnyRecord)['showInPriorityInbox']) return 1
    if (a.status === 'unread' && b.status !== 'unread') return -1
    if (b.status === 'unread' && a.status !== 'unread') return 1
    return new Date(b.lastMessageIso).getTime() - new Date(a.lastMessageIso).getTime()
  })

  return { threads: filtered, totalAvailable: totalAvailable ?? filtered.length }
}

export const fetchInboxModel = async (options: InboxFetchOptions = {}): Promise<InboxModel> => {
  const lastLiveFetchAt = new Date().toISOString()
  
  if (DEV) {
    console.log('[NexusInbox] fetchInboxModel start', { 
      hasUrl: !!import.meta.env.VITE_SUPABASE_URL,
      hasKey: !!import.meta.env.VITE_SUPABASE_ANON_KEY,
      useSupabase: shouldUseSupabase(),
      options
    })
  }

  const { threads } = await getInboxThreads(options.filters || {}, options)
  
  // Real counts from backend (aligned with applyInboxViewServerFilters)
  const supabase = getSupabaseClient()
  
  const priorityBase = supabase.from('nexus_inbox_threads_v').select('thread_key', { count: 'exact', head: true }).eq('show_in_priority_inbox', true).eq('is_archived', false)
  const activeBase = supabase
    .from('nexus_inbox_threads_v')
    .select('thread_key', { count: 'exact', head: true })
    .eq('is_archived', false)
    .not('priority_bucket', 'eq', 'hidden')
    .not('priority_bucket', 'eq', 'suppressed')
    .not('ui_intent', 'eq', 'outbound_waiting')
  const waitingBase = supabase
    .from('nexus_inbox_threads_v')
    .select('thread_key', { count: 'exact', head: true })
    .eq('ui_intent', 'outbound_waiting')
    .eq('is_archived', false)
  const allBase = supabase.from('nexus_inbox_threads_v').select('thread_key', { count: 'exact', head: true })
  const unreadBase = supabase.from('nexus_inbox_threads_v').select('thread_key', { count: 'exact', head: true }).eq('is_archived', false).eq('is_read', false)
  const archivedBase = supabase.from('nexus_inbox_threads_v').select('thread_key', { count: 'exact', head: true }).eq('is_archived', true)
  const hiddenBase = supabase.from('nexus_inbox_threads_v').select('thread_key', { count: 'exact', head: true }).eq('is_archived', false).eq('priority_bucket', 'hidden')
  const suppressedBase = supabase.from('nexus_inbox_threads_v').select('thread_key', { count: 'exact', head: true }).eq('is_archived', false).eq('priority_bucket', 'suppressed')

  const [
    priorityRes, 
    activeRes, 
    waitingRes, 
    allRes, 
    unreadRes,
    archivedRes,
    hiddenRes,
    suppressedRes
  ] = await Promise.all([
    priorityBase,
    activeBase,
    waitingBase,
    allBase,
    unreadBase,
    archivedBase,
    hiddenBase,
    suppressedBase,
  ])

  const safeCount = (res: { count: number | null }) => (res.count === null ? null : res.count)
  
  const rawCounts = {
    priority: safeCount(priorityRes),
    active: safeCount(activeRes),
    waiting: safeCount(waitingRes),
    all: safeCount(allRes),
    unread: safeCount(unreadRes),
    archived: safeCount(archivedRes),
    hidden: safeCount(hiddenRes),
    suppressed: safeCount(suppressedRes),
  }

  let resolvedActive = rawCounts.active
  let activeFallbackUsed = false

  if (resolvedActive === null && rawCounts.all !== null && rawCounts.archived !== null) {
    // Fallback: active = all - archived - waiting - hidden - suppressed
    const waiting = rawCounts.waiting ?? 0
    const hidden = rawCounts.hidden ?? 0
    const suppressed = rawCounts.suppressed ?? 0
    resolvedActive = rawCounts.all - rawCounts.archived - waiting - hidden - suppressed
    activeFallbackUsed = true
  }

  const resolvedCounts = {
    ...rawCounts,
    active: resolvedActive,
  }

  if (DEV) {
    console.log('[NexusInboxCountsResolved]', {
      rawCounts,
      resolvedCounts,
      source: 'live',
      activeFallbackUsed,
      filters: options.filters
    })
  }

  return {
    threads,
    unreadCount: resolvedCounts.unread ?? threads.filter((thread) => thread.unreadCount > 0).length,
    urgentCount: resolvedCounts.priority ?? threads.filter((thread) => thread.priority === 'urgent').length,
    totalCount: resolvedCounts.all ?? threads.length,
    aiDraftCount: threads.filter((thread) => thread.aiDraft !== null).length,
    dataMode: 'live',
    liveFetchStatus: 'active',
    liveFetchError: null,
    messageEventsCount: resolvedCounts.active,
    messageEventsRawCount: resolvedCounts.waiting,
    groupedThreadCount: resolvedCounts.all,
    priorityInboxCount: resolvedCounts.priority,
    activeInboxCount: resolvedCounts.active,
    waitingInboxCount: resolvedCounts.waiting,
    allInboxCount: resolvedCounts.all,
    unreadThreadsCount: resolvedCounts.unread,
    sendQueueCount: null,
    archivedThreadsCount: resolvedCounts.archived,
    hiddenThreadsCount: resolvedCounts.hidden,
    suppressedThreadsCount: resolvedCounts.suppressed,
    lastLiveFetchAt,
  }
}

const toThreadMessage = (row: AnyRecord): ThreadMessage => {
  const timelineAt =
    asIso(row['timeline_at'] ?? row['created_at'] ?? row['event_timestamp'] ?? row['sent_at'] ?? row['received_at']) ??
    new Date().toISOString()
  const createdAt =
    asIso(row['created_at'] ?? row['event_timestamp'] ?? row['sent_at'] ?? row['received_at'] ?? row['timeline_at']) ??
    timelineAt
  const direction = normalizeMessageDirection(row)
  
  const status = asString(
    row['delivery_status'] ?? row['provider_delivery_status'] ?? row['raw_carrier_status'] ?? row['queue_status'] ?? row['status'],
    'unknown',
  ).toLowerCase()
  
  let deliveryStatus = 'pending'
  if (status.includes('deliver')) deliveryStatus = 'delivered'
  else if (status.includes('sent') || status === 'success') deliveryStatus = 'sent'
  else if (status.includes('fail') || status.includes('undeliv')) deliveryStatus = 'failed'
  else if (status.includes('queue')) deliveryStatus = 'queued'
  else if (status === 'pending') deliveryStatus = 'pending'

  const { sellerPhone, canonicalE164: msgCanonical } = getSellerPhoneFromMessage(row)
  const source =
    asString(row['source_app'] ?? row['message_source'], '') ||
    asString(getNestedValue(row, 'metadata.source'), '') ||
    'textgrid'

  const developerMetaEntries = [
    ['template_id', asString(row['template_id'], '')],
    ['template_name', asString(row['template_name'], '')],
    ['use_case', asString(row['use_case'] ?? row['use_case_template'], '')],
    ['queue_id', asString(row['queue_id'], '')],
    ['provider_message_sid', asString(row['provider_message_sid'], '')],
  ].filter(([, value]) => value)

  const developerMeta = developerMetaEntries.length > 0
    ? Object.fromEntries(developerMetaEntries)
    : undefined

  return {
    id: asString(row['id'], createdAt),
    direction,
    body: asString(row['message_body'], '') || getMessageBody(row),
    createdAt,
    timelineAt,
    deliveredAt: asIso(row['delivered_at']),
    deliveryStatus,
    fromNumber: normalizePhone(row['from_phone_number']),
    toNumber: normalizePhone(row['to_phone_number']),
    ownerId: asString(row['master_owner_id'], ''),
    prospectId: asString(row['prospect_id'], ''),
    propertyId: asString(row['property_id'], ''),
    phoneNumber: sellerPhone,
    canonicalE164: msgCanonical,
    templateId: asString(row['template_id'], '') || null,
    templateName: null,
    agentId: asString(row['sms_agent_id'], '') || null,
    source,
    rawStatus: normalizeStatus(row['delivery_status'] ?? row['raw_carrier_status']),
    error: asString(row['error_message'] ?? row['failure_reason'] ?? row['failure_code'], '') || null,
    developerMeta,
  }
}

export interface ThreadMessageFetchOptions {
  maxPages?: number
  maxMessages?: number
}

export const getThreadMessagesForThread = async (
  thread: InboxThread,
  options: ThreadMessageFetchOptions = {},
): Promise<ThreadMessage[]> => {
  const supabase = getSupabaseClient()
  const threadKey = asString(thread.threadKey, '') || asString(thread.id, '')
  if (!threadKey) return []

  const pageSize = MESSAGE_EVENTS_THREAD_PAGE_SIZE
  const maxPages = Math.max(1, options.maxPages ?? 50)
  const maxMessages = options.maxMessages && options.maxMessages > 0 ? options.maxMessages : null

  const rows: AnyRecord[] = []
  for (let page = 0; page < maxPages; page += 1) {
    const { data, error } = await supabase
      .from('nexus_thread_messages_v')
      .select('*')
      .eq('thread_key', threadKey)
      .order('timeline_at', { ascending: true })
      .order('created_at', { ascending: true })
      .range(page * pageSize, page * pageSize + pageSize - 1)

    if (error) throw new Error(mapErrorMessage(error))

    const batch = safeArray(data as AnyRecord[])
    rows.push(...batch)
    if (maxMessages !== null && rows.length >= maxMessages) break
    if (batch.length < pageSize) break
  }

  const bounded = maxMessages !== null ? rows.slice(0, maxMessages) : rows
  const mapped = bounded.map(toThreadMessage)

  if (DEV) {
    console.log(`[getThreadMessagesForThread] thread_key=${threadKey} → ${mapped.length} rows from nexus_thread_messages_v`)
  }

  return mapped.sort((a, b) => {
    const aTs = new Date(a.timelineAt || a.createdAt).getTime()
    const bTs = new Date(b.timelineAt || b.createdAt).getTime()
    return aTs - bTs
  })
}

export const getThreadMessages = async (threadIdOrKey: string): Promise<ThreadMessage[]> => {
  return getThreadMessagesForThread({
    id: threadIdOrKey,
    threadKey: threadIdOrKey,
    leadId: threadIdOrKey,
    marketId: 'unknown',
    ownerName: 'Unknown owner',
    subject: 'Thread',
    preview: '',
    status: 'read',
    priority: 'normal',
    sentiment: 'neutral',
    messageCount: 0,
    lastMessageLabel: '',
    lastMessageIso: new Date().toISOString(),
    unreadCount: 0,
    aiDraft: null,
    labels: [],
  })
}

export const getThreadIntelligence = async (thread: InboxThread): Promise<ThreadIntelligenceRecord | null> => {
  const supabase = getSupabaseClient()
  const threadKey = asString(thread.threadKey, '') || asString(thread.id, '')
  if (!threadKey) return null

  const { data, error } = await supabase
    .from('nexus_thread_intelligence_v')
    .select('*')
    .eq('thread_key', threadKey)
    .limit(1)

  if (error) {
    if (DEV) console.warn('[getThreadIntelligence] query failed', mapErrorMessage(error))
    return null
  }

  const row = safeArray(data as AnyRecord[])[0] ?? null
  if (DEV) {
    console.log('[getThreadIntelligence]', { threadKey, found: Boolean(row) })
  }
  return row
}

export const getThreadContext = async (thread: InboxThread): Promise<ThreadContext> => {
  const supabase = getSupabaseClient()

  let ownerId = asString(thread.ownerId, '')
  let propertyId = asString(thread.propertyId, '')
  let prospectId = asString(thread.prospectId, '')
  const queueId = asString(thread.queueId, '')
  const phoneNumberId = asString(thread.phoneNumberId, '')
  const canonical = normalizePhone(thread.canonicalE164)
  const phone = normalizePhone(thread.phoneNumber)
  const searchPhone = canonical || phone
  const phoneVariants = buildPhoneVariants(searchPhone)
  const propertyAddress = asString(thread.propertyAddress ?? thread.subject, '')

  // ── Phase 1: find phone_numbers row via direct filter ───────────────────
  // Try all likely field names with all phone variants in one OR query.
  let phoneRows: AnyRecord[] = []
  let matchedPhoneBy: string | null = null
  let matchedPhoneRowId: string | null = null
  let bridgedMasterOwnerId: string | null = null
  let bridgedProspectId: string | null = null
  let bridgedPropertyId: string | null = null

  if (searchPhone) {
    const phoneFilters: Array<{ key: string; value: string }> = []
    if (phoneNumberId) phoneFilters.push({ key: 'id', value: phoneNumberId })
    for (const field of PHONE_NUMBER_FIELD_NAMES) {
      for (const variant of phoneVariants) {
        phoneFilters.push({ key: field, value: variant })
      }
    }
    // Deduplicate
    const seen = new Set<string>()
    const uniquePhoneFilters = phoneFilters.filter((f) => {
      const k = `${f.key}:${f.value}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })

    phoneRows = await runFilteredQuery('phones', uniquePhoneFilters, 8)

    // ── Phase 1b: client-side broad scan if server returned nothing ──────
    if (phoneRows.length === 0 && searchPhone) {
      if (DEV) console.log('[Inbox phones] direct filter returned 0 — attempting broad client-side scan')
      const phonesTable = await resolveTable('phones')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let broadData: any = null
      let broadFailed = true
      if (phonesTable) {
        const broadResult = await supabase.from(phonesTable).select('*').limit(5000)
        if (!broadResult.error) { broadData = broadResult.data; broadFailed = false }
      }
      if (!broadFailed && broadData) {
        const broadRows = safeArray(broadData as AnyRecord[])
        if (DEV && broadRows.length > 0) {
          const sample = Math.min(3, broadRows.length)
          for (let i = 0; i < sample; i++) {
            console.log('[Inbox phones sample keys]', Object.keys(broadRows[i]!))
            console.log('[Inbox phones sample row]', broadRows[i])
          }
        }
        phoneRows = broadRows.filter((row) => {
          for (const field of PHONE_NUMBER_FIELD_NAMES) {
            const val = normalizePhone(row[field])
            if (val && phoneVariants.includes(val)) return true
          }
          return false
        })
        if (DEV) {
          if (phoneRows.length > 0) {
            console.log(`[Inbox phones] client-side matched ${phoneRows.length} rows for ${searchPhone}`)
          } else {
            console.log('[Inbox phones] client-side scan also found 0 matches')
          }
        }
        matchedPhoneBy = phoneRows.length > 0 ? 'client_side:phone_scan' : null
      }
    }

    // ── Phase 1c: determine how we matched ────────────────────────────────
    if (phoneRows.length > 0 && !matchedPhoneBy) {
      const phoneRow = phoneRows[0]!
      for (const field of PHONE_NUMBER_FIELD_NAMES) {
        const val = normalizePhone(phoneRow[field])
        if (val && phoneVariants.includes(val)) {
          matchedPhoneBy = field
          break
        }
      }
      if (!matchedPhoneBy && phoneNumberId) matchedPhoneBy = 'id'
    }

    // ── Phase 1d: extract bridged IDs from matched phone row ─────────────
    if (phoneRows.length > 0) {
      const phoneRow = phoneRows[0]!
      matchedPhoneRowId = asString(getFirst(phoneRow, ['id', 'phone_number_id']), '') || null
      const bridgedOwner = asString(
        getFirst(phoneRow, ['master_owner_id', 'owner_id', 'masterowner_id']), '',
      )
      const bridgedProspect = asString(getFirst(phoneRow, ['prospect_id']), '')
      const bridgedProperty = asString(getFirst(phoneRow, ['property_id']), '')
      if (bridgedOwner) {
        bridgedMasterOwnerId = bridgedOwner
        if (!ownerId) ownerId = bridgedOwner
      }
      if (bridgedProspect) {
        bridgedProspectId = bridgedProspect
        if (!prospectId) prospectId = bridgedProspect
      }
      if (bridgedProperty) {
        bridgedPropertyId = bridgedProperty
        if (!propertyId) propertyId = bridgedProperty
      }
      if (DEV) {
        console.log('[Inbox phones bridge]', {
          matchedPhoneBy,
          matchedPhoneRowId,
          bridgedMasterOwnerId,
          bridgedProspectId,
          bridgedPropertyId,
        })
      }
    }
  }

  // ── Phase 2: main context queries using actual + bridged IDs ─────────────
  const [masterowners, owners, prospects, properties, emails, aiRows, queueRows, offers] = await Promise.all([
    runFilteredQuery('masterOwners', [
      { key: 'master_owner_id', value: ownerId },
      { key: 'owner_id', value: ownerId },
      { key: 'normalized_owner_key', value: ownerId },
    ], 5),
    runFilteredQuery('owners', [
      { key: 'owner_id', value: ownerId },
      { key: 'master_owner_id', value: ownerId },
      { key: 'normalized_owner_key', value: ownerId },
      { key: 'podio_item_id', value: ownerId },
    ], 5),
    runFilteredQuery('prospects', [
      { key: 'prospect_id', value: prospectId },
      { key: 'master_owner_id', value: ownerId },
      { key: 'property_id', value: propertyId },
      { key: 'phone_number', value: searchPhone },
    ], 5),
    runFilteredQuery('properties', [
      { key: 'property_id', value: propertyId },
      { key: 'owner_id', value: ownerId },
      { key: 'master_owner_id', value: ownerId },
      { key: 'property_address', value: propertyAddress },
    ], 5),
    runFilteredQuery('emails', [
      { key: 'owner_id', value: ownerId },
      { key: 'prospect_id', value: prospectId },
      { key: 'property_id', value: propertyId },
    ], 8),
    runFilteredQuery('aiBrain', [
      { key: 'master_owner_id', value: ownerId },
      { key: 'prospect_id', value: prospectId },
      { key: 'property_id', value: propertyId },
      { key: 'phone_number', value: searchPhone },
      { key: 'canonical_e164', value: canonical },
      { key: 'conversation_brain_id', value: asString(thread.queueId, '') },
    ], 5),
    runFilteredQuery('send_queue', [
      { key: 'id', value: queueId },
      { key: 'master_owner_id', value: ownerId },
      { key: 'prospect_id', value: prospectId },
      { key: 'property_id', value: propertyId },
      { key: 'phone_number', value: searchPhone },
      { key: 'to_phone_number', value: searchPhone },
    ], 12),
    runFilteredQuery('offers', [
      { key: 'master_owner_id', value: ownerId },
      { key: 'owner_id', value: ownerId },
      { key: 'prospect_id', value: prospectId },
      { key: 'property_id', value: propertyId },
      { key: 'property_address', value: propertyAddress },
    ], 8),
  ])

  // ── Phase 3: build debug + contextMatchQuality ────────────────────────────
  // Read resolved table names from cache (populated during Phases 1 & 2)
  const resolvedPhoneTable = resolvedTableCache.get('phones') ?? null
  const resolvedMasterOwnerTable = resolvedTableCache.get('masterOwners') ?? null
  const resolvedOwnerTable = resolvedTableCache.get('owners') ?? null

  const ownerRow = owners[0] ?? masterowners[0] ?? null
  const propertyRow = properties[0] ?? null
  const prospectRow = prospects[0] ?? null
  const aiRow = aiRows[0] ?? null

  const phoneMatched = phoneRows.length > 0
  const ownerMatched = ownerRow !== null
  const propertyMatched = propertyRow !== null
  const prospectMatched = prospectRow !== null

  const debug: ThreadContextDebug = {
    resolvedPhoneTable,
    resolvedMasterOwnerTable,
    resolvedOwnerTable,
    resolvedPropertyTable: 'properties',
    resolvedProspectTable: 'prospects',
    matchedOwnerBy: ownerMatched
      ? (asString(getFirst(ownerRow!, ['master_owner_id']), '') === ownerId
        ? 'master_owner_id'
        : asString(getFirst(ownerRow!, ['owner_id']), '') === ownerId
        ? 'owner_id'
        : bridgedMasterOwnerId
        ? `phone_bridge:master_owner_id`
        : 'normalized_owner_key')
      : null,
    matchedProspectBy: prospectMatched
      ? (asString(getFirst(prospectRow!, ['prospect_id']), '') === prospectId
        ? 'prospect_id'
        : bridgedProspectId
        ? 'phone_bridge:prospect_id'
        : asString(getFirst(prospectRow!, ['master_owner_id']), '') === ownerId
        ? 'master_owner_id'
        : 'property_id')
      : null,
    matchedPropertyBy: propertyMatched
      ? (asString(getFirst(propertyRow!, ['property_id']), '') === propertyId
        ? 'property_id'
        : bridgedPropertyId
        ? 'phone_bridge:property_id'
        : asString(getFirst(propertyRow!, ['property_address']), '') === propertyAddress
        ? 'property_address'
        : 'master_owner_id')
      : null,
    matchedPhoneBy,
    matchedPhoneRowId,
    matchedEmailBy: emails.length > 0 ? 'owner_id/prospect_id' : null,
    matchedAiBrainBy: aiRow
      ? (asString(getFirst(aiRow, ['master_owner_id']), '') === ownerId
        ? 'master_owner_id'
        : asString(getFirst(aiRow, ['prospect_id']), '') === prospectId
        ? 'prospect_id'
        : 'phone_number')
      : null,
    matchedQueueBy: queueRows.length > 0
      ? (queueId && queueRows.some((r) => asString(getFirst(r, ['id']), '') === queueId)
        ? 'queue_id'
        : searchPhone && queueRows.some((r) =>
            normalizePhone(getFirst(r, ['phone_number', 'to_phone_number'])) === searchPhone,
          )
        ? 'phone'
        : 'master_owner_id/property_id')
      : null,
    bridgedMasterOwnerId,
    bridgedProspectId,
    bridgedPropertyId,
  }

  // contextMatchQuality based on what we actually resolved
  const contextMatchQuality: ThreadContext['contextMatchQuality'] = (() => {
    if (phoneMatched && ownerMatched && propertyMatched) return 'high'
    if (phoneMatched && (ownerMatched || prospectMatched)) return 'medium'
    if (phoneMatched || ownerMatched || propertyMatched || prospectMatched) return 'low'
    return 'missing'
  })()

  // ── Phase 4: build response ───────────────────────────────────────────────
  const sellerName = asString(
    getFirst(ownerRow ?? prospectRow ?? {}, ['full_name', 'name', 'first_name', 'owner_name']),
    thread.ownerName,
  )

  const sellerMarket = asString(
    getFirst(ownerRow ?? propertyRow ?? prospectRow ?? {}, ['market', 'market_id']),
    thread.market || thread.marketId,
  )

  const propertyAddressValue = asString(
    getFirst(propertyRow ?? prospectRow ?? {}, ['property_address', 'address']),
    thread.propertyAddress || thread.subject,
  )

  const primaryPhone = phone || canonical || null

  const stack: ThreadContext['contactStack'] = []
  for (const row of phoneRows.slice(0, 3)) {
    const value = normalizePhone(
      getFirst(row, ['canonical_e164', 'phone_number', 'phone', 'e164', 'phone_e164']),
    ) || searchPhone
    if (value) stack.push({ type: 'phone', value, status: asString(getFirst(row, ['status']), 'active') })
  }
  for (const row of emails.slice(0, 3)) {
    const value = asString(getFirst(row, ['email']), '')
    if (value) stack.push({ type: 'email', value, status: asString(getFirst(row, ['status']), 'active') })
  }
  if (stack.length === 0 && primaryPhone) {
    stack.push({ type: 'phone', value: primaryPhone, status: 'active' })
    const fallbackEmail = asString(getFirst(ownerRow ?? prospectRow ?? {}, ['email']), '')
    if (fallbackEmail) stack.push({ type: 'email', value: fallbackEmail, status: 'active' })
  }

  const queueContext = queueRows.length > 0
    ? {
        items: queueRows.map((row) => ({
          id: asString(getFirst(row, ['id']), ''),
          status: asString(getFirst(row, ['status']), 'unknown'),
          scheduleAt: asIso(getFirst(row, ['scheduled_at', 'scheduled_for', 'created_at'])),
        })),
      }
    : null

  const aiContext = aiRow
    ? {
        summary: asString(getFirst(aiRow, ['summary']), ''),
        intent: asString(getFirst(aiRow, ['intent', 'recommended_action']), ''),
        sentiment: asString(getFirst(aiRow, ['sentiment']), thread.sentiment),
      }
    : null

  const archived = thread.status === 'archived'
  const needsResponse = asBoolean(thread.needsResponse, false)
  const offerCount = offers.length

  return {
    seller: sellerName
      ? {
          id: ownerId || asString(getFirst(ownerRow ?? {}, ['owner_id', 'master_owner_id']), ''),
          name: sellerName,
          market: sellerMarket,
        }
      : null,
    property: propertyAddressValue
      ? {
          id: propertyId || asString(getFirst(propertyRow ?? {}, ['property_id']), ''),
          address: propertyAddressValue,
          market: sellerMarket,
        }
      : null,
    phone: primaryPhone,
    contactStack: stack,
    dealContext: {
      stage: archived ? 'Archived' : needsResponse ? 'Needs Response' : 'Active',
      nextAction: archived ? 'Review Archive' : needsResponse ? 'Respond Now' : offerCount > 0 ? 'Review Offer' : 'Monitor',
    },
    aiContext,
    queueContext,
    contextMatchQuality,
    contextDebug: debug,
  }
}

/**
 * Queue a reply from the Inbox by inserting a send_queue row with queue_status=approval.
 * Never sends SMS directly — the queue processor handles the actual send.
 */
export const queueReplyFromInbox = async (
  thread: InboxThread,
  messageText: string,
  _options?: { scheduledAt?: string },
): Promise<QueueReplyResult> => {
  void _options
  const trimmedText = messageText.trim()
  if (!trimmedText) {
    return { ok: false, queueId: null, status: null, errorMessage: 'Message text is required', insertPayloadKeys: [] }
  }

  const personalization = buildQueuePersonalization(thread, trimmedText)

  const toPhone = normalizePhone(thread.canonicalE164 || thread.phoneNumber)
  if (!toPhone) {
    return { ok: false, queueId: null, status: null, errorMessage: 'Thread has no valid phone number', insertPayloadKeys: [] }
  }

  // Resolve from number with better fallback chain
  const fromPhone = [
    normalizePhone(thread.ourNumber ?? ''),
    normalizePhone(import.meta.env.VITE_TEXTGRID_FROM_NUMBER ?? ''),
    normalizePhone(import.meta.env.VITE_TEXTGRID_NUMBER ?? ''),
  ].find((phone) => phone && phone.length > 0) || null

  const supabase = getSupabaseClient()
  const now = new Date().toISOString()
  const queueKey = `inbox:approval:${thread.threadKey ?? thread.id}:${Date.now()}`

  const payload: Record<string, unknown> = {
    queue_status: 'approval',
    queue_key: queueKey,
    queue_id: queueKey,
    queue_sequence: 1,
    scheduled_for: now,
    scheduled_for_utc: now,
    scheduled_for_local: now,
    send_priority: 5,
    is_locked: false,
    retry_count: 0,
    max_retries: 3,
    message_body: personalization.messageText,
    message_text: personalization.messageText,
    to_phone_number: toPhone,
    character_count: personalization.messageText.length,
    touch_number: 1,
    current_stage: 'manual_reply',
    message_type: 'manual_reply',
    use_case_template: 'inbox_manual_reply',
    metadata: {
      source: 'inbox',
      action: 'queue_reply',
      thread_key: thread.threadKey,
      selected_thread_id: thread.id,
      created_from: 'leadcommand_inbox',
      our_number: thread.ourNumber,
      seller_phone: thread.phoneNumber,
      template_variables: personalization.renderVariables,
      candidate_snapshot: personalization.candidateSnapshot,
      personalization: personalization.personalizationMeta,
    },
    created_at: now,
  }

  // ALWAYS include from_phone_number (even if null)
  payload.from_phone_number = fromPhone
  if (isValidUUID(asString(thread.phoneNumberId, ''))) payload.phone_number_id = thread.phoneNumberId
  if (isValidUUID(asString(thread.textgridNumberId, ''))) payload.textgrid_number_id = thread.textgridNumberId
  if (thread.propertyAddress) payload.property_address = thread.propertyAddress
  if (isValidUUID(asString(thread.ownerId, ''))) payload.master_owner_id = thread.ownerId
  if (isValidUUID(asString(thread.prospectId, ''))) payload.prospect_id = thread.prospectId
  if (isValidUUID(asString(thread.propertyId, ''))) payload.property_id = thread.propertyId
  if (thread.marketId) payload.market_id = thread.marketId

  const insertPayloadKeys = Object.keys(payload)

  if (DEV) {
    console.log('[queueReplyFromInbox] inserting', { keys: insertPayloadKeys, toPhone, queue_status: 'approval', queueKey })
  }

  const { data, error } = await supabase.from('send_queue').insert(payload).select('id,queue_id,queue_key,queue_status').limit(1)

  if (error) {
    if (DEV) console.error('[queueReplyFromInbox] insert failed:', error.message, error)
    return { ok: false, queueId: null, status: null, errorMessage: error.message, insertPayloadKeys }
  }

  const row = safeArray(data as AnyRecord[])[0] ?? null
  const queueId = row ? asString(getFirst(row, ['id', 'queue_id', 'queue_key']), '') || queueKey : queueKey

  if (DEV) console.log('[queueReplyFromInbox] success', { queueId, queue_status: 'approval' })

  return { ok: true, queueId, status: 'approval', errorMessage: null, insertPayloadKeys }
}

export const getSuggestedDraft = async (thread: InboxThread): Promise<SuggestedDraft> => {
  const supabase = getSupabaseClient()
  const ownerId = asString(thread.ownerId ?? thread.leadId, '')

  const aiFilters = [
    ownerId ? `owner_id.eq.${safeFilterValue(ownerId)}` : '',
    thread.id ? `thread_id.eq.${safeFilterValue(thread.id)}` : '',
    thread.id ? `conversation_id.eq.${safeFilterValue(thread.id)}` : '',
  ].filter(Boolean)

  const aiBrainTable = await resolveTable('aiBrain')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let aiResult: { data: any; error: any } = { data: null, error: null }
  if (aiBrainTable) {
    const aiQuery = supabase
      .from(aiBrainTable)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
    aiResult = aiFilters.length > 0 ? await aiQuery.or(aiFilters.join(',')) : await aiQuery
  }
  if (!aiResult.error) {
    const aiRow = safeArray(aiResult.data as AnyRecord[])[0] ?? null
    const text = asString(getFirst(aiRow ?? {}, ['suggested_reply', 'rendered_message']), '')
    if (text) {
      return {
        text,
        confidence: asNumber(getFirst(aiRow ?? {}, ['confidence']), 0) || null,
        reason: asString(getFirst(aiRow ?? {}, ['recommended_action', 'summary']), '') || null,
        source: 'ai_brain',
      }
    }
  }

  const queueFilters = [
    ownerId ? `owner_id.eq.${safeFilterValue(ownerId)}` : '',
    thread.id ? `thread_id.eq.${safeFilterValue(thread.id)}` : '',
    thread.phoneNumber ? `phone_number.eq.${safeFilterValue(thread.phoneNumber)}` : '',
  ].filter(Boolean)

  const queueQuery = supabase
    .from('send_queue')
    .select('*')
    .in('status', ['pending', 'draft', 'ready'])
    .order('created_at', { ascending: false })
    .limit(1)
  const queueResult = queueFilters.length > 0 ? await queueQuery.or(queueFilters.join(',')) : await queueQuery

  if (!queueResult.error) {
    const queueRow = safeArray(queueResult.data as AnyRecord[])[0] ?? null
    const text = getMessageBody(queueRow ?? {})
    if (text) {
      return {
        text,
        confidence: null,
        reason: `Queued reply - status: ${asString(getFirst(queueRow ?? {}, ['status']), 'pending')}`,
        source: 'send_queue',
      }
    }
  }

  const templatesTable = await resolveTable('templates')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const templatesResult: { data: any; error: any } = templatesTable
    ? await supabase.from(templatesTable).select('*').limit(1)
    : { data: null, error: 'no templates table' }
  if (!templatesResult.error) {
    const template = safeArray(templatesResult.data as AnyRecord[])[0] ?? null
    const templateText = getMessageBody(template ?? {})
    if (templateText) {
      return {
        text: templateText,
        confidence: null,
        reason: 'Template fallback',
        source: 'template',
      }
    }
  }

  return {
    text: thread.aiDraft ?? 'No draft generated yet.',
    confidence: null,
    reason: null,
    source: 'placeholder',
  }
}

export interface InboxThreadStateMutationResult {
  ok: boolean
  threadKey: string
  mutationPayload: AnyRecord
  errorMessage: string | null
}

const writeInboxThreadState = async (
  threadKey: string,
  patch: AnyRecord,
): Promise<InboxThreadStateMutationResult> => {
  const supabase = getSupabaseClient()
  const now = new Date().toISOString()
  const mutationPayload: AnyRecord = {
    thread_key: threadKey,
    updated_at: now,
    ...patch,
  }
  const { error } = await supabase
    .from('inbox_thread_state')
    .upsert(mutationPayload, { onConflict: 'thread_key' })

  if (!error) {
    return { ok: true, threadKey, mutationPayload, errorMessage: null }
  }
  return { ok: false, threadKey, mutationPayload, errorMessage: mapErrorMessage(error) }
}

export const upsertInboxThreadState = async (thread: InboxThread): Promise<InboxThreadStateMutationResult> => {
  const threadKey = asString(thread.threadKey, '') || asString(thread.id, '')
  if (!threadKey) {
    return { ok: false, threadKey: '', mutationPayload: {}, errorMessage: 'Missing thread key for state upsert' }
  }

  return writeInboxThreadState(threadKey, {
    master_owner_id: thread.ownerId ?? null,
    prospect_id: thread.prospectId ?? null,
    property_id: thread.propertyId ?? null,
    seller_phone: thread.phoneNumber ?? null,
    canonical_e164: thread.canonicalE164 ?? null,
    our_number: thread.ourNumber ?? null,
    market: thread.market ?? thread.marketId,
  })
}

export const markThreadRead = async (threadKey: string): Promise<InboxThreadStateMutationResult> => {
  return writeInboxThreadState(threadKey, {
    is_read: true,
    status: 'read',
    last_read_at: new Date().toISOString(),
  })
}

export const markThreadUnread = async (threadKey: string): Promise<InboxThreadStateMutationResult> => {
  return writeInboxThreadState(threadKey, {
    is_read: false,
    status: 'unread',
    last_read_at: null,
  })
}

export const archiveThread = async (threadKey: string): Promise<InboxThreadStateMutationResult> => {
  return writeInboxThreadState(threadKey, {
    is_archived: true,
    status: 'archived',
    stage: 'archived',
    archived_at: new Date().toISOString(),
  })
}

export const unarchiveThread = async (threadKey: string): Promise<InboxThreadStateMutationResult> => {
  return writeInboxThreadState(threadKey, {
    is_archived: false,
    status: 'open',
    stage: 'needs_response',
    archived_at: null,
  })
}

export const updateThreadStage = async (threadKey: string, stage: string): Promise<InboxThreadStateMutationResult> => {
  const status = stage === 'archived' ? 'archived' : stage === 'dnc_opt_out' ? 'suppressed' : 'open'
  return writeInboxThreadState(threadKey, {
    stage,
    status,
    is_archived: stage === 'archived',
    archived_at: stage === 'archived' ? new Date().toISOString() : null,
  })
}

export const updateThreadStatus = async (threadKey: string, status: string): Promise<InboxThreadStateMutationResult> => {
  const archived = status === 'archived'
  return writeInboxThreadState(threadKey, {
    status,
    is_archived: archived,
    archived_at: archived ? new Date().toISOString() : null,
  })
}

export const updateThreadPriority = async (threadKey: string, priority: string): Promise<InboxThreadStateMutationResult> => {
  return writeInboxThreadState(threadKey, {
    priority,
    is_urgent: priority === 'urgent',
  })
}

export const pinThread = async (threadKey: string, pinned: boolean): Promise<InboxThreadStateMutationResult> => {
  return writeInboxThreadState(threadKey, {
    is_pinned: pinned,
  })
}

export const flagThread = async (threadKey: string): Promise<InboxThreadStateMutationResult> => {
  return updateThreadStage(threadKey, 'needs_response')
}

export const sendDraft = async (_threadIdOrKey: string, _text: string): Promise<void> => {
  void _threadIdOrKey
  void _text
  throw new Error('sendDraft: replaced by sendInboxMessageNow — use that instead')
}

// ── Suppression / opt-out check ───────────────────────────────────────────
/**
 * Returns true if the phone number appears opted out or suppressed.
 * Checks:
 *   1. The most recent message_events row for that phone has is_opt_out=true
 *   2. A sms_suppression_list table exists and contains the phone
 */
export const checkSuppressionStatus = async (phone: string): Promise<{ suppressed: boolean; reason: string | null }> => {
  if (!phone) return { suppressed: false, reason: null }
  const supabase = getSupabaseClient()
  const variants = buildPhoneVariants(phone)

  // Check message_events for opt-out
  const { data: optOutRows } = await supabase
    .from('message_events')
    .select('is_opt_out,opt_out_keyword')
    .or(
      variants.map(v => `from_phone_number.eq.${safeFilterValue(v)}`).concat(
        variants.map(v => `to_phone_number.eq.${safeFilterValue(v)}`),
      ).join(','),
    )
    .order('created_at', { ascending: false })
    .limit(10)

  const rows = safeArray(optOutRows as AnyRecord[])
  const optedOut = rows.some((r) => asBoolean(r['is_opt_out'], false))
  if (optedOut) {
    const keywordRow = rows.find(r => r['opt_out_keyword'])
    const keyword = asString(keywordRow ? (keywordRow as AnyRecord)['opt_out_keyword'] : null, '')
    return { suppressed: true, reason: `Opted out${keyword ? ` (${keyword})` : ''}` }
  }

  // Try sms_suppression_list if it exists
  for (const variant of variants) {
    const { data: suppRows, error: suppErr } = await supabase
      .from('sms_suppression_list')
      .select('id,reason')
      .or(`phone.eq.${safeFilterValue(variant)},phone_number.eq.${safeFilterValue(variant)},canonical_e164.eq.${safeFilterValue(variant)}`)
      .limit(1)
    if (!suppErr && safeArray(suppRows as AnyRecord[]).length > 0) {
      const suppRow = safeArray(suppRows as AnyRecord[])[0]!
      return { suppressed: true, reason: `Suppressed: ${asString(getFirst(suppRow, ['reason']), 'on suppression list')}` }
    }
    // If error code 42P01 (no such table), stop trying
    if (suppErr && (suppErr as { code?: string }).code === '42P01') break
  }

  return { suppressed: false, reason: null }
}

/**
 * Send Now from Inbox:
 * This is a pure-SPA project with no backend API server.
 * "Send Now" works by inserting a send_queue row with status='ready',
 * which the queue processor picks up immediately, plus an optimistic
 * message_events row so the thread updates in realtime.
 *
 * Architecture note:
 * If a backend /api/inbox/send-now route is added in the future,
 * swap the Supabase insert for a fetch('/api/inbox/send-now', ...) call here.
 * The queue processor is the only code that should call TextGrid directly.
 */
export const sendInboxMessageNow = async (
  thread: InboxThread,
  messageText: string,
  options?: { fromPhoneNumber?: string },
): Promise<SendNowResult> => {
  const trimmedText = messageText.trim()
  if (!trimmedText) {
    return { ok: false, queueId: null, messageEventId: null, providerMessageSid: null, deliveryStatus: null, errorMessage: 'Message text is required', insertPayloadKeys: [], suppressionBlocked: false, sendRouteUsed: 'none', queueProcessorEligible: false }
  }

  const personalization = buildQueuePersonalization(thread, trimmedText)

  const toPhone = normalizePhone(thread.canonicalE164 || thread.phoneNumber)
  if (!toPhone) {
    return { ok: false, queueId: null, messageEventId: null, providerMessageSid: null, deliveryStatus: null, errorMessage: 'Thread has no valid phone number', insertPayloadKeys: [], suppressionBlocked: false, sendRouteUsed: 'none', queueProcessorEligible: false }
  }

  // ── Suppression check ──────────────────────────────────────────────────────
  const { suppressed, reason: suppressionReason } = await checkSuppressionStatus(toPhone)
  if (suppressed) {
    if (DEV) console.warn('[sendInboxMessageNow] suppressed', { toPhone, suppressionReason })
    return { ok: false, queueId: null, messageEventId: null, providerMessageSid: null, deliveryStatus: null, errorMessage: suppressionReason ?? 'Recipient is suppressed or opted out', insertPayloadKeys: [], suppressionBlocked: true, sendRouteUsed: 'none', queueProcessorEligible: false }
  }

  // ── Resolve from number ────────────────────────────────────────────────────
  // Try all possible sources for from_phone_number; empty strings are treated as falsy
  const fromPhone = [
    normalizePhone(options?.fromPhoneNumber ?? ''),
    normalizePhone(thread.ourNumber ?? ''),
    normalizePhone(import.meta.env.VITE_TEXTGRID_FROM_NUMBER ?? ''),
    normalizePhone(import.meta.env.VITE_TEXTGRID_NUMBER ?? ''),
  ].find((phone) => phone && phone.length > 0) || null

  if (!fromPhone) {
    if (DEV) console.warn('[sendInboxMessageNow] no from_phone_number available — send will likely fail', { threadOurNumber: thread.ourNumber, envVars: { VITE_TEXTGRID_FROM_NUMBER: !!import.meta.env.VITE_TEXTGRID_FROM_NUMBER, VITE_TEXTGRID_NUMBER: !!import.meta.env.VITE_TEXTGRID_NUMBER } })
  }

  // If from number known, try to resolve textgrid_numbers table for the number id
  let textgridNumberId = asString(thread.textgridNumberId, '') || null

  if (!textgridNumberId && fromPhone) {
    const supabase = getSupabaseClient()
    const { data: tgRows } = await supabase
      .from('textgrid_numbers')
      .select('id,phone_number,status')
      .or(
        buildPhoneVariants(fromPhone)
          .map(v => `phone_number.eq.${safeFilterValue(v)}`)
          .join(','),
      )
      .eq('status', 'active')
      .limit(1)
    if (tgRows && safeArray(tgRows as AnyRecord[]).length > 0) {
      textgridNumberId = asString(getFirst(safeArray(tgRows as AnyRecord[])[0]!, ['id']), '') || null
    }
  }

  const now = new Date().toISOString()
  const queueKey = `inbox:send_now:${thread.threadKey ?? thread.id}:${Date.now()}`

  const supabase = getSupabaseClient()
  const insertPayload: Record<string, unknown> = {
    queue_status: 'queued',    // processor selects WHERE queue_status = 'queued'
    queue_key: queueKey,
    queue_id: queueKey,
    queue_sequence: 1,
    scheduled_for: now,
    scheduled_for_utc: now,
    scheduled_for_local: now,
    send_priority: 10,          // higher priority than feed rows (priority 5)
    is_locked: false,
    retry_count: 0,
    max_retries: 3,
    message_body: personalization.messageText,
    message_text: personalization.messageText,
    to_phone_number: toPhone,
    character_count: personalization.messageText.length,
    touch_number: 1,
    current_stage: 'manual_reply',
    message_type: 'manual_reply',
    use_case_template: 'inbox_manual_send_now',
    // contact_window intentionally omitted — null means no window restriction
    // timezone not required but nice to have
    metadata: {
      source: 'inbox',
      action: 'send_now',
      thread_key: thread.threadKey,
      selected_thread_id: thread.id,
      created_from: 'leadcommand_inbox',
      our_number: thread.ourNumber,
      seller_phone: thread.phoneNumber,
      note: 'queued_ready_for_processor',
      template_variables: personalization.renderVariables,
      candidate_snapshot: personalization.candidateSnapshot,
      personalization: personalization.personalizationMeta,
    },
    created_at: now,
  }

  // ALWAYS include from_phone_number (even if null) — backend processor requires this field
  insertPayload.from_phone_number = fromPhone
  if (isValidUUID(asString(textgridNumberId, ''))) insertPayload.textgrid_number_id = textgridNumberId
  if (isValidUUID(asString(thread.phoneNumberId, ''))) insertPayload.phone_number_id = thread.phoneNumberId
  if (thread.propertyAddress) insertPayload.property_address = thread.propertyAddress
  if (isValidUUID(asString(thread.ownerId, ''))) insertPayload.master_owner_id = thread.ownerId
  if (isValidUUID(asString(thread.prospectId, ''))) insertPayload.prospect_id = thread.prospectId
  if (isValidUUID(asString(thread.propertyId, ''))) insertPayload.property_id = thread.propertyId
  if (thread.marketId) insertPayload.market_id = thread.marketId

  const insertPayloadKeys = Object.keys(insertPayload)

  if (DEV) { 
    console.log('[sendInboxMessageNow] inserting queue row queue_status=ready', { keys: insertPayloadKeys, toPhone, fromPhone, queueKey })
    console.log('[sendInboxMessageNow] full payload:', insertPayload)
  } else {
    console.log('[sendInboxMessageNow] inserting with keys:', insertPayloadKeys.join(', '), '| toPhone:', toPhone, '| fromPhone:', fromPhone)
  }

  const { data: queueData, error: queueError } = await supabase
    .from('send_queue')
    .insert(insertPayload)
    .select('id,queue_id,queue_key,queue_status')
    .limit(1)

  if (queueError) {
    console.error('[sendInboxMessageNow] queue insert FAILED:', { 
      errorMessage: queueError.message, 
      errorCode: queueError.code, 
      keys: insertPayloadKeys, 
      toPhone, 
      fromPhone 
    })
    if (DEV) console.error('[sendInboxMessageNow] full error:', queueError)
    return { ok: false, queueId: null, messageEventId: null, providerMessageSid: null, deliveryStatus: null, errorMessage: queueError.message, insertPayloadKeys, suppressionBlocked: false, sendRouteUsed: 'send_queue_queued', queueProcessorEligible: false }
  }

  const queueRow = safeArray(queueData as AnyRecord[])[0] ?? null
  const queueId = queueRow ? asString(getFirst(queueRow, ['id', 'queue_id', 'queue_key']), '') || queueKey : queueKey

  let queueProcessorEligible = true
  let processorLagCount = 0
  try {
    const lagCutoffIso = new Date(Date.now() - QUEUE_PROCESSOR_LAG_MINUTES * 60 * 1000).toISOString()
    const lagProbe = await supabase
      .from('send_queue')
      .select('id', { count: 'exact', head: true })
      .eq('queue_status', 'queued')
      .lt('created_at', lagCutoffIso)

    if (!lagProbe.error) {
      processorLagCount = lagProbe.count ?? 0
      if (processorLagCount > 0) queueProcessorEligible = false
    }
  } catch {
    // Keep optimistic defaults when health probe cannot run.
  }

  // ── Insert optimistic outbound message_events row ─────────────────────────
  const eventPayload: Record<string, unknown> = {
    message_event_key: `${queueKey}:optimistic`,
    direction: 'outbound',
    event_type: 'outbound_send',
    message_body: personalization.messageText,
    to_phone_number: toPhone,
    delivery_status: 'queued',
    provider_delivery_status: 'queued',
    source_app: 'inbox',
    trigger_name: 'inbox_manual_send_now',
    event_timestamp: now,
    created_at: now,
    sent_at: now,
    is_final_failure: false,
    character_count: personalization.messageText.length,
    queue_id: queueId,
    metadata: { source: 'inbox_send_now_optimistic', queue_key: queueKey },
  }
  // ALWAYS include from_phone_number (even if null)
  eventPayload.from_phone_number = fromPhone
  if (isValidUUID(asString(textgridNumberId, ''))) eventPayload.textgrid_number_id = textgridNumberId
  if (isValidUUID(asString(thread.phoneNumberId, ''))) eventPayload.phone_number_id = thread.phoneNumberId
  if (thread.propertyAddress) eventPayload.property_address = thread.propertyAddress
  if (isValidUUID(asString(thread.ownerId, ''))) eventPayload.master_owner_id = thread.ownerId
  if (isValidUUID(asString(thread.prospectId, ''))) eventPayload.prospect_id = thread.prospectId
  if (isValidUUID(asString(thread.propertyId, ''))) eventPayload.property_id = thread.propertyId
  if (thread.marketId) eventPayload.market_id = thread.marketId

  const { data: eventData, error: eventError } = await supabase
    .from('message_events')
    .insert(eventPayload)
    .select('id')
    .limit(1)

  if (eventError) {
    console.error('[sendInboxMessageNow] message_events insert FAILED (non-fatal):', { 
      errorMessage: eventError.message, 
      errorCode: eventError.code,
      queueId
    })
    if (DEV) console.error('[sendInboxMessageNow] full message_events error:', eventError)
  }

  const eventRow = safeArray(eventData as AnyRecord[])[0] ?? null
  const messageEventId = eventRow ? asString(getFirst(eventRow, ['id']), '') || null : null

  if (DEV) console.log('[sendInboxMessageNow] success', { queueId, messageEventId, queue_status: 'queued', queueKey, queueProcessorEligible, processorLagCount })
  else console.log('[sendInboxMessageNow] SUCCESS - queueId:', queueId, '| messageEventId:', messageEventId)

  return {
    ok: true,
    queueId,
    messageEventId,
    providerMessageSid: null,
    deliveryStatus: 'queued',
    errorMessage: queueProcessorEligible ? null : `Queued, but processor appears delayed (${processorLagCount} queued older than ${QUEUE_PROCESSOR_LAG_MINUTES}m)`,
    insertPayloadKeys,
    suppressionBlocked: false,
    sendRouteUsed: 'send_queue_queued',
    queueProcessorEligible,
  }
}

/**
 * Schedule a reply from Inbox.
 * Inserts a send_queue row with status='scheduled' and the given scheduledAt time.
 */
export const scheduleReplyFromInbox = async (
  thread: InboxThread,
  messageText: string,
  scheduledAt: string,
): Promise<QueueReplyResult> => {
  const trimmedText = messageText.trim()
  if (!trimmedText) {
    return { ok: false, queueId: null, status: null, errorMessage: 'Message text is required', insertPayloadKeys: [] }
  }

  const personalization = buildQueuePersonalization(thread, trimmedText)

  const toPhone = normalizePhone(thread.canonicalE164 || thread.phoneNumber)
  if (!toPhone) {
    return { ok: false, queueId: null, status: null, errorMessage: 'Thread has no valid phone number', insertPayloadKeys: [] }
  }

  // Resolve from number with better fallback chain
  const fromPhone = [
    normalizePhone(thread.ourNumber ?? ''),
    normalizePhone(import.meta.env.VITE_TEXTGRID_FROM_NUMBER ?? ''),
    normalizePhone(import.meta.env.VITE_TEXTGRID_NUMBER ?? ''),
  ].find((phone) => phone && phone.length > 0) || null

  const supabase = getSupabaseClient()
  const now = new Date().toISOString()
  const scheduledIso = scheduledAt || now
  const queueKey = `inbox:scheduled:${thread.threadKey ?? thread.id}:${Date.now()}`

  const payload: Record<string, unknown> = {
    queue_status: 'queued',    // processor selects WHERE queue_status = 'queued' AND scheduled_for <= now
    queue_key: queueKey,
    queue_id: queueKey,
    queue_sequence: 1,
    scheduled_for: scheduledIso,   // processor skips until this timestamp is reached
    scheduled_for_utc: scheduledIso,
    scheduled_for_local: scheduledIso,
    send_priority: 5,
    is_locked: false,
    retry_count: 0,
    max_retries: 3,
    message_body: personalization.messageText,
    message_text: personalization.messageText,
    to_phone_number: toPhone,
    character_count: personalization.messageText.length,
    touch_number: 1,
    current_stage: 'manual_reply',
    message_type: 'manual_scheduled_reply',
    use_case_template: 'inbox_manual_scheduled_reply',
    metadata: {
      source: 'inbox',
      action: 'schedule_reply',
      thread_key: thread.threadKey,
      selected_thread_id: thread.id,
      created_from: 'leadcommand_inbox',
      our_number: thread.ourNumber,
      seller_phone: thread.phoneNumber,
      template_variables: personalization.renderVariables,
      candidate_snapshot: personalization.candidateSnapshot,
      personalization: personalization.personalizationMeta,
    },
    created_at: now,
  }

  // ALWAYS include from_phone_number (even if null)
  payload.from_phone_number = fromPhone
  if (isValidUUID(asString(thread.phoneNumberId, ''))) payload.phone_number_id = thread.phoneNumberId
  if (isValidUUID(asString(thread.textgridNumberId, ''))) payload.textgrid_number_id = thread.textgridNumberId
  if (thread.propertyAddress) payload.property_address = thread.propertyAddress
  if (isValidUUID(asString(thread.ownerId, ''))) payload.master_owner_id = thread.ownerId
  if (isValidUUID(asString(thread.prospectId, ''))) payload.prospect_id = thread.prospectId
  if (isValidUUID(asString(thread.propertyId, ''))) payload.property_id = thread.propertyId
  if (thread.marketId) payload.market_id = thread.marketId

  const insertPayloadKeys = Object.keys(payload)
  if (DEV) console.log('[scheduleReplyFromInbox] inserting queue_status=scheduled', { toPhone, scheduledAt: scheduledIso, queueKey })

  const { data, error } = await supabase.from('send_queue').insert(payload).select('id,queue_id,queue_key,queue_status').limit(1)
  if (error) {
    if (DEV) console.error('[scheduleReplyFromInbox] failed:', error.message)
    return { ok: false, queueId: null, status: null, errorMessage: error.message, insertPayloadKeys }
  }

  const row = safeArray(data as AnyRecord[])[0] ?? null
  const queueId = row ? asString(getFirst(row, ['id', 'queue_id', 'queue_key']), '') || queueKey : queueKey
  if (DEV) console.log('[scheduleReplyFromInbox] success', { queueId, scheduledAt: scheduledIso })

  return { ok: true, queueId, status: 'scheduled', errorMessage: null, insertPayloadKeys }
}
