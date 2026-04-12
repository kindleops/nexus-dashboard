export type CampaignStatus = 'live' | 'warning' | 'paused'
export type AlertSeverity = 'critical' | 'warning' | 'info'
export type MarketHeat = 'hot' | 'warm' | 'steady'
export type PropertyType =
  | 'SFR'
  | 'Multi-Family'
  | 'Duplex'
  | 'Mobile Home'
  | 'Vacant Land'
export type Sentiment = 'hot' | 'warm' | 'neutral' | 'cold'
export type PipelineStage =
  | 'new'
  | 'contacted'
  | 'responding'
  | 'negotiating'
  | 'under-contract'
export type OwnerType =
  | 'absentee'
  | 'estate'
  | 'corporate'
  | 'tax-delinquent'
  | 'owner-occupied'
export type AgentStatus = 'active' | 'watching' | 'queued'
export type ActivityKind = 'system' | 'alert' | 'ai' | 'deal' | 'conversation'
export type MessageDirection = 'outbound' | 'inbound'

export interface TopZipRecord {
  zip: string
  outbound: number
  trend: '+' | '−'
}

export interface PipelineDistributionRecord {
  new: number
  contacted: number
  responding: number
  negotiating: number
  underContract: number
}

export interface MarketRecord {
  id: string
  slug: string
  name: string
  stateCode: string
  label: string
  lat: number
  lng: number
  heat: MarketHeat
  campaignStatus: CampaignStatus
  scanLabel: string
  activeProperties: number
  totalOutbound: number
  outboundToday: number
  repliesToday: number
  hotLeads: number
  pipelineValue: number
  deliverability: number
  healthScore: number
  activeCampaigns: number
  replyRate: number
  positiveRate: number
  optOutRate: number
  pendingFollowUps: number
  hourlyOutbound: number[]
  recentReplyRate: number[]
  topZips: TopZipRecord[]
  pipelineDistribution: PipelineDistributionRecord
  lastSweepIso: string
}

export interface LeadMessageRecord {
  id: string
  direction: MessageDirection
  message: string
  timestampIso: string
  aiGenerated?: boolean
}

export interface PropertyLeadRecord {
  id: string
  marketId: string
  address: string
  city: string
  stateCode: string
  zip: string
  lat: number
  lng: number
  ownerName: string
  ownerType: OwnerType
  propertyType: PropertyType
  sentiment: Sentiment
  pipelineStage: PipelineStage
  currentIntent: string
  estimatedValue: number
  offerAmount: number
  pipelineDays: number
  outboundAttempts: number
  lastOutboundIso: string
  lastInboundIso: string | null
  aiSummary: string
  objectionsDetected: string[]
  recommendedAction: string
  messages: LeadMessageRecord[]
}

export interface AgentRecord {
  id: string
  name: string
  specialty: string
  status: AgentStatus
  handledToday: number
  avgResponseMinutes: number
  successRate: number
  load: number
  marketId: string
  focusLeadId: string
  activityLabel: string
  aiSummary: string
}

export interface AlertRecord {
  id: string
  marketId: string
  severity: AlertSeverity
  title: string
  detail: string
  metricLabel: string
  metricValue: string
  timestampIso: string
}

export interface ActivityRecord {
  id: string
  marketId: string
  kind: ActivityKind
  severity: AlertSeverity
  title: string
  detail: string
  timestampIso: string
}

export interface MapLinkRecord {
  id: string
  fromMarketId: string
  toMarketId: string
  volume: number
}

export interface CommandCenterReferenceDataset {
  markets: MarketRecord[]
  properties: PropertyLeadRecord[]
  agents: AgentRecord[]
  alerts: AlertRecord[]
  activities: ActivityRecord[]
  mapLinks: MapLinkRecord[]
}

export interface CommandCenterStore {
  marketsById: Record<string, MarketRecord>
  marketIds: string[]
  propertiesById: Record<string, PropertyLeadRecord>
  propertyIds: string[]
  propertyIdsByMarketId: Record<string, string[]>
  agentsById: Record<string, AgentRecord>
  agentIds: string[]
  alertsById: Record<string, AlertRecord>
  alertIds: string[]
  alertIdsByMarketId: Record<string, string[]>
  activitiesById: Record<string, ActivityRecord>
  activityIds: string[]
  activityIdsByMarketId: Record<string, string[]>
  mapLinks: MapLinkRecord[]
}
