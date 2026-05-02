import type {
  DeliveryStatus,
  FailureReason,
  QueueItem,
  QueueItemPriority,
  QueueItemStatus,
  QueueModel,
  RiskLevel,
} from '../../modules/queue/queue.types'

export type {
  DeliveryStatus,
  FailureReason,
  QueueItem,
  QueueItemPriority,
  QueueItemStatus,
  QueueModel,
  RiskLevel,
}
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

const toQueueStatus = (value: unknown): QueueItemStatus => {
  const status = normalizeStatus(value)
  if (status === 'ready') return 'ready'
  if (status === 'scheduled') return 'scheduled'
  if (status === 'sent') return 'sent'
  if (status === 'delivered') return 'delivered'
  if (status === 'failed') return 'failed'
  if (status === 'held') return 'held'
  if (status === 'approval' || status === 'awaiting_approval') return 'approval'
  if (status === 'retry' || status === 'retrying') return 'retry'
  return 'scheduled'
}

const toPriority = (value: unknown): QueueItemPriority => {
  const raw = asString(value, 'P2').toUpperCase()
  if (raw === 'P0' || raw === 'P1' || raw === 'P2' || raw === 'P3') return raw
  return 'P2'
}

const toRisk = (value: unknown): RiskLevel => {
  const raw = normalizeStatus(value)
  if (raw === 'high') return 'high'
  if (raw === 'medium') return 'medium'
  return 'low'
}

const toFailureReason = (value: unknown): FailureReason | null => {
  const raw = normalizeStatus(value)
  const candidates: FailureReason[] = [
    'carrier_error',
    'textgrid_error',
    'invalid_phone',
    'dnc_conflict',
    'outside_contact_window',
    'template_missing',
    'retry_exhausted',
    'sync_error',
    'unknown',
  ]
  if (candidates.includes(raw as FailureReason)) return raw as FailureReason
  return null
}

const deliveryFromStatus = (status: QueueItemStatus): DeliveryStatus => {
  if (status === 'delivered') return 'delivered'
  if (status === 'failed') return 'failed'
  if (status === 'retry') return 'failed'
  if (status === 'sent') return 'sent'
  if (status === 'held') return 'pending'
  if (status === 'approval') return 'pending'
  return 'pending'
}

export const fetchQueueModel = async (): Promise<QueueModel> => {
  const supabase = getSupabaseClient()

  const [queueResult, ownerResult, propertyResult, phoneResult, marketResult] = await Promise.all([
    supabase
      .from('send_queue')
      .select(`
        id,
        queue_id,
        queue_key,
        queue_status,
        scheduled_for,
        scheduled_for_local,
        timezone,
        to_phone_number,
        from_phone_number,
        message_type,
        use_case_template,
        message_body,
        message_text,
        selected_template_id,
        selected_agent_id,
        master_owner_id,
        owner_id,
        property_id,
        prospect_id,
        phone_number_id,
        market_id,
        market,
        retry_count,
        max_retries,
        failed_reason,
        paused_reason,
        created_at,
        updated_at,
        metadata,
        priority,
        risk_level,
        ai_confidence,
        estimated_cost,
        sent_at,
        approved_at,
        held_at,
        touch_number,
        language
      `)
      .order('created_at', { ascending: false })
      .limit(1200),
    supabase
      .from('owners')
      .select('owner_id,master_owner_id,full_name,first_name,last_name,entity_name,market')
      .limit(2000),
    supabase
      .from('properties')
      .select('property_id,owner_id,master_owner_id,property_address,property_address_city,property_address_state,market')
      .limit(3000),
    supabase
      .from('phone_numbers')
      .select('phone_id,owner_id,master_owner_id,phone,phone_number,status')
      .limit(3000),
    supabase
      .from('markets')
      .select('id,name')
      .limit(100),
  ])

  if (queueResult.error) throw new Error(mapErrorMessage(queueResult.error))
  if (ownerResult.error) throw new Error(mapErrorMessage(ownerResult.error))
  if (propertyResult.error) throw new Error(mapErrorMessage(propertyResult.error))
  if (phoneResult.error) throw new Error(mapErrorMessage(phoneResult.error))
  if (marketResult.error) throw new Error(mapErrorMessage(marketResult.error))

  const queueRows = safeArray(queueResult.data as AnyRecord[])
  const ownerRows = safeArray(ownerResult.data as AnyRecord[])
  const propertyRows = safeArray(propertyResult.data as AnyRecord[])
  const phoneRows = safeArray(phoneResult.data as AnyRecord[])
  const marketRows = safeArray(marketResult.data as AnyRecord[])

  const ownerById = new Map<string, AnyRecord>()
  for (const row of ownerRows) {
    const ownerId = asString(getFirst(row, ['owner_id', 'master_owner_id']), '')
    if (ownerId) ownerById.set(ownerId, row)
  }

  const propertyById = new Map<string, AnyRecord>()
  for (const row of propertyRows) {
    const propertyId = asString(getFirst(row, ['property_id']), '')
    if (propertyId) propertyById.set(propertyId, row)
  }

  const marketById = new Map<string, string>()
  for (const row of marketRows) {
    const id = asString(row['id'], '')
    if (id) marketById.set(id, asString(row['name'], ''))
  }

  const phonesByOwner = new Map<string, string>()
  for (const row of phoneRows) {
    const ownerId = asString(getFirst(row, ['owner_id', 'master_owner_id']), '')
    if (!ownerId || phonesByOwner.has(ownerId)) continue
    phonesByOwner.set(ownerId, asString(getFirst(row, ['phone', 'phone_number']), ''))
  }

  const items: QueueItem[] = queueRows.map((row, index) => {
    const id = asString(row['id'], `queue-${index + 1}`)
    const queueId = asString(row['queue_id'] || row['id'], id)
    const ownerId = asString(getFirst(row, ['owner_id', 'master_owner_id']), '')
    const propertyId = asString(getFirst(row, ['property_id']), '')
    const owner = ownerById.get(ownerId)
    const property = propertyById.get(propertyId)

    const status = toQueueStatus(getFirst(row, ['queue_status', 'status']))
    const scheduledIso =
      asIso(getFirst(row, ['scheduled_for', 'scheduled_at', 'send_at'])) ?? new Date().toISOString()
    const localScheduledIso = asIso(getFirst(row, ['scheduled_for_local'])) || scheduledIso

    const sellerName = asString(
      getFirst(owner ?? row, ['full_name', 'entity_name', 'seller_name', 'first_name']),
      'Unknown seller',
    )

    const propertyAddress = asString(
      getFirst(property ?? row, ['property_address', 'address', 'property']),
      'No property linked',
    )

    const market = asString(
      marketById.get(asString(row['market_id'], '')) ??
      getFirst(row, ['market']) ?? 
      getFirst(owner ?? row, ['market']) ?? 
      getFirst(property ?? row, ['market']),
      'Market unknown',
    )

    const phone =
      asString(getFirst(row, ['to_phone_number', 'phone']), '') ||
      phonesByOwner.get(ownerId) ||
      'No phone'

    const retryCount = asNumber(getFirst(row, ['retry_count']), 0)
    const maxRetries = Math.max(asNumber(getFirst(row, ['max_retries']), 3), retryCount || 0)

    const metadata = (row['metadata'] as AnyRecord) || {}

    return {
      id,
      queueId,
      sellerName,
      propertyAddress,
      market,
      phone,
      agent: asString(getFirst(row, ['selected_agent_id', 'agent_name', 'agent']), 'NEXUS'),
      templateName: asString(getFirst(row, ['template_name', 'use_case_template']), 'Template not attached'),
      templateSource: 'system',
      useCase: asString(getFirst(row, ['message_type', 'use_case']), 'listing'),
      stage: asString(getFirst(row, ['stage', 'seller_stage']), 'lead'),
      messageText: asString(getFirst(row, ['message_body', 'message_text', 'message']), ''),
      scheduledForLocal: localScheduledIso,
      scheduledForUtc: scheduledIso,
      timezone: asString(getFirst(row, ['timezone']), 'America/Chicago'),
      contactWindow: 'flexible',
      status,
      priority: toPriority(getFirst(row, ['priority'])),
      touchNumber: Math.max(asNumber(getFirst(row, ['touch_number']), 1), 1),
      language: asString(getFirst(row, ['language']), 'en') === 'es' ? 'es' : 'en',
      retryCount,
      maxRetries,
      failureReason: toFailureReason(getFirst(row, ['failed_reason', 'failure_reason', 'error_code'])),
      deliveryStatus: deliveryFromStatus(status),
      createdAt: asIso(getFirst(row, ['created_at'])) ?? new Date().toISOString(),
      updatedAt: asIso(getFirst(row, ['updated_at'])) ?? new Date().toISOString(),
      sentAt: asIso(getFirst(row, ['sent_at'])),
      approvedByOperator: asIso(getFirst(row, ['approved_at'])) ? 'operator' : null,
      requiresApproval: status === 'approval' || asBoolean(getFirst(row, ['requires_approval']), false),
      riskLevel: toRisk(getFirst(row, ['risk_level'])),
      aiConfidence: Math.max(0, Math.min(100, asNumber(getFirst(row, ['ai_confidence', 'confidence']), 72))),
      estimatedCost: Math.max(asNumber(getFirst(row, ['estimated_cost']), 0.018), 0.01),
      textgridNumber: asString(getFirst(row, ['from_phone_number', 'textgrid_number']), phone),
      linkedInboxThreadId: asString(getFirst(metadata, ['thread_id', 'conversation_id', 'thread_key']), '') || null,
      linkedPropertyId: propertyId || null,
      linkedOwnerId: ownerId || null,
      metadata,
    }
  })

  const readyCount = items.filter((i) => i.status === 'ready').length
  const scheduledCount = items.filter((i) => i.status === 'scheduled').length
  const approvalCount = items.filter((i) => i.status === 'approval').length
  const failedCount = items.filter((i) => i.status === 'failed').length
  const retryCount = items.filter((i) => i.status === 'retry').length
  const heldCount = items.filter((i) => i.status === 'held').length
  const sentTodayCount = items.filter((i) => {
    if (i.status !== 'sent' && i.status !== 'delivered') return false
    const sentAt = i.sentAt ? new Date(i.sentAt) : null
    if (!sentAt) return false
    return sentAt.toDateString() === new Date().toDateString()
  }).length
  const deliveredTodayCount = items.filter((i) => {
    if (i.status !== 'delivered') return false
    const sentAt = i.sentAt ? new Date(i.sentAt) : null
    if (!sentAt) return false
    return sentAt.toDateString() === new Date().toDateString()
  }).length

  const apiPressureLevel: 'low' | 'medium' | 'high' =
    failedCount + retryCount > items.length * 0.1
      ? 'high'
      : failedCount + retryCount > items.length * 0.04
        ? 'medium'
        : 'low'

  return {
    items,
    readyCount,
    scheduledCount,
    approvalCount,
    failedCount,
    retryCount,
    heldCount,
    sentTodayCount,
    deliveredTodayCount,
    safeCapacityRemaining: Math.max(1200 - sentTodayCount, 0),
    optOutRiskCount: items.filter((item) => item.riskLevel === 'high').length,
    apiPressureLevel,
  }
}

// ── Queue Actions ─────────────────────────────────────────────────────────

export interface QueueActionResult {
  ok: boolean
  errorMessage: string | null
  updatedItem?: QueueItem
}

const writeAuditTrail = (item: QueueItem, action: string, metadata: AnyRecord = {}) => {
  const audit = (item.metadata?.audit_trail as AnyRecord[]) || []
  audit.push({
    action,
    timestamp: new Date().toISOString(),
    ...metadata,
  })
  return audit
}

export const approveQueueItem = async (item: QueueItem): Promise<QueueActionResult> => {
  const supabase = getSupabaseClient()
  const now = new Date().toISOString()
  
  const patch: AnyRecord = {
    queue_status: 'queued',
    approved_at: now,
    updated_at: now,
    metadata: {
      ...item.metadata,
      audit_trail: writeAuditTrail(item, 'approved'),
    },
  }

  const { error } = await supabase
    .from('send_queue')
    .update(patch)
    .eq('id', item.id)

  if (error) return { ok: false, errorMessage: mapErrorMessage(error) }
  return { ok: true, errorMessage: null, updatedItem: { ...item, status: 'scheduled', approvedByOperator: 'operator' } }
}

export const holdQueueItem = async (item: QueueItem): Promise<QueueActionResult> => {
  const supabase = getSupabaseClient()
  const now = new Date().toISOString()
  
  const patch: AnyRecord = {
    queue_status: 'held',
    held_at: now,
    updated_at: now,
    metadata: {
      ...item.metadata,
      audit_trail: writeAuditTrail(item, 'held'),
    },
  }

  const { error } = await supabase
    .from('send_queue')
    .update(patch)
    .eq('id', item.id)

  if (error) return { ok: false, errorMessage: mapErrorMessage(error) }
  return { ok: true, errorMessage: null, updatedItem: { ...item, status: 'held' } }
}

export const rescheduleQueueItem = async (item: QueueItem, newTime: string): Promise<QueueActionResult> => {
  const supabase = getSupabaseClient()
  const now = new Date().toISOString()
  
  const patch: AnyRecord = {
    queue_status: 'queued',
    scheduled_for: newTime,
    scheduled_for_local: newTime,
    updated_at: now,
    metadata: {
      ...item.metadata,
      audit_trail: writeAuditTrail(item, 'rescheduled', { previous_time: item.scheduledForLocal, new_time: newTime }),
    },
  }

  const { error } = await supabase
    .from('send_queue')
    .update(patch)
    .eq('id', item.id)

  if (error) return { ok: false, errorMessage: mapErrorMessage(error) }
  return { ok: true, errorMessage: null, updatedItem: { ...item, status: 'scheduled', scheduledForLocal: newTime } }
}

export const cancelQueueItem = async (item: QueueItem): Promise<QueueActionResult> => {
  const supabase = getSupabaseClient()
  const now = new Date().toISOString()
  
  const patch: AnyRecord = {
    queue_status: 'cancelled',
    updated_at: now,
    metadata: {
      ...item.metadata,
      audit_trail: writeAuditTrail(item, 'cancelled'),
    },
  }

  const { error } = await supabase
    .from('send_queue')
    .update(patch)
    .eq('id', item.id)

  if (error) return { ok: false, errorMessage: mapErrorMessage(error) }
  return { ok: true, errorMessage: null, updatedItem: { ...item, status: 'held' } }
}

export const retryQueueItem = async (item: QueueItem): Promise<QueueActionResult> => {
  const supabase = getSupabaseClient()
  const now = new Date().toISOString()
  
  const patch: AnyRecord = {
    queue_status: 'queued',
    retry_count: (item.retryCount || 0) + 1,
    failed_reason: null,
    updated_at: now,
    metadata: {
      ...item.metadata,
      audit_trail: writeAuditTrail(item, 'manual_retry'),
    },
  }

  const { error } = await supabase
    .from('send_queue')
    .update(patch)
    .eq('id', item.id)

  if (error) return { ok: false, errorMessage: mapErrorMessage(error) }
  return { ok: true, errorMessage: null, updatedItem: { ...item, status: 'retry', retryCount: (item.retryCount || 0) + 1 } }
}
