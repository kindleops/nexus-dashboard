import { memo } from 'react'
import type { InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import { Icon } from '../../../shared/icons'
import { formatRelativeTime } from '../../../shared/formatters'
import {
  resolveThreadAddressLine,
  resolveThreadMarketBadge,
  resolveThreadPrimaryName,
  getThreadMatchedKeywords,
  type InboxSavedFilterPreset,
  type InboxViewSelectValue,
  savedFilterOptions,
} from '../inbox-ui-helpers'
import { getStatusVisual, getSellerStageVisual, statusStyleVars } from '../status-visuals'

const cls = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

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
}

const fallback = (value: unknown, placeholder = '') => {
  const text = String(value ?? '').trim()
  return text || placeholder
}

const readClassifier = (thread: InboxWorkflowThread) => {
  const row = thread as unknown as Record<string, unknown>
  const uiIntent = String(row.uiIntent ?? row.ui_intent ?? '').trim().toLowerCase()
  const priorityBucket = String(row.priorityBucket ?? row.priority_bucket ?? '').trim().toLowerCase()
  return { uiIntent, priorityBucket }
}

const primaryPresetOptions = savedFilterOptions.filter((option) => (
  option.value === 'my_priority' ||
  option.value === 'new_inbounds' ||
  option.value === 'offer_needed' ||
  option.value === 'review_required'
))

const secondaryPresetOptions = savedFilterOptions.filter((option) => (
  !primaryPresetOptions.some((primary) => primary.value === option.value)
))


const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const highlightText = (text: string, terms: string[]) => {
  const cleanTerms = terms.map((term) => term.trim()).filter((term) => term.length > 1).slice(0, 8)
  if (cleanTerms.length === 0) return text
  const re = new RegExp(`(${cleanTerms.map(escapeRegExp).join('|')})`, 'ig')
  return text.split(re).map((part, index) => (
    cleanTerms.some((term) => term.toLowerCase() === part.toLowerCase())
      ? <mark key={`${part}-${index}`} className="nx-keyword-highlight">{part}</mark>
      : part
  ))
}
const compactBadgesForThread = (thread: InboxWorkflowThread): string[] => {
  const row = thread as unknown as Record<string, unknown>
  const latestDirection = String(row.latestDirection ?? row.lastDirection ?? row.directionUsed ?? '').toLowerCase()
  const autoStatus = String(row.autoReplyStatus ?? row.auto_reply_status ?? row.queueStatus ?? '').toLowerCase()
  const badges: string[] = []
  if (thread.needsResponse || row.needsReply || latestDirection === 'inbound') badges.push('Needs Reply')
  if (thread.sentiment === 'hot') badges.push('Positive')
  if (['queued', 'sent', 'delivered'].some((status) => autoStatus.includes(status))) badges.push('Auto-Replied')
  if (['failed', 'blocked', 'error'].some((status) => autoStatus.includes(status))) badges.push('Failed/Blocked')
  return Array.from(new Set(badges)).slice(0, 4)
}

interface ConversationRowProps {
  thread: InboxWorkflowThread
  selected: boolean
  isStarred: boolean
  isRecentlyUpdated?: boolean
  onSelect: (id: string) => void
  onAction?: (id: string, action: 'star' | 'unstar' | 'pin' | 'unpin' | 'archive' | 'hide') => void
  searchQuery?: string
}

export const ConversationRow = memo(({ 
  thread, 
  selected, 
  isStarred, 
  isRecentlyUpdated,
  onSelect, 
  onAction,
  searchQuery = '',
}: ConversationRowProps) => {
  const ownerName = resolveThreadPrimaryName(thread)
  const propertyAddress = resolveThreadAddressLine(thread)
  const contextStatus = propertyAddress.toLowerCase().includes('no address') ? 'Context loading' : ''
  const latestMessageBody = fallback(thread.lastMessageBody || thread.preview, '')
  const phone = fallback(thread.phoneNumber || thread.canonicalE164 || (thread as any).sellerPhone, 'Phone unavailable')
  const latestDirection = fallback((thread as any).latestDirection || thread.lastDirection || (thread as any).directionUsed, 'unknown')
  const compactBadges = compactBadgesForThread(thread)
  const matchedKeywords = getThreadMatchedKeywords(thread, searchQuery)
  const { uiIntent } = readClassifier(thread)
  const visual = getStatusVisual(thread.inboxStatus)
  const stageVisual = getSellerStageVisual(thread.conversationStage)
  const market = resolveThreadMarketBadge(thread)

  const handleAction = (e: React.MouseEvent, action: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (onAction) {
      console.log(`[NexusInboxActionNoRefresh]`, {
        action,
        thread_id: thread.id.slice(-8),
        optimistic: true,
        preventedDefault: true,
        stoppedPropagation: true
      })
      onAction(thread.id, action as any)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={cls(
        'nx-conversation-row',
        selected && 'is-selected',
        isRecentlyUpdated && 'is-updated',
        `intent-${uiIntent || 'default'}`,
      )}
      onClick={() => onSelect(thread.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(thread.id)
        }
      }}
      style={statusStyleVars(visual)}
    >
      <div className="nx-conversation-row__content">
        {/* Row 1: Name & Time */}
        <div className="nx-conversation-row__top">
          <strong className="nx-conversation-row__name">{ownerName}</strong><span className="nx-conversation-row__phone">{phone}</span>
          <div className="nx-row-end-actions">
            {thread.isPinned && <Icon name="pin" className="nx-pinned-icon" />}
            {thread.isStarred && <Icon name="star" className="nx-starred-icon" />}
            <time className="nx-conversation-row__time">{formatRelativeTime(thread.lastMessageAt || thread.lastMessageIso)}</time>
            <i className="nx-priority-dot" style={{ background: visual.dot, boxShadow: `0 0 10px ${visual.pulse}` }} />
          </div>
        </div>

        {/* Row 2: Address */}
        <div className="nx-conversation-row__sub-row">
          <span className="nx-conversation-row__address">{propertyAddress}</span>{contextStatus && <span className="nx-keyword-badge">{contextStatus}</span>}
        </div>

        {/* Row 3: Preview */}
        <div className="nx-conversation-row__preview"><span className="nx-direction-chip">{latestDirection}</span>{highlightText(latestMessageBody, matchedKeywords.length ? matchedKeywords : [searchQuery])}</div>

        {/* Row 4: Footer (Badges + Hover Actions) */}
        <div className="nx-conversation-row__footer">
          <div className="nx-conversation-row__meta">
            {compactBadges.map((badge) => <span key={badge} className="nx-stage-pill nx-status-pill">{badge}</span>)}
            {matchedKeywords.slice(0, 3).map((keyword) => <span key={keyword} className="nx-keyword-badge">{keyword}</span>)}
            <span className="nx-stage-pill nx-status-pill" style={{ color: visual.color, background: visual.bg, borderColor: visual.border }}>
              <i className="nx-status-dot" style={{ background: visual.dot }} />
              {visual.label}
            </span>
            <span className="nx-stage-pill nx-conv-stage-pill" style={{ color: stageVisual.color, background: stageVisual.bg, borderColor: stageVisual.border }}>
              {stageVisual.label}
            </span>
            <span className="nx-market-tag">{market}</span>
          </div>
          
          <div className="nx-conversation-row__hover-actions">
             <button 
               type="button" 
               title={isStarred ? "Unstar" : "Star"} 
               className={cls("nx-hover-action-btn", isStarred && "is-active")}
               onClick={(e) => handleAction(e, isStarred ? 'unstar' : 'star')}
             >
               <Icon name="star" />
             </button>
             <button 
               type="button" 
               title={thread.isPinned ? "Unpin" : "Pin"} 
               className={cls("nx-hover-action-btn", thread.isPinned && "is-active")}
               onClick={(e) => handleAction(e, thread.isPinned ? 'unpin' : 'pin')}
             >
               <Icon name="pin" />
             </button>
             <button 
               type="button" 
               title="Archive" 
               className="nx-hover-action-btn"
               onClick={(e) => handleAction(e, 'archive')}
             >
               <Icon name="archive" />
             </button>
          </div>
        </div>
      </div>
    </div>
  )
})

ConversationRow.displayName = 'ConversationRow'

export const ConversationList = ({
  threads,
  activeViewFilter,
  selectedId,
  onSelect,
  onAction,
  recentlyUpdatedThreadIds = new Set(),
  searchQuery = '',
}: {
  threads: InboxWorkflowThread[]
  activeViewFilter: InboxViewSelectValue
  selectedId: string | null
  onSelect: (id: string) => void
  onAction?: (id: string, action: 'star' | 'unstar' | 'pin' | 'unpin' | 'archive' | 'hide') => void
  recentlyUpdatedThreadIds?: Set<string>
  searchQuery?: string
}) => (
  <div className="nx-conversation-list">
    {threads.length > 0 ? (
      threads.map((thread) => (
        <ConversationRow
          key={thread.threadKey || thread.id}
          thread={thread}
          selected={selectedId === thread.id}
          isStarred={thread.isStarred}
          isRecentlyUpdated={recentlyUpdatedThreadIds.has(thread.id) || recentlyUpdatedThreadIds.has(thread.threadKey || '')}
          onSelect={onSelect}
          onAction={onAction}
          searchQuery={searchQuery}
        />
      ))
    ) : (
      <div className="nx-sidebar-empty">
        {activeViewFilter === 'priority'
          ? 'No priority replies right now.'
          : 'No conversations match these filters.'}
      </div>
    )}
  </div>
)

export const InboxSidebar = ({
  threads,
  activeViewFilter,
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
  onThreadAction,
  recentlyUpdatedThreadIds = new Set(),
  searchQuery = '',
}: InboxSidebarProps) => {
  const activePresetConfig = savedFilterOptions.find(o => o.value === savedPreset)
  const activeLabel = activePresetConfig?.label || 'Smart'
  const rawActiveCount = viewCounts[activeViewFilter]
  const activeCount = rawActiveCount === null || rawActiveCount === undefined ? null : rawActiveCount
  const formatCount = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '—'
    return String(value)
  }

  return (
    <aside className="nx-sidebar">
      <div className="nx-sidebar__top">
        <div className="nx-sidebar__label-row">
          <span className="nx-section-label">{activeLabel.toUpperCase()} INBOX</span>
          <button 
            type="button" 
            className="nx-sidebar__icon-button" 
            title="Inbox settings"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <Icon name="settings" />
          </button>
        </div>

        <section className={cls('nx-priority-command-card', `is-mode-${activeViewFilter}`)}>
          <div className="nx-priority-command-card__liquid-bg" />
          <div className="nx-priority-command-card__left">
            <span className="nx-priority-command-card__title">
              {activeLabel} Inbox
            </span>
            <p className="nx-priority-command-card__sub">
              {savedPreset === 'my_priority' 
                ? 'Actionable signals & urgent replies' 
                : `Viewing ${activeLabel.toLowerCase()} threads and signals`}
            </p>
          </div>
          <strong className="nx-priority-command-card__count">{formatCount(activeCount)}</strong>
        </section>

        <div className="nx-sidebar__saved-filters">
          <span className="nx-sidebar__saved-label">Mode</span>
          <div className="nx-sidebar__saved-scroll">
            <div className="nx-mode-tabs">
              {primaryPresetOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cls('nx-mode-tab', savedPreset === option.value && 'is-active')}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onApplySavedPreset(option.value as InboxSavedFilterPreset)
                  }}
                >
                  <span className="nx-mode-tab__label">{option.label}</span>
                  <span className="nx-mode-tab__count">{formatCount(viewCounts[option.value])}</span>
                </button>
              ))}
            </div>
          </div>
          <select
              className="nx-filter-more-select"
              value={secondaryPresetOptions.some((option) => option.value === savedPreset) ? savedPreset : ''}
              onChange={(event) => event.target.value && onApplySavedPreset(event.target.value as InboxSavedFilterPreset)}
              aria-label="More inbox modes"
            >
              <option value="">More</option>
              {secondaryPresetOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
        </div>
      </div>

      <div className="nx-sidebar__advanced-wrap">
        <button
          type="button"
          className="nx-sidebar__filter-button"
          onClick={onOpenAdvancedFilters}
        >
          <Icon name="filter" />
          Advanced Filters
          <Icon name="chevron-right" />
        </button>
        {onClearFilters && (
          <button
            type="button"
            className="nx-sidebar__clear-btn"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onClearFilters()
            }}
            title="Clear all filters"
          >
            Clear
          </button>
        )}
      </div>

      {loadingError && (
        <div className="nx-sidebar-error">
          <Icon name="alert" />
          <span>{loadingError}</span>
        </div>
      )}

      <ConversationList
        threads={threads.slice(0, visibleThreadCount)}
        activeViewFilter={activeViewFilter}
        selectedId={selectedId}
        onSelect={onSelect}
        onAction={onThreadAction}
        recentlyUpdatedThreadIds={recentlyUpdatedThreadIds}
        searchQuery={searchQuery}
      />

      {canLoadMore && (
        <div className="nx-sidebar__load-more">
          <button type="button" className="nx-filter-pill nx-load-more-btn" onClick={onLoadMore}>
            Load More
          </button>
        </div>
      )}

    </aside>
  )
}
