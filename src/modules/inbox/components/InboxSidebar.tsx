import { memo, useMemo } from 'react'
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
  loadingError: string | null
  visibleThreadCount: number
  canLoadMore: boolean
  onLoadMore: () => void
  onThreadAction?: (id: string, action: 'star' | 'unstar' | 'pin' | 'unpin' | 'archive' | 'hide') => void
  recentlyUpdatedThreadIds?: Set<string>
  searchQuery?: string
  onSearchQueryChange?: (value: string) => void
}

type QueuePreset =
  | 'positive_hot'
  | 'manual_review'
  | 'needs_reply'
  | 'auto_replied'
  | 'outbound_only'
  | 'missing_context'
  | 'suppressed'

const QUEUE_PRESETS: QueuePreset[] = ['positive_hot', 'manual_review', 'needs_reply', 'auto_replied', 'outbound_only', 'missing_context', 'suppressed']

const QUEUE_CONFIG: Array<{
  preset: QueuePreset
  icon: string
  label: string
  accentClass: string
  countKey: string
}> = [
  { preset: 'positive_hot', icon: '🔥', label: 'HOT LEADS', accentClass: 'is-hot', countKey: 'positive_hot' },
  { preset: 'manual_review', icon: '⚠', label: 'NEEDS REVIEW', accentClass: 'is-review', countKey: 'manual_review' },
  { preset: 'needs_reply', icon: '📨', label: 'NEW INBOUND', accentClass: 'is-inbound', countKey: 'needs_reply' },
  { preset: 'auto_replied', icon: '🤖', label: 'AUTOMATED', accentClass: 'is-automated', countKey: 'auto_replied' },
  { preset: 'outbound_only', icon: '📤', label: 'OUTBOUND ACTIVE', accentClass: 'is-outbound', countKey: 'outbound_only' },
  { preset: 'missing_context', icon: '🧊', label: 'COLD / NO RESPONSE', accentClass: 'is-cold', countKey: 'missing_context' },
  { preset: 'suppressed', icon: '🚫', label: 'DNC / OPT OUT', accentClass: 'is-dnc', countKey: 'suppressed' },
]

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

const getInitials = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '+('

const resolvePropertyTypeBadge = (thread: InboxWorkflowThread) => {
  const propertyType = readString(thread, 'propertyType', 'property_type', 'assetType', 'asset_type')
  if (!propertyType) return null
  return propertyType.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

const resolveStageBadge = (thread: InboxWorkflowThread) => {
  const raw = readString(thread, 'conversationStage', 'conversation_stage') || thread.conversationStage || thread.inboxStatus
  if (!raw) return 'Not enriched'
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

interface ConversationRowProps {
  thread: InboxWorkflowThread
  selected: boolean
  queuePreset: QueuePreset
  onSelect: (id: string) => void
}

const ConversationRow = memo(({ thread, selected, queuePreset, onSelect }: ConversationRowProps) => {
  const name = resolveThreadPrimaryName(thread) || thread.phoneNumber || thread.canonicalE164 || 'Unknown contact'
  const address = resolveThreadAddressLine(thread) || 'No linked property'
  const preview = readString(thread, 'latestMessageBody', 'lastMessageBody', 'preview') || 'No recent message'
  const market = resolveThreadMarketBadge(thread)
  const propertyType = resolvePropertyTypeBadge(thread)
  const ownerType = readString(thread, 'ownerType', 'owner_type')
  const score = readNumber(thread, 'finalAcquisitionScore', 'final_score', 'priorityScore', 'aiScore', 'motivationScore')
  const stage = resolveStageBadge(thread)
  const time = thread.lastMessageAt || thread.lastMessageIso || thread.updatedAt
  const avatarToneClass = queuePreset === 'suppressed' ? 'is-dnc' : queuePreset === 'positive_hot' ? 'is-hot' : 'is-default'
  const previewText = preview.replace(/\s+/g, ' ').trim()
  const badges = [
    queuePreset === 'positive_hot' ? 'HI EQUITY' : null,
    propertyType?.toUpperCase(),
    ownerType && /(llc|corp|corporate|company)/i.test(ownerType) ? 'CORPORATE' : null,
    market?.toUpperCase(),
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
          <div className="nx-thread-card__address">{address || 'No linked property'}</div>
          <span className="nx-thread-card__action">{stage}</span>
        </div>
        <div className="nx-thread-card__preview">{previewText}</div>
        <div className="nx-thread-card__chips">
          {badges.map((badge) => (
            <span
              key={badge}
              className={cls(
                'nx-thread-chip',
                badge === 'HI EQUITY' && 'is-equity',
                badge === 'CORPORATE' && 'is-corporate',
              )}
            >
              {badge}
            </span>
          ))}
        </div>
      </div>
    </button>
  )
})

ConversationRow.displayName = 'ConversationRow'

export const InboxSidebar = ({
  threads,
  selectedId,
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
  const expandedQueue = QUEUE_PRESETS.includes(savedPreset as QueuePreset) ? savedPreset as QueuePreset : null
  const visibleThreads = useMemo(
    () => threads
      .slice(0, visibleThreadCount)
      .filter((thread) => !recentlyUpdatedThreadIds.has(`hidden:${thread.id}`)),
    [threads, visibleThreadCount, recentlyUpdatedThreadIds],
  )

  const totalCount = viewCounts.review_required ?? viewCounts.all ?? threads.length

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
          <span className="nx-inbox-badge is-hot">🔥 {formatCount(numberOrNull(viewCounts.positive_hot) ?? 0)}</span>
          <span className="nx-inbox-badge is-review">⚠️ {formatCount(numberOrNull(viewCounts.manual_review) ?? 0)}</span>
          <span className="nx-inbox-badge is-new">📨 {formatCount(numberOrNull(viewCounts.needs_reply) ?? 0)}</span>
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
          const count = viewCounts[group.countKey] ?? 0
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
                  {visibleThreads.length > 0 ? (
                    visibleThreads.map((thread) => (
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
