import { useState } from 'react'
import type { QueueProcessorHealth } from '../../../lib/data/inboxData'
import type { InboxStage, InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import { Icon } from '../../../shared/icons'
import { formatRelativeTime } from '../../../shared/formatters'
import type { ActiveOverlay, NexusTheme } from '../inbox-layout-state'
import { getStatusVisual, inboxStatusOptions, statusStyleVars } from '../status-visuals'
import { buildInboxNotifications, NexusNotificationCenter, type NexusNotification } from './NexusNotificationCenter'

const cls = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

interface NexusTopBarProps {
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  searchResults: InboxWorkflowThread[]
  onSelectSearchResult: (id: string) => void
  selectedThread: InboxWorkflowThread | null
  isSuppressed: boolean
  onStageChange: (stage: InboxStage) => void
  statusCounts: Partial<Record<InboxStage, number>>
  notificationCount: number
  queueProcessorHealth: QueueProcessorHealth | null
  queueProcessorHealthLoading: boolean
  theme: NexusTheme
  onToggleTheme: () => void
  activeOverlay: ActiveOverlay
  onOpenOverlay: (overlay: ActiveOverlay) => void
  onCloseOverlay: () => void
  onOpenMap: () => void
  onOpenDossier: () => void
  onOpenAi: () => void
  onOpenKeys: () => void
  onOpenKpis: () => void
  onOpenActivity: () => void
  onResetLayout: () => void
}

const stageLabel = (thread: InboxWorkflowThread | null, isSuppressed: boolean) => {
  if (!thread) return 'No Thread'
  if (isSuppressed) return 'Suppressed'
  return getStatusVisual(thread.inboxStage).label
}

const fallback = (value: unknown, placeholder = 'Unknown') => {
  const text = String(value ?? '').trim()
  return text || placeholder
}

export const ViewToggleButton = ({
  active,
  icon,
  label,
  shortcut,
  onClick,
}: {
  active?: boolean
  icon: Parameters<typeof Icon>[0]['name']
  label: string
  shortcut?: string
  onClick: () => void
}) => (
  <button
    type="button"
    className={cls('nx-view-toggle', active && 'is-active')}
    onClick={onClick}
    aria-pressed={Boolean(active)}
    aria-label={label}
    title={shortcut ? `${label} (${shortcut})` : label}
  >
    <Icon name={icon} />
  </button>
)

export const KpiEntryButton = ({ onClick }: { onClick: () => void }) => (
  <button type="button" className="nx-kpi-entry" onClick={onClick} title="KPI / Analytics">
    <Icon name="stats" />
  </button>
)

export const NexusTopBar = ({
  searchQuery,
  onSearchQueryChange,
  searchResults,
  onSelectSearchResult,
  selectedThread,
  isSuppressed,
  onStageChange,
  statusCounts,
  notificationCount,
  queueProcessorHealth,
  queueProcessorHealthLoading,
  theme,
  onToggleTheme,
  activeOverlay,
  onOpenOverlay,
  onCloseOverlay,
  onOpenMap,
  onOpenDossier,
  onOpenAi,
  onOpenKeys,
  onOpenKpis,
  onOpenActivity,
  onResetLayout,
}: NexusTopBarProps) => {
  const [statusOpen, setStatusOpen] = useState(false)
  const showSearchResults = searchQuery.trim().length > 0
  const processorStatus = queueProcessorHealth?.status ?? 'unknown'
  const processorLabel = processorStatus === 'healthy' ? 'Healthy' : processorStatus === 'lagging' ? 'Delayed' : 'Unknown'
  const selectedStage = selectedThread?.inboxStage ?? 'needs_response'
  const statusVisual = getStatusVisual(selectedStage, isSuppressed)
  const notifications = buildInboxNotifications({ unreadCount: notificationCount, selectedThread, queueProcessorHealth })
  const unreadNotifications = notifications.filter((item) => item.status !== 'read').length
  const handleNotificationAction = (notification: NexusNotification) => {
    if (notification.related_thread_id) onSelectSearchResult(notification.related_thread_id)
    onCloseOverlay()
  }

  return (
    <header className="nx-topbar">
      <div className="nx-topbar__left">
        <div className="nx-topbar__brand" aria-label="NEXUS Inbox">
          <div className="nx-topbar__logo">
            <Icon name="inbox" />
          </div>
          <div>
            <span>NEXUS</span>
            <strong>Inbox</strong>
          </div>
        </div>

        <div className="nx-stage-control" style={statusStyleVars(statusVisual)}>
          <button
            type="button"
            className="nx-stage-orbit"
            onClick={() => setStatusOpen((open) => !open)}
            disabled={!selectedThread}
            aria-expanded={statusOpen}
            aria-label="Thread status"
          >
          <span className="nx-stage-orbit__halo nx-status-dot" />
          <span className="nx-stage-orbit__copy">
            <small>Status</small>
            <strong>{stageLabel(selectedThread, isSuppressed)}</strong>
          </span>
          <Icon name="chevron-down" />
          </button>

          {statusOpen && (
            <div className="nx-status-menu nx-liquid-panel">
              {inboxStatusOptions.map((option) => {
                const selected = option.value === selectedStage || (isSuppressed && option.value === 'dnc_opt_out')
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={cls(selected && 'is-selected')}
                    style={statusStyleVars(option)}
                    onClick={() => {
                      setStatusOpen(false)
                      onStageChange(option.value)
                    }}
                  >
                    <i className="nx-status-dot" />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                    <b>{statusCounts[option.value] ?? 0}</b>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="nx-global-search">
        <Icon name="search" />
        <input
          aria-label="Search threads, sellers, addresses, or commands"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search threads, sellers, addresses, or commands..."
        />
        <kbd>⌘K</kbd>
        {showSearchResults && (
          <div className="nx-search-results-popover">
            <div className="nx-search-results-popover__header">
              <span>Search Results</span>
              <b>{searchResults.length}</b>
            </div>
            <div className="nx-search-results-list">
              {searchResults.length > 0 ? searchResults.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  className="nx-search-result-item"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    onSelectSearchResult(thread.id)
                  }}
                >
                  <span>{fallback(thread.ownerName, 'Unknown Seller')}</span>
                  <small>{fallback(thread.propertyAddress || thread.subject, 'Property Unknown')}</small>
                </button>
              )) : (
                <p>No matching sellers, phones, addresses, or commands.</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="nx-topbar__actions">
        <div className="nx-notification-control">
          <button
            type="button"
            className={cls('nx-processor-button', `is-${processorStatus}`)}
            onClick={() => onOpenOverlay(activeOverlay === 'queue' ? null : 'queue')}
            aria-expanded={activeOverlay === 'queue'}
            title="Queue processor health"
          >
            <Icon name={processorStatus === 'healthy' ? 'check' : processorStatus === 'lagging' ? 'alert' : 'activity'} />
          </button>
          {activeOverlay === 'queue' && (
            <div className="nx-liquid-popover nx-liquid-popover--processor" role="status">
              <div className="nx-liquid-popover__title">Queue Processor</div>
              <p>{queueProcessorHealthLoading ? 'Checking processor health...' : (queueProcessorHealth?.summary ?? 'No processor data yet.')}</p>
              <div className="nx-processor-pop-grid">
                <span><small>Status</small><b>{processorLabel}</b></span>
                <span><small>Queued</small><b>{queueProcessorHealth?.queuedCount ?? 0}</b></span>
                <span><small>Older Than 10m</small><b>{queueProcessorHealth?.queuedOlderThanLagWindow ?? 0}</b></span>
                <span><small>Latest Sent</small><b>{queueProcessorHealth?.latestSentAt ? formatRelativeTime(queueProcessorHealth.latestSentAt) : 'Unknown'}</b></span>
              </div>
            </div>
          )}
        </div>

        {/* Theme toggle temporarily disabled per requirements */}
        {/*
        <button
          type="button"
          className="nx-icon-control"
          onClick={onToggleTheme}
          title={theme === 'light' ? 'Dark mode' : 'Light mode'}
          aria-label={theme === 'light' ? 'Enable dark mode' : 'Enable light mode'}
        >
          <Icon name={theme === 'light' ? 'moon' : 'palette'} />
        </button>
        */}

        <div className="nx-notification-control">
          <button
            type="button"
            className="nx-notification-button"
            onClick={onOpenActivity}
            title="Activity Log"
          >
            <Icon name="activity" />
          </button>
        </div>

        <div className="nx-notification-control">
          <button
            type="button"
            className={cls('nx-notification-button', unreadNotifications > 0 && 'has-alerts')}
            onClick={() => onOpenOverlay(activeOverlay === 'notifications' ? null : 'notifications')}
            aria-expanded={activeOverlay === 'notifications'}
            title="Notifications"
          >
            <Icon name="bell" />
            {unreadNotifications > 0 && <span>{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}
          </button>
        </div>

        <button
          type="button"
          className="nx-avatar-menu"
          title="User menu"
          onClick={() => onOpenOverlay(activeOverlay === 'avatar' ? null : 'avatar')}
          aria-expanded={activeOverlay === 'avatar'}
        >
          <span>RK</span>
          <Icon name="chevron-down" />
        </button>

        {activeOverlay === 'avatar' && (
          <div className="nx-avatar-popover nx-liquid-popover">
            <button type="button" onClick={onOpenMap}><Icon name="map" /> Map Mode <kbd>⌘M</kbd></button>
            <button type="button" onClick={onOpenDossier}><Icon name="briefing" /> Dossier</button>
            <button type="button" onClick={onOpenAi}><Icon name="brain" /> AI Assistant</button>
            <button type="button" onClick={onOpenKeys}><Icon name="key" /> Keyboard Shortcuts</button>
            <button type="button" onClick={onOpenKpis}><Icon name="stats" /> KPI Intelligence</button>
            <button type="button" onClick={onResetLayout}><Icon name="layout-split" /> Reset Layout</button>
          </div>
        )}
      </div>

      <NexusNotificationCenter
        open={activeOverlay === 'notifications'}
        notifications={notifications}
        onClose={onCloseOverlay}
        onOpenRecord={handleNotificationAction}
      />
    </header>
  )
}
