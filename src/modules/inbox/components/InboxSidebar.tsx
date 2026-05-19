import { memo, useEffect, useMemo, useRef } from 'react'
import type { InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import { Icon } from '../../../shared/icons'
import { WatchBell } from '../../../shared/WatchBell'
import { formatInboxThreadTimestamp } from '../../../shared/formatters'
import {
  resolveThreadAddressLine,
  resolveThreadMarketBadge,
  resolveThreadPrimaryName,
  type InboxSavedFilterPreset,
  type InboxViewSelectValue,
} from '../inbox-ui-helpers'
import type { InboxSourceMode } from '../../../lib/data/inboxData'
import {
  buildConversationDecision,
  isHotLeadDecision,
  matchesInboxBucket,
  sortThreadsByDecision,
  type ConversationDecision,
  type InboxBucket,
} from '../inbox-decisioning'

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
  viewCounts: Record<string, number | string | null | undefined>
  onOpenAdvancedFilters: () => void
  onClearFilters?: () => void
  onLoadMore: () => void
  canLoadMore: boolean
  recentlyUpdatedThreadIds?: Set<string>
  searchQuery?: string
  onSearchQueryChange?: (value: string) => void
  visibleThreadCount?: number
  loadingError?: string | null
  densityMode?: 'full' | 'compact'
  sourceMode?: InboxSourceMode
  onSourceModeChange?: (mode: InboxSourceMode) => void
}

type BucketConfig = {
  bucket: InboxBucket
  view: InboxViewSelectValue | string
  label: string
  icon: string
  description: string
  accentClass: string
  countKey: string
}

const BUCKETS: BucketConfig[] = [
  { bucket: 'new_replies', view: 'new_replies', label: 'NEW REPLIES', icon: '📨', description: 'Unread inbound replies that need attention now', accentClass: 'is-inbound', countKey: 'new_replies' },
  { bucket: 'priority', view: 'priority', label: 'PRIORITY', icon: '⚡', description: 'Unread, high-priority conversations', accentClass: 'is-hot', countKey: 'priority' },
  { bucket: 'priority', view: 'hot_leads', label: 'HOT LEADS', icon: '🔥', description: 'The warmest opportunities based on live signals and score.', accentClass: 'is-hot', countKey: 'hot_leads' },
  { bucket: 'waiting_on_seller', view: 'not_contacted', label: 'NOT CONTACTED', icon: '🆕', description: 'Leads that have not been contacted yet', accentClass: 'is-cold', countKey: 'not_contacted' },
  { bucket: 'waiting_on_seller', view: 'scheduled', label: 'SCHEDULED', icon: '📅', description: 'Messages scheduled for future delivery', accentClass: 'is-outbound', countKey: 'scheduled' },
  { bucket: 'waiting_on_seller', view: 'queued', label: 'QUEUED', icon: '⏳', description: 'Messages in the active delivery queue', accentClass: 'is-outbound', countKey: 'queued' },
  { bucket: 'waiting_on_seller', view: 'waiting_on_seller', label: 'WAITING', icon: '⌛', description: 'Outbound sent, waiting for seller response', accentClass: 'is-inbound-all', countKey: 'waiting_on_seller' },
  { bucket: 'follow_up_due', view: 'follow_up_due', label: 'FOLLOW-UPS DUE', icon: '⏰', description: 'System-owned follow-ups due now', accentClass: 'is-outbound', countKey: 'follow_up_due' },
  { bucket: 'needs_review', view: 'needs_review', label: 'NEEDS REVIEW', icon: '🛡', description: 'Ambiguous, legal, hostile, or low-confidence threads', accentClass: 'is-review', countKey: 'needs_review' },
  { bucket: 'automated', view: 'automated', label: 'AUTOMATED', icon: '⚙️', description: 'Deterministic automation is ready to act', accentClass: 'is-automated', countKey: 'automated' },
  { bucket: 'dnc_suppressed', view: 'suppressed', label: 'SUPPRESSED', icon: '🚫', description: 'Opt-out, wrong number, DNC, or legal suppression', accentClass: 'is-dnc', countKey: 'suppressed' },
  { bucket: 'dnc_suppressed', view: 'archived', label: 'DEAD', icon: '☠️', description: 'Threads archived, closed, or removed from active acquisition motion.', accentClass: 'is-cold', countKey: 'archived' },
  { bucket: 'needs_review', view: 'failed', label: 'FAILED SENDS', icon: '❌', description: 'Delivery failures, blocked sends, and queue exceptions.', accentClass: 'is-review', countKey: 'failed' },
]

const KPI_STRIP = [
  { key: 'new_replies', label: 'New Replies' },
  { key: 'needs_review', label: 'Needs Review' },
  { key: 'follow_up_due', label: 'Follow-Up Due' },
  { key: 'active', label: 'Active Threads' },
  { key: 'sent_today', label: 'Sent Today' },
  { key: 'replies_today', label: 'Replies Today' },
  { key: 'positive_reply_rate', label: 'Positive Reply Rate' },
  { key: 'opt_out_rate', label: 'Opt-Out Rate' },
  { key: 'delivery_rate', label: 'Delivery Rate' },
  { key: 'queue_health', label: 'Queue Health' },
] as const

const COMPACT_STATS = [
  { key: 'new_replies', label: 'New Replies', icon: '📬' },
  { key: 'priority', label: 'Priority', icon: '⚡' },
  { key: 'needs_review', label: 'Needs Review', icon: '⚠' },
  { key: 'follow_up_due', label: 'Follow-Up Due', icon: '⏰' },
  { key: 'automated', label: 'Auto-Eligible', icon: '⚙️' },
] as const

const numberOrNull = (value: unknown): number | null => {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

const formatCount = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${value}`
const formatMetric = (key: typeof KPI_STRIP[number]['key'], value: unknown) => {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '—'
  if (key === 'positive_reply_rate' || key === 'opt_out_rate' || key === 'delivery_rate') {
    if (numeric < 0 || numeric > 100) return '—'
    return `${Math.round(numeric)}%`
  }
  return `${Math.round(numeric)}`
}

const formatLoadingError = (value: unknown) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  if (typeof value === 'object') {
    const maybeMessage = (value as { message?: unknown }).message
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) return maybeMessage.trim()
    try {
      return JSON.stringify(value)
    } catch {
      return 'Unable to load inbox data'
    }
  }
  return String(value)
}

const readString = (thread: InboxWorkflowThread, ...keys: string[]) => {
  const row = thread as unknown as Record<string, unknown>
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
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
  ]
  return values.some((value) => value.toLowerCase().includes(search))
}

const getInitials = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '??'

const primaryBadges = (decision: ConversationDecision) => [
  decision.intent_tags[0] || decision.seller_intent.replace(/_/g, ' '),
  decision.conversation_stage.replace(/_/g, ' '),
  decision.lead_temperature.replace(/_/g, ' '),
].filter(Boolean).slice(0, 3)

const ConversationRow = memo(({
  thread,
  selected,
  decision,
  onSelect,
}: {
  thread: InboxWorkflowThread
  selected: boolean
  decision: ConversationDecision
  onSelect: (id: string) => void
}) => {
  const name = resolveThreadPrimaryName(thread) || readString(thread, 'best_phone', 'canonical_e164', 'phone') || 'Unknown Owner'
  const address = resolveThreadAddressLine(thread) || readString(thread, 'property_address_full', 'propertyAddressFull') || 'No Address'
  const preview = readString(thread, 'latest_message_body', 'latestMessageBody', 'lastMessageBody', 'preview') || 'No recent message'
  const timestamp = formatInboxThreadTimestamp(thread.lastMessageAt || (thread as any).lastMessageIso || thread.updatedAt)
  const statusTone =
    decision.suppression_status === 'suppressed' ? 'critical'
      : decision.automation_status === 'AUTO-BLOCKED' ? 'warning'
      : decision.review_reason ? 'warning'
      : isHotLeadDecision(decision) ? 'good'
      : 'neutral'

  return (
    <div
      role="button"
      tabIndex={0}
      className={cls('nx-thread-card', 'nx-thread-card--deterministic', `is-${statusTone}`, selected && 'is-selected', decision.unread && 'is-unread')}
      data-thread-id={thread.id}
      onClick={() => onSelect(thread.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(thread.id)
        }
      }}
    >
      <div className="nx-thread-card__row nx-thread-card__row--1">
        <div className="nx-thread-card__identity">
          <div className="nx-thread-card__avatar-lite">{getInitials(name)}</div>
          <div className="nx-thread-card__name-stack">
            <div className="nx-thread-card__name">{name}</div>
            <div className="nx-thread-card__address">{address}</div>
          </div>
        </div>
        <div className="nx-thread-card__time-group">
          <WatchBell
            watch_type="thread"
            watch_key={thread.id}
            label={name}
            thread_key={thread.id}
            owner_id={readString(thread, 'owner_id', 'ownerId')}
            address={address !== 'No Address' ? address : undefined}
          />
          <time className="nx-thread-card__time" aria-label={timestamp.fullLabel}>
            <span className="nx-thread-card__time-day">{timestamp.dayLabel}</span>
            {timestamp.timeLabel && <span className="nx-thread-card__time-clock">{timestamp.timeLabel}</span>}
          </time>
        </div>
      </div>

      <div className="nx-thread-card__row nx-thread-card__row--2 nx-thread-card__row--badges">
        {primaryBadges(decision).map((tag) => (
          <span key={tag} className={cls('nx-thread-decision-pill', tag === primaryBadges(decision)[0] && `is-${statusTone}`)}>{tag}</span>
        ))}
      </div>

      <div className="nx-thread-card__row nx-thread-card__row--3">
        <div className="nx-thread-card__preview">{preview}</div>
      </div>

      <div className="nx-thread-card__row nx-thread-card__row--4 nx-thread-card__row--decision">
        <span className="nx-thread-card__next-action">{decision.next_action}</span>
        <span className={cls('nx-thread-card__automation-status', `is-${statusTone}`)}>{decision.automation_status}</span>
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
  savedPreset,
  onApplySavedPreset,
  viewCounts,
  onOpenAdvancedFilters,
  onClearFilters,
  onLoadMore,
  canLoadMore,
  recentlyUpdatedThreadIds = new Set(),
  searchQuery = '',
  onSearchQueryChange,
  visibleThreadCount = 1000,
  loadingError,
  densityMode = 'compact',
  sourceMode = 'conversations',
  onSourceModeChange,
}: InboxSidebarProps) => {
  const groupsRef = useRef<HTMLDivElement | null>(null)
  const loadingErrorMessage = formatLoadingError(loadingError)

  const searchableThreads = useMemo(
    () => threads.filter((thread) => !recentlyUpdatedThreadIds.has(`hidden:${thread.id}`) && matchesSearch(thread, searchQuery)),
    [threads, recentlyUpdatedThreadIds, searchQuery],
  )

  const decisionMap = useMemo(() => {
    const map = new Map<string, ConversationDecision>()
    searchableThreads.forEach((thread) => {
      map.set(thread.id, buildConversationDecision(thread))
    })
    return map
  }, [searchableThreads])

  const bucketedThreads = useMemo(() => {
    const grouped = Object.fromEntries(BUCKETS.map((bucket) => [bucket.bucket, [] as InboxWorkflowThread[]])) as Record<InboxBucket, InboxWorkflowThread[]>
    searchableThreads.forEach((thread) => {
      const decision = decisionMap.get(thread.id)
      if (!decision) return
      BUCKETS.forEach((bucket) => {
        if (matchesInboxBucket(thread, bucket.bucket, decision)) grouped[bucket.bucket].push(thread)
      })
    })
    BUCKETS.forEach((bucket) => {
      grouped[bucket.bucket] = sortThreadsByDecision(grouped[bucket.bucket], decisionMap).slice(0, visibleThreadCount)
    })
    return grouped
  }, [decisionMap, searchableThreads, visibleThreadCount])

  const activeBucketConfig = useMemo(
    () => BUCKETS.find((bucket) => bucket.view === activeViewFilter) ?? BUCKETS.find((bucket) => bucket.bucket === 'priority') ?? BUCKETS[0],
    [activeViewFilter],
  )

  const kpiValues = useMemo(() => ({
    new_replies: viewCounts.new_replies ?? viewCounts.needs_reply ?? bucketedThreads.new_replies.length,
    needs_review: viewCounts.needs_review ?? viewCounts.manual_review ?? bucketedThreads.needs_review.length,
    follow_up_due: viewCounts.follow_up_due ?? bucketedThreads.follow_up_due.length,
    active: viewCounts.active ?? searchableThreads.filter((thread) => (decisionMap.get(thread.id)?.active)).length,
    sent_today: numberOrNull(viewCounts.sent_today) ?? 0,
    replies_today: numberOrNull(viewCounts.replies_today) ?? 0,
    positive_reply_rate: numberOrNull(viewCounts.positive_reply_rate) ?? 0,
    opt_out_rate: numberOrNull(viewCounts.opt_out_rate) ?? 0,
    delivery_rate: numberOrNull(viewCounts.delivery_rate) ?? 0,
    queue_health: viewCounts.queue_health ?? 'OK',
  }), [bucketedThreads, decisionMap, searchableThreads, viewCounts])

  useEffect(() => {
    if (!selectedId) return
    const root = groupsRef.current
    if (!root) return
    const selectedNode = root.querySelector<HTMLElement>(`[data-thread-id="${selectedId}"]`)
    selectedNode?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId, activeBucketConfig, visibleThreadCount])

  return (
    <aside className={cls('nx-sidebar', 'nx-sidebar--premium', 'nx-sidebar--deterministic', `nx-sidebar--density-${densityMode}`, `nx-sidebar--active-${activeBucketConfig.accentClass.replace('is-', '')}`, savedPreset && 'has-preset')}>
      <div className="nx-sidebar__top">
        <div className="nx-sidebar__title-row">
          <span className="nx-sidebar__app-title">ACQUISITIONS COMMAND CENTER</span>
        </div>

        <div className="nx-sidebar__source-toggle-row">
          <button
            type="button"
            className={cls('nx-source-mode-btn', sourceMode === 'conversations' && 'is-active')}
            onClick={() => onSourceModeChange?.('conversations')}
          >
            Conversations
          </button>
          <button
            type="button"
            className={cls('nx-source-mode-btn', sourceMode === 'all_sellers' && 'is-active')}
            onClick={() => onSourceModeChange?.('all_sellers')}
          >
            All Sellers
          </button>
        </div>

        <div className="nx-sidebar__label-row">
          <span className="nx-section-label">
            {activeBucketConfig.label}
            <b className="nx-sidebar__label-count">{formatCount(numberOrNull(viewCounts[activeBucketConfig.countKey]) ?? bucketedThreads[activeBucketConfig.bucket].length)}</b>
          </span>
          <div className="nx-sidebar__header-actions">
            <button type="button" className="nx-sidebar__icon-button" title="Advanced filters" onClick={onOpenAdvancedFilters}>
              <Icon name="filter" />
            </button>
            <button type="button" className="nx-sidebar__icon-button" title="Clear filters" onClick={() => onClearFilters?.()}>
              <Icon name="close" />
            </button>
          </div>
        </div>

        {densityMode === 'full' && (
          <>
            <div className="nx-sidebar__badge-row">
              {BUCKETS.slice(0, 4).map((bucket) => {
                const count = numberOrNull(viewCounts[bucket.countKey]) ?? bucketedThreads[bucket.bucket].length
                return (
                  <button
                    key={bucket.bucket}
                    type="button"
                    className={cls('nx-inbox-badge', bucket.accentClass, activeBucketConfig.bucket === bucket.bucket && 'is-selected')}
                    onClick={() => onApplySavedPreset(viewToPreset(bucket.view))}
                  >
                    <span>{bucket.icon}</span>
                    <strong>{formatCount(count)}</strong>
                  </button>
                )
              })}
              <span className="nx-sidebar__total-count">{formatCount(numberOrNull(viewCounts.all) ?? searchableThreads.length)}</span>
            </div>

            <div className={cls('nx-sidebar__hero', `is-${activeBucketConfig.accentClass.replace('is-', '')}`)}>
              <div className="nx-sidebar__hero__glow" aria-hidden="true" />
              <div className="nx-sidebar__hero__inner">
                <div className="nx-sidebar__hero__text">
                  <span className="nx-sidebar__hero__label">{activeBucketConfig.label}</span>
                  <span className="nx-sidebar__hero__desc">{activeBucketConfig.description}</span>
                </div>
                <span className="nx-sidebar__hero__count">{formatCount(numberOrNull(viewCounts[activeBucketConfig.countKey]) ?? bucketedThreads[activeBucketConfig.bucket].length)}</span>
              </div>
            </div>

            <div className="nx-sidebar-kpi-strip">
              {KPI_STRIP.map((item) => (
                <div key={item.key} className="nx-sidebar-kpi-tile">
                  <span>{item.label}</span>
                  <strong>{formatMetric(item.key, kpiValues[item.key])}</strong>
                </div>
              ))}
            </div>
          </>
        )}

        {densityMode === 'compact' && (
          <div className="nx-sidebar-stats-row" aria-label="Compact inbox stats">
            {COMPACT_STATS.map((item) => {
              const value = numberOrNull(viewCounts[item.key]) ?? bucketedThreads[item.key as InboxBucket]?.length ?? 0
              return (
                <button key={item.key} type="button" className="nx-sidebar-stat-pill" onClick={() => onApplySavedPreset(viewToPreset(item.key as InboxViewSelectValue))}>
                  <span>{item.icon}</span>
                  <b>{formatCount(value)}</b>
                  <small>{item.label}</small>
                </button>
              )
            })}
          </div>
        )}

        <label className="nx-sidebar-search">
          <input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange?.(event.target.value)}
            placeholder="Owner, address, phone, APN..."
            aria-label="Search inbox threads"
          />
        </label>

        {loadingErrorMessage && (
          <div className="nx-sidebar-error">
            <Icon name="alert" />
            <span>{loadingErrorMessage}</span>
          </div>
        )}
      </div>

      <div className="nx-queue-groups" ref={groupsRef}>
        {BUCKETS.map((bucket) => {
          const groupThreads = bucketedThreads[bucket.bucket]
          const count = numberOrNull(viewCounts[bucket.countKey]) ?? groupThreads.length
          const expanded = activeBucketConfig.bucket === bucket.bucket
          return (
            <section key={bucket.bucket} className={cls('nx-queue-group', bucket.accentClass, expanded && 'is-expanded')}>
              <button
                type="button"
                className={cls('nx-queue-group__header', expanded && 'is-selected')}
                onClick={() => onApplySavedPreset(viewToPreset(bucket.view))}
              >
                <span className="nx-queue-group__accent" />
                <span className="nx-queue-group__icon">{bucket.icon}</span>
                <span className="nx-queue-group__label">{bucket.label}</span>
                <span className="nx-queue-group__count">{formatCount(count)}</span>
                <Icon name={expanded ? 'chevron-down' : 'chevron-right'} />
              </button>

              {expanded && (
                <div className="nx-queue-group__threads">
                  {groupThreads.length > 0 ? groupThreads.map((thread) => {
                    const decision = decisionMap.get(thread.id)
                    if (!decision) return null
                    return (
                      <ConversationRow
                        key={thread.threadKey || thread.id}
                        thread={thread}
                        selected={selectedId === thread.id}
                        decision={decision}
                        onSelect={onSelect}
                      />
                    )
                  }) : (
                    <div className="nx-sidebar-empty">No conversations match this bucket.</div>
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

const viewToPreset = (view: InboxViewSelectValue | string): InboxSavedFilterPreset => {
  if (view === 'new_replies') return 'new_inbounds'
  if (view === 'priority') return 'my_priority'
  if (view === 'negotiating') return 'offer_needed'
  if (view === 'follow_up_due') return 'offer_needed'
  if (view === 'waiting_on_seller') return 'outbound_only'
  if (view === 'automated') return 'auto_replied'
  if (view === 'needs_review') return 'review_required'
  if (view === 'cold_no_response') return 'missing_context'
  if (view === 'dnc_opt_out') return 'suppressed'
  return 'all_messages'
}
