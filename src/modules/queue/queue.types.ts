export type QueueItemStatus = 'ready' | 'scheduled' | 'sent' | 'delivered' | 'failed' | 'held' | 'approval' | 'retry'
export type QueueItemPriority = 'P0' | 'P1' | 'P2' | 'P3'
export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'bounced' | 'rejected'
export type FailureReason =
  | 'carrier_error'
  | 'textgrid_error'
  | 'invalid_phone'
  | 'dnc_conflict'
  | 'outside_contact_window'
  | 'template_missing'
  | 'retry_exhausted'
  | 'sync_error'
  | 'unknown'
export type RiskLevel = 'low' | 'medium' | 'high'
export type QueueBucket = 'ready' | 'scheduled' | 'approval' | 'failed' | 'retry' | 'held' | 'sent' | 'delivered'
export type QueueView = 'today' | 'week' | 'month' | 'list' | 'approval' | 'failed'

export interface QueueItem {
  id: string
  queueId: string
  sellerName: string
  propertyAddress: string
  market: string
  phone: string
  agent: string
  templateName: string
  templateSource: 'system' | 'custom' | 'ai'
  useCase: string
  stage: string
  messageText: string
  scheduledForLocal: string // ISO string in local tz
  scheduledForUtc: string // ISO string in UTC
  timezone: string
  contactWindow: 'morning' | 'afternoon' | 'evening' | 'flexible'
  status: QueueItemStatus
  priority: QueueItemPriority
  touchNumber: number
  language: 'en' | 'es'
  retryCount: number
  maxRetries: number
  failureReason: FailureReason | null
  deliveryStatus: DeliveryStatus
  createdAt: string
  sentAt: string | null
  approvedByOperator: string | null
  requiresApproval: boolean
  riskLevel: RiskLevel
  aiConfidence: number // 0-100
  estimatedCost: number
  textgridNumber: string
  linkedInboxThreadId: string | null
  linkedPropertyId: string | null
  linkedOwnerId: string | null
  metadata?: Record<string, any>
}

export interface QueueModel {
  items: QueueItem[]
  readyCount: number
  scheduledCount: number
  approvalCount: number
  failedCount: number
  retryCount: number
  heldCount: number
  sentTodayCount: number
  deliveredTodayCount: number
  safeCapacityRemaining: number
  optOutRiskCount: number
  apiPressureLevel: 'low' | 'medium' | 'high'
}

export interface QueueFilters {
  markets: string[]
  statuses: QueueItemStatus[]
  agents: string[]
  priorities: QueueItemPriority[]
  templates: string[]
  useCases: string[]
  languages: ('en' | 'es')[]
  contactWindows: ('morning' | 'afternoon' | 'evening' | 'flexible')[]
  riskLevels: RiskLevel[]
  searchQuery: string
}
