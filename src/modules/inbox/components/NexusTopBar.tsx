import { useEffect, useRef } from 'react'
import type { QueueProcessorHealth } from '../../../lib/data/inboxData'
import type { InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import { Icon } from '../../../shared/icons'
import type { ActiveOverlay, NexusTheme } from '../inbox-layout-state'
import { buildInboxNotifications, NexusNotificationCenter, type NexusNotification } from './NexusNotificationCenter'
import type { AutonomousEngineModel } from '../autonomy-engine'
import { InboxKpiOrb } from './InboxKpiOrb'
import { QueueCommandCenter, type QueueCommandCaps, type QueueCommandMode } from './QueueCommandCenter'

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
  queueCommandMode: QueueCommandMode
  queueCommandCaps: QueueCommandCaps
  queueCommandActionLoading: string | null
  onQueueCommandModeChange: (mode: QueueCommandMode) => void
  onQueueCommandCapsChange: (patch: Partial<QueueCommandCaps>) => void
  onRunSafeBatch: () => void
  onRunQueueNow: () => void
  onReprocessPaused: (ids?: string[]) => void
  onRetryFailed: () => void
  onReconcileDelivery: () => void
  onCancelStaleFollowUps: () => void
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
  queueCommandMode,
  queueCommandCaps,
  queueCommandActionLoading,
  onQueueCommandModeChange,
  onQueueCommandCapsChange,
  onRunSafeBatch,
  onRunQueueNow,
  onReprocessPaused,
  onRetryFailed,
  onReconcileDelivery,
  onCancelStaleFollowUps,
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
  const processorHealthLabel =
    processorStatus === 'healthy' ? 'Healthy'
      : processorStatus === 'warning' ? 'Warning'
        : processorStatus === 'critical' ? 'Critical'
          : 'Unknown'
  
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
          <div className="nx-topbar-orb-slot">
            <InboxKpiOrb />
          </div>
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
            <Icon name={processorStatus === 'healthy' ? 'check' : processorStatus === 'warning' || processorStatus === 'critical' ? 'alert' : 'activity'} />
            <div className="nx-processor-button__meta">
              <small>{queueCommandMode === 'off' ? 'Off' : queueCommandMode === 'safe' ? 'Safe' : 'Live'}</small>
              <span>{processorHealthLabel}</span>
            </div>
          </button>
          {activeOverlay === 'queue' && (
            <div className="nx-liquid-popover nx-liquid-popover--processor" role="status">
              <QueueCommandCenter
                health={queueProcessorHealth}
                loading={queueProcessorHealthLoading}
                mode={queueCommandMode}
                caps={queueCommandCaps}
                actionLoading={queueCommandActionLoading}
                onModeChange={onQueueCommandModeChange}
                onCapsChange={onQueueCommandCapsChange}
                onRefresh={() => onRefreshQueueHealth?.()}
                onRunSafeBatch={onRunSafeBatch}
                onRunQueueNow={onRunQueueNow}
                onReprocessPaused={onReprocessPaused}
                onRetryFailed={onRetryFailed}
                onReconcileDelivery={onReconcileDelivery}
                onCancelStaleFollowUps={onCancelStaleFollowUps}
              />
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
