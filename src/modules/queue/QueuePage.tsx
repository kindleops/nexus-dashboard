import { useState, useEffect, useCallback } from 'react'
import { getSupabaseClient } from '../../lib/supabaseClient'
import {
  fetchQueueModel,
  approveQueueItem,
  holdQueueItem,
  rescheduleQueueItem,
  retryQueueItem,
  cancelQueueItem,
  type QueueModel,
  type QueueItem,
} from '../../lib/data/queueData'
import type { QueueItemStatus } from './queue.types'
import { Icon } from '../../shared/icons'
import { formatRelativeTime } from '../../shared/formatters'
import { emitNotification } from '../../shared/NotificationToast'
import './queue-premium.css'

// ── Types & Helpers ────────────────────────────────────────────────────────

type ViewMode = 'today' | 'week' | 'month' | 'list' | 'approval' | 'failed'

const cls = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

// ── Components ────────────────────────────────────────────────────────────

/**
 * Status Badge for Queue Items
 */
const StatusBadge = ({ status }: { status: QueueItemStatus }) => {
  const labels: Record<string, string> = {
    ready: 'Ready',
    scheduled: 'Scheduled',
    approval: 'Pending Approval',
    failed: 'Failed',
    sent: 'Sent',
    delivered: 'Delivered',
    retry: 'Retrying',
    held: 'On Hold',
  }

  return (
    <span className={cls('nx-badge', `nx-badge--${status}`)}>
      {labels[status] || status}
    </span>
  )
}

/**
 * Risk Tag
 */
const RiskTag = ({ level }: { level: 'low' | 'medium' | 'high' }) => (
  <span className={cls('nx-risk-tag', `is-${level}`)}>
    {level} RISK
  </span>
)

/**
 * Queue Card for Grid/List views
 */
const QueueCard = ({ 
  item, 
  isSelected, 
  onClick 
}: { 
  item: QueueItem, 
  isSelected: boolean, 
  onClick: () => void 
}) => (
  <div 
    className={cls('nx-queue-card', isSelected && 'is-selected')} 
    onClick={onClick}
  >
    <div className="nx-queue-card__header">
      <div className="nx-queue-card__seller-info">
        <span className="nx-queue-card__seller">{item.sellerName}</span>
        <span className="nx-queue-card__address">{item.propertyAddress}</span>
      </div>
      <StatusBadge status={item.status} />
    </div>
    
    {item.messageText && (
      <div className="nx-queue-card__preview">
        {item.messageText}
      </div>
    )}

    <div className="nx-queue-card__footer">
      <div className="nx-card-time">
        <Icon name="clock" />
        {formatRelativeTime(item.scheduledForLocal)}
      </div>
      <div className="nx-card-template">
        <Icon name="file-text" />
        {item.templateName}
      </div>
      {item.riskLevel === 'high' && <RiskTag level="high" />}
    </div>
  </div>
)

/**
 * Intelligence Row
 */
const IntelRow = ({ label, value, icon, className }: { label: string; value: string | number; icon?: string; className?: string }) => (
  <div className={cls('nx-queue-inspector-row', className)}>
    <span className="nx-queue-inspector-label">
      {icon && <span style={{ marginRight: 6 }}>{icon}</span>}
      {label}
    </span>
    <span className="nx-queue-inspector-value">{value || '—'}</span>
  </div>
)

/**
 * Collapsible Inspector Card
 */
const CollapsibleInspectorCard = ({ 
  title, 
  icon, 
  children, 
  className,
  defaultExpanded = true 
}: { 
  title: string; 
  icon: any; 
  children: React.ReactNode; 
  className?: string;
  defaultExpanded?: boolean 
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded)
  return (
    <section className={cls('nx-inspector-card', !expanded && 'is-collapsed', className)}>
      <button type="button" className="nx-inspector-card__header" onClick={() => setExpanded(!expanded)}>
        <Icon name={icon} />
        <strong>{title}</strong>
        <Icon name="chevron-down" className={cls('nx-inspector-card__chevron', expanded && 'is-rotated')} />
      </button>
      {expanded && <div className="nx-inspector-card__body">{children}</div>}
    </section>
  )
}

/**
 * Intelligence Inspector Panel
 */
const QueueInspector = ({ 
  item, 
  onAction 
}: { 
  item: QueueItem | null, 
  onAction: (action: string, id: string) => void 
}) => {
  const [showMetadata, setShowMetadata] = useState(false)

  if (!item) {
    return (
      <aside className="nx-queue-inspector is-empty">
        <div className="nx-empty-state">
          <Icon name="target" style={{ width: 48, height: 48, opacity: 0.2, marginBottom: 16 }} />
          <p>Select a queue item to inspect signal</p>
        </div>
      </aside>
    )
  }

  return (
    <aside className="nx-queue-inspector">
      <header className="nx-queue-inspector-header">
        <div className="nx-inspector-title">
          <h2>Item Intelligence</h2>
          <StatusBadge status={item.status} />
        </div>
        <button className="nx-inspector-close" onClick={() => onAction('deselect', item.id)}>
          <Icon name="close" />
        </button>
      </header>

      <div className="nx-queue-inspector-body">
        <CollapsibleInspectorCard title="Execution Details" icon="radar">
          <div className="nx-inspector-grid">
            <IntelRow label="Scheduled" value={new Date(item.scheduledForLocal).toLocaleString()} />
            <IntelRow label="Timezone" value={item.timezone} />
            <IntelRow label="Touch #" value={item.touchNumber} />
            <IntelRow label="Priority" value={item.priority.toUpperCase()} className={cls(item.priority === 'P0' && 'is-urgent')} />
            <IntelRow label="Risk" value={item.riskLevel.toUpperCase()} className={cls(`is-risk-${item.riskLevel}`)} />
            <IntelRow label="Language" value={item.language === 'es' ? 'Spanish' : 'English'} />
          </div>
        </CollapsibleInspectorCard>

        <CollapsibleInspectorCard title="Seller & Property" icon="user">
          <div className="nx-inspector-grid">
            <IntelRow label="Seller" value={item.sellerName} />
            <IntelRow label="Phone" value={item.phone} />
            <IntelRow label="Market" value={item.market} />
            <IntelRow label="Address" value={item.propertyAddress} />
            <IntelRow label="Owner ID" value={item.linkedOwnerId || '—'} className="is-id-row" />
          </div>
        </CollapsibleInspectorCard>

        <CollapsibleInspectorCard title="Payload Signal" icon="file-text">
          <div className="nx-inspector-message-preview">
            <div className="nx-msg-meta">
              <span>{item.templateName}</span>
              <span>{item.useCase}</span>
            </div>
            <p>{item.messageText}</p>
          </div>
        </CollapsibleInspectorCard>

        {item.status === 'failed' && (
          <CollapsibleInspectorCard title="Error Diagnostic" icon="alert" className="is-error">
            <div className="nx-error-box">
              <strong>{item.failureReason || 'Unknown Failure'}</strong>
              <p>Retry attempt {item.retryCount} of {item.maxRetries}</p>
            </div>
          </CollapsibleInspectorCard>
        )}

        <div className="nx-inspector-advanced">
          <button 
            className="nx-inspector-toggle-json"
            onClick={() => setShowMetadata(!showMetadata)}
          >
            <Icon name="grid" />
            {showMetadata ? 'Hide Metadata' : 'View Raw Signal'}
          </button>
          
          {showMetadata && (
            <pre className="nx-inspector-json">
              {JSON.stringify(item.metadata || {}, null, 2)}
            </pre>
          )}
        </div>
      </div>

      <div className="nx-queue-inspector-actions">
        {item.status === 'approval' && (
          <button className="nx-btn nx-btn--primary" onClick={() => onAction('approve', item.id)}>
            <Icon name="check" /> Approve Send
          </button>
        )}
        {(item.status === 'ready' || item.status === 'scheduled') && (
          <button className="nx-btn nx-btn--secondary" onClick={() => onAction('hold', item.id)}>
            <Icon name="shield" /> Hold Item
          </button>
        )}
        {item.status === 'failed' && (
          <button className="nx-btn nx-btn--primary" onClick={() => onAction('retry', item.id)}>
            <Icon name="zap" /> Retry Now
          </button>
        )}
        <button className="nx-btn nx-btn--secondary" onClick={() => onAction('reschedule', item.id)}>
          <Icon name="calendar" /> Reschedule
        </button>
        <button className="nx-btn nx-btn--danger" onClick={() => onAction('cancel', item.id)}>
          <Icon name="close" /> Cancel
        </button>
      </div>
    </aside>
  )
}

// ── Main Page Component ────────────────────────────────────────────────────
interface QueuePageProps {
  data?: QueueModel
}

export const QueuePage = ({ data: initialData }: QueuePageProps = {}) => {
  const [loading, setLoading] = useState(!initialData)
  const [model, setModel] = useState<QueueModel | null>(initialData || null)
  const [viewMode, setViewMode] = useState<ViewMode>('today')
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<QueueItemStatus | 'all'>('all')

  const refreshData = useCallback(async () => {
    try {
      const data = await fetchQueueModel()
      setModel(data)
    } catch (err) {
      console.error('Failed to fetch queue data', err)
      emitNotification({
        title: 'Queue Load Failed',
        detail: err instanceof Error ? err.message : 'Database sync error',
        severity: 'critical'
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshData()

    const supabase = getSupabaseClient()
    const channel = supabase
      .channel('queue-live-updates')
      .on(
        'postgres_changes',
        { event: '*', table: 'send_queue', schema: 'public' },
        () => {
          refreshData()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [refreshData])

  // Keyboard navigation for view switching
  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      
      const modes: ViewMode[] = ['today', 'week', 'month', 'list', 'approval', 'failed']
      const key = parseInt(e.key)
      if (key >= 1 && key <= 6) {
        setViewMode(modes[key - 1])
      }
    }
    window.addEventListener('keydown', handleKeys)
    return () => window.removeEventListener('keydown', handleKeys)
  }, [])

  const handleAction = async (action: string, id: string) => {
    const item = model?.items.find((i: QueueItem) => i.id === id)
    if (!item) return

    if (action === 'deselect') {
      setSelectedItemId(null)
      return
    }

    // Optimistic UI mapping
    let successMessage = ''
    let resultPromise: Promise<any> | null = null

    switch (action) {
      case 'approve':
        successMessage = `Approved send to ${item.sellerName}`
        resultPromise = approveQueueItem(item)
        break
      case 'hold':
        successMessage = `Held item for ${item.sellerName}`
        resultPromise = holdQueueItem(item)
        break
      case 'cancel':
        successMessage = `Cancelled item for ${item.sellerName}`
        resultPromise = cancelQueueItem(item)
        break
      case 'retry':
        successMessage = `Retrying send to ${item.sellerName}`
        resultPromise = retryQueueItem(item)
        break
      case 'reschedule':
        // Simplified for now - in production would open a date picker
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        successMessage = `Rescheduled to ${tomorrow.toLocaleDateString()}`
        resultPromise = rescheduleQueueItem(item, tomorrow.toISOString())
        break
    }

    if (resultPromise) {
      try {
        const res = await resultPromise
        if (res.ok) {
          emitNotification({
            title: 'Action Successful',
            detail: successMessage,
            severity: 'success',
            sound: 'notification'
          })
          refreshData()
        } else {
          throw new Error(res.errorMessage || 'Unknown error')
        }
      } catch (err) {
        emitNotification({
          title: 'Action Failed',
          detail: err instanceof Error ? err.message : 'Database update failed',
          severity: 'critical',
          sound: 'alert-triggered'
        })
      }
    }
  }

  const selectedItem = model?.items.find((i: QueueItem) => i.id === selectedItemId) || null

  const filteredItems = (model?.items || []).filter((item: QueueItem) => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false
    
    // Additional view-specific filtering
    if (viewMode === 'approval') return item.status === 'approval'
    if (viewMode === 'failed') return item.status === 'failed'
    
    return true
  })

  // Group items for Today view
  const timeBuckets = [
    { label: 'Past Due / Overdue', filter: (i: QueueItem) => new Date(i.scheduledForLocal) < new Date() && (i.status === 'ready' || i.status === 'retry') },
    { label: 'Upcoming (Next 4h)', filter: (i: QueueItem) => {
      const diff = new Date(i.scheduledForLocal).getTime() - new Date().getTime()
      return diff > 0 && diff < 4 * 3600 * 1000
    }},
    { label: 'Later Today', filter: (i: QueueItem) => {
      const diff = new Date(i.scheduledForLocal).getTime() - new Date().getTime()
      return diff >= 4 * 3600 * 1000 && new Date(i.scheduledForLocal).toDateString() === new Date().toDateString()
    }}
  ]

  if (loading) {
    return (
      <div className="nx-premium-queue is-loading">
        <div className="nx-loading-spinner" />
        <p>Syncing operations queue...</p>
      </div>
    )
  }

  return (
    <div className="nx-premium-queue">
      <header className="nx-queue-topbar">
        <div className="nx-queue-topbar__title">
          <h1>Operations Queue</h1>
          <div className="nx-view-switcher">
            {(['today', 'week', 'month', 'list', 'approval', 'failed'] as ViewMode[]).map(mode => (
              <button 
                key={mode}
                className={cls('nx-view-btn', viewMode === mode && 'is-active')}
                onClick={() => setViewMode(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div className="nx-queue-topbar__actions">
          <div className="nx-queue-stat">
            <small>READY</small>
            <b>{model?.readyCount || 0}</b>
          </div>
          <div className="nx-queue-stat is-warning">
            <small>PENDING</small>
            <b>{model?.approvalCount || 0}</b>
          </div>
          <div className="nx-queue-stat is-danger">
            <small>FAILED</small>
            <b>{model?.failedCount || 0}</b>
          </div>
          <button className="nx-btn nx-btn--secondary" onClick={refreshData}>
            <Icon name="radar" /> Refresh
          </button>
        </div>
      </header>

      <div className="nx-queue-shell">
        <aside className="nx-queue-sidebar">
          <div className="nx-queue-sidebar-section">
            <span className="nx-queue-sidebar-label">Active Capacity</span>
            <div className="nx-queue-capacity">
              <div className="nx-queue-capacity-item">
                <span className="nx-queue-capacity-label">Sent Today</span>
                <span className="nx-queue-capacity-value">{model?.sentTodayCount || 0}</span>
              </div>
              <div className="nx-queue-capacity-item">
                <span className="nx-queue-capacity-label">Daily Limit</span>
                <span className="nx-queue-capacity-value">1,200</span>
              </div>
              <div className="nx-queue-capacity-progress">
                <div 
                  className="nx-queue-capacity-bar" 
                  style={{ width: `${Math.min(((model?.sentTodayCount || 0) / 1200) * 100, 100)}%` }} 
                />
              </div>
            </div>
          </div>

          <div className="nx-queue-sidebar-section">
            <span className="nx-queue-sidebar-label">Status Filters</span>
            {(['all', 'ready', 'scheduled', 'approval', 'held', 'failed'] as const).map(s => (
              <button 
                key={s}
                className={cls('nx-queue-bucket-btn', statusFilter === s && 'is-active')}
                onClick={() => setStatusFilter(s)}
              >
                <span className="nx-bucket-name">{s === 'all' ? 'All Items' : s.charAt(0).toUpperCase() + s.slice(1)}</span>
                <span className="nx-queue-bucket-count">
                  {s === 'all' ? model?.items.length : (model as any)[`${s}Count`] || 0}
                </span>
              </button>
            ))}
          </div>

          <div className="nx-queue-sidebar-section is-spacer" />

          <div className="nx-queue-sidebar-section">
            <div className="nx-sidebar-footer">
              <div className="nx-pressure-gauge">
                <div className={cls('nx-gauge-dot', `is-pressure-${model?.apiPressureLevel || 'low'}`)} />
                <span>API Pressure: {model?.apiPressureLevel.toUpperCase()}</span>
              </div>
            </div>
          </div>
        </aside>

        <main className="nx-queue-main">
          <div className="nx-queue-scroll-area">
            {viewMode === 'today' && (
              <div className="nx-today-view">
                {timeBuckets.map(bucket => {
                  const items = filteredItems.filter(bucket.filter)
                  if (items.length === 0) return null
                  return (
                    <div key={bucket.label} className="nx-queue-group">
                      <div className="nx-queue-group-header">
                        <h3>{bucket.label}</h3>
                        <span className="nx-queue-group-count">{items.length}</span>
                      </div>
                      <div className="nx-queue-grid">
                        {items.map((item: QueueItem) => (
                          <QueueCard 
                            key={item.id} 
                            item={item} 
                            isSelected={selectedItemId === item.id}
                            onClick={() => setSelectedItemId(item.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
                {filteredItems.length === 0 && (
                  <div className="nx-queue-empty">
                    <p>No items scheduled for today.</p>
                  </div>
                )}
              </div>
            )}

            {(viewMode === 'list' || viewMode === 'approval' || viewMode === 'failed') && (
              <div className="nx-list-view">
                <div className="nx-queue-table-container">
                  <table className="nx-queue-table">
                    <thead>
                      <tr>
                        <th>Seller & Property</th>
                        <th>Status</th>
                        <th>Scheduled</th>
                        <th>Market</th>
                        <th>Agent</th>
                        <th>Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map((item: QueueItem) => (
                        <tr 
                          key={item.id} 
                          className={cls(selectedItemId === item.id && 'is-selected')}
                          onClick={() => setSelectedItemId(item.id)}
                        >
                          <td>
                            <div className="nx-cell-owner">
                              <strong>{item.sellerName}</strong>
                              <small>{item.propertyAddress}</small>
                            </div>
                          </td>
                          <td><StatusBadge status={item.status} /></td>
                          <td>{formatRelativeTime(item.scheduledForLocal)}</td>
                          <td>{item.market}</td>
                          <td>{item.agent}</td>
                          <td><RiskTag level={item.riskLevel} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {viewMode === 'week' && (
              <div className="nx-week-board">
                {/* Simplified week view implementation */}
                <div className="nx-queue-grid">
                   {filteredItems.map((item: QueueItem) => (
                    <QueueCard 
                      key={item.id} 
                      item={item} 
                      isSelected={selectedItemId === item.id}
                      onClick={() => setSelectedItemId(item.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {viewMode === 'month' && (
              <div className="nx-month-heatmap">
                 <div className="nx-queue-grid">
                   {filteredItems.map((item: QueueItem) => (
                    <QueueCard 
                      key={item.id} 
                      item={item} 
                      isSelected={selectedItemId === item.id}
                      onClick={() => setSelectedItemId(item.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>

        <QueueInspector 
          item={selectedItem} 
          onAction={handleAction} 
        />
      </div>
    </div>
  )
}
