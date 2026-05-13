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
  asIso,
  asNumber,
  asString,
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
  if (status === 'paused_invalid_queue_row') return 'paused_invalid_queue_row'
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

  const { data, error } = await supabase
    .from('queue_command_center_v')
    .select('*')
    .limit(1000)

  if (error) throw new Error(mapErrorMessage(error))

  const rows = safeArray(data as AnyRecord[])
  const items: QueueItem[] = rows.map((row) => ({
    id: asString(row.id, ''),
    queueId: asString(row.queue_id, ''),
    sellerName: asString(row.seller_name, 'Unknown seller'),
    propertyAddress: asString(row.property_address, 'No property linked'),
    city: asString(row.city, ''),
    state: asString(row.state, ''),
    zip: asString(row.zip, ''),
    market: asString(row.market, 'Market unknown'),
    phone: asString(row.to_phone_number, 'No phone'),
    agent: asString(row.agent_persona || row.selected_agent_id, 'NEXUS'),
    templateName: asString(row.template_name || row.use_case_template, 'Template not attached'),
    templateSource: 'system',
    useCase: asString(row.use_case_template, 'listing'),
    stage: asString(row.current_stage || 'lead', 'lead'),
    messageText: asString(row.message_text || row.message_body, ''),
    messageBody: asString(row.message_body || row.message_text, ''),
    scheduledForLocal: asIso(row.scheduled_for_local) ?? new Date().toISOString(),
    scheduledForUtc: asIso(row.scheduled_for) ?? new Date().toISOString(),
    timezone: asString(row.timezone, 'America/Chicago'),
    contactWindow: 'flexible',
    status: toQueueStatus(row.queue_status),
    priority: toPriority(row.priority),
    touchNumber: asNumber(row.touch_number, 1),
    language: asString(row.language, 'en') === 'es' ? 'es' : 'en',
    retryCount: asNumber(row.retry_count, 0),
    maxRetries: asNumber(row.max_retries, 3),
    failureReason: toFailureReason(row.failed_reason),
    deliveryStatus: deliveryFromStatus(toQueueStatus(row.queue_status)),
    createdAt: asIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: asIso(row.updated_at) ?? new Date().toISOString(),
    sentAt: asIso(row.sent_at),
    deliveredAt: asIso(row.delivered_at),
    approvedByOperator: asIso(row.approved_at) ? 'operator' : null,
    requiresApproval: row.queue_status === 'approval' || row.risk_level === 'high',
    riskLevel: toRisk(row.risk_level),
    aiConfidence: Math.max(0, Math.min(100, asNumber(row.ai_confidence, 72))),
    estimatedCost: Math.max(asNumber(row.estimated_cost, 0.018), 0.01),
    textgridNumber: asString(row.from_phone_number, ''),
    linkedInboxThreadId: asString(row.thread_key, undefined),
    linkedPropertyId: asString(row.property_id, undefined),
    linkedOwnerId: asString(row.master_owner_id, undefined),
    dealTemperature: asString(row.deal_temperature, undefined),
    nextBestAction: asString(row.next_best_action, undefined),
    metadata: (row.metadata as AnyRecord) || {},
  }))

  const readyCount = items.filter((i) => i.status === 'ready').length
  const scheduledCount = items.filter((i) => i.status === 'scheduled').length
  const approvalCount = items.filter((i) => i.status === 'approval' || i.riskLevel === 'high').length
  const failedCount = items.filter((i) => i.status === 'failed' || i.status === 'retry' || i.status === 'paused_invalid_queue_row').length
  const retryCount = items.filter((i) => i.status === 'retry').length
  const heldCount = items.filter((i) => i.status === 'held').length
  
  const now = new Date().toDateString()
  const sentTodayCount = items.filter((i) => i.sentAt && new Date(i.sentAt).toDateString() === now).length
  const deliveredTodayCount = items.filter((i) => (i as any).deliveredAt && new Date((i as any).deliveredAt).toDateString() === now).length

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
