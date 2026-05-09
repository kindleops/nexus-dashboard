import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import { Icon } from '../../../shared/icons'
import { formatCompactTime } from '../../../shared/formatters'
import {
  resolveThreadAddressLine,
  resolveThreadMarketBadge,
  resolveThreadPrimaryName,
  type InboxSavedFilterPreset,
  type InboxViewSelectValue,
} from '../inbox-ui-helpers'
import { getSellerStageVisual, getStatusVisual } from '../status-visuals'

const cls = (...tokens: Array<string | false | null | undefined>) => tokens.filter(Boolean).join(' ')

export interface AdvancedFilterOptions {
  markets: string[]
  states: string[]
  zips: string[]
  propertyTypes: string[]
  ownerTypes: string[]
  occupancies: string[]
  languages: string[]
  personas: string[]
  assignedAgents: string[]
}

interface InboxSidebarProps {
  threads: InboxWorkflowThread[]
  selectedId: string | null
  activeViewFilter: InboxViewSelectValue
  onSelect: (id: string) => void
  onThreadAction?: (id: string, action: string) => void
  savedPreset: InboxSavedFilterPreset
  onApplySavedPreset: (preset: InboxSavedFilterPreset) => void
  viewCounts: Record<string, number | null | undefined>
  onOpenAdvancedFilters: () => void
  onClearFilters?: () => void
  onLoadMore: () => void
  canLoadMore: boolean
  recentlyUpdatedThreadIds?: Set<string>
  searchQuery?: string
  onSearchQueryChange?: (value: string) => void
  visibleThreadCount?: number
  loadingError?: string | null
}

type QueuePreset =
  | 'positive_hot'
  | 'manual_review'
  | 'needs_reply'
  | 'auto_replied'
  | 'outbound_only'
  | 'missing_context'
  | 'suppressed'

type CategoryKey =
  | 'hot_leads'
  | 'needs_review'
  | 'new_inbound'
  | 'automated'
  | 'outbound_active'
  | 'cold_no_response'
  | 'dnc_opt_out'
  | 'all'

const QUEUE_PRESETS: QueuePreset[] = ['positive_hot', 'manual_review', 'needs_reply', 'auto_replied', 'outbound_only', 'missing_context', 'suppressed']

const QUEUE_DESCRIPTIONS: Record<QueuePreset, string> = {
  positive_hot: 'High-intent signals & active sellers',
  manual_review: 'Requires operator triage',
  needs_reply: 'Fresh replies awaiting response',
  auto_replied: 'AI-managed conversations',
  outbound_only: 'Active outreach in progress',
  missing_context: 'No recent seller activity',
  suppressed: 'Compliant suppressions & DNC',
}

const QUEUE_CONFIG: Array<{
  preset: QueuePreset
  category: CategoryKey
  icon: string
  label: string
  accentClass: string
  countKey: string
}> = [
  { preset: 'positive_hot', category: 'hot_leads', icon: '🔥', label: 'HOT LEADS', accentClass: 'is-hot', countKey: 'positive_hot' },
  { preset: 'manual_review', category: 'needs_review', icon: '⚠', label: 'NEEDS REVIEW', accentClass: 'is-review', countKey: 'manual_review' },
  { preset: 'needs_reply', category: 'new_inbound', icon: '📨', label: 'NEW INBOUND', accentClass: 'is-inbound', countKey: 'needs_reply' },
  { preset: 'auto_replied', category: 'automated', icon: '🤖', label: 'AUTOMATED', accentClass: 'is-automated', countKey: 'auto_replied' },
  { preset: 'outbound_only', category: 'outbound_active', icon: '📤', label: 'OUTBOUND ACTIVE', accentClass: 'is-outbound', countKey: 'outbound_only' },
  { preset: 'missing_context', category: 'cold_no_response', icon: '🧊', label: 'COLD / NO RESPONSE', accentClass: 'is-cold', countKey: 'missing_context' },
  { preset: 'suppressed', category: 'dnc_opt_out', icon: '🚫', label: 'DNC / OPT OUT', accentClass: 'is-dnc', countKey: 'suppressed' },
]

const VIEW_TO_QUEUE_PRESET: Partial<Record<InboxViewSelectValue, QueuePreset>> = {
  positive_hot: 'positive_hot',
  manual_review: 'manual_review',
  needs_reply: 'needs_reply',
  auto_replied: 'auto_replied',
  outbound: 'outbound_only',
  missing_context: 'missing_context',
  suppressed: 'suppressed',
}

const HERO_MODE_META: Record<'priority' | 'active' | 'waiting' | 'all', { label: string; tone: string; description: string }> = {
  priority: { label: 'PRIORITY INBOX', tone: 'priority', description: 'Actionable signals & urgent replies' },
  active: { label: 'ACTIVE INBOX', tone: 'active', description: 'Recently engaged seller conversations' },
  waiting: { label: 'WAITING INBOX', tone: 'waiting', description: 'Outbound threads awaiting a response' },
  all: { label: 'ALL MESSAGES', tone: 'all', description: 'Full conversation flow for this inbox' },
}

const QUEUE_HERO_META: Record<QueuePreset, { tone: string; description: string }> = {
  positive_hot: { tone: 'hot', description: 'Motivated sellers and high-intent deal flow' },
  manual_review: { tone: 'review', description: 'Operator review required before the next move' },
  needs_reply: { tone: 'inbound', description: 'Fresh inbound replies ready for action' },
  auto_replied: { tone: 'automated', description: 'Automation-managed threads in motion' },
  outbound_only: { tone: 'outbound', description: 'Live outbound follow-up and outreach' },
  missing_context: { tone: 'cold', description: 'Cooling threads with no recent seller movement' },
  suppressed: { tone: 'suppressed', description: 'Suppressed and do-not-contact conversations' },
}

const numberOrNull = (value: unknown): number | null => {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

const formatCount = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '—'
  return `${value}`
}

const readString = (thread: InboxWorkflowThread, ...keys: string[]) => {
  const row = thread as unknown as Record<string, unknown>
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

const readNumber = (thread: InboxWorkflowThread, ...keys: string[]) => {
  const row = thread as unknown as Record<string, unknown>
  for (const key of keys) {
    const value = row[key]
    const num = Number(String(value ?? '').replace(/[^0-9.]/g, ''))
    if (Number.isFinite(num) && num > 0) return Math.round(num)
  }
  return null
}

const getActivityTime = (thread: InboxWorkflowThread) => {
  const iso = thread.lastMessageAt || thread.lastMessageIso || readString(thread, 'latest_message_at', 'latestMessageAt', 'updatedAt')
  const ts = iso ? new Date(iso).getTime() : Number.NaN
  return Number.isFinite(ts) ? ts : 0
}

const resolveQueuePreset = (thread: InboxWorkflowThread): QueuePreset => {
  const category = readString(thread, 'inbox_category', 'inboxCategory', 'priorityBucket', 'priority_bucket').toLowerCase()
  const latestDirection = readString(thread, 'latest_message_direction', 'latestDirection').toLowerCase()
  const queueStatus = readString(thread, 'queue_status', 'queueStatus', 'autoReplyStatus').toLowerCase()
  const queueStage = readString(thread, 'queue_stage', 'threadWorkflowStage', 'workflowStage').toLowerCase()
  const detectedIntent = readString(thread, 'detected_intent', 'uiIntent').toLowerCase()
  const preview = readString(thread, 'latest_message_body', 'latestMessageBody', 'lastMessageBody', 'preview').toLowerCase()
  const isHotLead = Boolean((thread as unknown as Record<string, unknown>).is_hot_lead)
  const isNewInbound = Boolean((thread as unknown as Record<string, unknown>).is_new_inbound)
  const isDnc = Boolean((thread as unknown as Record<string, unknown>).is_dnc)
  const score = readNumber(thread, 'finalAcquisitionScore', 'final_acquisition_score', 'priorityScore', 'priority_score') ?? 0
  const hoursSinceActivity = Math.max(0, (Date.now() - getActivityTime(thread)) / 36e5)

  if (category === 'dnc_opt_out' || isDnc || /stop|wrong number|not interested|remove|do not call|dnc|opt out/.test(preview)) return 'suppressed'
  if (category === 'hot_leads' || isHotLead || /interested|yes|sell|asking price|call me|offer/.test(preview) || score >= 74) return 'positive_hot'
  if (category === 'needs_review' || queueStatus === 'failed' || queueStatus === 'paused_global_lock' || /manual|review|unclear|ambiguous/.test(`${queueStage} ${detectedIntent}`)) return 'manual_review'
  if (category === 'new_inbound' || isNewInbound || latestDirection === 'inbound') return 'needs_reply'
  if (category === 'automated' || queueStatus === 'queued' || /queued|automation/.test(queueStatus)) return 'auto_replied'
  if (category === 'outbound_active') return 'outbound_only'
  if (category === 'cold_no_response') return 'missing_context'
  if (latestDirection === 'outbound' && /sent|delivered/.test(queueStatus) && hoursSinceActivity <= 72) return 'outbound_only'
  if (latestDirection === 'outbound' && /sent|delivered/.test(queueStatus)) return 'missing_context'
  if (latestDirection === 'outbound' && !queueStatus) return 'missing_context'
  return 'missing_context'
}

const getQueueCount = (
  preset: QueuePreset,
  backendCount: number | null | undefined,
  localCount: number,
) => {
  void preset
  return numberOrNull(backendCount) ?? localCount
}

const matchesSearch = (thread: InboxWorkflowThread, query: string) => {
  const search = query.trim().toLowerCase()
  if (!search) return true
  const values = [
    resolveThreadPrimaryName(thread),
    resolveThreadAddressLine(thread),
    resolveThreadMarketBadge(thread),
    readString(thread, 'latest_message_body', 'latestMessageBody', 'lastMessageBody', 'preview'),
    readString(thread, 'best_phone', 'canonical_e164', 'phone'),
    readString(thread, 'propertyType', 'property_type'),
    readString(thread, 'threadWorkflowStage', 'workflowStage', 'queue_stage', 'detected_intent', 'conversationStage', 'inbox_category'),
  ]
  return values.some((value) => value.toLowerCase().includes(search))
}

const getInitials = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '+('

const resolveStatusBadge = (thread: InboxWorkflowThread) => {
  const visual = getStatusVisual(thread.inboxStatus, {
    latestDirection: thread.latestDirection || readString(thread, 'latest_message_direction', 'latestDirection') || null,
    lastOutboundAt: thread.lastOutboundAt ?? null,
    lastInboundAt: thread.lastInboundAt ?? null,
  })
  return visual.label.toUpperCase()
}

const resolveStageBadge = (thread: InboxWorkflowThread) => {
  const raw = thread.conversationStage || readString(thread, 'threadWorkflowStage', 'workflowStage', 'queue_stage')
  return getSellerStageVisual(raw || null).label
}

const resolveCardBadges = (thread: InboxWorkflowThread) => {
  const market = resolveThreadMarketBadge(thread)
  const stage = resolveStageBadge(thread)
  const status = resolveStatusBadge(thread)

  const stageShortMap: Record<string, string> = {
    'Ownership Check': 'OWNERSHIP',
    'Interest Probe': 'INTEREST',
    'Active Communication': 'ACTIVE',
    'Price Discovery': 'PRICE',
    'Condition / Details': 'DETAILS',
    'Offer Stage': 'OFFER',
    'Contract Sent': 'CONTRACT',
    'Negotiation': 'NEGOTIATION',
    'Dead': 'DEAD',
    'Closed': 'CLOSED',
  }
  const stageShort = stageShortMap[stage] ?? stage.toUpperCase().slice(0, 10)

  return [
    market ? market.toUpperCase() : null,
    stageShort || null,
    status || null,
  ].filter(Boolean) as string[]
}

interface ConversationRowProps {
  thread: InboxWorkflowThread
  selected: boolean
  queuePreset: QueuePreset
  onSelect: (id: string) => void
  onThreadAction?: (id: string, action: string) => void
}

const ConversationRow = memo(({ thread, selected, queuePreset, onSelect, onThreadAction }: ConversationRowProps) => {
  const name = resolveThreadPrimaryName(thread) || readString(thread, 'best_phone', 'canonical_e164', 'phone') || 'Unknown Owner'
  const address = resolveThreadAddressLine(thread) || readString(thread, 'property_address_full', 'propertyAddressFull') || 'No Address'
  const preview = readString(thread, 'latest_message_body', 'latestMessageBody', 'lastMessageBody', 'preview') || ''
  const time = thread.lastMessageAt || (thread as any).lastMessageIso || thread.updatedAt
  const avatarToneClass = queuePreset === 'suppressed' ? 'is-dnc' : queuePreset === 'positive_hot' ? 'is-hot' : 'is-default'
  const previewText = preview.replace(/\s+/g, ' ').trim()
  const badges = resolveCardBadges(thread)
  const isStarred = Boolean(thread.isStarred)
  const isPinned = Boolean(thread.isPinned)

  const handleAction = (action: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onThreadAction?.(thread.id, action)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={cls(
        'nx-thread-card',
        `queue-${queuePreset}`,
        avatarToneClass,
        selected && 'is-selected',
        isPinned && 'is-pinned',
        isStarred && 'is-starred',
      )}
      data-thread-id={thread.id}
      onClick={() => onSelect(thread.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(thread.id) }}
    >
      <div className="nx-thread-card__avatar">{getInitials(name)}</div>
      <div className="nx-thread-card__body">
        <div className="nx-thread-card__topline">
          <strong className="nx-thread-card__name">{name}</strong>
          <div className="nx-thread-card__meta">
            {isPinned && <span className="nx-thread-card__pin-icon" title="Pinned">📌</span>}
            {isStarred && <span className="nx-thread-card__star-icon" title="Starred">⭐</span>}
            <time className="nx-thread-card__time">{time ? formatCompactTime(time) : '—'}</time>
          </div>
        </div>
        <div className="nx-thread-card__address">{address}</div>
        {previewText && <div className="nx-thread-card__preview">{previewText}</div>}
        <div className="nx-thread-card__footer">
          {badges.length > 0 && (
            <div className="nx-thread-card__chips">
              {badges.slice(0, 3).map((badge, i) => (
                <span
                  key={badge}
                  className={cls(
                    'nx-thread-chip',
                    i === 0 && 'is-market',
                    i === 1 && 'is-stage',
                    i === 2 && 'is-type',
                  )}
                >
                  {badge}
                </span>
              ))}
            </div>
          )}
          <div className="nx-thread-card__quick-actions">
            <button
              type="button"
              className={cls('nx-thread-quick-btn', isStarred && 'is-active')}
              title={isStarred ? 'Remove star' : 'Star thread'}
              onClick={handleAction(isStarred ? 'unstar' : 'star')}
            >
              ⭐
            </button>
            <button
              type="button"
              className={cls('nx-thread-quick-btn', isPinned && 'is-active')}
              title={isPinned ? 'Unpin' : 'Pin thread'}
              onClick={handleAction(isPinned ? 'unpin' : 'pin')}
            >
              📌
            </button>
            <button
              type="button"
              className={cls('nx-thread-quick-btn', thread.isRead && 'is-active')}
              title={thread.isRead ? 'Mark as unread' : 'Mark as read'}
              onClick={handleAction(thread.isRead ? 'unread' : 'read')}
            >
              📥
            </button>
            <button
              type="button"
              className="nx-thread-quick-btn"
              title="Archive thread"
              onClick={handleAction('archive')}
            >
              🗄
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})

ConversationRow.displayName = 'ConversationRow'

export const InboxSidebar = ({
  threads,
  selectedId,
  activeViewFilter,
  onSelect,
  onThreadAction,
  savedPreset,
  onApplySavedPreset,
  viewCounts,
  onOpenAdvancedFilters,
  onClearFilters,
  loadingError,
  visibleThreadCount,
  canLoadMore,
  onLoadMore,
  recentlyUpdatedThreadIds = new Set(),
  searchQuery = '',
  onSearchQueryChange,
}: InboxSidebarProps) => {
  const groupsRef = useRef<HTMLDivElement | null>(null)
  const searchableThreads = useMemo(
    () => threads.filter((thread) => !recentlyUpdatedThreadIds.has(`hidden:${thread.id}`) && matchesSearch(thread, searchQuery)),
    [threads, recentlyUpdatedThreadIds, searchQuery],
  )

  const visibleThreads = useMemo(
    () => searchableThreads.slice(0, visibleThreadCount),
    [searchableThreads, visibleThreadCount],
  )

  const groupedThreads = useMemo(() => {
    const initial = Object.fromEntries(QUEUE_CONFIG.map((group) => [group.preset, [] as InboxWorkflowThread[]])) as Record<QueuePreset, InboxWorkflowThread[]>
    visibleThreads.forEach((thread) => {
      initial[resolveQueuePreset(thread)].push(thread)
    })
    return initial
  }, [visibleThreads])

  const firstPopulatedQueue = useMemo(
    () => QUEUE_PRESETS.find((preset) => groupedThreads[preset].length > 0) ?? 'missing_context',
    [groupedThreads],
  )

  const expandedQueue = useMemo(() => {
    if (QUEUE_PRESETS.includes(savedPreset as QueuePreset)) return savedPreset as QueuePreset
    return VIEW_TO_QUEUE_PRESET[activeViewFilter] ?? firstPopulatedQueue
  }, [savedPreset, activeViewFilter, firstPopulatedQueue])

  const totalCount = viewCounts.review_required ?? viewCounts.all ?? threads.length

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const categoryCounts = Object.fromEntries(QUEUE_PRESETS.map((preset) => [preset, groupedThreads[preset].length]))
    const firstThread = visibleThreads[0]
    console.log('[NEXUS Left Inbox Diagnostics]', {
      rawHydratedRows: threads.length,
      normalizedThreads: threads.length,
      visibleRows: visibleThreads.length,
      categoryCounts,
      activeCategory: expandedQueue,
      firstNormalizedThread: threads[0] ?? null,
      firstVisibleThread: firstThread ?? null,
    })
  }, [threads, visibleThreads, groupedThreads, expandedQueue])

  useEffect(() => {
    if (!selectedId) return
    const root = groupsRef.current
    if (!root) return
    const selectedNode = root.querySelector<HTMLElement>(`[data-thread-id="${selectedId}"]`)
    selectedNode?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId, expandedQueue, visibleThreads.length])

  const activeQueueConfig = QUEUE_CONFIG.find((g) => g.preset === expandedQueue)
  const activeCount = activeQueueConfig
    ? getQueueCount(activeQueueConfig.preset, viewCounts[activeQueueConfig.countKey], groupedThreads[activeQueueConfig.preset].length)
    : numberOrNull(totalCount) ?? 0

  const [manuallyClosed, setManuallyClosed] = useState<Set<QueuePreset>>(new Set())

  type ModePerspective = 'priority' | 'active' | 'waiting' | 'all'
  const [modePerspective, setModePerspective] = useState<ModePerspective>('all')

  const filterByMode = (threadList: InboxWorkflowThread[], mode: ModePerspective): InboxWorkflowThread[] => {
    if (mode === 'all') return threadList
    const now = Date.now()
    if (mode === 'priority') return threadList.filter((t) => (readNumber(t, 'finalAcquisitionScore', 'final_acquisition_score', 'priorityScore', 'priority_score') ?? 0) >= 55)
    if (mode === 'active') return threadList.filter((t) => { const ts = getActivityTime(t); return ts > 0 && (now - ts) < 48 * 36e5 })
    if (mode === 'waiting') return threadList.filter((t) => t.lastDirection === 'outbound' || readString(t, 'latest_message_direction', 'latestDirection').toLowerCase() === 'outbound')
    return threadList
  }

  const modeCounts = useMemo(() => {
    const queueThreads = activeQueueConfig ? groupedThreads[activeQueueConfig.preset] : visibleThreads
    const now = Date.now()
    return {
      priority: queueThreads.filter((t) => (readNumber(t, 'finalAcquisitionScore', 'final_acquisition_score', 'priorityScore', 'priority_score') ?? 0) >= 55).length,
      active: queueThreads.filter((t) => {
        const ts = getActivityTime(t)
        return ts > 0 && (now - ts) < 48 * 36e5
      }).length,
      waiting: queueThreads.filter((t) => readString(t, 'latest_message_direction', 'latestDirection').toLowerCase() === 'outbound').length,
      all: queueThreads.length,
    }
  }, [groupedThreads, activeQueueConfig, visibleThreads])

  const heroMeta = modePerspective === 'all' && activeQueueConfig
    ? {
        label: activeQueueConfig.label,
        tone: QUEUE_HERO_META[activeQueueConfig.preset]?.tone ?? 'default',
        description: QUEUE_HERO_META[activeQueueConfig.preset]?.description ?? QUEUE_DESCRIPTIONS[activeQueueConfig.preset],
        count: activeCount,
      }
    : {
        label: HERO_MODE_META[modePerspective].label,
        tone: HERO_MODE_META[modePerspective].tone,
        description: HERO_MODE_META[modePerspective].description,
        count: modeCounts[modePerspective],
      }

  const topBadges = [
    { preset: 'positive_hot' as const, icon: '🔥', label: 'HOT LEADS' },
    { preset: 'manual_review' as const, icon: '⚠', label: 'NEEDS REVIEW' },
    { preset: 'needs_reply' as const, icon: '📨', label: 'NEW INBOUND' },
  ]

  const handleQueueClick = (preset: QueuePreset) => {
    if (expandedQueue === preset) {
      setManuallyClosed((prev) => {
        const next = new Set(prev)
        if (prev.has(preset)) { next.delete(preset) } else { next.add(preset) }
        return next
      })
    } else {
      setManuallyClosed((prev) => { const next = new Set(prev); next.delete(preset); return next })
      onApplySavedPreset(preset)
    }
  }

  return (
    <aside className={cls('nx-sidebar nx-sidebar--premium', `nx-sidebar--active-${heroMeta.tone}`)}>
      <div className="nx-sidebar__top">
        <div className="nx-sidebar__title-row">
          <span className="nx-sidebar__app-title">ACQUISITIONS INBOX</span>
        </div>

        {/* ── Top bar: label + icon actions ── */}
        <div className="nx-sidebar__label-row">
          <span className="nx-section-label">
            {heroMeta.label}
            <b className="nx-sidebar__label-count">{formatCount(numberOrNull(heroMeta.count) ?? 0)}</b>
          </span>
          <div className="nx-sidebar__header-actions">
            <button type="button" className="nx-sidebar__icon-button" title="Notifications">
              <Icon name="alert" />
            </button>
            <button type="button" className="nx-sidebar__icon-button" title="Advanced filters" onClick={onOpenAdvancedFilters}>
              <Icon name="filter" />
            </button>
            <button type="button" className="nx-sidebar__icon-button" title="Clear filters" onClick={() => onClearFilters?.()}>
              <Icon name="close" />
            </button>
          </div>
        </div>

        <div className="nx-sidebar__badge-row">
          {topBadges.map((badge) => {
            const badgeGroup = QUEUE_CONFIG.find((group) => group.preset === badge.preset)
            const count = badgeGroup ? getQueueCount(badgeGroup.preset, viewCounts[badgeGroup.countKey], groupedThreads[badgeGroup.preset].length) : 0
            const selected = expandedQueue === badge.preset
            return (
              <button
                key={badge.preset}
                type="button"
                className={cls('nx-inbox-badge', badgeGroup?.accentClass, selected && 'is-selected')}
                onClick={() => {
                  setModePerspective('all')
                  setManuallyClosed((prev) => { const next = new Set(prev); next.delete(badge.preset); return next })
                  onApplySavedPreset(badge.preset)
                }}
              >
                <span>{badge.icon}</span>
                <strong>{formatCount(numberOrNull(count) ?? 0)}</strong>
              </button>
            )
          })}
          <span className="nx-sidebar__total-count">{formatCount(numberOrNull(totalCount) ?? threads.length)}</span>
        </div>

        {/* ── Hero card: active queue name + count ── */}
        <div className={cls('nx-sidebar__hero', `is-${heroMeta.tone}`)}>
          <div className="nx-sidebar__hero__glow" aria-hidden="true" />
          <div className="nx-sidebar__hero__inner">
            <div className="nx-sidebar__hero__text">
              <span className="nx-sidebar__hero__label">{heroMeta.label}</span>
              <span className="nx-sidebar__hero__desc">{heroMeta.description}</span>
            </div>
            <span className="nx-sidebar__hero__count">{formatCount(numberOrNull(heroMeta.count) ?? 0)}</span>
          </div>
          <div className="nx-sidebar__hero__modes">
            {(['priority', 'active', 'waiting', 'all'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={cls('nx-hero-mode-tab', modePerspective === mode && 'is-active')}
                onClick={(e) => { e.stopPropagation(); setModePerspective(mode) }}
              >
                <span className="nx-hero-mode-tab__label">{mode.toUpperCase()}</span>
                <span className="nx-hero-mode-tab__count">{modeCounts[mode]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Search ── */}
        <label className="nx-sidebar-search">
          <Icon name="search" />
          <input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange?.(event.target.value)}
            placeholder="Owner, address, phone, APN..."
            aria-label="Search inbox threads"
          />
        </label>

        {loadingError && (
          <div className="nx-sidebar-error">
            <Icon name="alert" />
            <span>{loadingError}</span>
          </div>
        )}
      </div>

      <div className="nx-queue-groups" ref={groupsRef}>
        {QUEUE_CONFIG.map((group) => {
          const isActive = expandedQueue === group.preset
          const expanded = isActive && !manuallyClosed.has(group.preset)
          const groupThreads = groupedThreads[group.preset]
          const displayThreads = isActive ? filterByMode(groupThreads, modePerspective) : groupThreads
          const count = getQueueCount(group.preset, viewCounts[group.countKey], groupThreads.length)
          return (
            <section key={group.preset} className={cls('nx-queue-group', group.accentClass, expanded && 'is-expanded')}>
              <button
                type="button"
                className={cls('nx-queue-group__header', isActive && 'is-selected')}
                onClick={() => handleQueueClick(group.preset)}
              >
                <span className="nx-queue-group__accent" />
                <span className="nx-queue-group__icon">{group.icon}</span>
                <span className="nx-queue-group__label">{group.label}</span>
                <span className="nx-queue-group__count">{formatCount(numberOrNull(count) ?? 0)}</span>
                <Icon name={expanded ? 'chevron-down' : 'chevron-right'} />
              </button>

              {expanded && (
                <div className="nx-queue-group__threads">
                  {displayThreads.length > 0 ? (
                    displayThreads.map((thread) => (
                      <ConversationRow
                        key={thread.threadKey || thread.id}
                        thread={thread}
                        selected={selectedId === thread.id}
                        queuePreset={group.preset}
                        onSelect={onSelect}
                        onThreadAction={onThreadAction}
                      />
                    ))
                  ) : (
                    <div className="nx-sidebar-empty">
                      {modePerspective !== 'all' ? `No ${modePerspective} threads in this queue.` : 'No conversations match this queue.'}
                    </div>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>

      {canLoadMore && (
        <div className="nx-sidebar__load-more">
          <button type="button" className="nx-load-more-btn" onClick={onLoadMore}>
            LOAD MORE
          </button>
        </div>
      )}
    </aside>
  )
}
