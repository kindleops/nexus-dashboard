import { memo } from 'react'
import type { InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import { Icon } from '../../../shared/icons'
import { formatRelativeTime } from '../../../shared/formatters'
import {
  type InboxSavedFilterPreset,
  type InboxStageSelectValue,
  type InboxViewSelectValue,
  savedFilterOptions,
  stageOptions,
} from '../inbox-ui-helpers'
import { getStatusVisual, statusStyleVars } from '../status-visuals'

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
  viewCounts: Record<InboxViewSelectValue, number>
  onOpenAdvancedFilters: () => void
  loadingError: string | null
  visibleThreadCount: number
  canLoadMore: boolean
  onLoadMore: () => void
  selectedThreadIds: string[]
  onToggleThreadSelection: (id: string) => void
  onSelectAllVisible: () => void
  onBulkReplyAll: () => void
  onBulkStageChange: (stage: InboxStageSelectValue) => void
  onBulkStatusChange: (status: 'open' | 'read' | 'unread' | 'archived' | 'suppressed') => void
  onBulkArchiveToggle: () => void
  onBulkPinToggle: () => void
  onBulkStarToggle: () => void
  starredThreadIds: string[]
  onToggleStarThread: (id: string) => void
}

const fallback = (value: unknown, placeholder = 'Unknown') => {
  const text = String(value ?? '').trim()
  return text || placeholder
}

const marketLabel = (thread: InboxWorkflowThread) =>
  fallback(thread.market || thread.marketId, 'Market Unknown')

const readClassifier = (thread: InboxWorkflowThread) => {
  const row = thread as unknown as Record<string, unknown>
  const uiIntent = String(row.uiIntent ?? row.ui_intent ?? '').trim().toLowerCase() || 'needs_review'
  const priorityBucket = String(row.priorityBucket ?? row.priority_bucket ?? '').trim().toLowerCase() || 'priority'
  const status = String(row.workflowStatus ?? row.status ?? '').trim().toLowerCase() || 'open'
  const stage = String(row.workflowStage ?? row.stage ?? thread.inboxStage).trim().toLowerCase() || 'needs_response'
  return { uiIntent, priorityBucket, status, stage }
}

const formatCurrency = (value: unknown, fallbackValue = 'Unknown') => {
  if (value === null || value === undefined || value === '') return fallbackValue
  const numeric = Number(String(value).replace(/[,$\s]/g, ''))
  if (!Number.isFinite(numeric)) return String(value)
  return `$${Math.round(numeric).toLocaleString()}`
}

const priorityTone = (thread: InboxWorkflowThread) => {
  if (thread.isOptOut || thread.inboxStatus === 'suppressed') return 'suppressed'
  if (thread.priority === 'urgent' || thread.inboxStage === 'needs_response') return 'urgent'
  if (thread.priority === 'high') return 'high'
  if (thread.inboxStage === 'interested' || thread.inboxStage === 'needs_offer') return 'qualified'
  return 'normal'
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

interface ConversationRowProps {
  thread: InboxWorkflowThread
  selected: boolean
  onSelect: (id: string) => void
  isChecked: boolean
  isStarred: boolean
  onToggleCheck: (id: string) => void
  onToggleStar: (id: string) => void
}

export const ConversationRow = memo(({ thread, selected, onSelect, isChecked, isStarred, onToggleCheck, onToggleStar }: ConversationRowProps) => {
  const row = thread as unknown as Record<string, unknown>
  const ownerName = fallback(row.ownerDisplayName ?? thread.ownerName ?? thread.phoneNumber, 'Unknown Seller')
  const propertyAddress = fallback(row.propertyAddressFull ?? thread.propertyAddress ?? thread.subject, 'Property Unknown')
  const latestMessageBody = fallback(row.latestMessageBody ?? thread.lastMessageBody ?? thread.preview, 'No preview')
  const { uiIntent, priorityBucket, status, stage } = readClassifier(thread)
  const cashOffer = formatCurrency(row.cashOffer)
  const estimatedValue = formatCurrency(row.estimatedValue)
  const acquisitionScore = row.finalAcquisitionScore == null || row.finalAcquisitionScore === ''
    ? 'Unknown'
    : String(row.finalAcquisitionScore)
  const initial = ownerName.slice(0, 1).toUpperCase()
  const tone = priorityTone(thread)
  const visual = getStatusVisual(thread.inboxStage, thread.isOptOut || thread.inboxStatus === 'suppressed' || priorityBucket === 'suppressed')

  return (
    <button
      type="button"
      className={cls(
        'nx-conversation-row',
        selected && 'is-selected',
        `intent-${uiIntent}`,
        `bucket-${priorityBucket}`,
      )}
      onClick={() => onSelect(thread.id)}
      style={statusStyleVars(visual)}
    >
      <span className="nx-conversation-row__select" onClick={(event) => { event.stopPropagation(); onToggleCheck(thread.id) }}>
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggleCheck(thread.id)}
          aria-label="Select thread"
        />
      </span>
      <span className={cls('nx-conversation-avatar', `is-${tone}`)}>{initial}</span>
      <span className="nx-conversation-main">
        <span className="nx-conversation-row__top">
          <strong>{ownerName}</strong>
          <time>{formatRelativeTime(thread.lastMessageAt || thread.lastMessageIso)}</time>
        </span>
        <span className="nx-conversation-row__phone">{fallback(thread.phoneNumber || thread.canonicalE164, 'No phone')}</span>
        <span className="nx-conversation-row__address">{propertyAddress}</span>
        <span className="nx-conversation-row__preview">{latestMessageBody}</span>
        <span className="nx-conversation-row__meta">
          <span className="nx-market-tag">{marketLabel(thread)}</span>
          <span className="nx-stage-pill nx-status-pill">
            <i className="nx-status-dot" />
            {visual.label}
          </span>
          <span className="nx-stage-pill">{uiIntent.replaceAll('_', ' ')}</span>
          <span className="nx-stage-pill">{priorityBucket}</span>
          <span className="nx-stage-pill">{status}</span>
          <span className="nx-stage-pill">{stage}</span>
        </span>
        <span className="nx-conversation-row__meta nx-conversation-row__deal-metrics">
          <span className="nx-stage-pill">Offer {cashOffer}</span>
          <span className="nx-stage-pill">Value {estimatedValue}</span>
          <span className="nx-stage-pill">Score {acquisitionScore}</span>
        </span>
      </span>
      <span className="nx-conversation-row__star" onClick={(event) => { event.stopPropagation(); onToggleStar(thread.id) }}>
        <Icon name="star" className={cls(isStarred && 'is-active')} />
      </span>
      <span className={cls('nx-priority-dot nx-status-dot', `intent-${uiIntent}`, `bucket-${priorityBucket}`)} />
    </button>
  )
})

ConversationRow.displayName = 'ConversationRow'

export const ConversationList = ({
  threads,
  activeViewFilter,
  selectedId,
  onSelect,
  selectedThreadIds,
  onToggleThreadSelection,
  starredThreadIds,
  onToggleStarThread,
}: {
  threads: InboxWorkflowThread[]
  activeViewFilter: InboxViewSelectValue
  selectedId: string | null
  onSelect: (id: string) => void
  selectedThreadIds: string[]
  onToggleThreadSelection: (id: string) => void
  starredThreadIds: string[]
  onToggleStarThread: (id: string) => void
}) => (
  <div className="nx-conversation-list">
    {threads.length > 0 ? (
      threads.map((thread) => (
        <ConversationRow
          key={thread.threadKey || thread.id}
          thread={thread}
          selected={thread.id === selectedId}
          onSelect={onSelect}
          isChecked={selectedThreadIds.includes(thread.id)}
          isStarred={starredThreadIds.includes(thread.id)}
          onToggleCheck={onToggleThreadSelection}
          onToggleStar={onToggleStarThread}
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
  loadingError,
  visibleThreadCount,
  canLoadMore,
  onLoadMore,
  selectedThreadIds,
  onToggleThreadSelection,
  onSelectAllVisible,
  onBulkReplyAll,
  onBulkStageChange,
  onBulkStatusChange,
  onBulkArchiveToggle,
  onBulkPinToggle,
  onBulkStarToggle,
  starredThreadIds,
  onToggleStarThread,
}: InboxSidebarProps) => {
  const selectedCount = selectedThreadIds.length

  return (
    <aside className="nx-sidebar">
      <div className="nx-sidebar__top">
        <div className="nx-sidebar__label-row">
          <span className="nx-section-label">PRIORITY INBOX</span>
          <button type="button" className="nx-sidebar__icon-button" title="Inbox settings">
            <Icon name="settings" />
          </button>
        </div>

        <section className="nx-priority-command-card">
          <span>Smart Inbox</span>
          <strong>{viewCounts.priority ?? 0}</strong>
          <p>Actionable buying signals, replies, offer intent, and urgent follow-ups.</p>
        </section>

        <div className="nx-sidebar__saved-filters">
          <span className="nx-sidebar__saved-label">Mode</span>
          <div className="nx-sidebar__saved-scroll">
            {primaryPresetOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cls('nx-filter-pill', savedPreset === option.value && 'is-active')}
                onClick={() => onApplySavedPreset(option.value)}
              >
                {option.label}
              </button>
            ))}
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
        </div>

        {loadingError && (
          <div className="nx-sidebar-error">
            <Icon name="alert" />
            <span>{loadingError}</span>
          </div>
        )}

        {selectedCount > 0 && (
        <div className="nx-bulk-toolbar">
          <button type="button" className="nx-filter-pill" onClick={onSelectAllVisible}>
            Select visible ({visibleThreadCount})
          </button>
          <span>{selectedCount} selected</span>
          <button type="button" className="nx-filter-pill" disabled={selectedCount === 0} onClick={onBulkReplyAll}>
            Reply all
          </button>
          <button type="button" className="nx-filter-pill" disabled={selectedCount === 0} onClick={onBulkArchiveToggle}>
            Archive
          </button>
          <button type="button" className="nx-filter-pill" disabled={selectedCount === 0} onClick={onBulkPinToggle}>
            Pin
          </button>
          <button type="button" className="nx-filter-pill" disabled={selectedCount === 0} onClick={onBulkStarToggle}>
            Star
          </button>
          <label>
            <span>Stage</span>
            <select disabled={selectedCount === 0} onChange={(event) => onBulkStageChange(event.target.value as InboxStageSelectValue)}>
              <option value="">Set stage</option>
              {stageOptions.map((option) => (
                <option key={`bulk-stage-${option.value}`} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select
              disabled={selectedCount === 0}
              onChange={(event) => onBulkStatusChange(event.target.value as 'open' | 'read' | 'unread' | 'archived' | 'suppressed')}
            >
              <option value="">Set status</option>
              <option value="open">Open</option>
              <option value="read">Read</option>
              <option value="unread">Unread</option>
              <option value="archived">Archived</option>
              <option value="suppressed">Suppressed</option>
            </select>
          </label>
        </div>
        )}
      </div>

      <ConversationList
        threads={threads.slice(0, visibleThreadCount)}
        activeViewFilter={activeViewFilter}
        selectedId={selectedId}
        onSelect={onSelect}
        selectedThreadIds={selectedThreadIds}
        onToggleThreadSelection={onToggleThreadSelection}
        starredThreadIds={starredThreadIds}
        onToggleStarThread={onToggleStarThread}
      />

      {canLoadMore && (
        <div className="nx-sidebar__load-more">
          <button type="button" className="nx-filter-pill" onClick={onLoadMore}>
            Load 250 More
          </button>
        </div>
      )}

    </aside>
  )
}
