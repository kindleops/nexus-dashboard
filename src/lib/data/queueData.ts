import type {
  DeliveryStatus,
  FailureReason,
  QueueItem,
  QueueItemPriority,
  QueueItemStatus,
  QueueModel,
  RiskLevel,
} from '../../modules/queue/queue.types'
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

  const [queueResult, ownerResult, propertyResult, phoneResult] = await Promise.all([
    supabase
      .from('send_queue')
      .select('queue_id,owner_id,master_owner_id,prospect_id,property_id,market,phone,status,priority,risk_level,retry_count,max_retries,scheduled_at,scheduled_for,send_at,sent_at,created_at,approved_at,held_at,template_name,message_text')
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
  ])

  if (queueResult.error) throw new Error(mapErrorMessage(queueResult.error))
  if (ownerResult.error) throw new Error(mapErrorMessage(ownerResult.error))
  if (propertyResult.error) throw new Error(mapErrorMessage(propertyResult.error))
  if (phoneResult.error) throw new Error(mapErrorMessage(phoneResult.error))

  const queueRows = safeArray(queueResult.data as AnyRecord[])
  const ownerRows = safeArray(ownerResult.data as AnyRecord[])
  const propertyRows = safeArray(propertyResult.data as AnyRecord[])
  const phoneRows = safeArray(phoneResult.data as AnyRecord[])

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

  const phonesByOwner = new Map<string, string>()
  for (const row of phoneRows) {
    const ownerId = asString(getFirst(row, ['owner_id', 'master_owner_id']), '')
    if (!ownerId || phonesByOwner.has(ownerId)) continue
    phonesByOwner.set(ownerId, asString(getFirst(row, ['phone', 'phone_number']), ''))
  }

  const items: QueueItem[] = queueRows.map((row, index) => {
    const queueId = asString(getFirst(row, ['queue_id']), `queue-${index + 1}`)
    const ownerId = asString(getFirst(row, ['owner_id', 'master_owner_id']), '')
    const propertyId = asString(getFirst(row, ['property_id']), '')
    const owner = ownerById.get(ownerId)
    const property = propertyById.get(propertyId)

    const status = toQueueStatus(getFirst(row, ['status']))
    const scheduledIso =
      asIso(getFirst(row, ['scheduled_at', 'scheduled_for', 'send_at'])) ?? new Date().toISOString()

    const sellerName = asString(
      getFirst(owner ?? row, ['full_name', 'entity_name', 'seller_name', 'first_name']),
      'Unknown seller',
    )

    const propertyAddress = asString(
      getFirst(property ?? row, ['property_address', 'address', 'property']),
      'Address unavailable',
    )

    const market = asString(
      getFirst(row, ['market']) ?? getFirst(owner ?? row, ['market']) ?? getFirst(property ?? row, ['market']),
      'Unknown',
    )

    const phone =
      asString(getFirst(row, ['phone']), '') ||
      phonesByOwner.get(ownerId) ||
      '+10000000000'

    const retryCount = asNumber(getFirst(row, ['retry_count']), 0)
    const maxRetries = Math.max(asNumber(getFirst(row, ['max_retries']), 3), retryCount || 0)

    return {
      id: queueId,
      queueId,
      sellerName,
      propertyAddress,
      market,
      phone,
      agent: asString(getFirst(row, ['agent_name', 'agent', 'assigned_to']), 'NEXUS'),
      templateName: asString(getFirst(row, ['template_name']), 'Default Outreach'),
      templateSource: 'system',
      useCase: asString(getFirst(row, ['use_case', 'campaign_source']), 'listing'),
      stage: asString(getFirst(row, ['stage', 'seller_stage', 'lead_stage']), 'lead'),
      messageText: asString(getFirst(row, ['message_text', 'message', 'body']), ''),
      scheduledForLocal: scheduledIso,
      scheduledForUtc: scheduledIso,
      timezone: asString(getFirst(row, ['timezone']), 'America/Chicago'),
      contactWindow: 'flexible',
      status,
      priority: toPriority(getFirst(row, ['priority'])),
      touchNumber: Math.max(asNumber(getFirst(row, ['touch_number']), 1), 1),
      language: asString(getFirst(row, ['language']), 'en') === 'es' ? 'es' : 'en',
      retryCount,
      maxRetries,
      failureReason: toFailureReason(getFirst(row, ['failure_reason', 'error_code', 'status_reason'])),
      deliveryStatus: deliveryFromStatus(status),
      createdAt: asIso(getFirst(row, ['created_at'])) ?? new Date().toISOString(),
      sentAt: asIso(getFirst(row, ['sent_at'])),
      approvedByOperator: asIso(getFirst(row, ['approved_at'])) ? 'operator' : null,
      requiresApproval: status === 'approval' || asBoolean(getFirst(row, ['requires_approval']), false),
      riskLevel: toRisk(getFirst(row, ['risk_level'])),
      aiConfidence: Math.max(0, Math.min(100, asNumber(getFirst(row, ['ai_confidence', 'confidence']), 72))),
      estimatedCost: Math.max(asNumber(getFirst(row, ['estimated_cost']), 0.018), 0.01),
      textgridNumber: asString(getFirst(row, ['textgrid_number']), phone),
      linkedInboxThreadId: asString(getFirst(row, ['thread_id', 'conversation_id']), '') || null,
      linkedPropertyId: propertyId || null,
      linkedOwnerId: ownerId || null,
    }
  })

  const readyCount = items.filter((i) => i.status === 'ready').length
  const scheduledCount = items.filter((i) => i.status === 'scheduled').length
  const approvalCount = items.filter((i) => i.status === 'approval').length
  const failedCount = items.filter((i) => i.status === 'failed').length
  const retryCount = items.filter((i) => i.status === 'retry').length
  const heldCount = items.filter((i) => i.status === 'held').length
  const sentTodayCount = items.filter((i) => i.status === 'sent').length
  const deliveredTodayCount = items.filter((i) => i.status === 'delivered').length

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
    safeCapacityRemaining: Math.max(1200 - items.length, 0),
    optOutRiskCount: items.filter((item) => item.riskLevel === 'high').length,
    apiPressureLevel,
  }
}
