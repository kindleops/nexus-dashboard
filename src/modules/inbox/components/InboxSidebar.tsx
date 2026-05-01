import { memo } from 'react'
import type { InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import { Icon } from '../../../shared/icons'
import { formatRelativeTime } from '../../../shared/formatters'
import {
  type InboxSavedFilterPreset,
  type InboxViewSelectValue,
  savedFilterOptions,
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
}

export const ConversationRow = memo(({ thread, selected, onSelect }: ConversationRowProps) => {
  const row = thread as unknown as Record<string, unknown>
  const ownerName = fallback(row.ownerDisplayName ?? thread.ownerName ?? thread.phoneNumber, 'Unknown Seller')
  const propertyAddress = fallback(row.propertyAddressFull ?? thread.propertyAddress, '')
  const latestMessageBody = fallback(row.latestMessageBody ?? thread.lastMessageBody ?? thread.preview, '')
  const { uiIntent } = readClassifier(thread)
  const isSuppressed = thread.isOptOut || thread.inboxStatus === 'suppressed' || readClassifier(thread).priorityBucket === 'suppressed'
  const visual = getStatusVisual(thread.inboxStage, isSuppressed)
  const market = marketLabel(thread)

  return (
    <button
      type="button"
      className={cls(
        'nx-conversation-row',
        selected && 'is-selected',
        `intent-${uiIntent || 'default'}`,
      )}
      onClick={() => onSelect(thread.id)}
      style={statusStyleVars(visual)}
    >
      <span className="nx-conversation-main">
        {/* Row 1: Name & Time */}
        <span className="nx-conversation-row__top">
          <strong>{ownerName}</strong>
          <div className="nx-row-end-actions">
            <time>{formatRelativeTime(thread.lastMessageAt || thread.lastMessageIso)}</time>
            <i className="nx-priority-dot" style={{ background: visual.dot, boxShadow: `0 0 10px ${visual.pulse}` }} />
          </div>
        </span>

        {/* Row 2: Address */}
        {propertyAddress && (
          <span className="nx-conversation-row__sub-row">
            <span className="nx-conversation-row__address">{propertyAddress}</span>
          </span>
        )}

        {/* Row 3: Preview */}
        {latestMessageBody && (
          <span className="nx-conversation-row__preview">{latestMessageBody}</span>
        )}

        {/* Row 4: Meta */}
        <div className="nx-conversation-row__footer">
          <span className="nx-conversation-row__meta">
            {market && (
              <span className="nx-market-tag">{market}</span>
            )}
            <span className="nx-stage-pill nx-status-pill" style={{ '--pill-color': visual.color, '--pill-bg': visual.bg, '--pill-border': visual.border } as Record<string, string>}>
              <i className="nx-status-dot" style={{ background: visual.dot }} />
              {visual.label}
            </span>
          </span>
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
}: {
  threads: InboxWorkflowThread[]
  activeViewFilter: InboxViewSelectValue
  selectedId: string | null
  onSelect: (id: string) => void
}) => (
  <div className="nx-conversation-list">
    {threads.length > 0 ? (
      threads.map((thread) => (
        <ConversationRow
          key={thread.threadKey || thread.id}
          thread={thread}
          selected={selectedId === thread.id}
          onSelect={onSelect}
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
}: InboxSidebarProps) => {
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
            <span className="nx-priority-command-card__title">
              {savedFilterOptions.find(o => o.value === savedPreset)?.label || 'Smart'} Inbox
            </span>
            <p className="nx-priority-command-card__sub">
              {savedPreset === 'my_priority' 
                ? 'Actionable signals & urgent replies' 
                : `Active filter: ${savedFilterOptions.find(o => o.value === savedPreset)?.label || 'Custom'}`}
            </p>
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
      </div>

      <ConversationList
        threads={threads.slice(0, visibleThreadCount)}
        activeViewFilter={activeViewFilter}
        selectedId={selectedId}
        onSelect={onSelect}
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
