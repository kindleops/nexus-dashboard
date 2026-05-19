import { useEffect, useMemo, useRef, useState } from 'react'
import type { QueueProcessorHealth } from '../../../lib/data/inboxData'
import type { InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import { Icon } from '../../../shared/icons'
import type { CommandResult } from '../../command-center/command.types'
import type { ActiveOverlay, NexusTheme } from '../inbox-layout-state'
import { buildInboxNotifications, NexusNotificationCenter, type NexusNotification } from './NexusNotificationCenter'
import type { AutonomousEngineModel } from '../autonomy-engine'
import { InboxKpiOrb } from './InboxKpiOrb'
import { QueueCommandCenter, type QueueCommandCaps, type QueueCommandMode } from './QueueCommandCenter'

const cls = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

interface NexusTopBarProps {
  onSelectSearchResult: (id: string) => void
  topSearchQuery: string
  onTopSearchQueryChange: (value: string) => void
  topSearchGroups: Array<{ key: string; label: string; items: CommandResult[] }>
  topSearchLoading: boolean
  onExecuteTopSearchResult: (result: CommandResult) => void
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
  activeViewLabel?: string
  viewOptions?: Array<{ key: string; label: string; description?: string }>
  selectedViewKeys?: string[]
  selectedViewWidths?: Record<string, string>
  onToggleView?: (viewKey: string) => void
  onFocusView?: (viewKey: string) => void
  viewWidthOptions?: Array<{ key: string; label: string }>
  onSelectViewWidth?: (viewKey: string, widthKey: string) => void
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

export const NexusTopBar = ({
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
  activeViewKey,
  activeViewLabel = 'Conversation View',
  viewOptions = [],
  selectedViewKeys = [],
  selectedViewWidths = {},
  onToggleTheme,
  viewWidthOptions = [],
  onToggleView,
  onFocusView,
  onSelectViewWidth,
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
  topSearchQuery,
  onTopSearchQueryChange,
  topSearchGroups,
  topSearchLoading,
  onExecuteTopSearchResult,
}: NexusTopBarProps) => {
  const DEV = Boolean(import.meta.env.DEV)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [openControlMenu, setOpenControlMenu] = useState<null | 'view'>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchActiveIndex, setSearchActiveIndex] = useState(0)
  
  useEffect(() => {
    if (DEV && activeOverlay) {
      console.log(`[NexusPopover]`, { name: activeOverlay, action: 'open', open: true })
    }
  }, [activeOverlay, DEV])

  useEffect(() => {
    const focusSearch = () => {
      searchInputRef.current?.focus()
    }
    window.addEventListener('nexus:focus-search', focusSearch as EventListener)
    return () => window.removeEventListener('nexus:focus-search', focusSearch as EventListener)
  }, [])

  useEffect(() => {
    const handleWindowClick = () => setOpenControlMenu(null)
    window.addEventListener('click', handleWindowClick)
    return () => window.removeEventListener('click', handleWindowClick)
  }, [])

  const processorStatus = queueProcessorHealth?.status ?? 'unknown'
  const processorHealthLabel =
    processorStatus === 'healthy' ? 'Healthy'
      : processorStatus === 'warning' ? 'Warning'
        : processorStatus === 'critical' ? 'Critical'
          : 'Unknown'
  
  const notifications = buildInboxNotifications({ unreadCount: notificationCount, selectedThread, queueProcessorHealth, autonomyModel })
  const unreadNotifications = notifications.filter((item) => item.status !== 'read').length
  const topSearchItems = useMemo(
    () => topSearchGroups.flatMap((group) => group.items),
    [topSearchGroups],
  )

  useEffect(() => {
    setSearchActiveIndex(0)
  }, [topSearchQuery, topSearchGroups])

  const showSearchPopover = searchOpen && (topSearchLoading || topSearchItems.length > 0 || topSearchQuery.trim().length >= 2)

  const handleNotificationAction = (notification: NexusNotification) => {
    if (notification.related_thread_id) onSelectSearchResult(notification.related_thread_id)
    onCloseOverlay()
  }

  const handleSearchSubmit = (result: CommandResult | undefined) => {
    if (!result) return
    onExecuteTopSearchResult(result)
    setSearchOpen(false)
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
          <div className="nx-topbar-view-control">
            <button
              type="button"
              className={cls('nx-topbar-view-button', openControlMenu === 'view' && 'is-active')}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setOpenControlMenu((current) => current === 'view' ? null : 'view')
              }}
            >
              <span className="nx-topbar-view-button__label">View</span>
              <strong>{activeViewLabel}</strong>
              <Icon name="chevron-down" />
            </button>
            {openControlMenu === 'view' && (
              <div className="nx-liquid-popover nx-topbar-view-popover" role="menu">
                <div className="nx-topbar-view-popover__header">
                  <span>Workspace Views</span>
                </div>
                <div className="nx-topbar-view-popover__list">
                  {viewOptions.map((view) => (
                    <div key={view.key} className={cls('nx-topbar-view-option', activeViewKey === view.key && 'is-active')}>
                      <button
                        type="button"
                        className="nx-topbar-view-option__main"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          onFocusView?.(view.key)
                        }}
                      >
                        <div>
                          <strong>{view.label}</strong>
                          {view.description ? <small>{view.description}</small> : null}
                        </div>
                        {selectedViewKeys.includes(view.key) ? <span className="nx-topbar-view-option__badge">{selectedViewWidths[view.key] || 'on'}</span> : null}
                      </button>
                      <div className="nx-topbar-view-option__controls">
                        <button
                          type="button"
                          className={cls('nx-topbar-view-toggle', selectedViewKeys.includes(view.key) && 'is-active')}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            onToggleView?.(view.key)
                          }}
                        >
                          {selectedViewKeys.includes(view.key) ? 'On' : 'Off'}
                        </button>
                        {selectedViewKeys.includes(view.key) ? (
                          <div className="nx-topbar-view-widths">
                            {viewWidthOptions.map((option) => (
                              <button
                                key={option.key}
                                type="button"
                                className={cls('nx-topbar-width-pill', selectedViewWidths[view.key] === option.label && 'is-active')}
                                onClick={(event) => {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  onSelectViewWidth?.(view.key, option.key)
                                }}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="nx-global-search">
            <Icon name="search" />
            <input
              ref={searchInputRef}
              aria-label="Search Inbox sellers, buyers, properties, conversations, and markets"
              value={topSearchQuery}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                onTopSearchQueryChange(event.target.value)
                setSearchOpen(true)
              }}
              onFocus={(event) => {
                event.currentTarget.select()
                setSearchOpen(true)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setSearchOpen(true)
                  setSearchActiveIndex((current) => Math.min(current + 1, Math.max(topSearchItems.length - 1, 0)))
                  return
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setSearchActiveIndex((current) => Math.max(current - 1, 0))
                  return
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleSearchSubmit(topSearchItems[searchActiveIndex])
                  return
                }
                if (event.key === 'Escape') {
                  setSearchOpen(false)
                  return
                }
              }}
              onBlur={() => {
                window.setTimeout(() => setSearchOpen(false), 120)
              }}
              placeholder="Search sellers, buyers, properties, conversations, markets…"
            />
            <kbd>⌘K</kbd>
            {showSearchPopover ? (
              <div className="nx-search-results-popover" role="listbox" aria-label="Inbox search suggestions">
                <div className="nx-search-results-popover__header">
                  <span>Inbox Search</span>
                  <b>{topSearchLoading ? 'Live' : `${topSearchItems.length} matches`}</b>
                </div>
                <div className="nx-search-results-list">
                  {topSearchGroups.map((group) => {
                    let runningIndex = -1
                    return (
                      <section key={group.key} className="nx-search-result-group">
                        <header className="nx-search-result-group__label">{group.label}</header>
                        {group.items.map((result) => {
                          runningIndex = topSearchItems.findIndex((item) => item.id === result.id)
                          const isActive = runningIndex === searchActiveIndex
                          return (
                            <button
                              key={result.id}
                              type="button"
                              className={cls('nx-search-result-item', isActive && 'is-active')}
                              onMouseEnter={() => setSearchActiveIndex(runningIndex)}
                              onMouseDown={(event) => {
                                event.preventDefault()
                                handleSearchSubmit(result)
                              }}
                            >
                              <span className="nx-search-result-item__row">
                                <strong>{result.title}</strong>
                                {result.badge ? <em>{result.badge}</em> : null}
                              </span>
                              <small>{result.subtitle}</small>
                              {result.description ? <p>{result.description}</p> : null}
                            </button>
                          )
                        })}
                      </section>
                    )
                  })}
                  {!topSearchLoading && topSearchItems.length === 0 ? (
                    <div className="nx-search-results-empty">
                      <strong>No inbox matches</strong>
                      <span>Try a seller, buyer, address, market, phone, or queue status.</span>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
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
