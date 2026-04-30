import type { InboxThread } from '../../modules/inbox/inbox.adapter'
import { getSupabaseClient } from '../supabaseClient'
import { getInboxThreads, getThreadMessagesForThread, normalizeMessageDirection } from './inboxData'
import { asBoolean, asIso, asString, getSupabaseErrorMessage, mapErrorMessage, normalizeStatus, safeArray, type AnyRecord } from './shared'

const DEV = Boolean(import.meta.env.DEV)
const SENT_MESSAGES_PAGE_SIZE = 1000

export type InboxStage =
  | 'new_reply'
  | 'needs_response'
  | 'ai_draft_ready'
  | 'queued_reply'
  | 'sent_waiting'
  | 'interested'
  | 'needs_offer'
  | 'needs_call'
  | 'nurture'
  | 'not_interested'
  | 'wrong_number'
  | 'dnc_opt_out'
  | 'archived'
  | 'closed_converted'

export type InboxWorkflowStatus =
  | 'open'
  | 'unread'
  | 'read'
  | 'pending'
  | 'queued'
  | 'sent'
  | 'scheduled'
  | 'failed'
  | 'archived'
  | 'suppressed'
  | 'closed'

export type InboxPriority = 'urgent' | 'high' | 'normal' | 'low'

export type InboxStatusTab =
  | 'priority'
  | 'needs_response'
  | 'sent'
  | 'queued'
  | 'scheduled'
  | 'failed'
  | 'archived'
  | 'all'

export interface InboxThreadsQuery {
  tab?: InboxStatusTab
  search?: string
  market?: string
  direction?: 'all' | 'inbound' | 'outbound'
  stage?: InboxStage | 'all'
  status?: InboxWorkflowStatus | 'all'
  priority?: InboxPriority | 'all'
  read?: 'all' | 'read' | 'unread'
  hasPropertyLink?: boolean
  hasOwnerLink?: boolean
  hasPhoneLink?: boolean
  dncOptOut?: boolean
  startDate?: string
  endDate?: string
}

export interface InboxThreadWorkflow {
  threadKey: string
  inboxStatus: InboxWorkflowStatus
  inboxStage: InboxStage
  isArchived: boolean
  isRead: boolean
  isPinned: boolean
  priority: InboxPriority
  lastInboundAt: string | null
  lastOutboundAt: string | null
  lastMessageAt: string
  lastMessageBody: string
  lastDirection: 'inbound' | 'outbound' | 'unknown'
  updatedAt: string
  queueStatus: string | null
}

export type InboxWorkflowThread = InboxThread & InboxThreadWorkflow

export interface WorkflowMutationResult {
  ok: boolean
  writeTarget: 'inbox_thread_state' | 'none'
  errorMessage: string | null
  threadKey: string
  mutationPayload: AnyRecord | null
}

export interface SentMessageItem {
  id: string
  threadKey: string
  body: string
  recipientNumber: string
  fromNumber: string
  providerMessageId: string | null
  sentAt: string
  deliveryStatus: string
  providerDeliveryStatus: string | null
  deliveryConfirmed: boolean
  failedReason: string | null
  ownerName: string
  propertyAddress: string
}

const tableProbeCache = new Map<string, boolean>()

const normalizePhone = (value: unknown): string => {
  const raw = asString(value, '').trim()
  if (!raw) return ''
  const hasPlus = raw.startsWith('+')
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  return hasPlus ? `+${digits}` : digits
}

const safeFilterValue = (value: string): string => value.replace(/[(),]/g, '')

const buildPhoneVariants = (phone: string): string[] => {
  if (!phone) return []
  const digits = phone.replace(/\D/g, '')
  if (!digits) return []
  const out = new Set<string>()
  out.add(phone)
  out.add(digits)
  out.add(phone.startsWith('+') ? phone : `+${digits}`)
  if (digits.length === 11 && digits.startsWith('1')) {
    out.add(digits.slice(1))
    out.add(`+${digits}`)
  }
  if (digits.length === 10) out.add(`+1${digits}`)
  return Array.from(out)
}

const isMissingSchemaError = (err: unknown): boolean => {
  const code = (err as { code?: string } | null)?.code
  return code === '42P01' || code === '42703'
}

const tableExists = async (table: string): Promise<boolean> => {
  if (tableProbeCache.has(table)) return tableProbeCache.get(table) ?? false
  const supabase = getSupabaseClient()
  const { error } = await supabase.from(table).select('*').limit(1)
  const exists = !error || !isMissingSchemaError(error)
  tableProbeCache.set(table, exists)
  return exists
}

const toThreadKey = (thread: InboxThread): string =>
  asString(thread.threadKey, '') ||
  asString(thread.id, '') ||
  [thread.ownerId, thread.propertyId, thread.phoneNumber].filter(Boolean).join(':')

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size))
  }
  return out
}

const inferStage = (
  input: {
    isArchived: boolean
    needsResponse: boolean
    hasAiDraft: boolean
    queueStatus: string | null
    suppressed: boolean
    failed: boolean
  },
): InboxStage => {
  if (input.isArchived) return 'archived'
  if (input.suppressed) return 'dnc_opt_out'
  if (input.failed) return 'needs_response'
  if (input.queueStatus === 'scheduled') return 'queued_reply'
  if (input.queueStatus === 'queued' || input.queueStatus === 'approval') return 'queued_reply'
  if (input.needsResponse) return 'needs_response'
  if (input.hasAiDraft) return 'ai_draft_ready'
  return 'sent_waiting'
}

const inferStatus = (
  input: {
    isArchived: boolean
    unread: boolean
    queueStatus: string | null
    failed: boolean
    suppressed: boolean
  },
): InboxWorkflowStatus => {
  if (input.isArchived) return 'archived'
  if (input.suppressed) return 'suppressed'
  if (input.failed) return 'failed'
  if (input.queueStatus === 'scheduled') return 'scheduled'
  if (input.queueStatus === 'queued' || input.queueStatus === 'approval') return 'queued'
  if (input.queueStatus === 'sent' || input.queueStatus === 'delivered') return 'sent'
  if (input.unread) return 'unread'
  return 'open'
}

const buildMessageEventFilter = (thread: InboxThread): string => {
  const terms: string[] = []
  if (thread.ownerId) terms.push(`master_owner_id.eq.${safeFilterValue(thread.ownerId)}`)
  if (thread.prospectId) terms.push(`prospect_id.eq.${safeFilterValue(thread.prospectId)}`)
  if (thread.propertyId) terms.push(`property_id.eq.${safeFilterValue(thread.propertyId)}`)

  const phones = [thread.canonicalE164, thread.phoneNumber].flatMap((p) => buildPhoneVariants(normalizePhone(p)))
  for (const phone of phones) {
    terms.push(`from_phone_number.eq.${safeFilterValue(phone)}`)
    terms.push(`to_phone_number.eq.${safeFilterValue(phone)}`)
  }

  if (terms.length === 0) {
    const key = safeFilterValue(toThreadKey(thread))
    terms.push(`message_event_key.eq.${key}`)
    terms.push(`queue_id.eq.${key}`)
  }

  return Array.from(new Set(terms)).join(',')
}

const queueStateForThread = (thread: InboxThread, queueRows: AnyRecord[]): AnyRecord | null => {
  const tPhone = normalizePhone(thread.canonicalE164 || thread.phoneNumber)
  for (const row of queueRows) {
    const byProperty = thread.propertyId && asString(row['property_id'], '') === thread.propertyId
    const byOwner = thread.ownerId && asString(row['master_owner_id'], '') === thread.ownerId
    const byProspect = thread.prospectId && asString(row['prospect_id'], '') === thread.prospectId
    const rowTo = normalizePhone(row['to_phone_number'])
    const rowPhone = normalizePhone(row['phone_number'])
    const byPhone = Boolean(tPhone && (rowTo === tPhone || rowPhone === tPhone))
    if (byProperty || byOwner || byProspect || byPhone) return row
  }
  return null
}

const withWorkflowState = (
  thread: InboxThread,
  stateRow: AnyRecord | null,
  queueRow: AnyRecord | null,
): InboxWorkflowThread => {
  const hasStateRow = Boolean(stateRow)
  const queueStatus = normalizeStatus(queueRow?.['queue_status'] ?? queueRow?.['status'] ?? '') || null
  const failed = ['failed', 'error', 'undelivered'].includes(normalizeStatus(thread.deliveryStatus)) ||
    ['failed', 'error', 'undelivered'].includes(normalizeStatus(queueRow?.['queue_status']))
  const lastInboundTs = thread.lastInboundAt ? new Date(thread.lastInboundAt).getTime() : 0
  const lastOutboundTs = thread.lastOutboundAt ? new Date(thread.lastOutboundAt).getTime() : 0
  const latestInbound = lastInboundTs > lastOutboundTs || (lastInboundTs === lastOutboundTs && normalizeMessageDirection({ direction: thread.directionUsed }) === 'inbound')

  const isArchived = hasStateRow ? asBoolean(stateRow?.['is_archived'], false) : false
  const isRead = hasStateRow ? asBoolean(stateRow?.['is_read'], false) : false
  const status = hasStateRow
    ? ((normalizeStatus(stateRow?.['status']) as InboxWorkflowStatus) ||
      inferStatus({
        isArchived,
        unread: !isRead,
        queueStatus,
        failed,
        suppressed: Boolean(thread.isOptOut),
      }))
    : (latestInbound ? 'unread' : 'sent')

  const stage = hasStateRow
    ? ((normalizeStatus(stateRow?.['stage']) as InboxStage) ||
      inferStage({
        isArchived,
        needsResponse: Boolean(thread.needsResponse),
        hasAiDraft: Boolean(thread.aiDraft),
        queueStatus,
        suppressed: Boolean(thread.isOptOut),
        failed,
      }))
    : 'needs_response'

  const lastDirection = normalizeMessageDirection({ direction: thread.directionUsed })
  const lastMessageAt = thread.lastMessageIso || new Date().toISOString()

  return {
    ...thread,
    threadKey: toThreadKey(thread),
    inboxStatus: status,
    inboxStage: stage,
    isArchived,
    isRead,
    isPinned: asBoolean(stateRow?.['is_pinned'], false),
    priority: hasStateRow
      ? ((normalizeStatus(stateRow?.['priority']) as InboxPriority) || thread.priority)
      : (latestInbound ? 'urgent' : 'normal'),
    lastInboundAt: asIso(stateRow?.['last_inbound_at']) ?? thread.lastInboundAt ?? null,
    lastOutboundAt: asIso(stateRow?.['last_outbound_at']) ?? thread.lastOutboundAt ?? null,
    lastMessageAt,
    lastMessageBody: thread.preview,
    lastDirection,
    updatedAt: asIso(stateRow?.['updated_at']) ?? lastMessageAt,
    queueStatus,
  }
}

const matchesSearch = (thread: InboxWorkflowThread, search: string): boolean => {
  if (!search) return true
  const q = search.toLowerCase()
  const tokens = [
    thread.ownerName,
    thread.subject,
    thread.preview,
    thread.phoneNumber,
    thread.propertyAddress,
    thread.market,
    thread.marketId,
    thread.inboxStage,
    thread.inboxStatus,
  ]
  return tokens.filter(Boolean).some((value) => String(value).toLowerCase().includes(q))
}

const applyThreadFilters = (threads: InboxWorkflowThread[], params: InboxThreadsQuery): InboxWorkflowThread[] => {
  let filtered = [...threads]

  if (params.tab && params.tab !== 'all') {
    filtered = filtered.filter((thread) => {
      if (params.tab === 'priority') return thread.priority === 'urgent' || thread.priority === 'high'
      if (params.tab === 'needs_response') return thread.inboxStage === 'needs_response' || thread.needsResponse
      if (params.tab === 'sent') return thread.inboxStatus === 'sent' || thread.inboxStage === 'sent_waiting'
      if (params.tab === 'queued') return thread.inboxStatus === 'queued' || thread.inboxStage === 'queued_reply'
      if (params.tab === 'scheduled') return thread.inboxStatus === 'scheduled'
      if (params.tab === 'failed') return thread.inboxStatus === 'failed'
      if (params.tab === 'archived') return thread.isArchived
      return true
    })
  }

  if (!params.tab || params.tab !== 'archived') {
    filtered = filtered.filter((thread) => !thread.isArchived)
  }

  if (params.market) filtered = filtered.filter((thread) => (thread.market || thread.marketId) === params.market)
  if (params.direction && params.direction !== 'all') filtered = filtered.filter((thread) => thread.lastDirection === params.direction)
  if (params.stage && params.stage !== 'all') filtered = filtered.filter((thread) => thread.inboxStage === params.stage)
  if (params.status && params.status !== 'all') filtered = filtered.filter((thread) => thread.inboxStatus === params.status)
  if (params.priority && params.priority !== 'all') filtered = filtered.filter((thread) => thread.priority === params.priority)
  if (params.read === 'read') filtered = filtered.filter((thread) => thread.isRead)
  if (params.read === 'unread') filtered = filtered.filter((thread) => !thread.isRead)
  if (params.hasPropertyLink) filtered = filtered.filter((thread) => Boolean(thread.propertyId || thread.propertyAddress))
  if (params.hasOwnerLink) filtered = filtered.filter((thread) => Boolean(thread.ownerId || thread.ownerName))
  if (params.hasPhoneLink) filtered = filtered.filter((thread) => Boolean(thread.phoneNumber || thread.canonicalE164))
  if (params.dncOptOut) filtered = filtered.filter((thread) => Boolean(thread.isOptOut) || thread.inboxStatus === 'suppressed')

  if (params.startDate) {
    const start = new Date(params.startDate).getTime()
    filtered = filtered.filter((thread) => new Date(thread.lastMessageAt).getTime() >= start)
  }
  if (params.endDate) {
    const end = new Date(params.endDate).getTime()
    filtered = filtered.filter((thread) => new Date(thread.lastMessageAt).getTime() <= end)
  }

  if (params.search) {
    const query = params.search
    filtered = filtered.filter((thread) => matchesSearch(thread, query))
  }

  filtered.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
    if (!a.isRead && b.isRead) return -1
    if (!b.isRead && a.isRead) return 1
    return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
  })

  return filtered
}

export const fetchThreadQueueState = async (thread: InboxThread): Promise<AnyRecord[]> => {
  const supabase = getSupabaseClient()
  let query = supabase.from('send_queue').select('*').limit(50)

  const filters = buildMessageEventFilter(thread)
  query = query.or(filters
    .replaceAll('from_phone_number', 'to_phone_number')
    .replaceAll('message_event_key', 'queue_key'))

  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) {
    if (DEV) console.warn('[inboxWorkflow] fetchThreadQueueState failed', error.message)
    return []
  }
  return safeArray(data as AnyRecord[])
}

export const fetchThreadSentMessages = async (thread: InboxThread): Promise<SentMessageItem[]> => {
  const messages = await getThreadMessagesForThread(thread)
  return messages
    .filter((msg) => msg.direction === 'outbound')
    .map((msg) => ({
      id: msg.id,
      threadKey: toThreadKey(thread),
      body: msg.body,
      recipientNumber: msg.toNumber,
      fromNumber: msg.fromNumber,
      providerMessageId: null,
      sentAt: msg.createdAt,
      deliveryStatus: msg.deliveryStatus,
      providerDeliveryStatus: null,
      deliveryConfirmed: ['delivered', 'confirmed'].includes(normalizeStatus(msg.deliveryStatus)),
      failedReason: msg.error,
      ownerName: thread.ownerName,
      propertyAddress: thread.subject,
    }))
}

export const deriveThreadStateFromEvents = (events: AnyRecord[], queueRows: AnyRecord[]): Partial<InboxThreadWorkflow> => {
  const sorted = [...events].sort((a, b) => {
    const aTs = asIso(a['event_timestamp'] ?? a['created_at']) ?? ''
    const bTs = asIso(b['event_timestamp'] ?? b['created_at']) ?? ''
    return new Date(bTs).getTime() - new Date(aTs).getTime()
  })
  const last = sorted[0] ?? null
  const latestInbound = sorted.find((row) => normalizeStatus(row['direction']) === 'inbound')
  const latestOutbound = sorted.find((row) => normalizeStatus(row['direction']) === 'outbound')
  const queue = queueRows[0] ?? null
  const queueStatus = normalizeStatus(queue?.['queue_status'] ?? queue?.['status']) || null

  const lastInboundAt = asIso(latestInbound?.['event_timestamp'] ?? latestInbound?.['created_at']) ?? null
  const lastOutboundAt = asIso(latestOutbound?.['event_timestamp'] ?? latestOutbound?.['created_at']) ?? null
  const needsResponse = Boolean(lastInboundAt && (!lastOutboundAt || new Date(lastInboundAt).getTime() > new Date(lastOutboundAt).getTime()))

  const inboxStage = inferStage({
    isArchived: normalizeStatus(last?.['status']) === 'archived',
    needsResponse,
    hasAiDraft: false,
    queueStatus,
    suppressed: asBoolean(last?.['is_opt_out'], false),
    failed: ['failed', 'error'].includes(normalizeStatus(last?.['delivery_status'])),
  })

  const inboxStatus = inferStatus({
    isArchived: normalizeStatus(last?.['status']) === 'archived',
    unread: asBoolean(last?.['unread'], needsResponse),
    queueStatus,
    failed: ['failed', 'error'].includes(normalizeStatus(last?.['delivery_status'])),
    suppressed: asBoolean(last?.['is_opt_out'], false),
  })

  return {
    inboxStage,
    inboxStatus,
    lastInboundAt,
    lastOutboundAt,
    lastDirection: normalizeMessageDirection(last ?? {}),
    lastMessageAt: asIso(last?.['event_timestamp'] ?? last?.['created_at']) ?? new Date().toISOString(),
    lastMessageBody: asString(last?.['message_body'], ''),
    updatedAt: asIso(last?.['updated_at'] ?? last?.['created_at']) ?? new Date().toISOString(),
  }
}

export const getThreadWorkflowState = async (thread: InboxThread): Promise<InboxThreadWorkflow> => {
  const queueRows = await fetchThreadQueueState(thread)
  const messages = await getThreadMessagesForThread(thread)
  const inferred = deriveThreadStateFromEvents(
    messages.map((msg) => ({
      direction: msg.direction,
      event_timestamp: msg.createdAt,
      created_at: msg.createdAt,
      message_body: msg.body,
      delivery_status: msg.deliveryStatus,
      error_message: msg.error,
    })),
    queueRows,
  )

  return {
    threadKey: toThreadKey(thread),
    inboxStatus: (inferred.inboxStatus as InboxWorkflowStatus) ?? 'open',
    inboxStage: (inferred.inboxStage as InboxStage) ?? 'needs_response',
    isArchived: (inferred.inboxStatus as InboxWorkflowStatus) === 'archived',
    isRead: !thread.unread,
    isPinned: false,
    priority: thread.priority,
    lastInboundAt: inferred.lastInboundAt ?? thread.lastInboundAt ?? null,
    lastOutboundAt: inferred.lastOutboundAt ?? thread.lastOutboundAt ?? null,
    lastMessageAt: inferred.lastMessageAt ?? thread.lastMessageIso,
    lastMessageBody: inferred.lastMessageBody ?? thread.preview,
    lastDirection: inferred.lastDirection ?? 'unknown',
    updatedAt: inferred.updatedAt ?? thread.lastMessageIso,
    queueStatus: normalizeStatus(queueRows[0]?.['queue_status'] ?? queueRows[0]?.['status']) || null,
  }
}

const persistWorkflowPatch = async (
  thread: InboxThread,
  patch: Partial<Pick<InboxThreadWorkflow, 'inboxStatus' | 'inboxStage' | 'isArchived' | 'isRead' | 'isPinned' | 'priority'>>,
): Promise<WorkflowMutationResult> => {
  const supabase = getSupabaseClient()
  const now = new Date().toISOString()
  const threadKey = toThreadKey(thread)

  if (await tableExists('inbox_thread_state')) {
    const payload: AnyRecord = {
      thread_key: threadKey,
      master_owner_id: thread.ownerId ?? null,
      prospect_id: thread.prospectId ?? null,
      property_id: thread.propertyId ?? null,
      seller_phone: thread.phoneNumber ?? null,
      canonical_e164: thread.canonicalE164 ?? null,
      our_number: thread.ourNumber ?? null,
      market: thread.market ?? thread.marketId,
      updated_at: now,
      metadata: {
        owner_name: thread.ownerName,
        property_address: thread.propertyAddress ?? thread.subject,
        thread_id: thread.id,
      },
    }
    if (patch.inboxStatus) payload['status'] = patch.inboxStatus
    if (patch.inboxStage) payload['stage'] = patch.inboxStage
    if (patch.isArchived != null) payload['is_archived'] = patch.isArchived
    if (patch.isRead != null) {
      payload['is_read'] = patch.isRead
      payload['last_read_at'] = patch.isRead ? now : null
      if (patch.inboxStatus === 'read' && patch.isRead) payload['status'] = 'read'
      if (patch.inboxStatus === 'unread' && !patch.isRead) payload['status'] = 'unread'
    }
    if (patch.isPinned != null) payload['is_pinned'] = patch.isPinned
    if (patch.priority) payload['priority'] = patch.priority
    if (patch.isArchived != null) payload['archived_at'] = patch.isArchived ? now : null
    payload['is_urgent'] = (patch.priority ?? thread.priority) === 'urgent'

    const { error } = await supabase
      .from('inbox_thread_state')
      .upsert(payload, { onConflict: 'thread_key' })

    if (!error) return { ok: true, writeTarget: 'inbox_thread_state', errorMessage: null, threadKey, mutationPayload: payload }
    return { ok: false, writeTarget: 'none', errorMessage: getSupabaseErrorMessage(error), threadKey, mutationPayload: payload }
  }

  return {
    ok: false,
    writeTarget: 'none',
    errorMessage: 'inbox_thread_state table missing. Run the Inbox thread-state migration.',
    threadKey,
    mutationPayload: null,
  }
}

export const fetchInboxThreads = async (params: InboxThreadsQuery = {}): Promise<InboxWorkflowThread[]> => {
  const base = await getInboxThreads({ query: params.search })
  const supabase = getSupabaseClient()

  const stateRowsByKey = new Map<string, AnyRecord>()
  if (await tableExists('inbox_thread_state')) {
    const keys = base.map((thread) => toThreadKey(thread)).filter(Boolean)
    if (keys.length > 0) {
      const stateResponses = await Promise.all(
        chunk(keys, 40).map((keyBatch) => (
          supabase
            .from('inbox_thread_state')
            .select('thread_key,stage,status,priority,is_archived,is_read,is_pinned,last_read_at,archived_at,updated_at')
            .in('thread_key', keyBatch)
        )),
      )
      for (const response of stateResponses) {
        if (!response.error) {
          for (const row of safeArray(response.data as AnyRecord[])) {
            const key = asString(row['thread_key'], '')
            if (key) stateRowsByKey.set(key, row)
          }
        } else if (DEV) {
          console.warn('[inboxWorkflow] inbox_thread_state read failed', getSupabaseErrorMessage(response.error))
        }
      }
    }
  }

  const { data: queueData, error: queueError } = await supabase
    .from('send_queue')
    .select('id,queue_status,status,scheduled_for,to_phone_number,phone_number,master_owner_id,prospect_id,property_id,created_at,updated_at,error_message,failure_reason')
    .order('created_at', { ascending: false })
    .limit(2500)

  if (queueError && DEV) {
    console.warn('[inboxWorkflow] send_queue read failed', getSupabaseErrorMessage(queueError))
  }

  const queueRows = safeArray(queueData as AnyRecord[])

  const enriched = base.map((thread) => withWorkflowState(thread, stateRowsByKey.get(toThreadKey(thread)) ?? null, queueStateForThread(thread, queueRows)))
  return applyThreadFilters(enriched, params)
}

export const fetchArchivedThreads = async (params: InboxThreadsQuery = {}): Promise<InboxWorkflowThread[]> => {
  return fetchInboxThreads({ ...params, tab: 'archived' })
}

export const fetchSentMessages = async (params: InboxThreadsQuery = {}): Promise<SentMessageItem[]> => {
  const supabase = getSupabaseClient()

  const eventData: AnyRecord[] = []
  let eventFrom = 0
  while (true) {
    const eventTo = eventFrom + SENT_MESSAGES_PAGE_SIZE - 1
    const { data, error } = await supabase
      .from('message_events')
      .select('id,message_body,to_phone_number,from_phone_number,provider_message_sid,provider_message_id,event_timestamp,created_at,sent_at,delivery_status,provider_delivery_status,error_message,failure_reason,master_owner_id,property_id,property_address')
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .range(eventFrom, eventTo)
    if (error) throw new Error(mapErrorMessage(error))
    const batch = safeArray(data as AnyRecord[])
    if (batch.length === 0) break
    eventData.push(...batch)
    if (batch.length < SENT_MESSAGES_PAGE_SIZE) break
    eventFrom += batch.length
  }

  const queueData: AnyRecord[] = []
  let queueFrom = 0
  while (true) {
    const queueTo = queueFrom + SENT_MESSAGES_PAGE_SIZE - 1
    const { data, error } = await supabase
      .from('send_queue')
      .select('id,message_body,to_phone_number,from_phone_number,provider_message_id,created_at,sent_at,queue_status,status,error_message,failure_reason,master_owner_id,property_id,property_address')
      .in('queue_status', ['sent', 'delivered', 'queued', 'scheduled', 'failed'])
      .order('created_at', { ascending: false })
      .range(queueFrom, queueTo)
    if (error) throw new Error(mapErrorMessage(error))
    const batch = safeArray(data as AnyRecord[])
    if (batch.length === 0) break
    queueData.push(...batch)
    if (batch.length < SENT_MESSAGES_PAGE_SIZE) break
    queueFrom += batch.length
  }

  const rows: SentMessageItem[] = []

  for (const row of eventData) {
    const sentAt = asIso(row['sent_at'] ?? row['event_timestamp'] ?? row['created_at']) ?? new Date().toISOString()
    rows.push({
      id: asString(row['id'], sentAt),
      threadKey: [row['master_owner_id'], row['property_id'], normalizePhone(row['to_phone_number'])].filter(Boolean).join(':'),
      body: asString(row['message_body'], ''),
      recipientNumber: normalizePhone(row['to_phone_number']),
      fromNumber: normalizePhone(row['from_phone_number']),
      providerMessageId: asString(row['provider_message_id'] ?? row['provider_message_sid'], '') || null,
      sentAt,
      deliveryStatus: asString(row['delivery_status'], 'sent'),
      providerDeliveryStatus: asString(row['provider_delivery_status'], '') || null,
      deliveryConfirmed: ['delivered', 'confirmed'].includes(normalizeStatus(row['delivery_status'] ?? row['provider_delivery_status'])),
      failedReason: asString(row['failure_reason'] ?? row['error_message'], '') || null,
      ownerName: '',
      propertyAddress: asString(row['property_address'], ''),
    })
  }

  for (const row of queueData) {
    const sentAt = asIso(row['sent_at'] ?? row['created_at']) ?? new Date().toISOString()
    rows.push({
      id: `queue:${asString(row['id'], sentAt)}`,
      threadKey: [row['master_owner_id'], row['property_id'], normalizePhone(row['to_phone_number'])].filter(Boolean).join(':'),
      body: asString(row['message_body'], ''),
      recipientNumber: normalizePhone(row['to_phone_number']),
      fromNumber: normalizePhone(row['from_phone_number']),
      providerMessageId: asString(row['provider_message_id'], '') || null,
      sentAt,
      deliveryStatus: asString(row['queue_status'] ?? row['status'], 'queued'),
      providerDeliveryStatus: null,
      deliveryConfirmed: ['sent', 'delivered'].includes(normalizeStatus(row['queue_status'] ?? row['status'])),
      failedReason: asString(row['failure_reason'] ?? row['error_message'], '') || null,
      ownerName: '',
      propertyAddress: asString(row['property_address'], ''),
    })
  }

  const filtered = rows.filter((row) => {
    if (params.search) {
      const q = params.search.toLowerCase()
      const hay = [row.body, row.recipientNumber, row.fromNumber, row.propertyAddress].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (params.startDate && new Date(row.sentAt).getTime() < new Date(params.startDate).getTime()) return false
    if (params.endDate && new Date(row.sentAt).getTime() > new Date(params.endDate).getTime()) return false
    return true
  })

  filtered.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
  return filtered
}

export const updateThreadStage = async (thread: InboxThread, stage: InboxStage): Promise<WorkflowMutationResult> => {
  const status: InboxWorkflowStatus = stage === 'archived' ? 'archived' : stage === 'dnc_opt_out' ? 'suppressed' : 'open'
  return persistWorkflowPatch(thread, { inboxStage: stage, inboxStatus: status, isArchived: stage === 'archived' })
}

export const updateThreadStatus = async (thread: InboxThread, status: InboxWorkflowStatus): Promise<WorkflowMutationResult> => {
  const archived = status === 'archived'
  return persistWorkflowPatch(thread, { inboxStatus: status, isArchived: archived, inboxStage: archived ? 'archived' : 'needs_response' })
}

export const updateThreadPriority = async (thread: InboxThread, priority: InboxPriority): Promise<WorkflowMutationResult> => {
  return persistWorkflowPatch(thread, { priority })
}

export const archiveThread = async (thread: InboxThread): Promise<WorkflowMutationResult> => {
  return persistWorkflowPatch(thread, { isArchived: true, inboxStatus: 'archived', inboxStage: 'archived' })
}

export const unarchiveThread = async (thread: InboxThread): Promise<WorkflowMutationResult> => {
  const lastIn = thread.lastInboundAt ? new Date(thread.lastInboundAt).getTime() : 0
  const lastOut = thread.lastOutboundAt ? new Date(thread.lastOutboundAt).getTime() : 0
  const needsResponse = lastIn > lastOut
  return persistWorkflowPatch(thread, {
    isArchived: false,
    inboxStatus: needsResponse ? 'unread' : 'open',
    inboxStage: needsResponse ? 'needs_response' : 'sent_waiting',
  })
}

export const markThreadRead = async (thread: InboxThread): Promise<WorkflowMutationResult> => {
  return persistWorkflowPatch(thread, { isRead: true, inboxStatus: 'read' })
}

export const markThreadUnread = async (thread: InboxThread): Promise<WorkflowMutationResult> => {
  return persistWorkflowPatch(thread, { isRead: false, inboxStatus: 'unread' })
}

export const pinThread = async (thread: InboxThread): Promise<WorkflowMutationResult> => {
  return persistWorkflowPatch(thread, { isPinned: true })
}

export const unpinThread = async (thread: InboxThread): Promise<WorkflowMutationResult> => {
  return persistWorkflowPatch(thread, { isPinned: false })
}
