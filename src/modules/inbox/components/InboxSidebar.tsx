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

const fallback = (value: unknown, placeholder = '') => {
  const text = String(value ?? '').trim()
  return text || placeholder
}

const marketLabel = (thread: InboxWorkflowThread) =>
  fallback(thread.market || thread.marketId, '')

const readClassifier = (thread: InboxWorkflowThread) => {
  const row = thread as unknown as Record<string, unknown>
  const uiIntent = String(row.uiIntent ?? row.ui_intent ?? '').trim().toLowerCase()
  const priorityBucket = String(row.priorityBucket ?? row.priority_bucket ?? '').trim().toLowerCase()
  const stage = String(row.workflowStage ?? row.stage ?? thread.inboxStage).trim().toLowerCase() || 'needs_response'
  return { uiIntent, priorityBucket, stage }
}

// Only show a deal metric chip if the value is a real number/currency, not unknown
const formatCurrencyIfReal = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '' || value === 'Unknown') return null
  const numeric = Number(String(value).replace(/[,$\s]/g, ''))
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return `$${Math.round(numeric).toLocaleString()}`
}

const formatScoreIfReal = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '' || value === 'Unknown') return null
  const numeric = Number(String(value))
  if (!Number.isFinite(numeric)) return null
  return String(Math.round(numeric))
}

// Check if intent is meaningfully different from stage (avoids duplication)
const isIntentMeaningfullyDifferent = (uiIntent: string, stage: string): boolean => {
  if (!uiIntent) return false
  const normalized = uiIntent.replace(/_/g, '')
  const stageNorm = stage.replace(/_/g, '')
  return normalized !== stageNorm && uiIntent !== 'needs_review' && uiIntent !== 'outbound_waiting'
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
  const phoneNumber = fallback(thread.phoneNumber || thread.canonicalE164, '')
  const propertyAddress = fallback(row.propertyAddressFull ?? thread.propertyAddress, '')
  const latestMessageBody = fallback(row.latestMessageBody ?? thread.lastMessageBody ?? thread.preview, '')
  const { uiIntent, priorityBucket, stage } = readClassifier(thread)
  const isSuppressed = thread.isOptOut || thread.inboxStatus === 'suppressed' || priorityBucket === 'suppressed'
  const visual = getStatusVisual(thread.inboxStage, isSuppressed)

  // Deal metrics — only show if real values exist
  const cashOffer = formatCurrencyIfReal(row.cashOffer ?? row['cash_offer'])
  const estimatedValue = formatCurrencyIfReal(row.estimatedValue ?? row['estimated_value'])
  const acquisitionScore = formatScoreIfReal(row.finalAcquisitionScore ?? row['final_acquisition_score'])

  const hasDealMetrics = cashOffer || estimatedValue || acquisitionScore
  const showIntentChip = isIntentMeaningfullyDifferent(uiIntent, stage)
  const market = marketLabel(thread)
  const initial = ownerName.slice(0, 1).toUpperCase()
  const tone = priorityTone(thread)

  return (
    <button
      type="button"
      className={cls(
        'nx-conversation-row',
        selected && 'is-selected',
        `intent-${uiIntent || 'default'}`,
        priorityBucket && `bucket-${priorityBucket}`,
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
        {/* Row 1: Name, Time, Star, Dot */}
        <span className="nx-conversation-row__top">
          <strong>{ownerName}</strong>
          <div className="nx-row-end-actions">
            <time>{formatRelativeTime(thread.lastMessageAt || thread.lastMessageIso)}</time>
            <span className="nx-conversation-row__star" onClick={(event) => { event.stopPropagation(); onToggleStar(thread.id) }}>
              <Icon name="star" className={cls(isStarred && 'is-active')} />
            </span>
            <i className="nx-priority-dot" style={{ background: visual.dot, boxShadow: `0 0 10px ${visual.pulse}` }} />
          </div>
        </span>

        {/* Row 2: Phone & Address */}
        {(phoneNumber || propertyAddress) && (
          <span className="nx-conversation-row__sub-row">
            {phoneNumber && <span className="nx-conversation-row__phone">{phoneNumber}</span>}
            {propertyAddress && <span className="nx-conversation-row__address">{propertyAddress}</span>}
          </span>
        )}

        {/* Row 3: Preview */}
        {latestMessageBody && (
          <span className="nx-conversation-row__preview">{latestMessageBody}</span>
        )}

        {/* Row 4: Meta & Metrics */}
        <div className="nx-conversation-row__footer">
          <span className="nx-conversation-row__meta">
            {market && (
              <span className="nx-market-tag">{market}</span>
            )}
            <span className="nx-stage-pill nx-status-pill" style={{ '--pill-color': visual.color, '--pill-bg': visual.bg, '--pill-border': visual.border } as Record<string, string>}>
              <i className="nx-status-dot" style={{ background: visual.dot }} />
              {visual.label}
            </span>
            {showIntentChip && (
              <span className="nx-stage-pill nx-intent-pill">{uiIntent.replaceAll('_', ' ')}</span>
            )}
          </span>
          {hasDealMetrics && (
            <span className="nx-conversation-row__deal-metrics">
              {cashOffer && <span className="nx-deal-chip nx-deal-chip--offer">Offer {cashOffer}</span>}
              {estimatedValue && <span className="nx-deal-chip nx-deal-chip--value">Value {estimatedValue}</span>}
              {acquisitionScore && <span className="nx-deal-chip nx-deal-chip--score">Score {acquisitionScore}</span>}
            </span>
          )}
        </div>
      </span>
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
  const priorityCount = viewCounts.priority ?? 0

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
          <div className="nx-priority-command-card__left">
            <span className="nx-priority-command-card__title">Smart Inbox</span>
            <p className="nx-priority-command-card__sub">Actionable signals &amp; urgent replies</p>
          </div>
          <strong className="nx-priority-command-card__count">{priorityCount}</strong>
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
          <button type="button" className="nx-filter-pill nx-load-more-btn" onClick={onLoadMore}>
            Load More
          </button>
        </div>
      )}

    </aside>
  )
}
