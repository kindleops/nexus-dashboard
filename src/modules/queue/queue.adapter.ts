import type { QueueModel, QueueItem, QueueItemStatus, QueueItemPriority, DeliveryStatus, FailureReason, RiskLevel } from './queue.types'
import { fetchQueueModel } from '../../lib/data/queueData'
import { isDev, shouldUseSupabase } from '../../lib/data/shared'

const MARKETS = ['Dallas', 'Austin', 'Houston', 'San Antonio', 'Minneapolis', 'Denver']
const AGENTS = ['Sarah Johnson', 'Mike Chen', 'Elena Rodriguez', 'James Wilson', 'Lisa Park']
const TEMPLATES = ['Initial Outreach', 'Follow-up', 'Urgency', 'Closing Push', 'Property Update']
const USE_CASES = ['listing', 'foreclosure', 'probate', 'distressed', 'investment']
const SELLERS = [
  'John Smith Realty',
  'Elite Properties LLC',
  'Urban Homes',
  'Midwest Equity',
  'Century Estates',
  'Portfolio Advisors',
]

const STATUS_DISTRIBUTION: Record<QueueItemStatus, number> = {
  ready: 24,
  scheduled: 156,
  sent: 342,
  delivered: 319,
  failed: 18,
  held: 7,
  approval: 12,
  retry: 9,
}

const FAILURE_REASONS: FailureReason[] = [
  'carrier_error',
  'textgrid_error',
  'invalid_phone',
  'dnc_conflict',
  'outside_contact_window',
  'template_missing',
  'retry_exhausted',
  'sync_error',
]

const generateQueueItem = (index: number): QueueItem => {
  const status: QueueItemStatus = Object.keys(STATUS_DISTRIBUTION)[
    Math.floor(Math.random() * Object.keys(STATUS_DISTRIBUTION).length)
  ] as QueueItemStatus

  const now = new Date()
  const scheduledTime = new Date(now.getTime() + (Math.random() * 7 * 24 * 60 * 60 * 1000))
  const createdTime = new Date(now.getTime() - (Math.random() * 30 * 24 * 60 * 60 * 1000))

  const retryCount = Math.floor(Math.random() * 4)
  const priority: QueueItemPriority = ['P0', 'P1', 'P2', 'P3'][Math.floor(Math.random() * 4)] as QueueItemPriority
  const riskLevel: RiskLevel = ['low', 'medium', 'high'][Math.floor(Math.random() * 3)] as RiskLevel
  const aiConfidence = Math.floor(Math.random() * 40) + 60

  return {
    id: `queue-${index}`,
    queueId: `q-${Math.random().toString(36).substring(7)}`,
    sellerName: SELLERS[Math.floor(Math.random() * SELLERS.length)],
    propertyAddress: `${Math.floor(Math.random() * 10000) + 1} Main St`,
    market: MARKETS[Math.floor(Math.random() * MARKETS.length)],
    phone: `+1${Math.floor(Math.random() * 9000000000 + 2000000000)}`,
    agent: AGENTS[Math.floor(Math.random() * AGENTS.length)],
    templateName: TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)],
    templateSource: ['system', 'custom', 'ai'][Math.floor(Math.random() * 3)] as 'system' | 'custom' | 'ai',
    useCase: USE_CASES[Math.floor(Math.random() * USE_CASES.length)],
    stage: ['lead', 'follow-up', 'negotiation', 'closing'][Math.floor(Math.random() * 4)],
    messageText: `Hi there! I wanted to follow up on the property at ${Math.floor(Math.random() * 10000) + 1} Main St. We have a qualified buyer interested. Would you like to discuss further?`,
    scheduledForLocal: scheduledTime.toISOString(),
    scheduledForUtc: scheduledTime.toISOString(),
    timezone: 'America/Chicago',
    contactWindow: ['morning', 'afternoon', 'evening', 'flexible'][Math.floor(Math.random() * 4)] as any,
    status,
    priority,
    touchNumber: Math.floor(Math.random() * 5) + 1,
    language: Math.random() > 0.8 ? 'es' : 'en',
    retryCount,
    maxRetries: 3,
    failureReason: status === 'failed' || status === 'retry' ? FAILURE_REASONS[Math.floor(Math.random() * FAILURE_REASONS.length)] : null,
    deliveryStatus: (['pending', 'sent', 'delivered', 'failed', 'bounced'] as DeliveryStatus[])[status === 'delivered' ? 2 : status === 'sent' ? 1 : 0],
    createdAt: createdTime.toISOString(),
    sentAt: status === 'sent' || status === 'delivered' ? new Date(now.getTime() - Math.random() * 24 * 60 * 60 * 1000).toISOString() : null,
    approvedByOperator: status === 'sent' || status === 'delivered' ? 'ops-team' : null,
    requiresApproval: status === 'approval' || (riskLevel === 'high' && Math.random() > 0.7),
    riskLevel,
    aiConfidence,
    estimatedCost: Math.random() * 0.025 + 0.01,
    textgridNumber: `+1${Math.floor(Math.random() * 9000000000 + 2000000000)}`,
    linkedInboxThreadId: Math.random() > 0.4 ? `thread-${Math.random().toString(36).substring(7)}` : null,
    linkedPropertyId: `prop-${Math.random().toString(36).substring(7)}`,
    linkedOwnerId: `owner-${Math.random().toString(36).substring(7)}`,
  }
}

export const adaptQueueModel = (): QueueModel => {
  // Generate ~600 items distributed across statuses
  let items: QueueItem[] = []
  let id = 0

  for (const [status, count] of Object.entries(STATUS_DISTRIBUTION)) {
    for (let i = 0; i < count; i++) {
      const item = generateQueueItem(id)
      item.status = status as QueueItemStatus
      items.push(item)
      id++
    }
  }

  const readyCount = items.filter((i) => i.status === 'ready').length
  const scheduledCount = items.filter((i) => i.status === 'scheduled').length
  const approvalCount = items.filter((i) => i.status === 'approval').length
  const failedCount = items.filter((i) => i.status === 'failed').length
  const retryCount = items.filter((i) => i.status === 'retry').length
  const heldCount = items.filter((i) => i.status === 'held').length
  const sentTodayCount = items.filter((i) => i.status === 'sent').length
  const deliveredTodayCount = items.filter((i) => i.status === 'delivered').length

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
    safeCapacityRemaining: Math.floor(Math.random() * 500) + 200,
    optOutRiskCount: Math.floor(Math.random() * 8) + 2,
    apiPressureLevel: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)] as any,
  }
}

export const loadQueue = async (): Promise<QueueModel> => {
  if (shouldUseSupabase()) {
    try {
      return await fetchQueueModel()
    } catch (error) {
      if (isDev) {
        console.warn('[NEXUS] Queue Supabase load failed, using generated model.', error)
      }
    }
  }

  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 200))
  return adaptQueueModel()
}
