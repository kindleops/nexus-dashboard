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

const DEV = Boolean(import.meta.env.DEV)

// UUID v4 safety guard — prevents inserting 'ph_...' text ids into uuid columns
const isValidUUID = (v: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)

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

// All likely phone field names in the `phones` / `phone_numbers` table
const PHONE_NUMBER_FIELD_NAMES = [
  'phone_number', 'phone', 'canonical_e164', 'phone_e164', 'best_phone',
  'best_phone_e164', 'e164', 'phone_raw', 'number', 'normalized_phone',
  'phone_number_e164', 'raw_phone', 'formatted_phone', 'contact_phone',
  'phone_digits', 'original_phone',
] as const

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
  const propertyAddress = asString(row['property_address'], '').trim().toLowerCase()
  const { sellerPhone } = getSellerPhoneFromMessage(row)

  // Priority: most stable grouping key first
  if (sellerPhone && propertyId)
    return { key: `phone_property:${sellerPhone}:${propertyId}`, method: 'seller_phone+property_id', confidence: 'high' }
  if (sellerPhone && propertyAddress)
    return { key: `phone_address:${sellerPhone}:${propertyAddress}`, method: 'seller_phone+property_address', confidence: 'high' }
  if (sellerPhone && ownerId)
    return { key: `phone_owner:${sellerPhone}:${ownerId}`, method: 'seller_phone+master_owner_id', confidence: 'high' }
  if (sellerPhone && prospectId)
    return { key: `phone_prospect:${sellerPhone}:${prospectId}`, method: 'seller_phone+prospect_id', confidence: 'medium' }
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
  const valid = filters.filter((f) => f.value)
  if (valid.length > 0) {
    const orClause = valid.map((f) => `${f.key}.eq.${safeFilterValue(f.value)}`).join(',')
    query = query.or(orClause)
  }
  const { data, error } = await query
  if (error) {
    if (DEV) console.warn(`[NEXUS] ${table} lookup failed`, error.message)
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
      .from('master_owners')
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
      inspectMessageEventShape(events[i]!)
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

    // Direct column access — actual message_events schema
    const ownerId = asString(latest['master_owner_id'], '')
    const prospectId = asString(latest['prospect_id'], '')
    const propertyId = asString(latest['property_id'], '')
    const { sellerPhone, sellerPhoneSourceField, canonicalE164, ourNumber, directionUsed } = getSellerPhoneFromMessage(latest)
    const phoneNumber = sellerPhone

    const owner = ownerById.get(ownerId)
    const property = propertyById.get(propertyId)
    const prospect = prospectById.get(prospectId)

    const ownerName = asString(
      getFirst(owner ?? prospect ?? latest, ['full_name', 'name', 'first_name', 'owner_name']),
      'Unknown owner',
    )

    const propertyAddress =
      asString(latest['property_address'], '') ||
      asString(getFirst(property ?? {}, ['property_address', 'address']), '')

    const market =
      asString(latest['market_id'], '') ||
      asString(getFirst(property ?? owner ?? {}, ['market', 'market_id']), 'unknown')

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
      id: asString(latest['id'], threadKey),
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
      ourNumber: ourNumber || undefined,
      directionUsed: directionUsed || undefined,
      messageEventKey: asString(latest['message_event_key'], '') || undefined,
      providerMessageSid: asString(latest['provider_message_sid'], '') || undefined,
      queueId: asString(latest['queue_id'], '') || undefined,
      phoneNumberId: asString(latest['phone_number_id'], '') || undefined,
      textgridNumberId: asString(latest['textgrid_number_id'], '') || undefined,
      isOptOut: latest['is_opt_out'] != null ? Boolean(latest['is_opt_out']) : undefined,
      deliveryStatus: asString(latest['delivery_status'] ?? latest['provider_delivery_status'] ?? latest['raw_carrier_status'], '') || undefined,
      providerDeliveryStatus: asString(latest['provider_delivery_status'] ?? latest['raw_carrier_status'], '') || undefined,
      failureReason: asString(latest['failure_reason'] ?? latest['failure_code'] ?? latest['error_message'], '') || undefined,
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
  // Use actual confirmed message_events column names
  const createdAt =
    asIso(row['event_timestamp'] ?? row['created_at'] ?? row['sent_at'] ?? row['received_at']) ??
    new Date().toISOString()
  const direction = normalizeMessageDirection(row)
  const deliveryStatus = asString(
    row['delivery_status'] ?? row['provider_delivery_status'] ?? row['raw_carrier_status'],
    'unknown',
  )
  const { sellerPhone, canonicalE164: msgCanonical } = getSellerPhoneFromMessage(row)
  const source =
    asString(row['source_app'], '') ||
    asString(getNestedValue(row, 'metadata.source'), '') ||
    'textgrid'

  return {
    id: asString(row['id'], createdAt),
    direction,
    body: asString(row['message_body'], '') || getMessageBody(row),
    createdAt,
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
  }
}

export const getThreadMessagesForThread = async (thread: InboxThread): Promise<ThreadMessage[]> => {
  const supabase = getSupabaseClient()
  const threadPhone = normalizePhone(thread.canonicalE164 || thread.phoneNumber)
  const propertyId = asString(thread.propertyId, '')
  const ownerId = asString(thread.ownerId, '')
  const prospectId = asString(thread.prospectId, '')

  // ── Strategy: use actual confirmed columns for server-side filtering ──────
  // Build a targeted query rather than a giant OR clause over non-existent fields.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase.from('message_events').select('*').limit(500)

  if (threadPhone && propertyId) {
    // Best case: phone + property — most precise grouping
    query = query
      .or(`from_phone_number.eq.${safeFilterValue(threadPhone)},to_phone_number.eq.${safeFilterValue(threadPhone)}`)
      .eq('property_id', propertyId)
  } else if (threadPhone && ownerId) {
    query = query
      .or(`from_phone_number.eq.${safeFilterValue(threadPhone)},to_phone_number.eq.${safeFilterValue(threadPhone)}`)
      .eq('master_owner_id', ownerId)
  } else if (threadPhone) {
    query = query.or(
      `from_phone_number.eq.${safeFilterValue(threadPhone)},to_phone_number.eq.${safeFilterValue(threadPhone)}`,
    )
  } else if (propertyId) {
    query = query.eq('property_id', propertyId)
  } else if (ownerId) {
    query = query.eq('master_owner_id', ownerId)
  } else if (prospectId) {
    query = query.eq('prospect_id', prospectId)
  } else {
    // Last resort: match by id or message_event_key
    const idVal = safeFilterValue(thread.id)
    const orParts = [`id.eq.${idVal}`]
    const keyVal = asString(thread.threadKey, '')
    if (keyVal) orParts.push(`message_event_key.eq.${safeFilterValue(keyVal)}`)
    query = query.or(orParts.join(','))
  }

  const { data, error } = await query.order('created_at', { ascending: true })
  if (error) throw new Error(mapErrorMessage(error))

  const rows = safeArray(data as AnyRecord[])
  if (DEV) {
    console.log(
      `[getThreadMessagesForThread] phone=${threadPhone} propertyId=${propertyId} ownerId=${ownerId} → ${rows.length} rows`,
    )
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
  const trimmedText = messageText.trim()
  if (!trimmedText) {
    return { ok: false, queueId: null, status: null, errorMessage: 'Message text is required', insertPayloadKeys: [] }
  }

  const toPhone = normalizePhone(thread.canonicalE164 || thread.phoneNumber)
  if (!toPhone) {
    return { ok: false, queueId: null, status: null, errorMessage: 'Thread has no valid phone number', insertPayloadKeys: [] }
  }

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
    message_body: trimmedText,
    message_text: trimmedText,
    to_phone_number: toPhone,
    character_count: trimmedText.length,
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
    },
    created_at: now,
  }

  if (thread.ourNumber) payload.from_phone_number = normalizePhone(thread.ourNumber) || thread.ourNumber
  if (isValidUUID(asString(thread.phoneNumberId, ''))) payload.phone_number_id = thread.phoneNumberId
  if (thread.textgridNumberId) payload.textgrid_number_id = thread.textgridNumberId
  if (thread.propertyAddress) payload.property_address = thread.propertyAddress
  if (thread.ownerId) payload.master_owner_id = thread.ownerId
  if (thread.prospectId) payload.prospect_id = thread.prospectId
  if (thread.propertyId) payload.property_id = thread.propertyId
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
  const fromPhone =
    normalizePhone(options?.fromPhoneNumber ?? '') ||
    normalizePhone(thread.ourNumber ?? '') ||
    normalizePhone(import.meta.env.VITE_TEXTGRID_FROM_NUMBER ?? '') ||
    normalizePhone(import.meta.env.VITE_TEXTGRID_NUMBER ?? '')

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

  if (!fromPhone) {
    return { ok: false, queueId: null, messageEventId: null, providerMessageSid: null, deliveryStatus: null, errorMessage: 'Missing sender number — set ourNumber on thread or VITE_TEXTGRID_NUMBER env var', insertPayloadKeys: [], suppressionBlocked: false, sendRouteUsed: 'none', queueProcessorEligible: false }
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
    message_body: trimmedText,
    message_text: trimmedText,
    to_phone_number: toPhone,
    from_phone_number: fromPhone,
    character_count: trimmedText.length,
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
    },
    created_at: now,
  }

  if (isValidUUID(asString(thread.phoneNumberId, ''))) insertPayload.phone_number_id = thread.phoneNumberId
  if (textgridNumberId) insertPayload.textgrid_number_id = textgridNumberId
  if (thread.propertyAddress) insertPayload.property_address = thread.propertyAddress
  if (thread.ownerId) insertPayload.master_owner_id = thread.ownerId
  if (thread.prospectId) insertPayload.prospect_id = thread.prospectId
  if (thread.propertyId) insertPayload.property_id = thread.propertyId
  if (thread.marketId) insertPayload.market_id = thread.marketId

  const insertPayloadKeys = Object.keys(insertPayload)

  if (DEV) console.log('[sendInboxMessageNow] inserting queue row queue_status=ready', { keys: insertPayloadKeys, toPhone, fromPhone, queueKey })

  const { data: queueData, error: queueError } = await supabase
    .from('send_queue')
    .insert(insertPayload)
    .select('id,queue_id,queue_key,queue_status')
    .limit(1)

  if (queueError) {
    if (DEV) console.error('[sendInboxMessageNow] queue insert failed:', queueError.message)
    return { ok: false, queueId: null, messageEventId: null, providerMessageSid: null, deliveryStatus: null, errorMessage: queueError.message, insertPayloadKeys, suppressionBlocked: false, sendRouteUsed: 'send_queue_queued', queueProcessorEligible: false }
  }

  const queueRow = safeArray(queueData as AnyRecord[])[0] ?? null
  const queueId = queueRow ? asString(getFirst(queueRow, ['id', 'queue_id', 'queue_key']), '') || queueKey : queueKey

  // ── Insert optimistic outbound message_events row ─────────────────────────
  const eventPayload: Record<string, unknown> = {
    direction: 'outbound',
    event_type: 'outbound_send',
    message_body: trimmedText,
    to_phone_number: toPhone,
    from_phone_number: fromPhone,
    delivery_status: 'queued',
    provider_delivery_status: 'queued',
    source_app: 'inbox',
    trigger_name: 'inbox_manual_send_now',
    event_timestamp: now,
    created_at: now,
    sent_at: now,
    is_final_failure: false,
    character_count: trimmedText.length,
    queue_id: queueId,
    metadata: { source: 'inbox_send_now_optimistic', queue_key: queueKey },
  }
  if (textgridNumberId) eventPayload.textgrid_number_id = textgridNumberId
  if (isValidUUID(asString(thread.phoneNumberId, ''))) eventPayload.phone_number_id = thread.phoneNumberId
  if (thread.propertyAddress) eventPayload.property_address = thread.propertyAddress
  if (thread.ownerId) eventPayload.master_owner_id = thread.ownerId
  if (thread.prospectId) eventPayload.prospect_id = thread.prospectId
  if (thread.propertyId) eventPayload.property_id = thread.propertyId
  if (thread.marketId) eventPayload.market_id = thread.marketId

  const { data: eventData, error: eventError } = await supabase
    .from('message_events')
    .insert(eventPayload)
    .select('id')
    .limit(1)

  if (eventError && DEV) {
    console.warn('[sendInboxMessageNow] message_events insert failed (non-fatal):', eventError.message)
  }

  const eventRow = safeArray(eventData as AnyRecord[])[0] ?? null
  const messageEventId = eventRow ? asString(getFirst(eventRow, ['id']), '') || null : null

  if (DEV) console.log('[sendInboxMessageNow] success', { queueId, messageEventId, queue_status: 'queued', queueKey, queueProcessorEligible: true })

  return {
    ok: true,
    queueId,
    messageEventId,
    providerMessageSid: null,
    deliveryStatus: 'queued',
    errorMessage: null,
    insertPayloadKeys,
    suppressionBlocked: false,
    sendRouteUsed: 'send_queue_queued',
    queueProcessorEligible: true,
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

  const toPhone = normalizePhone(thread.canonicalE164 || thread.phoneNumber)
  if (!toPhone) {
    return { ok: false, queueId: null, status: null, errorMessage: 'Thread has no valid phone number', insertPayloadKeys: [] }
  }

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
    message_body: trimmedText,
    message_text: trimmedText,
    to_phone_number: toPhone,
    character_count: trimmedText.length,
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
    },
    created_at: now,
  }

  if (thread.ourNumber) payload.from_phone_number = normalizePhone(thread.ourNumber) || thread.ourNumber
  if (isValidUUID(asString(thread.phoneNumberId, ''))) payload.phone_number_id = thread.phoneNumberId
  if (thread.textgridNumberId) payload.textgrid_number_id = thread.textgridNumberId
  if (thread.propertyAddress) payload.property_address = thread.propertyAddress
  if (thread.ownerId) payload.master_owner_id = thread.ownerId
  if (thread.prospectId) payload.prospect_id = thread.prospectId
  if (thread.propertyId) payload.property_id = thread.propertyId
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
