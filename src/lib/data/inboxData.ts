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
  type AnyRecord,
} from './shared'

/**
 * TODO (schema hardening): message_events should ideally include these
 * canonical columns for reliable thread grouping without field-guessing:
 *
 *   thread_key             – stable per-conversation identifier
 *   seller_phone_e164      – normalized seller phone in E.164 format
 *   owner_id               – linked master_owner_id
 *   master_owner_id        – master owner reference
 *   prospect_id            – linked prospect
 *   property_id            – linked property
 *   direction              – 'inbound' | 'outbound'
 *   message_body           – plain-text body
 *   created_at             – ISO timestamp (already likely present)
 *   delivery_status        – carrier delivery status
 *   textgrid_message_id    – TextGrid message SID for deduplication
 *
 * Once these exist, the multi-field detection heuristics below can be
 * replaced with direct column references for better performance and accuracy.
 */

export interface InboxThreadFilters {
  status?: 'all' | 'unread' | 'read' | 'replied' | 'archived'
  priority?: 'all' | 'urgent' | 'high' | 'normal' | 'low'
  query?: string
}

export interface ThreadMessage {
  id: string
  direction: 'inbound' | 'outbound' | 'unknown'
  body: string
  createdAt: string
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
}

export interface ThreadContextDebug {
  matchedOwnerBy: string | null
  matchedProspectBy: string | null
  matchedPropertyBy: string | null
  matchedPhoneBy: string | null
  matchedEmailBy: string | null
  matchedAiBrainBy: string | null
  matchedQueueBy: string | null
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

export interface SuggestedDraft {
  text: string
  confidence: number | null
  reason: string | null
  source: 'ai_brain' | 'send_queue' | 'template' | 'placeholder'
}

const DEV = Boolean(import.meta.env.DEV)

const toSentiment = (value: unknown): InboxThread['sentiment'] => {
  const normalized = normalizeStatus(value)
  if (normalized === 'hot' || normalized === 'interested' || normalized === 'positive') return 'hot'
  if (normalized === 'warm') return 'warm'
  if (normalized === 'cold' || normalized === 'negative') return 'cold'
  return 'neutral'
}

const normalizePhone = (value: unknown): string => {
  const raw = asString(value, '').trim()
  if (!raw) return ''
  const hasPlus = raw.startsWith('+')
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  return hasPlus ? `+${digits}` : digits
}

const safeFilterValue = (value: string): string => value.replace(/[(),]/g, '')

// ── Message_events phone field candidates ─────────────────────────────────
// Ordered: most-canonical → inbound sender → outbound recipient → generic
const ALL_PHONE_FIELDS = [
  'canonical_e164', 'phone_e164', 'e164', 'seller_phone_e164',
  'best_phone_e164', 'phone_number', 'phone', 'seller_phone',
  'contact_phone', 'recipient_phone',
  'to_number', 'to', 'message_to', 'destination', 'destination_number', 'textgrid_to',
  'from_number', 'from', 'message_from', 'source_number', 'textgrid_from',
  'recipient', 'source',
] as const

// When direction is inbound, seller is the sender
const INBOUND_SENDER_FIELDS = [
  'from_number', 'from', 'message_from', 'source_number', 'source', 'textgrid_from',
] as const

// When direction is outbound, seller is the recipient
const OUTBOUND_RECIPIENT_FIELDS = [
  'to_number', 'to', 'message_to', 'destination_number', 'destination',
  'recipient', 'recipient_phone', 'textgrid_to',
] as const

// Canonical-preferred fields regardless of direction
const CANONICAL_PREFERRED_FIELDS = [
  'canonical_e164', 'phone_e164', 'e164', 'seller_phone_e164',
  'best_phone_e164', 'seller_phone', 'phone_number', 'phone', 'contact_phone',
] as const

export interface SellerPhoneResult {
  sellerPhone: string
  sellerPhoneSourceField: string
  canonicalE164: string
}

/**
 * Determine the seller's phone number from a message_events row.
 * Uses direction to pick sender (inbound) or recipient (outbound) field.
 * Falls back to canonical fields, then any phone field.
 */
export const getSellerPhoneFromMessage = (row: AnyRecord): SellerPhoneResult => {
  const direction = normalizeMessageDirection(row)

  let sellerPhone = ''
  let sellerPhoneSourceField = ''

  if (direction === 'inbound') {
    for (const field of INBOUND_SENDER_FIELDS) {
      const val = normalizePhone(row[field])
      if (val) { sellerPhone = val; sellerPhoneSourceField = field; break }
    }
  } else if (direction === 'outbound') {
    for (const field of OUTBOUND_RECIPIENT_FIELDS) {
      const val = normalizePhone(row[field])
      if (val) { sellerPhone = val; sellerPhoneSourceField = field; break }
    }
  }

  // direction unknown or field not found: prefer canonical
  if (!sellerPhone) {
    for (const field of CANONICAL_PREFERRED_FIELDS) {
      const val = normalizePhone(row[field])
      if (val) { sellerPhone = val; sellerPhoneSourceField = field; break }
    }
  }

  // last resort: any phone field
  if (!sellerPhone) {
    for (const field of ALL_PHONE_FIELDS) {
      const val = normalizePhone(row[field])
      if (val) { sellerPhone = val; sellerPhoneSourceField = field; break }
    }
  }

  const canonicalE164 =
    normalizePhone(row['canonical_e164']) ||
    normalizePhone(row['phone_e164']) ||
    normalizePhone(row['e164']) ||
    sellerPhone

  return { sellerPhone, sellerPhoneSourceField, canonicalE164 }
}

export const getMessageTimestamp = (row: AnyRecord): string => {
  const value = getFirst(row, [
    'created_at',
    'timestamp',
    'message_timestamp',
    'sent_at',
    'received_at',
    'event_at',
    'updated_at',
  ])
  return asIso(value) ?? new Date().toISOString()
}

export const getMessageBody = (row: AnyRecord): string => {
  return asString(
    getFirst(row, [
      'body',
      'text',
      'message',
      'message_body',
      'content',
      'rendered_message',
      'template_text',
    ]),
    '',
  )
}

export const normalizeMessageDirection = (row: AnyRecord): 'inbound' | 'outbound' | 'unknown' => {
  const direction = normalizeStatus(getFirst(row, ['direction', 'message_direction']))
  if (['inbound', 'incoming', 'received', 'reply', 'from_seller'].includes(direction)) return 'inbound'
  if (['outbound', 'outgoing', 'sent', 'queued', 'to_seller'].includes(direction)) return 'outbound'

  const eventType = normalizeStatus(getFirst(row, ['event_type', 'type']))
  if (['inbound', 'incoming', 'received', 'message_received', 'reply_received'].includes(eventType)) return 'inbound'
  if (['outbound', 'outgoing', 'sent', 'message_sent', 'send'].includes(eventType)) return 'outbound'

  const status = normalizeStatus(getFirst(row, ['status']))
  if (['received', 'inbound'].includes(status)) return 'inbound'
  if (['queued', 'sent', 'delivered', 'outbound'].includes(status)) return 'outbound'

  const source = normalizeStatus(getFirst(row, ['source']))
  if (['inbound', 'incoming', 'seller'].includes(source)) return 'inbound'
  if (['outbound', 'outgoing', 'operator', 'ai'].includes(source)) return 'outbound'

  const fromNumber = normalizePhone(getFirst(row, ['from_number']))
  const toNumber = normalizePhone(getFirst(row, ['to_number']))
  const ownerPhone = normalizePhone(getFirst(row, ['phone_number', 'canonical_e164']))

  if (ownerPhone && fromNumber && ownerPhone === fromNumber) return 'inbound'
  if (ownerPhone && toNumber && ownerPhone === toNumber) return 'outbound'

  return 'unknown'
}

const getThreadKeyParts = (
  row: AnyRecord,
  indexHint: number,
): { key: string; method: string; confidence: 'high' | 'medium' | 'low' } => {
  // ── 1. Explicit conversation/thread ID ──────────────────────────────────
  const conversationId = asString(
    getFirst(row, [
      'conversation_id', 'thread_id', 'textgrid_thread_id', 'message_thread_id',
      'sms_thread_id', 'external_conversation_id', 'conversation_key', 'thread_key',
    ]),
    '',
  )

  // ── 2. Owner/seller IDs ─────────────────────────────────────────────────
  const ownerId = asString(
    getFirst(row, [
      'owner_id', 'master_owner_id', 'masterowner_id', 'linked_master_owner',
      'master_owner', 'seller_id', 'prospect_owner_id', 'podio_owner_id',
    ]),
    '',
  )

  // ── 3. Prospect IDs ─────────────────────────────────────────────────────
  const prospectId = asString(
    getFirst(row, [
      'prospect_id', 'linked_prospect', 'prospect', 'podio_prospect_id',
    ]),
    '',
  )

  // ── 4. Property IDs and address ─────────────────────────────────────────
  const propertyId = asString(
    getFirst(row, [
      'property_id', 'linked_property', 'property', 'podio_property_id',
    ]),
    '',
  )
  const propertyAddress = normalizeStatus(
    getFirst(row, ['property_address', 'property_address_full', 'address']),
  )

  // ── 5. Seller phone via direction-aware detection ───────────────────────
  // Note: normalizeMessageDirection is called before getSellerPhoneFromMessage
  // but getSellerPhoneFromMessage also calls it internally — that's fine, it's pure.
  const { sellerPhone } = getSellerPhoneFromMessage(row)

  // ── Grouping priority ───────────────────────────────────────────────────
  // P1: explicit conversation/thread ID
  if (conversationId) return { key: `conversation:${conversationId}`, method: 'conversation_id', confidence: 'high' }
  // P2: sellerPhone + property_id
  if (sellerPhone && propertyId) return { key: `phone_property:${sellerPhone}:${propertyId}`, method: 'sellerPhone+property_id', confidence: 'high' }
  // P3: sellerPhone + property_address
  if (sellerPhone && propertyAddress) return { key: `phone_address:${sellerPhone}:${propertyAddress}`, method: 'sellerPhone+property_address', confidence: 'high' }
  // P4: sellerPhone + owner_id
  if (sellerPhone && ownerId) return { key: `phone_owner:${sellerPhone}:${ownerId}`, method: 'sellerPhone+owner_id', confidence: 'high' }
  // P5: sellerPhone alone
  if (sellerPhone) return { key: `phone:${sellerPhone}`, method: 'sellerPhone', confidence: 'medium' }
  // P6: owner + property
  if (ownerId && propertyId) return { key: `owner_property:${ownerId}:${propertyId}`, method: 'owner_id+property_id', confidence: 'medium' }
  // P7: owner alone
  if (ownerId) return { key: `owner:${ownerId}`, method: 'owner_id', confidence: 'low' }
  // P8: property alone
  if (propertyId) return { key: `property:${propertyId}`, method: 'property_id', confidence: 'low' }
  // P9: prospect alone
  if (prospectId) return { key: `prospect:${prospectId}`, method: 'prospect_id', confidence: 'low' }
  return { key: `fallback:${indexHint}`, method: 'fallback_id', confidence: 'low' }
}

export const doesMessageBelongToThread = (
  messageRow: AnyRecord,
  selectedThread: InboxThread,
): boolean => {
  const conversationId = asString(
    getFirst(messageRow, ['conversation_id', 'thread_id', 'textgrid_thread_id', 'message_thread_id', 'sms_thread_id']),
    '',
  )
  const ownerId = asString(
    getFirst(messageRow, ['owner_id', 'master_owner_id', 'masterowner_id', 'seller_id']),
    '',
  )
  const propertyId = asString(
    getFirst(messageRow, ['property_id', 'linked_property']),
    '',
  )
  const prospectId = asString(
    getFirst(messageRow, ['prospect_id', 'linked_prospect']),
    '',
  )
  const { sellerPhone, canonicalE164: msgCanonical } = getSellerPhoneFromMessage(messageRow)

  const selectedThreadKey = asString(selectedThread.threadKey, '')
  const selectedOwnerId = asString(selectedThread.ownerId, '')
  const selectedPropertyId = asString(selectedThread.propertyId, '')
  const selectedProspectId = asString(selectedThread.prospectId, '')
  const selectedCanonical = normalizePhone(selectedThread.canonicalE164)
  const selectedPhone = normalizePhone(selectedThread.phoneNumber)

  const keys = new Set<string>(
    [
      selectedThread.id,
      selectedThreadKey,
      selectedThread.leadId,
      selectedOwnerId,
      selectedPropertyId,
      selectedProspectId,
      selectedCanonical,
      selectedPhone,
    ].filter(Boolean),
  )

  if (conversationId && keys.has(conversationId)) return true
  if (ownerId && keys.has(ownerId)) return true
  if (propertyId && keys.has(propertyId)) return true
  if (prospectId && keys.has(prospectId)) return true
  if (sellerPhone && keys.has(sellerPhone)) return true
  if (msgCanonical && keys.has(msgCanonical)) return true

  if (selectedThreadKey) {
    const derived = getThreadKeyParts(messageRow, 0)
    if (derived.key === selectedThreadKey) return true
  }

  return false
}

const runFilteredQuery = async (
  table: string,
  filters: Array<{ key: string; value: string }>,
  limit = 20,
): Promise<AnyRecord[]> => {
  const supabase = getSupabaseClient()
  let query = supabase.from(table).select('*').limit(limit)
  const valid = filters.filter((f) => f.value)
  if (valid.length > 0) {
    const orClause = valid.map((f) => `${f.key}.eq.${safeFilterValue(f.value)}`).join(',')
    query = query.or(orClause)
  }
  const { data, error } = await query
  if (error) {
    if (DEV) {
      console.warn(`[NEXUS] ${table} lookup failed`, error.message)
    }
    return []
  }
  return safeArray(data as AnyRecord[])
}

export const getInboxThreads = async (filters: InboxThreadFilters = {}): Promise<InboxThread[]> => {
  const supabase = getSupabaseClient()

  const [eventsResult, ownerResult, propertyResult, prospectResult] = await Promise.all([
    supabase
      .from('message_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(3000),
    supabase
      .from('owners')
      .select('*')
      .limit(3000),
    supabase
      .from('properties')
      .select('*')
      .limit(4000),
    supabase
      .from('prospects')
      .select('*')
      .limit(4000),
  ])

  if (eventsResult.error) throw new Error(mapErrorMessage(eventsResult.error))

  const events = safeArray(eventsResult.data as AnyRecord[])
  const owners = ownerResult.error ? [] : safeArray(ownerResult.data as AnyRecord[])
  const properties = propertyResult.error ? [] : safeArray(propertyResult.data as AnyRecord[])
  const prospects = prospectResult.error ? [] : safeArray(prospectResult.data as AnyRecord[])

  // ── DEV: log raw message_events schema to diagnose field mapping ─────────
  if (DEV && events.length > 0) {
    const sampleCount = Math.min(3, events.length)
    for (let i = 0; i < sampleCount; i++) {
      console.log(`[Inbox message_events sample keys][${i}]`, Object.keys(events[i]!))
      console.log(`[Inbox message_events sample row][${i}]`, events[i])
    }
  }

  const ownerById = new Map<string, AnyRecord>()
  for (const owner of owners) {
    const ownerId = asString(getFirst(owner, ['owner_id', 'master_owner_id']), '')
    if (ownerId) ownerById.set(ownerId, owner)
  }

  const propertyById = new Map<string, AnyRecord>()
  for (const property of properties) {
    const propertyId = asString(getFirst(property, ['property_id', 'id']), '')
    if (propertyId) propertyById.set(propertyId, property)
  }

  const prospectById = new Map<string, AnyRecord>()
  for (const prospect of prospects) {
    const prospectId = asString(getFirst(prospect, ['prospect_id', 'id']), '')
    if (prospectId) prospectById.set(prospectId, prospect)
  }

  const grouped = new Map<string, { meta: ReturnType<typeof getThreadKeyParts>; rows: AnyRecord[] }>()
  events.forEach((row, index) => {
    const meta = getThreadKeyParts(row, index)
    const bucket = grouped.get(meta.key)
    if (bucket) {
      bucket.rows.push(row)
      return
    }
    grouped.set(meta.key, { meta, rows: [row] })
  })

  const threads: InboxThread[] = []

  for (const [threadKey, bucket] of grouped.entries()) {
    const sorted = [...bucket.rows].sort(
      (a, b) => new Date(getMessageTimestamp(b)).getTime() - new Date(getMessageTimestamp(a)).getTime(),
    )
    const latest = sorted[0]
    if (!latest) continue

    const latestDirection = sorted.map(normalizeMessageDirection).find((d) => d !== 'unknown') ?? 'unknown'
    const lastInbound = sorted
      .filter((row) => normalizeMessageDirection(row) === 'inbound')
      .map((row) => getMessageTimestamp(row))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null
    const lastOutbound = sorted
      .filter((row) => normalizeMessageDirection(row) === 'outbound')
      .map((row) => getMessageTimestamp(row))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null

    const ownerId = asString(
      getFirst(latest, [
        'owner_id', 'master_owner_id', 'masterowner_id', 'linked_master_owner',
        'master_owner', 'seller_id', 'prospect_owner_id', 'podio_owner_id',
      ]),
      '',
    )
    const prospectId = asString(
      getFirst(latest, [
        'prospect_id', 'linked_prospect', 'prospect', 'podio_prospect_id',
      ]),
      '',
    )
    const propertyId = asString(
      getFirst(latest, [
        'property_id', 'linked_property', 'property', 'podio_property_id',
      ]),
      '',
    )
    const { sellerPhone, sellerPhoneSourceField, canonicalE164 } = getSellerPhoneFromMessage(latest)
    const phoneNumber = sellerPhone

    const owner = ownerById.get(ownerId)
    const property = propertyById.get(propertyId)
    const prospect = prospectById.get(prospectId)

    const ownerName = asString(
      getFirst(owner ?? prospect ?? latest, ['full_name', 'name', 'first_name', 'owner_name']),
      'Unknown owner',
    )

    const propertyAddress = asString(
      getFirst(property ?? latest, ['property_address', 'address']),
      asString(getFirst(latest, ['property_address']), ''),
    )

    const market = asString(
      getFirst(latest, ['market', 'market_id']),
      asString(getFirst(property ?? owner ?? prospect ?? {}, ['market']), 'unknown'),
    )

    const archived = ['archived', 'closed'].includes(normalizeStatus(getFirst(latest, ['status'])))
    const explicitRequiresResponse = sorted.some((row) => asBoolean(getFirst(row, ['requires_response']), false))
    const needsResponse = (latestDirection === 'inbound' || explicitRequiresResponse) && !archived

    const explicitUnreadCount = sorted.filter((row) => asBoolean(getFirst(row, ['unread']), false)).length
    const derivedUnread =
      !!lastInbound && (!lastOutbound || new Date(lastInbound).getTime() > new Date(lastOutbound).getTime())
    const unread = explicitUnreadCount > 0 || derivedUnread

    const lastActivityAt = getMessageTimestamp(latest)
    const preview = getMessageBody(latest) || 'No message preview'

    const sentiment = toSentiment(getFirst(latest, ['sentiment']))
    let priority: InboxThread['priority'] = 'normal'
    if (archived) priority = 'low'
    else if (needsResponse && unread) priority = 'urgent'
    else if (unread || sentiment === 'hot') priority = 'high'

    const status: InboxThread['status'] = archived
      ? 'archived'
      : unread
      ? 'unread'
      : latestDirection === 'inbound'
      ? 'replied'
      : 'read'

    const stage = archived ? 'Archived' : needsResponse ? 'Needs Response' : latestDirection === 'inbound' ? 'Replied' : 'Active'

    const thread: InboxThread = {
      id: asString(getFirst(latest, ['conversation_id', 'thread_id', 'event_id']), threadKey),
      leadId: propertyId || ownerId || threadKey,
      marketId: market || 'unknown',
      ownerName,
      subject: propertyAddress || `Thread ${threads.length + 1}`,
      preview,
      status,
      priority,
      sentiment,
      messageCount: sorted.length,
      lastMessageLabel: formatRelativeTime(lastActivityAt),
      lastMessageIso: lastActivityAt,
      unreadCount: explicitUnreadCount || (derivedUnread ? 1 : 0),
      aiDraft: needsResponse ? 'Draft response ready for operator review.' : null,
      labels: [market || 'General', stage],
      threadKey,
      groupingMethod: bucket.meta.method,
      groupingConfidence: bucket.meta.confidence,
      ownerId,
      prospectId,
      propertyId,
      phoneNumber,
      canonicalE164,
      sellerPhoneSourceField: sellerPhoneSourceField || undefined,
      propertyAddress,
      market,
      lastInboundAt: lastInbound,
      lastOutboundAt: lastOutbound,
      needsResponse,
      unread,
    }

    threads.push(thread)
  }

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
    if (a.status === 'unread' && b.status !== 'unread') return -1
    if (b.status === 'unread' && a.status !== 'unread') return 1
    return new Date(b.lastMessageIso).getTime() - new Date(a.lastMessageIso).getTime()
  })

  return filtered
}

export const fetchInboxModel = async (): Promise<InboxModel> => {
  const threads = await getInboxThreads()
  return {
    threads,
    unreadCount: threads.filter((thread) => thread.unreadCount > 0).length,
    urgentCount: threads.filter((thread) => thread.priority === 'urgent').length,
    totalCount: threads.length,
    aiDraftCount: threads.filter((thread) => thread.aiDraft !== null).length,
  }
}

const toThreadMessage = (row: AnyRecord): ThreadMessage => {
  const createdAt = getMessageTimestamp(row)
  const direction = normalizeMessageDirection(row)
  const deliveryStatus = asString(getFirst(row, ['delivery_status', 'status']), 'unknown')
  const { sellerPhone, canonicalE164: msgCanonical } = getSellerPhoneFromMessage(row)

  return {
    id: asString(getFirst(row, ['event_id', 'id']), createdAt),
    direction,
    body: getMessageBody(row),
    createdAt,
    deliveredAt: asIso(getFirst(row, ['delivered_at', 'sent_at'])),
    deliveryStatus,
    fromNumber: normalizePhone(getFirst(row, ['from_number', 'from', 'message_from', 'textgrid_from'])),
    toNumber: normalizePhone(getFirst(row, ['to_number', 'to', 'message_to', 'textgrid_to', 'recipient', 'destination'])),
    ownerId: asString(getFirst(row, ['owner_id', 'master_owner_id', 'masterowner_id', 'seller_id']), ''),
    prospectId: asString(getFirst(row, ['prospect_id', 'linked_prospect']), ''),
    propertyId: asString(getFirst(row, ['property_id', 'linked_property']), ''),
    phoneNumber: sellerPhone,
    canonicalE164: msgCanonical,
    templateId: asString(getFirst(row, ['template_id']), '') || null,
    templateName: asString(getFirst(row, ['template_name']), '') || null,
    agentId: asString(getFirst(row, ['agent_id']), '') || null,
    source: asString(getFirst(row, ['source']), 'sms'),
    rawStatus: normalizeStatus(getFirst(row, ['status'])),
    error: asString(getFirst(row, ['error_message', 'failure_reason', 'error_code']), '') || null,
  }
}

export const getThreadMessagesForThread = async (thread: InboxThread): Promise<ThreadMessage[]> => {
  const supabase = getSupabaseClient()
  const threadPhone = normalizePhone(thread.canonicalE164 || thread.phoneNumber)

  // ── Build server-side OR filter covering all known field names ──────────
  const filters: Array<{ key: string; value: string }> = [
    // conversation/thread ID fields
    { key: 'conversation_id', value: asString(thread.id, '') },
    { key: 'thread_id', value: asString(thread.id, '') },
    { key: 'conversation_id', value: asString(thread.threadKey, '') },
    { key: 'thread_id', value: asString(thread.threadKey, '') },
    { key: 'textgrid_thread_id', value: asString(thread.threadKey, '') },
    // canonical phone fields
    { key: 'canonical_e164', value: threadPhone },
    { key: 'phone_e164', value: threadPhone },
    { key: 'phone_number', value: threadPhone },
    { key: 'phone', value: threadPhone },
    { key: 'seller_phone', value: threadPhone },
    { key: 'seller_phone_e164', value: threadPhone },
    // directional phone fields
    { key: 'from_number', value: threadPhone },
    { key: 'to_number', value: threadPhone },
    { key: 'from', value: threadPhone },
    { key: 'to', value: threadPhone },
    { key: 'recipient', value: threadPhone },
    { key: 'destination', value: threadPhone },
    { key: 'message_to', value: threadPhone },
    { key: 'message_from', value: threadPhone },
    { key: 'textgrid_to', value: threadPhone },
    { key: 'textgrid_from', value: threadPhone },
    // relationship IDs
    { key: 'owner_id', value: asString(thread.ownerId, '') },
    { key: 'master_owner_id', value: asString(thread.ownerId, '') },
    { key: 'property_id', value: asString(thread.propertyId, '') },
    { key: 'prospect_id', value: asString(thread.prospectId, '') },
  ].filter((f) => f.value)

  if (filters.length === 0) return []

  // De-duplicate (same key+value pairs produce redundant Supabase clauses)
  const seen = new Set<string>()
  const uniqueFilters = filters.filter((f) => {
    const key = `${f.key}:${f.value}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const orClause = uniqueFilters.map((f) => `${f.key}.eq.${safeFilterValue(f.value)}`).join(',')

  const { data, error } = await supabase
    .from('message_events')
    .select('*')
    .or(orClause)
    .order('created_at', { ascending: true })
    .limit(1000)

  if (error) throw new Error(mapErrorMessage(error))

  let rows = safeArray(data as AnyRecord[])

  // ── DEV: log schema from first fetched message ──────────────────────────
  if (DEV && rows.length > 0) {
    const sampleCount = Math.min(2, rows.length)
    for (let i = 0; i < sampleCount; i++) {
      console.log(`[Inbox getThreadMessagesForThread sample keys][${i}]`, Object.keys(rows[i]!))
      console.log(`[Inbox getThreadMessagesForThread sample row][${i}]`, rows[i])
    }
  }

  // ── Client-side phone fallback ──────────────────────────────────────────
  // If server-side returned 0 results but thread has a phone, do a broader
  // fetch and filter client-side. This handles cases where no column
  // matches exactly what the Supabase filter expects.
  // TODO: once message_events has canonical thread_key/seller_phone_e164
  //       columns, replace this with a single server-side filter.
  if (rows.length === 0 && threadPhone) {
    const { data: broadData, error: broadError } = await supabase
      .from('message_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000)

    if (!broadError && broadData) {
      const broadRows = safeArray(broadData as AnyRecord[])
      rows = broadRows.filter((row) => {
        const { sellerPhone: rowPhone, canonicalE164: rowCanonical } = getSellerPhoneFromMessage(row)
        return (rowPhone && rowPhone === threadPhone) || (rowCanonical && rowCanonical === threadPhone)
      })
      if (DEV && rows.length > 0) {
        console.log(`[Inbox message_events client-side phone fallback matched ${rows.length} rows for phone ${threadPhone}]`)
      }
    }
  }

  return rows
    .map(toThreadMessage)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
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

export const getThreadContext = async (thread: InboxThread): Promise<ThreadContext> => {
  const ownerId = asString(thread.ownerId ?? thread.leadId, '')
  const propertyId = asString(thread.propertyId ?? thread.leadId, '')
  const prospectId = asString(thread.prospectId, '')
  const canonical = normalizePhone(thread.canonicalE164)
  const phone = normalizePhone(thread.phoneNumber)
  const searchPhone = canonical || phone
  const propertyAddress = asString(thread.propertyAddress ?? thread.subject, '')

  // ── Context lookup via all known relationship + phone fields ─────────────
  const [masterowners, owners, prospects, properties, phones, emails, aiRows, queueRows, offers] = await Promise.all([
    runFilteredQuery('masterowners', [
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
      { key: 'owner_id', value: ownerId },
      { key: 'property_id', value: propertyId },
      // match by any phone variant if direct IDs empty
      { key: 'phone_number', value: searchPhone },
      { key: 'canonical_e164', value: canonical },
      { key: 'phone', value: searchPhone },
    ], 5),
    runFilteredQuery('properties', [
      { key: 'property_id', value: propertyId },
      { key: 'owner_id', value: ownerId },
      { key: 'master_owner_id', value: ownerId },
      { key: 'property_address', value: propertyAddress },
      { key: 'podio_item_id', value: propertyId },
    ], 5),
    // phone_numbers: try all phone field variants — this is the key fallback
    // for context when message_events only has phone data, no owner/property IDs
    runFilteredQuery('phone_numbers', [
      { key: 'canonical_e164', value: canonical },
      { key: 'phone_e164', value: searchPhone },
      { key: 'phone_number', value: searchPhone },
      { key: 'phone', value: searchPhone },
      { key: 'owner_id', value: ownerId },
      { key: 'prospect_id', value: prospectId },
      { key: 'property_id', value: propertyId },
    ], 8),
    runFilteredQuery('emails', [
      { key: 'owner_id', value: ownerId },
      { key: 'prospect_id', value: prospectId },
      { key: 'property_id', value: propertyId },
    ], 8),
    runFilteredQuery('ai_conversation_brain', [
      { key: 'owner_id', value: ownerId },
      { key: 'prospect_id', value: prospectId },
      { key: 'property_id', value: propertyId },
      { key: 'thread_id', value: thread.id },
      { key: 'conversation_id', value: thread.id },
      { key: 'canonical_e164', value: canonical },
      { key: 'phone_number', value: searchPhone },
    ], 5),
    runFilteredQuery('send_queue', [
      { key: 'owner_id', value: ownerId },
      { key: 'prospect_id', value: prospectId },
      { key: 'property_id', value: propertyId },
      { key: 'thread_id', value: thread.id },
      { key: 'conversation_id', value: thread.id },
      { key: 'phone_number', value: searchPhone },
      { key: 'canonical_e164', value: canonical },
      { key: 'phone', value: searchPhone },
    ], 12),
    runFilteredQuery('offers', [
      { key: 'owner_id', value: ownerId },
      { key: 'prospect_id', value: prospectId },
      { key: 'property_id', value: propertyId },
      { key: 'property_address', value: propertyAddress },
      { key: 'phone_number', value: searchPhone },
    ], 8),
  ])

  const ownerRow = owners[0] ?? masterowners[0] ?? null
  const propertyRow = properties[0] ?? null
  const prospectRow = prospects[0] ?? null
  const aiRow = aiRows[0] ?? null

  const debug: ThreadContextDebug = {
    matchedOwnerBy: ownerRow
      ? (asString(getFirst(ownerRow, ['owner_id']), '') === ownerId
        ? 'owner_id'
        : asString(getFirst(ownerRow, ['master_owner_id']), '') === ownerId
        ? 'master_owner_id'
        : 'normalized_owner_key')
      : null,
    matchedProspectBy: prospectRow
      ? (asString(getFirst(prospectRow, ['prospect_id']), '') === prospectId
        ? 'prospect_id'
        : asString(getFirst(prospectRow, ['owner_id']), '') === ownerId
        ? 'owner_id'
        : 'property_id')
      : null,
    matchedPropertyBy: propertyRow
      ? (asString(getFirst(propertyRow, ['property_id']), '') === propertyId
        ? 'property_id'
        : asString(getFirst(propertyRow, ['property_address']), '') === propertyAddress
        ? 'property_address'
        : 'owner_id')
      : null,
    matchedPhoneBy: phones.length > 0
      ? (phones.some((r) => normalizePhone(getFirst(r, ['canonical_e164', 'phone_e164'])) === canonical && canonical)
        ? 'canonical_e164'
        : phones.some((r) => normalizePhone(getFirst(r, ['phone_number', 'phone'])) === (canonical || phone))
        ? 'phone_number'
        : 'owner_id/prospect_id')
      : null,
    matchedEmailBy: emails.length > 0 ? 'owner_id/prospect_id' : null,
    matchedAiBrainBy: aiRow
      ? (asString(getFirst(aiRow, ['thread_id', 'conversation_id']), '') === thread.id
        ? 'thread_id/conversation_id'
        : asString(getFirst(aiRow, ['owner_id']), '') === ownerId
        ? 'owner_id'
        : 'phone_number')
      : null,
    matchedQueueBy: queueRows.length > 0
      ? (queueRows.some((r) => asString(getFirst(r, ['thread_id', 'conversation_id']), '') === thread.id)
        ? 'thread_id/conversation_id'
        : 'owner_id/property_id')
      : null,
  }

  const matchScore = Object.values(debug).filter(Boolean).length
  const contextMatchQuality: ThreadContext['contextMatchQuality'] =
    matchScore >= 5 ? 'high' : matchScore >= 3 ? 'medium' : matchScore >= 1 ? 'low' : 'missing'

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

  const primaryPhone = normalizePhone(
    getFirst(phones[0] ?? ownerRow ?? prospectRow ?? {}, ['canonical_e164', 'phone_number', 'phone']),
  ) || null

  const stack: ThreadContext['contactStack'] = []
  for (const row of phones.slice(0, 3)) {
    const value = normalizePhone(getFirst(row, ['canonical_e164', 'phone_number']))
    if (value) stack.push({ type: 'phone', value, status: asString(getFirst(row, ['status']), 'active') })
  }
  for (const row of emails.slice(0, 3)) {
    const value = asString(getFirst(row, ['email']), '')
    if (value) stack.push({ type: 'email', value, status: asString(getFirst(row, ['status']), 'active') })
  }

  if (stack.length === 0) {
    if (primaryPhone) stack.push({ type: 'phone', value: primaryPhone, status: 'active' })
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
      ? { id: ownerId || asString(getFirst(ownerRow ?? {}, ['owner_id', 'master_owner_id']), ''), name: sellerName, market: sellerMarket }
      : null,
    property: propertyAddressValue
      ? { id: propertyId || asString(getFirst(propertyRow ?? {}, ['property_id']), ''), address: propertyAddressValue, market: sellerMarket }
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

export const getSuggestedDraft = async (thread: InboxThread): Promise<SuggestedDraft> => {
  const supabase = getSupabaseClient()
  const ownerId = asString(thread.ownerId ?? thread.leadId, '')

  const aiFilters = [
    ownerId ? `owner_id.eq.${safeFilterValue(ownerId)}` : '',
    thread.id ? `thread_id.eq.${safeFilterValue(thread.id)}` : '',
    thread.id ? `conversation_id.eq.${safeFilterValue(thread.id)}` : '',
  ].filter(Boolean)

  const aiQuery = supabase
    .from('ai_conversation_brain')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
  const aiResult = aiFilters.length > 0 ? await aiQuery.or(aiFilters.join(',')) : await aiQuery

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

  const templatesResult = await supabase.from('templates').select('*').limit(1)
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

const buildMutationFilter = (threadIdOrKey: string): string => {
  const value = safeFilterValue(threadIdOrKey)
  return [
    `thread_id.eq.${value}`,
    `conversation_id.eq.${value}`,
    `owner_id.eq.${value}`,
    `master_owner_id.eq.${value}`,
    `property_id.eq.${value}`,
    `prospect_id.eq.${value}`,
    `canonical_e164.eq.${value}`,
    `phone_number.eq.${value}`,
  ].join(',')
}

export const markThreadRead = async (threadIdOrKey: string): Promise<void> => {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('message_events')
    .update({ unread: false })
    .or(buildMutationFilter(threadIdOrKey))
  if (error && DEV) console.warn('[NEXUS] markThreadRead failed:', error.message)
}

export const archiveThread = async (threadIdOrKey: string): Promise<void> => {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('message_events')
    .update({ status: 'archived' })
    .or(buildMutationFilter(threadIdOrKey))
  if (error && DEV) console.warn('[NEXUS] archiveThread failed:', error.message)
}

export const flagThread = async (threadIdOrKey: string): Promise<void> => {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('message_events')
    .update({ requires_response: true })
    .or(buildMutationFilter(threadIdOrKey))
  if (error && DEV) console.warn('[NEXUS] flagThread failed:', error.message)
}

export const sendDraft = async (_threadIdOrKey: string, _text: string): Promise<void> => {
  throw new Error('sendDraft: safe SMS send route not yet configured')
}
