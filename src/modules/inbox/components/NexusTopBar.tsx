import { useEffect, useRef } from 'react'
import type { QueueProcessorHealth } from '../../../lib/data/inboxData'
import type { InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import { Icon } from '../../../shared/icons'
import { formatRelativeTime } from '../../../shared/formatters'
import type { ActiveOverlay, NexusTheme } from '../inbox-layout-state'
import { buildInboxNotifications, NexusNotificationCenter, type NexusNotification } from './NexusNotificationCenter'
import type { AutonomousEngineModel } from '../autonomy-engine'

const cls = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

interface NexusTopBarProps {
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  searchResults: InboxWorkflowThread[]
  onSelectSearchResult: (id: string) => void
  selectedThread: InboxWorkflowThread | null
  isSuppressed: boolean
  notificationCount: number
  queueProcessorHealth: QueueProcessorHealth | null
  queueProcessorHealthLoading: boolean
  onRefreshQueueHealth?: () => void
  autonomyModel: AutonomousEngineModel
  theme: NexusTheme
  viewCounts?: any
  threads?: InboxWorkflowThread[]
  activeViewKey?: string
  onSelectView?: (viewKey: string) => void
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
  dryRun: boolean
  onToggleDryRun: () => void
}

const fallback = (value: unknown, placeholder = 'Unknown') => {
  const text = String(value ?? '').trim()
  return text || placeholder
}

export const NexusTopBar = ({
  searchQuery,
  onSearchQueryChange,
  searchResults,
  onSelectSearchResult,
  selectedThread,
  isSuppressed,
  notificationCount,
  queueProcessorHealth,
  queueProcessorHealthLoading,
  onRefreshQueueHealth,
  autonomyModel,
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
  dryRun,
  onToggleDryRun,
}: NexusTopBarProps) => {
  const DEV = Boolean(import.meta.env.DEV)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  
  useEffect(() => {
    if (DEV && activeOverlay) {
      console.log(`[NexusPopover]`, { name: activeOverlay, action: 'open', open: true })
    }
  }, [activeOverlay, DEV])

  useEffect(() => {
    const focusSearch = () => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
    window.addEventListener('nexus:focus-search', focusSearch as EventListener)
    return () => window.removeEventListener('nexus:focus-search', focusSearch as EventListener)
  }, [])

  const showSearchResults = searchQuery.trim().length > 0
  const processorStatus = queueProcessorHealth?.status ?? 'unknown'
  const processorLabel = processorStatus === 'healthy' ? 'Healthy' : processorStatus === 'lagging' ? 'Delayed' : 'Unknown'
  
  const notifications = buildInboxNotifications({ unreadCount: notificationCount, selectedThread, queueProcessorHealth, autonomyModel })
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
      </div>

      <div className="nx-topbar__center">
        <div className="nx-inbox-utility-row inbox-center-width">
          <div className="nx-topbar-orb-slot" />
          <div className="nx-global-search">
            <Icon name="search" />
            <input
              ref={searchInputRef}
              aria-label="Search threads, sellers, addresses, or commands"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder="Search threads, sellers, addresses, or commands..."
            />
            <kbd>⌘K</kbd>
            {showSearchResults && (
              <div className="nx-search-results-popover nx-liquid-popover">
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
                        event.stopPropagation()
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
        </div>
      </div>

      <div className="nx-topbar__actions">
        <div className="nx-notification-control">
          <button
            type="button"
            className={cls('nx-dry-run-toggle', dryRun && 'is-active', isSuppressed && 'is-suppressed-context')}
            onClick={onToggleDryRun}
            title={isSuppressed ? 'Thread is suppressed' : (dryRun ? 'Simulation mode active (Auto-replies require approval)' : 'Live mode active (Auto-replies send automatically)')}
          >
            <Icon name="spark" />
            <span>{dryRun ? 'DRY RUN' : 'LIVE'}</span>
          </button>
        </div>

        <div className="nx-notification-control">
          <button
            type="button"
            className={cls('nx-processor-button', `is-${processorStatus}`)}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onOpenOverlay(activeOverlay === 'queue' ? null : 'queue')
            }}
            aria-expanded={activeOverlay === 'queue'}
            title="Queue processor health"
          >
            <Icon name={processorStatus === 'healthy' ? 'check' : processorStatus === 'lagging' ? 'alert' : 'activity'} />
          </button>
          {activeOverlay === 'queue' && (
            <div className="nx-liquid-popover nx-liquid-popover--processor" role="status">
              <div className="nx-processor-pop-header">
                <div className="nx-processor-pop-header__title">
                  <Icon name="activity" />
                  <span>Queue Processor</span>
                </div>
                <div className={cls('nx-processor-status-indicator', `is-${processorStatus}`)}>
                  {processorLabel}
                </div>
              </div>

              <div className="nx-processor-pop-body">
                <div className="nx-processor-summary-text">
                  {queueProcessorHealthLoading ? 'Synchronizing health data...' : (queueProcessorHealth?.summary ?? 'No processor data available.')}
                </div>
                
                <div className="nx-processor-stats-grid">
                  <div className="nx-processor-stat-card">
                    <label>Queued</label>
                    <b>{queueProcessorHealth?.queuedCount ?? 0}</b>
                  </div>
                  <div className="nx-processor-stat-card">
                    <label>Lagging</label>
                    <b>{queueProcessorHealth?.queuedOlderThanLagWindow ?? 0}</b>
                  </div>
                  <div className="nx-processor-stat-card" style={{ gridColumn: 'span 2' }}>
                    <label>Latest Sent</label>
                    <b>{queueProcessorHealth?.latestSentAt ? formatRelativeTime(queueProcessorHealth.latestSentAt) : 'None'}</b>
                  </div>
                </div>
              </div>

              <div className="nx-processor-pop-footer">
                <div className="nx-processor-last-check">
                  Updated {queueProcessorHealth?.checkedAt ? formatRelativeTime(queueProcessorHealth.checkedAt) : 'just now'}
                </div>
                {onRefreshQueueHealth && (
                  <button 
                    type="button" 
                    className="nx-processor-refresh-btn"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onRefreshQueueHealth()
                    }}
                    disabled={queueProcessorHealthLoading}
                  >
                    {queueProcessorHealthLoading ? 'Checking...' : 'Refresh'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className="nx-icon-control"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onToggleTheme()
          }}
          title={theme === 'light' ? 'Dark mode' : 'Light mode'}
          aria-label={theme === 'light' ? 'Enable dark mode' : 'Enable light mode'}
        >
          <Icon name={theme === 'light' ? 'close' : 'palette'} />
        </button>

        <div className="nx-notification-control">
          <button
            type="button"
            className="nx-notification-button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onOpenActivity()
            }}
            title="Activity Log"
          >
            <Icon name="activity" />
          </button>
        </div>

        <div className="nx-notification-control">
          <button
            type="button"
            className={cls('nx-notification-button', unreadNotifications > 0 && 'has-alerts')}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onOpenOverlay(activeOverlay === 'notifications' ? null : 'notifications')
            }}
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
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onOpenOverlay(activeOverlay === 'avatar' ? null : 'avatar')
          }}
          aria-expanded={activeOverlay === 'avatar'}
        >
          <span>RK</span>
          <Icon name="chevron-down" />
        </button>

        {activeOverlay === 'avatar' && (
          <div className="nx-avatar-popover nx-liquid-popover">
            <button 
              type="button" 
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onOpenMap()
              }}
            >
              <Icon name="map" /> Map Mode <kbd>⌘M</kbd>
            </button>
            <button 
              type="button" 
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onOpenDossier()
              }}
            >
              <Icon name="briefing" /> Dossier
            </button>
            <button 
              type="button" 
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onOpenAi()
              }}
            >
              <Icon name="spark" /> AI Assistant
            </button>
            <button 
              type="button" 
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onOpenKeys()
              }}
            >
              <Icon name="key" /> Keyboard Shortcuts
            </button>
            <button 
              type="button" 
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onOpenKpis()
              }}
            >
              <Icon name="stats" /> KPI Intelligence
            </button>
            <button 
              type="button" 
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onResetLayout()
              }}
            >
              <Icon name="layout-split" /> Reset Layout
            </button>
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
