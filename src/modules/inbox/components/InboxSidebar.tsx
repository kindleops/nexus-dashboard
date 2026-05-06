import { memo, useEffect, useMemo } from 'react'
import type { InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import { Icon } from '../../../shared/icons'
import { formatRelativeTime } from '../../../shared/formatters'
import {
  resolveThreadAddressLine,
  resolveThreadMarketBadge,
  resolveThreadPrimaryName,
  type InboxSavedFilterPreset,
  type InboxViewSelectValue,
} from '../inbox-ui-helpers'

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

const normalizeCategory = (thread: InboxWorkflowThread): CategoryKey => {
  const category = readString(thread, 'inbox_category', 'inboxCategory', 'priorityBucket', 'priority_bucket').toLowerCase()
  if (category === 'hot_leads') return 'hot_leads'
  if (category === 'needs_review') return 'needs_review'
  if (category === 'new_inbound') return 'new_inbound'
  if (category === 'automated') return 'automated'
  if (category === 'outbound_active') return 'outbound_active'
  if (category === 'dnc_opt_out') return 'dnc_opt_out'
  if (category === 'cold_no_response' || category === 'all') return 'cold_no_response'
  return 'cold_no_response'
}

const resolvePropertyTypeBadge = (thread: InboxWorkflowThread) => {
  const propertyType = readString(thread, 'propertyType', 'property_type', 'assetType', 'asset_type')
  if (!propertyType) return null
  return propertyType.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

const resolveStageBadge = (thread: InboxWorkflowThread) => {
  const raw = readString(thread, 'threadWorkflowStage', 'workflowStage', 'queue_stage', 'detected_intent', 'conversationStage', 'inbox_category')
  if (!raw) return 'Ownership Check'
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

interface ConversationRowProps {
  thread: InboxWorkflowThread
  selected: boolean
  queuePreset: QueuePreset
  onSelect: (id: string) => void
}

const ConversationRow = memo(({ thread, selected, queuePreset, onSelect }: ConversationRowProps) => {
  const name = resolveThreadPrimaryName(thread) || readString(thread, 'best_phone', 'canonical_e164', 'phone') || 'Unknown Owner'
  const address = resolveThreadAddressLine(thread) || readString(thread, 'property_address_full', 'propertyAddressFull') || 'No linked property'
  const preview = readString(thread, 'latest_message_body', 'latestMessageBody', 'lastMessageBody', 'preview') || 'No recent message'
  const market = resolveThreadMarketBadge(thread)
  const propertyType = resolvePropertyTypeBadge(thread)
  const ownerType = readString(thread, 'ownerType', 'owner_type')
  const language = readString(thread, 'contactLanguage', 'language')
  const score = readNumber(thread, 'finalAcquisitionScore', 'final_score', 'priorityScore', 'aiScore', 'motivationScore')
  const stage = resolveStageBadge(thread)
  const time = thread.lastMessageAt || thread.lastMessageIso || thread.updatedAt
  const avatarToneClass = queuePreset === 'suppressed' ? 'is-dnc' : queuePreset === 'positive_hot' ? 'is-hot' : 'is-default'
  const previewText = preview.replace(/\s+/g, ' ').trim() || 'No recent message'
  const actionLabel = stage.toLowerCase().includes('ownership') ? 'OWNERSHIP CHECK' : stage.toUpperCase()
  const badges = [
    market ? market.toUpperCase() : null,
    propertyType?.toUpperCase(),
    ownerType && /(llc|corp|corporate|company)/i.test(ownerType) ? 'CORPORATE' : null,
    language && !/english|en\b/i.test(language) ? language.toUpperCase() : null,
  ].filter(Boolean) as string[]

  return (
    <button
      type="button"
      className={cls(
        'nx-thread-card',
        `queue-${queuePreset}`,
        avatarToneClass,
        selected && 'is-selected',
      )}
      onClick={() => onSelect(thread.id)}
    >
      <div className="nx-thread-card__avatar">{getInitials(name)}</div>
      <div className="nx-thread-card__body">
        <div className="nx-thread-card__topline">
          <strong className="nx-thread-card__name">{name}</strong>
          <div className="nx-thread-card__score-time">
            {score !== null && <span className="nx-thread-card__score">{score}</span>}
            <time className="nx-thread-card__time">{time ? formatRelativeTime(time).toUpperCase() : '—'}</time>
          </div>
        </div>
        <div className="nx-thread-card__middle">
          <div className="nx-thread-card__address">{address}</div>
          <span className="nx-thread-card__action">{actionLabel}</span>
        </div>
        <div className="nx-thread-card__preview">{previewText}</div>
        {badges.length > 0 && (
          <div className="nx-thread-card__chips">
            {badges.map((badge) => (
              <span
                key={badge}
                className={cls(
                  'nx-thread-chip',
                  badge === 'CORPORATE' && 'is-corporate',
                )}
              >
                {badge}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
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
  loadingError,
  visibleThreadCount,
  canLoadMore,
  onLoadMore,
  recentlyUpdatedThreadIds = new Set(),
  searchQuery = '',
  onSearchQueryChange,
}: InboxSidebarProps) => {
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
      const category = normalizeCategory(thread)
      const match = QUEUE_CONFIG.find((group) => group.category === category)?.preset ?? 'missing_context'
      initial[match].push(thread)
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

  return (
    <aside className="nx-sidebar nx-sidebar--premium">
      <div className="nx-sidebar__top">
        <div className="nx-sidebar__label-row">
          <span className="nx-section-label">ACQUISITIONS INBOX</span>
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
          <span className="nx-inbox-badge is-hot">🔥 {formatCount(numberOrNull(viewCounts.positive_hot) ?? groupedThreads.positive_hot.length)}</span>
          <span className="nx-inbox-badge is-review">⚠️ {formatCount(numberOrNull(viewCounts.manual_review) ?? groupedThreads.manual_review.length)}</span>
          <span className="nx-inbox-badge is-new">📨 {formatCount(numberOrNull(viewCounts.needs_reply) ?? groupedThreads.needs_reply.length)}</span>
          <span className="nx-sidebar__total-count">{formatCount(numberOrNull(totalCount) ?? 0)}</span>
        </div>

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

      <div className="nx-queue-groups">
        {QUEUE_CONFIG.map((group) => {
          const expanded = expandedQueue === group.preset
          const groupThreads = groupedThreads[group.preset]
          const count = viewCounts[group.countKey] ?? groupThreads.length
          return (
            <section key={group.preset} className={cls('nx-queue-group', group.accentClass, expanded && 'is-expanded')}>
              <button
                type="button"
                className={cls('nx-queue-group__header', expanded && 'is-selected')}
                onClick={() => onApplySavedPreset(group.preset)}
              >
                <span className="nx-queue-group__accent" />
                <span className="nx-queue-group__icon">{group.icon}</span>
                <span className="nx-queue-group__label">{group.label}</span>
                <span className="nx-queue-group__count">{formatCount(numberOrNull(count) ?? 0)}</span>
                <Icon name={expanded ? 'chevron-down' : 'chevron-right'} />
              </button>

              {expanded && (
                <div className="nx-queue-group__threads">
                  {groupThreads.length > 0 ? (
                    groupThreads.map((thread) => (
                      <ConversationRow
                        key={thread.threadKey || thread.id}
                        thread={thread}
                        selected={selectedId === thread.id}
                        queuePreset={group.preset}
                        onSelect={onSelect}
                      />
                    ))
                  ) : (
                    <div className="nx-sidebar-empty">No conversations match this queue.</div>
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
