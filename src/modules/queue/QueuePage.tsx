import { useEffect, useMemo, useState } from 'react'
import type { QueueItem, QueueModel, QueueView, QueueFilters, QueueBucket } from './queue.types'
import { Icon } from '../../shared/icons'
import './queue-premium.css'

interface QueuePageProps {
  data: QueueModel
}

const cls = (...tokens: Array<string | false | null | undefined>) => tokens.filter(Boolean).join(' ')

// ── Shared UI Components ───────────────────────────────────────────────────

const Badge: React.FC<{ type: string; children: React.ReactNode }> = ({ type, children }) => (
  <span className={cls('nx-badge', `nx-badge--${type}`)}>{children}</span>
)

const StatusPill: React.FC<{ label: string; count: number; active?: boolean; onClick: () => void }> = ({
  label,
  count,
  active,
  onClick,
}) => (
  <button className={cls('nx-queue-bucket-btn', active && 'is-active')} onClick={onClick}>
    <span>{label}</span>
    <span className="nx-queue-bucket-count">{count}</span>
  </button>
)

// ── View: Today ────────────────────────────────────────────────────────────

const TodayView: React.FC<{
  items: QueueItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}> = ({ items, selectedId, onSelect }) => {
  const now = new Date()
  const todayItems = items.filter((i) => {
    const scheduled = new Date(i.scheduledForLocal)
    return scheduled.toDateString() === now.toDateString()
  })

  const groupByTime = (items: QueueItem[]) => {
    const groups: Record<string, QueueItem[]> = {
      'Ready Now': [],
      'Morning': [],
      'Afternoon': [],
      'Evening': [],
      'Outside Window': [],
    }

    items.forEach((item) => {
      const scheduled = new Date(item.scheduledForLocal)
      if (scheduled <= now) {
        groups['Ready Now'].push(item)
      } else {
        const hour = scheduled.getHours()
        if (hour >= 6 && hour < 12) groups['Morning'].push(item)
        else if (hour >= 12 && hour < 17) groups['Afternoon'].push(item)
        else if (hour >= 17 && hour < 22) groups['Evening'].push(item)
        else groups['Outside Window'].push(item)
      }
    })
    return groups
  }

  const groups = groupByTime(todayItems)

  return (
    <div className="nx-queue-view nx-animate-fade-in">
      {Object.entries(groups).map(
        ([timeGroup, groupItems]) =>
          groupItems.length > 0 && (
            <div key={timeGroup} className="nx-queue-group">
              <div className="nx-queue-group-header">
                <Icon name="clock" style={{ width: 14, height: 14, color: 'var(--text-muted)' }} />
                <h3>{timeGroup}</h3>
                <span className="nx-queue-group-count">{groupItems.length}</span>
              </div>
              <div className="nx-queue-grid">
                {groupItems.map((item) => (
                  <QueueCard key={item.id} item={item} selected={selectedId === item.id} onClick={() => onSelect(item.id)} />
                ))}
              </div>
            </div>
          ),
      )}
    </div>
  )
}

// ── View: Week ─────────────────────────────────────────────────────────────

const WeekView: React.FC<{
  items: QueueItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}> = ({ items }) => {
  const now = new Date()
  const weekDays: Date[] = []
  const firstDay = new Date(now)
  firstDay.setDate(now.getDate() - now.getDay())

  for (let i = 0; i < 7; i++) {
    const day = new Date(firstDay)
    day.setDate(firstDay.getDate() + i)
    weekDays.push(day)
  }

  const dayGroups = useMemo(() => {
    const groups: Record<string, QueueItem[]> = {}
    weekDays.forEach((day) => {
      groups[day.toISOString().split('T')[0]] = []
    })
    items.forEach((item) => {
      const key = item.scheduledForLocal.split('T')[0]
      if (key in groups) groups[key].push(item)
    })
    return groups
  }, [items])

  return (
    <div className="nx-queue-view nx-animate-fade-in">
      <div className="nx-queue-week-board">
        {weekDays.map((day) => {
          const key = day.toISOString().split('T')[0]
          const dayItems = dayGroups[key] || []
          const isToday = day.toDateString() === now.toDateString()

          return (
            <div key={key} className={cls('nx-queue-day-column', isToday && 'is-today')}>
              <div className="nx-queue-day-header">
                <span className="nx-day-name">{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                <span className="nx-day-number">{day.getDate()}</span>
              </div>
              <div className="nx-queue-day-stats">
                <div className="nx-day-stat">
                  <small>Sends</small>
                  <b>{dayItems.filter((i) => i.status === 'sent' || i.status === 'delivered').length}</b>
                </div>
                <div className="nx-day-stat">
                  <small>Pending</small>
                  <b>{dayItems.filter((i) => i.status === 'scheduled' || i.status === 'ready').length}</b>
                </div>
              </div>
              <div className="nx-day-volume-track">
                <div 
                  className="nx-day-volume-bar" 
                  style={{ height: `${Math.min(dayItems.length * 4, 100)}%`, opacity: 0.6 + (dayItems.length * 0.05) }} 
                />
              </div>
              {dayItems.length === 0 && <div className="nx-day-empty">Empty</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── View: Month ────────────────────────────────────────────────────────────

const MonthView: React.FC<{
  items: QueueItem[]
}> = ({ items }) => {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const firstDay = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startingDay = firstDay.getDay()

  const calendarDays = Array.from({ length: 42 }, (_, i) => {
    const dayNum = i - startingDay + 1
    return dayNum > 0 && dayNum <= daysInMonth ? new Date(year, month, dayNum) : null
  })

  const dayGroups = useMemo(() => {
    const groups: Record<string, QueueItem[]> = {}
    items.forEach((item) => {
      const key = item.scheduledForLocal.split('T')[0]
      if (!groups[key]) groups[key] = []
      groups[key].push(item)
    })
    return groups
  }, [items])

  return (
    <div className="nx-queue-view nx-animate-fade-in">
      <div className="nx-queue-month-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="nx-month-day-label">{d}</div>
        ))}
        {calendarDays.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} className="nx-month-cell is-empty" />
          const key = day.toISOString().split('T')[0]
          const dayItems = dayGroups[key] || []
          const intensity = Math.min(dayItems.length / 20, 1)

          return (
            <div key={key} className={cls('nx-month-cell', day.toDateString() === now.toDateString() && 'is-today')}>
              <span className="nx-month-date">{day.getDate()}</span>
              {dayItems.length > 0 && (
                <div className="nx-month-indicator" style={{ background: `rgba(10, 132, 255, ${0.1 + intensity * 0.4})` }}>
                  <b>{dayItems.length}</b>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── View: List ─────────────────────────────────────────────────────────────

const ListView: React.FC<{
  items: QueueItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}> = ({ items, selectedId, onSelect }) => (
  <div className="nx-queue-view nx-animate-fade-in">
    <div className="nx-queue-table-container">
      <table className="nx-queue-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Scheduled</th>
            <th>Seller / Address</th>
            <th>Market</th>
            <th>Touch</th>
            <th>Template</th>
            <th>Priority</th>
            <th>Retries</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className={cls(selectedId === item.id && 'is-selected')}
              onClick={() => onSelect(item.id)}
            >
              <td><Badge type={item.status}>{item.status}</Badge></td>
              <td className="nx-mono">{new Date(item.scheduledForLocal).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
              <td>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{item.sellerName}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.propertyAddress}</div>
              </td>
              <td>{item.market}</td>
              <td style={{ textAlign: 'center' }}>{item.touchNumber}</td>
              <td>{item.templateName}</td>
              <td><span className={cls('nx-pri-pill', `is-${item.priority.toLowerCase()}`)}>{item.priority}</span></td>
              <td style={{ textAlign: 'center' }}>{item.retryCount}/{item.maxRetries}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)

// ── View: Approval ─────────────────────────────────────────────────────────

const ApprovalView: React.FC<{
  items: QueueItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}> = ({ items, selectedId, onSelect }) => {
  const approvalItems = items.filter((i) => i.status === 'approval' || i.requiresApproval)

  return (
    <div className="nx-queue-view nx-animate-fade-in">
      <div className="nx-approval-grid">
        {approvalItems.map((item) => (
          <div
            key={item.id}
            className={cls('nx-approval-card', selectedId === item.id && 'is-selected')}
            onClick={() => onSelect(item.id)}
          >
            <div className="nx-approval-card-header">
              <div>
                <h3>{item.sellerName}</h3>
                <small>{item.propertyAddress}</small>
              </div>
              <div className={cls('nx-risk-tag', `is-${item.riskLevel}`)}>{item.riskLevel} Risk</div>
            </div>
            <div className="nx-approval-message-preview">
              <Icon name="message" />
              <p>{item.messageText}</p>
            </div>
            <div className="nx-approval-meta">
              <span><Icon name="target" /> {item.market}</span>
              <span><Icon name="spark" /> AI {item.aiConfidence}%</span>
            </div>
            <div className="nx-approval-actions">
              <button className="nx-btn nx-btn--primary">Approve</button>
              <button className="nx-btn nx-btn--secondary">Edit</button>
              <button className="nx-btn nx-btn--secondary">Hold</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── View: Failed ───────────────────────────────────────────────────────────

const FailedView: React.FC<{
  items: QueueItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}> = ({ items, selectedId, onSelect }) => {
  const failedItems = items.filter((i) => i.status === 'failed' || i.status === 'retry')
  
  const reasonGroups = useMemo(() => {
    const groups: Record<string, QueueItem[]> = {}
    failedItems.forEach((item) => {
      const reason = item.failureReason || 'unknown'
      if (!groups[reason]) groups[reason] = []
      groups[reason].push(item)
    })
    return groups
  }, [failedItems])

  return (
    <div className="nx-queue-view nx-animate-fade-in">
      {Object.entries(reasonGroups).map(([reason, groupItems]) => (
        <div key={reason} className="nx-failure-group">
          <div className="nx-failure-group-header">
            <Icon name="alert" />
            <h3>{reason.replace(/_/g, ' ')}</h3>
            <span className="nx-count-badge">{groupItems.length}</span>
          </div>
          <div className="nx-failure-grid">
            {groupItems.map((item) => (
              <div 
                key={item.id} 
                className={cls('nx-failure-item', selectedId === item.id && 'is-selected')}
                onClick={() => onSelect(item.id)}
              >
                <div className="nx-failure-item-top">
                  <strong>{item.sellerName}</strong>
                  <small>Retry {item.retryCount}/{item.maxRetries}</small>
                </div>
                <p>{item.propertyAddress}</p>
                <div className="nx-failure-actions">
                  <button className="nx-btn nx-btn--xs nx-btn--primary">Retry Now</button>
                  <button className="nx-btn nx-btn--xs nx-btn--secondary">Hold</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Sub-component: Queue Card ──────────────────────────────────────────────

const QueueCard: React.FC<{
  item: QueueItem
  selected: boolean
  onClick: () => void
}> = ({ item, selected, onClick }) => (
  <div className={cls('nx-queue-card', selected && 'is-selected')} onClick={onClick}>
    <div className="nx-queue-card__header">
      <span className="nx-queue-card__seller">{item.sellerName}</span>
      <Badge type={item.status}>{item.status}</Badge>
    </div>
    <div className="nx-queue-card__address">{item.propertyAddress}</div>
    <div className="nx-queue-card__meta">
      <span className="nx-market-tag">{item.market}</span>
      <span className="nx-touch-tag">Touch {item.touchNumber}</span>
      <span className={cls('nx-pri-pill', `is-${item.priority.toLowerCase()}`)}>{item.priority}</span>
    </div>
    <div className="nx-queue-card__preview">{item.messageText.substring(0, 80)}...</div>
    <div className="nx-queue-card__footer">
      <span className="nx-card-time">
        <Icon name="clock" />
        {new Date(item.scheduledForLocal).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
      <span className="nx-card-template">
        <Icon name="file-text" />
        {item.templateName}
      </span>
    </div>
  </div>
)

// ── Sub-component: Inspector ───────────────────────────────────────────────

const QueueInspector: React.FC<{
  item: QueueItem | null
  onClose: () => void
}> = ({ item, onClose }) => {
  if (!item) {
    return (
      <div className="nx-queue-inspector is-empty">
        <div className="nx-inspector-empty-state">
          <Icon name="radar" />
          <p>Select a queue item to inspect operational details</p>
        </div>
      </div>
    )
  }

  return (
    <div className="nx-queue-inspector nx-animate-fade-in">
      <div className="nx-queue-inspector-header">
        <div className="nx-inspector-title">
          <Icon name="activity" />
          <h2>Item Intelligence</h2>
        </div>
        <button className="nx-icon-btn" onClick={onClose}><Icon name="close" /></button>
      </div>

      <div className="nx-queue-inspector-body">
        <section className="nx-queue-inspector-section">
          <div className="nx-queue-inspector-section-title">Queue Summary</div>
          <div className="nx-queue-inspector-row">
            <span className="nx-queue-inspector-label">Queue ID</span>
            <span className="nx-queue-inspector-value nx-mono">{item.queueId}</span>
          </div>
          <div className="nx-queue-inspector-row">
            <span className="nx-queue-inspector-label">Status</span>
            <Badge type={item.status}>{item.status}</Badge>
          </div>
          <div className="nx-queue-inspector-row">
            <span className="nx-queue-inspector-label">Scheduled</span>
            <span className="nx-queue-inspector-value">{new Date(item.scheduledForLocal).toLocaleString()}</span>
          </div>
          <div className="nx-queue-inspector-row">
            <span className="nx-queue-inspector-label">Priority</span>
            <span className={cls('nx-pri-pill', `is-${item.priority.toLowerCase()}`)}>{item.priority}</span>
          </div>
        </section>

        <section className="nx-queue-inspector-section">
          <div className="nx-queue-inspector-section-title">Seller & Property</div>
          <div className="nx-queue-inspector-row">
            <span className="nx-queue-inspector-label">Seller</span>
            <span className="nx-queue-inspector-value">{item.sellerName}</span>
          </div>
          <div className="nx-queue-inspector-row">
            <span className="nx-queue-inspector-label">Phone</span>
            <span className="nx-queue-inspector-value nx-mono">{item.phone}</span>
          </div>
          <div className="nx-queue-inspector-row">
            <span className="nx-queue-inspector-label">Address</span>
            <span className="nx-queue-inspector-value">{item.propertyAddress}</span>
          </div>
          <div className="nx-queue-inspector-row">
            <span className="nx-queue-inspector-label">Market</span>
            <span className="nx-queue-inspector-value">{item.market}</span>
          </div>
        </section>

        <section className="nx-queue-inspector-section">
          <div className="nx-queue-inspector-section-title">Message</div>
          <div className="nx-queue-inspector-row">
            <span className="nx-queue-inspector-label">Template</span>
            <span className="nx-queue-inspector-value">{item.templateName}</span>
          </div>
          <div className="nx-queue-inspector-message-box">
            {item.messageText}
          </div>
          <div className="nx-queue-inspector-row" style={{ marginTop: 8 }}>
            <span className="nx-queue-inspector-label">Segments</span>
            <span className="nx-queue-inspector-value">{Math.ceil(item.messageText.length / 160)}</span>
          </div>
        </section>

        <section className="nx-queue-inspector-section">
          <div className="nx-queue-inspector-section-title">Delivery & Retry</div>
          <div className="nx-queue-inspector-row">
            <span className="nx-queue-inspector-label">Delivery</span>
            <Badge type={item.deliveryStatus}>{item.deliveryStatus}</Badge>
          </div>
          <div className="nx-queue-inspector-row">
            <span className="nx-queue-inspector-label">Attempts</span>
            <span className="nx-queue-inspector-value">{item.retryCount} / {item.maxRetries}</span>
          </div>
          {item.failureReason && (
            <div className="nx-failure-callout">
              <strong>Failure:</strong> {item.failureReason.replace(/_/g, ' ')}
            </div>
          )}
        </section>
      </div>

      <div className="nx-queue-inspector-actions">
        <button className="nx-btn nx-btn--primary">Approve</button>
        <button className="nx-btn nx-btn--secondary">Reschedule</button>
        <button className="nx-btn nx-btn--secondary">Hold</button>
        <button className="nx-btn nx-btn--danger">Cancel</button>
      </div>
    </div>
  )
}

// ── Main Queue Page ────────────────────────────────────────────────────────

export const QueuePage: React.FC<QueuePageProps> = ({ data }) => {
  const [view, setView] = useState<QueueView>('today')
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedBucket, setSelectedBucket] = useState<QueueBucket | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  
  const [_filters, _setFilters] = useState<QueueFilters>({
    markets: [],
    statuses: [],
    agents: [],
    priorities: [],
    templates: [],
    useCases: [],
    languages: [],
    contactWindows: [],
    riskLevels: [],
    searchQuery: '',
  })

  const selectedItem = useMemo(() => data.items.find((i) => i.id === selectedItemId) || null, [data.items, selectedItemId])

  const filteredItems = useMemo(() => {
    let items = data.items
    if (selectedBucket) {
      items = items.filter((i) => i.status === selectedBucket)
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      items = items.filter(
        (i) =>
          i.sellerName.toLowerCase().includes(q) ||
          i.propertyAddress.toLowerCase().includes(q) ||
          i.market.toLowerCase().includes(q),
      )
    }
    return items
  }, [data.items, selectedBucket, searchQuery])

  // Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.key === '1') setView('today')
      if (e.key === '2') setView('week')
      if (e.key === '3') setView('month')
      if (e.key === '4') setView('list')
      if (e.key === '5') setView('approval')
      if (e.key === '6') setView('failed')
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="nx-premium-queue">
      <header className="nx-queue-topbar">
        <div className="nx-queue-topbar__title">
          <div className="nx-topbar__logo" style={{ width: 32, height: 32 }}>
            <Icon name="radar" />
          </div>
          <h1>Operations Queue</h1>
        </div>

        <div className="nx-global-search">
          <Icon name="search" />
          <input 
            placeholder="Search queue..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <kbd>⌘K</kbd>
        </div>

        <div className="nx-queue-view-switcher">
          {(['today', 'week', 'month', 'list', 'approval', 'failed'] as QueueView[]).map((v) => (
            <button
              key={v}
              className={cls('nx-queue-view-btn', view === v && 'is-active')}
              onClick={() => setView(v)}
            >
              {v.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <div className="nx-queue-shell">
        <aside className="nx-queue-sidebar">
          <div className="nx-queue-sidebar-section">
            <span className="nx-queue-sidebar-label">Send Capacity</span>
            <div className="nx-queue-capacity">
              <div className="nx-queue-capacity-item">
                <span className="nx-queue-capacity-label">Today's Sends</span>
                <span className="nx-queue-capacity-value">{data.sentTodayCount}</span>
              </div>
              <div className="nx-queue-capacity-item">
                <span className="nx-queue-capacity-label">Remaining Safe</span>
                <span className="nx-queue-capacity-value" style={{ color: 'var(--success)' }}>{data.safeCapacityRemaining}</span>
              </div>
              <div className="nx-queue-capacity-item">
                <span className="nx-queue-capacity-label">Failed Today</span>
                <span className="nx-queue-capacity-value" style={{ color: 'var(--danger)' }}>{data.failedCount}</span>
              </div>
            </div>
          </div>

          <div className="nx-queue-sidebar-section">
            <span className="nx-queue-sidebar-label">Queue Status</span>
            <StatusPill label="Ready Now" count={data.readyCount} active={selectedBucket === 'ready'} onClick={() => setSelectedBucket(selectedBucket === 'ready' ? null : 'ready')} />
            <StatusPill label="Scheduled" count={data.scheduledCount} active={selectedBucket === 'scheduled'} onClick={() => setSelectedBucket(selectedBucket === 'scheduled' ? null : 'scheduled')} />
            <StatusPill label="Approvals" count={data.approvalCount} active={selectedBucket === 'approval'} onClick={() => setSelectedBucket(selectedBucket === 'approval' ? null : 'approval')} />
            <StatusPill label="Failed" count={data.failedCount} active={selectedBucket === 'failed'} onClick={() => setSelectedBucket(selectedBucket === 'failed' ? null : 'failed')} />
          </div>

          <div className="nx-queue-sidebar-section">
            <span className="nx-queue-sidebar-label">Active Markets</span>
            {['Dallas', 'Austin', 'Houston', 'Denver', 'Minneapolis'].map((m) => (
              <label key={m} className="nx-market-filter" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" style={{ accentColor: 'var(--accent-blue)' }} />
                <span style={{ color: 'var(--text-secondary)' }}>{m}</span>
              </label>
            ))}
          </div>
        </aside>

        <main className="nx-queue-main">
          <div className="nx-queue-scroll-area">
            {view === 'today' && <TodayView items={filteredItems} selectedId={selectedItemId} onSelect={setSelectedItemId} />}
            {view === 'week' && <WeekView items={filteredItems} selectedId={selectedItemId} onSelect={setSelectedItemId} />}
            {view === 'month' && <MonthView items={filteredItems} />}
            {view === 'list' && <ListView items={filteredItems} selectedId={selectedItemId} onSelect={setSelectedItemId} />}
            {view === 'approval' && <ApprovalView items={filteredItems} selectedId={selectedItemId} onSelect={setSelectedItemId} />}
            {view === 'failed' && <FailedView items={filteredItems} selectedId={selectedItemId} onSelect={setSelectedItemId} />}
          </div>
        </main>

        <QueueInspector item={selectedItem} onClose={() => setSelectedItemId(null)} />
      </div>
    </div>
  )
}
