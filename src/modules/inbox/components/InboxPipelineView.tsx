import { useEffect, useMemo, useState } from 'react'
import type { InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import { formatCurrency, formatPercent, formatPhone, formatRelativeTime } from '../../../shared/formatters'
import { buildConversationDecision } from '../inbox-decisioning'
import type { ViewLayoutMode } from '../view-layout'

const cls = (...tokens: Array<string | false | null | undefined>) => tokens.filter(Boolean).join(' ')

type StageTone = 'neutral' | 'cyan' | 'blue' | 'green' | 'gold' | 'orange' | 'red'

interface PipelineStageDefinition {
  id: string
  label: string
  tone: StageTone
  matches: string[]
}

interface PipelineCardModel {
  thread: InboxWorkflowThread
  sellerName: string
  address: string
  market: string
  zip: string
  county: string
  phone: string
  status: string
  stage: string
  priority: string
  automation: string
  lastIntent: string
  nextAction: string
  snippet: string
  value: number | null
  equityPercent: number | null
  repairs: number | null
  lastContact: string | null
  unread: boolean
  hot: boolean
  suppressed: boolean
  followUpDue: boolean
  decisionConfidence: number
}

interface PipelineStageModel {
  def: PipelineStageDefinition
  cards: PipelineCardModel[]
  count: number
  hotCount: number
  followUpDueCount: number
  unreadCount: number
  automationCount: number
  avgStageAge: string
  stuckCount: number
}

interface PipelineSummary {
  totalActive: number
  hotDeals: number
  newReplies: number
  negotiating: number
  contractSent: number
  closing: number
  deadSuppressed: number
  followUpsDue: number
  positiveIntentRate: string
  averageStageAge: string
}

type PipelineSortMode = 'priority' | 'recent' | 'value'

interface InboxPipelineViewProps {
  threads: InboxWorkflowThread[]
  selectedId: string | null
  selectedThread: InboxWorkflowThread | null
  layoutMode: ViewLayoutMode
  onSelect: (id: string) => void
  onOpenCommandView: (threadId?: string | null) => void
  onThreadAction: (id: string, action: string) => void | Promise<void>
}

const PIPELINE_STAGES: PipelineStageDefinition[] = [
  { id: 'ownership_check', label: 'Ownership Check', tone: 'cyan', matches: ['ownership'] },
  { id: 'interest_probe', label: 'Interest Probe', tone: 'blue', matches: ['interest'] },
  { id: 'active_communication', label: 'Active Communication', tone: 'blue', matches: ['active', 'seller_response'] },
  { id: 'price_discovery', label: 'Price Discovery', tone: 'gold', matches: ['price'] },
  { id: 'condition_details', label: 'Condition Details', tone: 'orange', matches: ['condition'] },
  { id: 'offer_stage', label: 'Offer Stage', tone: 'green', matches: ['offer'] },
  { id: 'negotiation', label: 'Negotiation', tone: 'green', matches: ['negotiat', 'counter'] },
  { id: 'contract_sent', label: 'Contract Sent', tone: 'green', matches: ['contract'] },
  { id: 'title_closing', label: 'Title / Closing', tone: 'green', matches: ['title', 'closing'] },
  { id: 'dead_suppressed', label: 'Dead / Suppressed', tone: 'red', matches: ['dead', 'suppressed', 'closed'] },
]

const formatStageText = (value: string) =>
  value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())

const normalizeText = (value: unknown): string => String(value ?? '').trim()

const numericValue = (value: unknown): number | null => {
  const number = Number(String(value ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(number) ? number : null
}

const firstText = (values: Array<unknown>): string => {
  for (const value of values) {
    const normalized = normalizeText(value)
    if (normalized) return normalized
  }
  return ''
}

const toPipelineStageLabel = (thread: InboxWorkflowThread): string => {
  const normalized = String(thread.conversationStage || thread.inboxStage || '').toLowerCase()
  for (const stage of PIPELINE_STAGES) {
    if (stage.matches.some((match) => normalized.includes(match))) return stage.label
  }
  return 'Ownership Check'
}

const toStageAgeDays = (thread: InboxWorkflowThread): number => {
  const iso = thread.lastInboundAt || thread.lastOutboundAt || thread.lastMessageAt || thread.updatedAt
  if (!iso) return 0
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff) || diff < 0) return 0
  return diff / 86400000
}

const formatAgeLabel = (days: number): string => {
  if (!Number.isFinite(days) || days <= 0) return 'Fresh'
  if (days < 1) return `${Math.round(days * 24)}h`
  return `${Math.round(days)}d`
}

const toneForPriority = (priority: string): StageTone => {
  const normalized = priority.toLowerCase()
  if (normalized === 'urgent') return 'red'
  if (normalized === 'high') return 'orange'
  if (normalized === 'low') return 'neutral'
  return 'blue'
}

const buildPipelineCard = (thread: InboxWorkflowThread): PipelineCardModel => {
  const decision = buildConversationDecision(thread)
  const sellerName =
    firstText([thread.ownerDisplayName, thread.ownerName, thread.sellerName, (thread as any).prospect_name, (thread as any).contact_name]) ||
    'Unknown Seller'
  const address =
    firstText([thread.propertyAddressFull, thread.propertyAddress, thread.subject, (thread as any).address, (thread as any).situs_address]) ||
    'Property Unknown'
  const market =
    firstText([thread.market, thread.marketName, (thread as any).property_address_city && (thread as any).property_address_state ? `${(thread as any).property_address_city}, ${(thread as any).property_address_state}` : '', (thread as any).city && (thread as any).state ? `${(thread as any).city}, ${(thread as any).state}` : '']) ||
    'Market Unknown'
  const zip = firstText([(thread as any).property_address_zip, (thread as any).zip, (thread as any).postal_code]) || 'ZIP Pending'
  const county = firstText([(thread as any).property_address_county_name, (thread as any).county]) || 'County Pending'
  const phone = firstText([thread.phoneNumber, thread.canonicalE164, thread.displayPhone, (thread as any).prospect_best_phone]) || 'Phone Pending'
  const status = firstText([thread.inboxStatus, thread.status]) || 'needs_review'
  const stage = firstText([thread.conversationStage, thread.inboxStage]) || 'ownership_check'
  const priority = firstText([thread.priority]) || 'normal'
  const automation = firstText([thread.automationState, thread.autoReplyStatus, (thread as any).automation_status]) || decision.automation_status
  const lastIntent = firstText([(thread as any).last_intent, decision.seller_intent]) || 'unknown'
  const nextAction = firstText([(thread as any).next_action, thread.nextSystemAction, decision.next_action]) || 'Review conversation'
  const snippet = firstText([thread.lastMessageBody, thread.latestMessageBody, thread.preview, (thread as any).latest_message_body]) || 'No recent seller context.'
  const value = numericValue(thread.estimatedValue ?? (thread as any).estimated_value)
  const equityPercent = numericValue(thread.equityPercent ?? (thread as any).equity_percent)
  const repairs = numericValue(thread.estimatedRepairCost ?? (thread as any).estimated_repair_cost)
  const lastContact = thread.lastInboundAt || thread.lastOutboundAt || thread.lastMessageAt || thread.updatedAt || null
  const followUpIso = (thread as any).next_action_at || (thread as any).next_follow_up_at || decision.next_follow_up_at
  const followUpDue = Boolean(followUpIso && new Date(followUpIso).getTime() - Date.now() < 36 * 60 * 60 * 1000)

  return {
    thread,
    sellerName,
    address,
    market,
    zip,
    county,
    phone,
    status,
    stage,
    priority,
    automation,
    lastIntent,
    nextAction,
    snippet,
    value,
    equityPercent,
    repairs,
    lastContact,
    unread: decision.unread,
    hot: Boolean(thread.isHotLead || thread.sentiment === 'hot' || (thread as any).is_hot_lead),
    suppressed: Boolean(thread.isSuppressed || thread.isOptOut || (thread as any).is_suppressed),
    followUpDue,
    decisionConfidence: decision.confidence,
  }
}

const stageProgress = (stage: PipelineStageModel): number => {
  if (!stage.count) return 0
  const signal = stage.hotCount + stage.followUpDueCount + stage.unreadCount
  return Math.min(100, Math.round((signal / Math.max(stage.count, 1)) * 38 + stage.automationCount * 2))
}

const actionLabel = (mode: ViewLayoutMode) => {
  if (mode === 'compact') return 'Open Full Deal'
  if (mode === 'medium') return 'Open Command View'
  return 'Command View'
}

export function InboxPipelineView({
  threads,
  selectedId,
  selectedThread,
  layoutMode,
  onSelect,
  onOpenCommandView,
  onThreadAction,
}: InboxPipelineViewProps) {
  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useState<PipelineSortMode>('priority')
  const [hotOnly, setHotOnly] = useState(false)
  const [followUpOnly, setFollowUpOnly] = useState(false)
  const [automationOnly, setAutomationOnly] = useState(false)
  const [showSuppressed, setShowSuppressed] = useState(layoutMode === 'full')
  const [activeCompactStage, setActiveCompactStage] = useState<string>(PIPELINE_STAGES[0].id)

  const cards = useMemo(() => threads.map(buildPipelineCard), [threads])

  const visibleCards = useMemo(() => {
    const search = query.trim().toLowerCase()
    return cards
      .filter((card) => {
        if (!showSuppressed && card.suppressed) return false
        if (hotOnly && !card.hot) return false
        if (followUpOnly && !card.followUpDue) return false
        if (automationOnly && !card.automation.toLowerCase().includes('active') && !card.automation.toLowerCase().includes('auto')) return false
        if (!search) return true
        return [
          card.sellerName,
          card.address,
          card.market,
          card.lastIntent,
          card.nextAction,
          card.snippet,
        ].some((value) => value.toLowerCase().includes(search))
      })
      .sort((left, right) => {
        if (sortMode === 'value') return (right.value ?? 0) - (left.value ?? 0)
        if (sortMode === 'recent') {
          return new Date(right.lastContact || 0).getTime() - new Date(left.lastContact || 0).getTime()
        }
        const priorityWeight = (value: string) => {
          if (value === 'urgent') return 4
          if (value === 'high') return 3
          if (value === 'normal') return 2
          return 1
        }
        return priorityWeight(right.priority) - priorityWeight(left.priority)
      })
  }, [automationOnly, cards, followUpOnly, hotOnly, query, showSuppressed, sortMode])

  const stageModels = useMemo<PipelineStageModel[]>(() => {
    return PIPELINE_STAGES.map((def) => {
      const stageCards = visibleCards.filter((card) => toPipelineStageLabel(card.thread) === def.label)
      const ages = stageCards.map((card) => toStageAgeDays(card.thread))
      const avgDays = ages.length ? ages.reduce((sum, value) => sum + value, 0) / ages.length : 0
      return {
        def,
        cards: stageCards,
        count: stageCards.length,
        hotCount: stageCards.filter((card) => card.hot).length,
        followUpDueCount: stageCards.filter((card) => card.followUpDue).length,
        unreadCount: stageCards.filter((card) => card.unread).length,
        automationCount: stageCards.filter((card) => card.automation.toLowerCase().includes('active') || card.automation.toLowerCase().includes('auto')).length,
        avgStageAge: formatAgeLabel(avgDays),
        stuckCount: stageCards.filter((card) => toStageAgeDays(card.thread) >= 7).length,
      }
    })
  }, [visibleCards])

  useEffect(() => {
    if (!selectedThread) return
    const nextStage = PIPELINE_STAGES.find((stage) => stage.label === toPipelineStageLabel(selectedThread))?.id
    if (nextStage) setActiveCompactStage(nextStage)
  }, [selectedThread?.id])

  const summary = useMemo<PipelineSummary>(() => {
    const activeDeals = visibleCards.filter((card) => !card.suppressed)
    const positiveIntentCount = visibleCards.filter((card) => ['seller_interested', 'price_interest'].includes(card.lastIntent)).length
    const averageDays =
      activeDeals.length > 0
        ? activeDeals.reduce((sum, card) => sum + toStageAgeDays(card.thread), 0) / activeDeals.length
        : 0

    return {
      totalActive: activeDeals.length,
      hotDeals: visibleCards.filter((card) => card.hot).length,
      newReplies: visibleCards.filter((card) => card.status === 'new_reply' || card.unread).length,
      negotiating: visibleCards.filter((card) => toPipelineStageLabel(card.thread) === 'Negotiation').length,
      contractSent: visibleCards.filter((card) => toPipelineStageLabel(card.thread) === 'Contract Sent').length,
      closing: visibleCards.filter((card) => toPipelineStageLabel(card.thread) === 'Title / Closing').length,
      deadSuppressed: visibleCards.filter((card) => card.suppressed || toPipelineStageLabel(card.thread) === 'Dead / Suppressed').length,
      followUpsDue: visibleCards.filter((card) => card.followUpDue).length,
      positiveIntentRate: activeDeals.length ? `${Math.round((positiveIntentCount / activeDeals.length) * 100)}%` : '0%',
      averageStageAge: formatAgeLabel(averageDays),
    }
  }, [visibleCards])

  const selectedCard =
    visibleCards.find((card) => card.thread.id === selectedId) ??
    (selectedThread ? buildPipelineCard(selectedThread) : visibleCards[0] ?? null)

  const compactStage = stageModels.find((stage) => stage.def.id === activeCompactStage) ?? stageModels[0]

  return (
    <section className={cls('nx-pipeline-view', `is-layout-${layoutMode}`)}>
      <PipelineSummaryBar summary={summary} layoutMode={layoutMode} />
      <PipelineControls
        layoutMode={layoutMode}
        query={query}
        sortMode={sortMode}
        hotOnly={hotOnly}
        followUpOnly={followUpOnly}
        automationOnly={automationOnly}
        showSuppressed={showSuppressed}
        onQueryChange={setQuery}
        onSortModeChange={setSortMode}
        onHotOnlyChange={setHotOnly}
        onFollowUpOnlyChange={setFollowUpOnly}
        onAutomationOnlyChange={setAutomationOnly}
        onShowSuppressedChange={setShowSuppressed}
      />

      {layoutMode === 'compact' ? (
        <CompactPipelineLayout
          stageModels={stageModels}
          activeStageId={activeCompactStage}
          onStageChange={setActiveCompactStage}
          onSelect={onSelect}
          onOpenCommandView={onOpenCommandView}
          onThreadAction={onThreadAction}
        />
      ) : layoutMode === 'medium' ? (
        <MediumPipelineLayout
          stageModels={stageModels}
          selectedId={selectedId}
          onSelect={onSelect}
          onOpenCommandView={onOpenCommandView}
          onThreadAction={onThreadAction}
        />
      ) : layoutMode === 'expanded' ? (
        <ExpandedPipelineLayout
          stageModels={stageModels}
          selectedId={selectedId}
          onSelect={onSelect}
          onOpenCommandView={onOpenCommandView}
          onThreadAction={onThreadAction}
        />
      ) : (
        <FullPipelineLayout
          stageModels={stageModels}
          selectedId={selectedId}
          selectedCard={selectedCard}
          onSelect={onSelect}
          onOpenCommandView={onOpenCommandView}
          onThreadAction={onThreadAction}
        />
      )}

      {layoutMode !== 'compact' && (
        <div className="nx-pipeline-dock-spacer" aria-hidden="true" />
      )}

      <section className="nx-pipeline-action-dock">
        <div className="nx-pipeline-action-dock__group">
          <span>Communication</span>
          <button type="button">Draft Reply</button>
          <button type="button">Send SMS</button>
          <button type="button">Send Email</button>
        </div>
        <div className="nx-pipeline-action-dock__group">
          <span>Analysis</span>
          <button type="button">Run Underwriting</button>
          <button type="button">Open Comp Workspace</button>
          <button type="button">Show Buyer Matches</button>
        </div>
        <div className="nx-pipeline-action-dock__group">
          <span>Navigation</span>
          <button type="button" onClick={() => selectedCard && onOpenCommandView(selectedCard.thread.id)}>Open Command View</button>
          <button type="button">Open Map</button>
          <button type="button">AI Assist</button>
        </div>
        <div className="nx-pipeline-action-dock__group is-safety">
          <span>Safety</span>
          <button type="button" onClick={() => selectedCard && onThreadAction(selectedCard.thread.id, 'pause_automation')}>Pause Automation</button>
          <button type="button" onClick={() => selectedCard && onThreadAction(selectedCard.thread.id, 'suppress')}>Suppress</button>
          <button type="button" onClick={() => selectedCard && onThreadAction(selectedCard.thread.id, 'archive')}>DNC</button>
        </div>
      </section>

      {layoutMode === 'compact' && compactStage.cards.length === 0 && (
        <div className="nx-pipeline-empty-state is-floating">
          <strong>No active deals in this stage.</strong>
          <span>Threads will appear here once they enter {compactStage.def.label}.</span>
        </div>
      )}
    </section>
  )
}

function PipelineSummaryBar({ summary, layoutMode }: { summary: PipelineSummary; layoutMode: ViewLayoutMode }) {
  const items =
    layoutMode === 'compact'
      ? [
          ['Active', summary.totalActive],
          ['Hot', summary.hotDeals],
          ['Due', summary.followUpsDue],
          ['Replies', summary.newReplies],
        ]
      : [
          ['Active Deals', summary.totalActive],
          ['Hot Deals', summary.hotDeals],
          ['New Replies', summary.newReplies],
          ['Negotiating', summary.negotiating],
          ['Contract Sent', summary.contractSent],
          ['Closing', summary.closing],
          ['Dead / Suppressed', summary.deadSuppressed],
          ['Follow-Ups Due', summary.followUpsDue],
          ['Positive Intent', summary.positiveIntentRate],
          ['Avg Stage Age', summary.averageStageAge],
        ]

  return (
    <section className="nx-pipeline-summary">
      {items.map(([label, value]) => (
        <div key={label} className="nx-pipeline-summary__item">
          <span>{label}</span>
          <strong>{String(value)}</strong>
        </div>
      ))}
    </section>
  )
}

function PipelineControls(props: {
  layoutMode: ViewLayoutMode
  query: string
  sortMode: PipelineSortMode
  hotOnly: boolean
  followUpOnly: boolean
  automationOnly: boolean
  showSuppressed: boolean
  onQueryChange: (value: string) => void
  onSortModeChange: (value: PipelineSortMode) => void
  onHotOnlyChange: (value: boolean) => void
  onFollowUpOnlyChange: (value: boolean) => void
  onAutomationOnlyChange: (value: boolean) => void
  onShowSuppressedChange: (value: boolean) => void
}) {
  const { layoutMode } = props
  return (
    <section className="nx-pipeline-controls">
      <label className="nx-pipeline-search">
        <span>Search Pipeline</span>
        <input value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="Seller, address, action, intent..." />
      </label>
      <div className="nx-pipeline-controls__cluster">
        <select value={props.sortMode} onChange={(event) => props.onSortModeChange(event.target.value as PipelineSortMode)}>
          <option value="priority">Sort: Priority</option>
          <option value="recent">Sort: Recent Activity</option>
          <option value="value">Sort: Value</option>
        </select>
        <button type="button" className={cls(props.hotOnly && 'is-active')} onClick={() => props.onHotOnlyChange(!props.hotOnly)}>Hot Only</button>
        <button type="button" className={cls(props.followUpOnly && 'is-active')} onClick={() => props.onFollowUpOnlyChange(!props.followUpOnly)}>Follow-Up Due</button>
        {layoutMode !== 'compact' && (
          <button type="button" className={cls(props.automationOnly && 'is-active')} onClick={() => props.onAutomationOnlyChange(!props.automationOnly)}>Automation Active</button>
        )}
        <button type="button" className={cls(props.showSuppressed && 'is-active')} onClick={() => props.onShowSuppressedChange(!props.showSuppressed)}>
          {props.showSuppressed ? 'Hide Suppressed' : 'Show Suppressed'}
        </button>
      </div>
    </section>
  )
}

function CompactPipelineLayout({
  stageModels,
  activeStageId,
  onStageChange,
  onSelect,
  onOpenCommandView,
  onThreadAction,
}: {
  stageModels: PipelineStageModel[]
  activeStageId: string
  onStageChange: (value: string) => void
  onSelect: (id: string) => void
  onOpenCommandView: (threadId?: string | null) => void
  onThreadAction: (id: string, action: string) => void | Promise<void>
}) {
  const activeStage = stageModels.find((stage) => stage.def.id === activeStageId) ?? stageModels[0]
  return (
    <div className="nx-pipeline-compact">
      <div className="nx-pipeline-stage-rail">
        {stageModels.map((stage) => (
          <button
            key={stage.def.id}
            type="button"
            className={cls('nx-pipeline-stage-pill', `is-${stage.def.tone}`, activeStage.def.id === stage.def.id && 'is-active')}
            onClick={() => onStageChange(stage.def.id)}
          >
            <strong>{stage.def.label}</strong>
            <span>{stage.count}</span>
          </button>
        ))}
      </div>
      <div className="nx-pipeline-compact__list">
        {activeStage.cards.length > 0 ? (
          activeStage.cards.map((card) => (
            <PipelineCompactCard key={card.thread.id} card={card} onSelect={onSelect} onOpenCommandView={onOpenCommandView} onThreadAction={onThreadAction} />
          ))
        ) : (
          <div className="nx-pipeline-empty-state">
            <strong>No active deals in this stage.</strong>
            <span>Threads will appear here once they enter {activeStage.def.label}.</span>
          </div>
        )}
      </div>
    </div>
  )
}

function MediumPipelineLayout({
  stageModels,
  selectedId,
  onSelect,
  onOpenCommandView,
  onThreadAction,
}: {
  stageModels: PipelineStageModel[]
  selectedId: string | null
  onSelect: (id: string) => void
  onOpenCommandView: (threadId?: string | null) => void
  onThreadAction: (id: string, action: string) => void | Promise<void>
}) {
  return (
    <div className="nx-pipeline-columns is-medium">
      {stageModels.map((stage) => (
        <PipelineLane key={stage.def.id} stage={stage} selectedId={selectedId} cardMode="medium" onSelect={onSelect} onOpenCommandView={onOpenCommandView} onThreadAction={onThreadAction} />
      ))}
    </div>
  )
}

function ExpandedPipelineLayout({
  stageModels,
  selectedId,
  onSelect,
  onOpenCommandView,
  onThreadAction,
}: {
  stageModels: PipelineStageModel[]
  selectedId: string | null
  onSelect: (id: string) => void
  onOpenCommandView: (threadId?: string | null) => void
  onThreadAction: (id: string, action: string) => void | Promise<void>
}) {
  return (
    <div className="nx-pipeline-columns is-expanded">
      {stageModels.map((stage) => (
        <PipelineLane key={stage.def.id} stage={stage} selectedId={selectedId} cardMode="expanded" onSelect={onSelect} onOpenCommandView={onOpenCommandView} onThreadAction={onThreadAction} />
      ))}
    </div>
  )
}

function FullPipelineLayout({
  stageModels,
  selectedId,
  selectedCard,
  onSelect,
  onOpenCommandView,
  onThreadAction,
}: {
  stageModels: PipelineStageModel[]
  selectedId: string | null
  selectedCard: PipelineCardModel | null
  onSelect: (id: string) => void
  onOpenCommandView: (threadId?: string | null) => void
  onThreadAction: (id: string, action: string) => void | Promise<void>
}) {
  return (
    <div className="nx-pipeline-full">
      <div className="nx-pipeline-columns is-full">
        {stageModels.map((stage) => (
          <PipelineLane key={stage.def.id} stage={stage} selectedId={selectedId} cardMode="full" onSelect={onSelect} onOpenCommandView={onOpenCommandView} onThreadAction={onThreadAction} />
        ))}
      </div>
      <aside className="nx-pipeline-preview">
        {selectedCard ? (
          <>
            <div className="nx-pipeline-preview__hero">
              <span className={cls('nx-pipeline-priority-dot', `is-${toneForPriority(selectedCard.priority)}`)} />
              <div>
                <strong>{selectedCard.address}</strong>
                <p>{selectedCard.sellerName} • {selectedCard.market}</p>
              </div>
            </div>
            <div className="nx-pipeline-preview__grid">
              <div><label>Status</label><strong>{formatStageText(selectedCard.status)}</strong></div>
              <div><label>Stage</label><strong>{formatStageText(selectedCard.stage)}</strong></div>
              <div><label>Priority</label><strong>{formatStageText(selectedCard.priority)}</strong></div>
              <div><label>Last Contact</label><strong>{selectedCard.lastContact ? formatRelativeTime(selectedCard.lastContact) : 'Pending'}</strong></div>
              <div><label>Phone</label><strong>{formatPhone(selectedCard.phone)}</strong></div>
              <div><label>County</label><strong>{selectedCard.county}</strong></div>
            </div>
            <div className="nx-pipeline-preview__insight">
              <span>Conversation Summary</span>
              <p>{selectedCard.snippet}</p>
            </div>
            <div className="nx-pipeline-preview__insight">
              <span>Next Action</span>
              <p>{selectedCard.nextAction}</p>
            </div>
            <div className="nx-pipeline-preview__metrics">
              <MetricChip label="Value" value={selectedCard.value ? formatCurrency(selectedCard.value) : 'Pending'} tone="green" />
              <MetricChip label="Equity" value={selectedCard.equityPercent !== null ? formatPercent(selectedCard.equityPercent) : 'Pending'} tone="blue" />
              <MetricChip label="Repairs" value={selectedCard.repairs ? formatCurrency(selectedCard.repairs) : 'Pending'} tone="orange" />
            </div>
            <div className="nx-pipeline-preview__timeline">
              <span>Command Preview</span>
              <ul>
                <li>Intent: {formatStageText(selectedCard.lastIntent)}</li>
                <li>Automation: {selectedCard.automation}</li>
                <li>Follow-Up: {selectedCard.followUpDue ? 'Due soon' : 'Stable'}</li>
                <li>Confidence: {Math.round(selectedCard.decisionConfidence * 100)}/100</li>
              </ul>
            </div>
            <div className="nx-pipeline-preview__actions">
              <button type="button" onClick={() => onOpenCommandView(selectedCard.thread.id)}>Open Command View</button>
              <button type="button" onClick={() => onThreadAction(selectedCard.thread.id, 'pause_automation')}>Pause Auto</button>
              <button type="button" onClick={() => onThreadAction(selectedCard.thread.id, 'snooze')}>Snooze</button>
            </div>
          </>
        ) : (
          <div className="nx-pipeline-empty-state">
            <strong>Select a deal.</strong>
            <span>Property snapshot, conversation intelligence, and next moves will appear here.</span>
          </div>
        )}
      </aside>
    </div>
  )
}

function PipelineLane({
  stage,
  selectedId,
  cardMode,
  onSelect,
  onOpenCommandView,
  onThreadAction,
}: {
  stage: PipelineStageModel
  selectedId: string | null
  cardMode: 'medium' | 'expanded' | 'full'
  onSelect: (id: string) => void
  onOpenCommandView: (threadId?: string | null) => void
  onThreadAction: (id: string, action: string) => void | Promise<void>
}) {
  return (
    <section className={cls('nx-pipeline-lane', `is-${stage.def.tone}`)}>
      <header className="nx-pipeline-lane__header">
        <div>
          <span>{stage.def.label}</span>
          <strong>{stage.count}</strong>
        </div>
        <div className="nx-pipeline-lane__meta">
          <small>Hot {stage.hotCount}</small>
          <small>Due {stage.followUpDueCount}</small>
        </div>
        <div className="nx-pipeline-lane__bar">
          <i style={{ width: `${stageProgress(stage)}%` }} />
        </div>
        <div className="nx-pipeline-lane__analytics">
          <small>Age {stage.avgStageAge}</small>
          <small>Stuck {stage.stuckCount}</small>
          <small>Auto {stage.automationCount}</small>
        </div>
      </header>
      <div className="nx-pipeline-lane__body">
        {stage.cards.length > 0 ? (
          stage.cards.map((card) => (
            <PipelineDealCard
              key={card.thread.id}
              card={card}
              cardMode={cardMode}
              selected={selectedId === card.thread.id}
              onSelect={onSelect}
              onOpenCommandView={onOpenCommandView}
              onThreadAction={onThreadAction}
            />
          ))
        ) : (
          <div className="nx-pipeline-empty-state">
            <strong>No active deals in this stage.</strong>
            <span>Threads will appear here once they enter {stage.def.label}.</span>
          </div>
        )}
      </div>
    </section>
  )
}

function PipelineCompactCard({
  card,
  onSelect,
  onOpenCommandView,
  onThreadAction,
}: {
  card: PipelineCardModel
  onSelect: (id: string) => void
  onOpenCommandView: (threadId?: string | null) => void
  onThreadAction: (id: string, action: string) => void | Promise<void>
}) {
  return (
    <article
      className={cls('nx-pipeline-card', 'is-compact', `is-${toneForPriority(card.priority)}`)}
      onClick={() => onSelect(card.thread.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(card.thread.id)
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="nx-pipeline-card__top">
        <strong>{card.sellerName}</strong>
        <span>{card.stage.replace(/_/g, ' ')}</span>
      </div>
      <p>{card.address}</p>
      <div className="nx-pipeline-card__meta">
        <span>{card.nextAction}</span>
        <small>{card.lastContact ? formatRelativeTime(card.lastContact) : 'Pending'}</small>
      </div>
      <div className="nx-pipeline-card__snippet">{card.snippet}</div>
      <div className="nx-pipeline-card__badges">
        {card.hot && <Badge label="Hot" tone="gold" />}
        {card.unread && <Badge label="Unread" tone="blue" />}
        {card.suppressed && <Badge label="Suppressed" tone="red" />}
        {card.automation.toLowerCase().includes('auto') && <Badge label="Auto" tone="green" />}
      </div>
      <div className="nx-pipeline-card__quick">
        <button type="button" onClick={(event) => { event.stopPropagation(); onOpenCommandView(card.thread.id) }}>{actionLabel('compact')}</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); onThreadAction(card.thread.id, 'pause_automation') }}>Pause Auto</button>
      </div>
    </article>
  )
}

function PipelineDealCard({
  card,
  cardMode,
  selected,
  onSelect,
  onOpenCommandView,
  onThreadAction,
}: {
  card: PipelineCardModel
  cardMode: 'medium' | 'expanded' | 'full'
  selected: boolean
  onSelect: (id: string) => void
  onOpenCommandView: (threadId?: string | null) => void
  onThreadAction: (id: string, action: string) => void | Promise<void>
}) {
  return (
    <article
      className={cls('nx-pipeline-card', `is-${cardMode}`, `is-${toneForPriority(card.priority)}`, selected && 'is-selected')}
      onClick={() => onSelect(card.thread.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(card.thread.id)
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="nx-pipeline-card__top">
        <div>
          <strong>{card.sellerName}</strong>
          <p>{card.address}</p>
        </div>
        <div className="nx-pipeline-card__signal">
          <span>{card.market}</span>
          <small>{card.zip}</small>
        </div>
      </div>
      <div className="nx-pipeline-card__badges">
        <Badge label={formatStageText(card.status)} tone="neutral" />
        <Badge label={formatStageText(card.stage)} tone="blue" />
        {card.hot && <Badge label="Hot" tone="gold" />}
        {card.unread && <Badge label="Unread" tone="cyan" />}
        {card.followUpDue && <Badge label="Due" tone="orange" />}
        {card.suppressed && <Badge label="Suppressed" tone="red" />}
      </div>
      <div className="nx-pipeline-card__grid">
        <div>
          <span>Intent</span>
          <strong>{formatStageText(card.lastIntent)}</strong>
        </div>
        <div>
          <span>Next</span>
          <strong>{card.nextAction}</strong>
        </div>
        <div>
          <span>Automation</span>
          <strong>{card.automation}</strong>
        </div>
        <div>
          <span>Last Contact</span>
          <strong>{card.lastContact ? formatRelativeTime(card.lastContact) : 'Pending'}</strong>
        </div>
      </div>
      <div className="nx-pipeline-card__snippet">{card.snippet}</div>
      <div className="nx-pipeline-card__chips">
        {card.value !== null && <MetricChip label="Value" value={formatCurrency(card.value)} tone="green" />}
        {card.equityPercent !== null && <MetricChip label="Equity" value={formatPercent(card.equityPercent)} tone="blue" />}
        {card.repairs !== null && <MetricChip label="Repairs" value={formatCurrency(card.repairs)} tone="orange" />}
      </div>
      <div className="nx-pipeline-card__quick">
        <button type="button" onClick={(event) => { event.stopPropagation(); onSelect(card.thread.id) }}>Open Thread</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); onOpenCommandView(card.thread.id) }}>{actionLabel(cardMode === 'medium' ? 'medium' : 'full')}</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); onThreadAction(card.thread.id, 'snooze') }}>Snooze</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); onThreadAction(card.thread.id, 'pause_automation') }}>Pause Auto</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); onSelect(card.thread.id) }}>Follow-Up</button>
      </div>
    </article>
  )
}

function Badge({ label, tone }: { label: string; tone: StageTone }) {
  return <span className={cls('nx-pipeline-badge', `is-${tone}`)}>{label}</span>
}

function MetricChip({ label, value, tone }: { label: string; value: string; tone: StageTone }) {
  return (
    <div className={cls('nx-pipeline-metric-chip', `is-${tone}`)}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
