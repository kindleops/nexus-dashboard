import { useEffect, useMemo, useState } from 'react'
import type { QueueItem, QueueModel, QueueView, QueueFilters, QueueBucket } from './queue.types'

interface QueuePageProps {
  data: QueueModel
}

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
      'Morning (6-12)': [],
      'Afternoon (12-5)': [],
      'Evening (5-10)': [],
      'Outside Window': [],
    }

    items.forEach((item) => {
      const scheduled = new Date(item.scheduledForLocal)
      if (scheduled <= now) {
        groups['Ready Now'].push(item)
      } else {
        const hour = scheduled.getHours()
        if (hour >= 6 && hour < 12) {
          groups['Morning (6-12)'].push(item)
        } else if (hour >= 12 && hour < 17) {
          groups['Afternoon (12-5)'].push(item)
        } else if (hour >= 17 && hour < 22) {
          groups['Evening (5-10)'].push(item)
        } else {
          groups['Outside Window'].push(item)
        }
      }
    })

    return groups
  }

  const groups = groupByTime(todayItems)

  return (
    <div className="queue-view queue-view--today">
      {Object.entries(groups).map(
        ([timeGroup, groupItems]) =>
          groupItems.length > 0 && (
            <div key={timeGroup} className="queue-time-group">
              <div className="queue-time-group__header">
                <h3 className="queue-time-group__title">{timeGroup}</h3>
                <span className="queue-time-group__count">{groupItems.length}</span>
              </div>
              <div className="queue-cards">
                {groupItems.map((item) => (
                  <div
                    key={item.id}
                    className={`queue-card ${selectedId === item.id ? 'queue-card--selected' : ''}`}
                    onClick={() => onSelect(item.id)}
                  >
                    <div className="queue-card__header">
                      <span className="queue-card__seller">{item.sellerName}</span>
                      <span className={`queue-status-badge queue-status--${item.status}`}>{item.status}</span>
                    </div>
                    <div className="queue-card__property">{item.propertyAddress}</div>
                    <div className="queue-card__meta">
                      <span className="queue-meta-item">{item.market}</span>
                      <span className="queue-meta-item">Touch {item.touchNumber}</span>
                      <span className={`queue-priority-badge queue-priority--${item.priority}`}>{item.priority}</span>
                    </div>
                    <div className="queue-card__message">{item.messageText.substring(0, 60)}...</div>
                    <div className="queue-card__footer">
                      <span className="queue-card__time">
                        {new Date(item.scheduledForLocal).toLocaleTimeString()}
                      </span>
                      <span className="queue-card__template">{item.templateName}</span>
                    </div>
                  </div>
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
}> = ({ items, selectedId: _selectedId, onSelect: _onSelect }) => {
  const now = new Date()
  const weekDays: Date[] = []
  const dayOfWeek = now.getDay()
  const firstDay = new Date(now)
  firstDay.setDate(now.getDate() - dayOfWeek)

  for (let i = 0; i < 7; i++) {
    const day = new Date(firstDay)
    day.setDate(firstDay.getDate() + i)
    weekDays.push(day)
  }

  const groupByDay = (items: QueueItem[]) => {
    const dayGroups: Record<string, QueueItem[]> = {}

    weekDays.forEach((day) => {
      const key = day.toISOString().split('T')[0]!
      dayGroups[key] = []
    })

    items.forEach((item) => {
      const key = item.scheduledForLocal.split('T')[0]!
      if (key in dayGroups) {
        dayGroups[key]!.push(item)
      }
    })

    return dayGroups
  }

  const dayGroups = groupByDay(items)

  return (
    <div className="queue-view queue-view--week">
      <div className="queue-week-board">
        {weekDays.map((day) => {
          const key = day.toISOString().split('T')[0]!
          const dayItems = dayGroups[key] || []
          const sendCount = dayItems.filter((i) => i.status === 'sent' || i.status === 'delivered').length
          const approvalCount = dayItems.filter((i) => i.status === 'approval').length
          const failedCount = dayItems.filter((i) => i.status === 'failed').length

          return (
            <div key={key} className="queue-day-card">
              <h3 className="queue-day-card__date">
                {day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </h3>
              <div className="queue-day-card__stats">
                <div className="queue-stat">
                  <span className="queue-stat__label">Sends</span>
                  <span className="queue-stat__value">{sendCount}</span>
                </div>
                <div className="queue-stat">
                  <span className="queue-stat__label">Approval</span>
                  <span className="queue-stat__value">{approvalCount}</span>
                </div>
                <div className="queue-stat">
                  <span className="queue-stat__label">Failed</span>
                  <span className="queue-stat__value">{failedCount}</span>
                </div>
              </div>
              <div className="queue-day-card__markets">
                {dayItems.length > 0 && (
                  <>
                    <div className="queue-day-card__market-list">
                      {Array.from(new Set(dayItems.map((i) => i.market))).map((market) => (
                        <span key={market} className="queue-market-tag">
                          {market}
                        </span>
                      ))}
                    </div>
                    <div className="queue-day-card__volume-bar" style={{ width: `${Math.min(dayItems.length * 5, 100)}%` }} />
                  </>
                )}
              </div>
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
  selectedId: string | null
  onSelect: (id: string) => void
}> = ({ items, selectedId: _selectedId, onSelect: _onSelect }) => {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const daysInMonth = lastDay.getDate()
  const startingDayOfWeek = firstDay.getDay()

  const calendarDays: (Date | null)[] = []
  for (let i = 0; i < startingDayOfWeek; i++) {
    calendarDays.push(null)
  }
  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push(new Date(year, month, i))
  }

  const groupByDay = (items: QueueItem[]) => {
    const dayGroups: Record<string, QueueItem[]> = {}

    items.forEach((item) => {
      const key = item.scheduledForLocal.split('T')[0]!
      if (!dayGroups[key]) {
        dayGroups[key] = []
      }
      dayGroups[key]!.push(item)
    })

    return dayGroups
  }

  const dayGroups = groupByDay(items)

  return (
    <div className="queue-view queue-view--month">
      <div className="queue-month-calendar">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div key={day} className="queue-month-header">
            {day}
          </div>
        ))}
        {calendarDays.map((day, idx) => {
          if (!day) {
            return <div key={`empty-${idx}`} className="queue-month-cell queue-month-cell--empty" />
          }

          const key = day.toISOString().split('T')[0]!
          const dayItems = dayGroups[key] || []

          return (
            <div key={key} className="queue-month-cell">
              <div className="queue-month-cell__date">{day.getDate()}</div>
              <div className="queue-month-cell__counts">
                <span className="queue-month-count">S: {dayItems.filter((i) => i.status === 'scheduled').length}</span>
                <span className="queue-month-count">X: {dayItems.filter((i) => i.status === 'sent').length}</span>
                <span className="queue-month-count queue-month-count--error">
                  F: {dayItems.filter((i) => i.status === 'failed').length}
                </span>
              </div>
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
  <div className="queue-view queue-view--list">
    <table className="queue-table">
      <thead className="queue-table__head">
        <tr>
          <th>Status</th>
          <th>Scheduled</th>
          <th>Seller</th>
          <th>Property</th>
          <th>Market</th>
          <th>Agent</th>
          <th>Template</th>
          <th>Touch</th>
          <th>Priority</th>
          <th>Retries</th>
          <th>Delivery</th>
        </tr>
      </thead>
      <tbody>
        {items.slice(0, 100).map((item) => (
          <tr
            key={item.id}
            className={`queue-table__row ${selectedId === item.id ? 'queue-table__row--selected' : ''}`}
            onClick={() => onSelect(item.id)}
          >
            <td>
              <span className={`queue-status-badge queue-status--${item.status}`}>{item.status}</span>
            </td>
            <td className="queue-table__mono">{new Date(item.scheduledForLocal).toLocaleString()}</td>
            <td>{item.sellerName}</td>
            <td>{item.propertyAddress.substring(0, 30)}</td>
            <td>{item.market}</td>
            <td>{item.agent}</td>
            <td>{item.templateName}</td>
            <td className="queue-table__center">{item.touchNumber}</td>
            <td>
              <span className={`queue-priority-badge queue-priority--${item.priority}`}>{item.priority}</span>
            </td>
            <td className="queue-table__center">
              {item.retryCount}/{item.maxRetries}
            </td>
            <td>
              <span className={`queue-delivery-badge queue-delivery--${item.deliveryStatus}`}>
                {item.deliveryStatus}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
    <div className="queue-view queue-view--approval">
      <div className="queue-approval-cards">
        {approvalItems.map((item) => (
          <div
            key={item.id}
            className={`queue-approval-card ${selectedId === item.id ? 'queue-approval-card--selected' : ''}`}
            onClick={() => onSelect(item.id)}
          >
            <div className="queue-approval-card__header">
              <h3 className="queue-approval-card__title">{item.sellerName}</h3>
              <span className={`queue-risk-badge queue-risk--${item.riskLevel}`}>{item.riskLevel} risk</span>
            </div>
            <div className="queue-approval-card__property">{item.propertyAddress}</div>
            <div className="queue-approval-card__meta">
              <span>{item.market}</span>
              <span>AI: {item.aiConfidence}%</span>
            </div>
            <div className="queue-approval-card__message">{item.messageText}</div>
            <div className="queue-approval-card__actions">
              <button className="queue-btn queue-btn--primary">Approve</button>
              <button className="queue-btn queue-btn--secondary">Edit</button>
              <button className="queue-btn queue-btn--secondary">Hold</button>
              <button className="queue-btn queue-btn--secondary">Reschedule</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── View: Failed / Retry ───────────────────────────────────────────────────

const FailedView: React.FC<{
  items: QueueItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}> = ({ items, selectedId, onSelect }) => {
  const failedItems = items.filter((i) => i.status === 'failed' || i.status === 'retry')

  const FAILURE_LABELS: Record<string, string> = {
    carrier_error: 'Carrier Error',
    textgrid_error: 'TextGrid Error',
    invalid_phone: 'Invalid Phone',
    dnc_conflict: 'DNC Conflict',
    outside_contact_window: 'Outside Contact Window',
    template_missing: 'Template Missing',
    retry_exhausted: 'Retry Exhausted',
    sync_error: 'Sync Error',
    unknown: 'Unknown Error',
  }

  const groupByReason = (items: QueueItem[]) => {
    const groups: Record<string, QueueItem[]> = {}
    items.forEach((item) => {
      const reason = item.failureReason || 'unknown'
      if (!groups[reason]) {
        groups[reason] = []
      }
      groups[reason]!.push(item)
    })
    return groups
  }

  const reasonGroups = groupByReason(failedItems)

  return (
    <div className="queue-view queue-view--failed">
      {Object.entries(reasonGroups).map(
        ([reason, groupItems]) =>
          groupItems.length > 0 && (
            <div key={reason} className="queue-failure-group">
              <h3 className="queue-failure-group__title">{FAILURE_LABELS[reason] || reason}</h3>
              <div className="queue-failure-items">
                {groupItems.map((item) => (
                  <div
                    key={item.id}
                    className={`queue-failure-item ${selectedId === item.id ? 'queue-failure-item--selected' : ''}`}
                    onClick={() => onSelect(item.id)}
                  >
                    <div className="queue-failure-item__header">
                      <span className="queue-failure-item__seller">{item.sellerName}</span>
                      <span className="queue-failure-item__retries">
                        Retry {item.retryCount}/{item.maxRetries}
                      </span>
                    </div>
                    <div className="queue-failure-item__property">{item.propertyAddress}</div>
                    <div className="queue-failure-item__actions">
                      <button className="queue-btn queue-btn--small queue-btn--secondary">Retry now</button>
                      <button className="queue-btn queue-btn--small queue-btn--secondary">Retry later</button>
                      <button className="queue-btn queue-btn--small queue-btn--secondary">Hold</button>
                      <button className="queue-btn queue-btn--small queue-btn--secondary">Mark resolved</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ),
      )}
    </div>
  )
}

// ── Left Rail Filter & Buckets ─────────────────────────────────────────────

const QueueLeftRail: React.FC<{
  data: QueueModel
  selectedBucket: QueueBucket | null
  onSelectBucket: (bucket: QueueBucket | null) => void
  filters: QueueFilters
  onFiltersChange: (filters: QueueFilters) => void
}> = ({ data, selectedBucket, onSelectBucket, filters: _filters, onFiltersChange: _onFiltersChange }) => {
  const buckets: Array<{ label: string; bucket: QueueBucket; count: number }> = [
    { label: 'Ready Now', bucket: 'ready', count: data.readyCount },
    { label: 'Scheduled', bucket: 'scheduled', count: data.scheduledCount },
    { label: 'Awaiting Approval', bucket: 'approval', count: data.approvalCount },
    { label: 'Failed', bucket: 'failed', count: data.failedCount },
    { label: 'Retry', bucket: 'retry', count: data.retryCount },
    { label: 'Held', bucket: 'held', count: data.heldCount },
    { label: 'Sent', bucket: 'sent', count: data.sentTodayCount },
    { label: 'Delivered', bucket: 'delivered', count: data.deliveredTodayCount },
  ]

  return (
    <div className="queue-left-rail">
      <div className="queue-capacity-card">
        <h4 className="queue-capacity-card__title">Send Capacity</h4>
        <div className="queue-capacity-item">
          <span className="queue-capacity-label">Sent today</span>
          <span className="queue-capacity-value">{data.sentTodayCount}</span>
        </div>
        <div className="queue-capacity-item">
          <span className="queue-capacity-label">Scheduled</span>
          <span className="queue-capacity-value">{data.scheduledCount}</span>
        </div>
        <div className="queue-capacity-item">
          <span className="queue-capacity-label">Failed</span>
          <span className="queue-capacity-value">{data.failedCount}</span>
        </div>
        <div className="queue-capacity-item">
          <span className="queue-capacity-label">Safe capacity left</span>
          <span className="queue-capacity-value">{data.safeCapacityRemaining}</span>
        </div>
      </div>

      <div className="queue-buckets">
        <h3 className="queue-buckets__title">Queue Status</h3>
        {buckets.map(({ label, bucket, count }) => (
          <button
            key={bucket}
            className={`queue-bucket-button ${selectedBucket === bucket ? 'queue-bucket-button--active' : ''}`}
            onClick={() => onSelectBucket(selectedBucket === bucket ? null : bucket)}
          >
            <span className="queue-bucket-label">{label}</span>
            <span className="queue-bucket-count">{count}</span>
          </button>
        ))}
      </div>

      <div className="queue-filters">
        <h3 className="queue-filters__title">Filters</h3>
        <div className="queue-filter-section">
          <label className="queue-filter-label">Markets</label>
          <div className="queue-filter-options">
            {['Dallas', 'Austin', 'Houston', 'San Antonio', 'Minneapolis', 'Denver'].map((market) => (
              <label key={market} className="queue-filter-checkbox">
                <input type="checkbox" readOnly />
                {market}
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Right Inspector ────────────────────────────────────────────────────────

const QueueInspector: React.FC<{
  item: QueueItem | null
  onClose: () => void
}> = ({ item, onClose }) => {
  if (!item) {
    return <div className="queue-inspector queue-inspector--empty">Select an item to view details</div>
  }

  return (
    <div className="queue-inspector">
      <button className="queue-inspector__close" onClick={onClose}>
        ✕
      </button>

      <section className="queue-inspector-section">
        <h3 className="queue-inspector-section__title">Queue Item</h3>
        <div className="queue-inspector-field">
          <span className="queue-inspector-label">ID</span>
          <code className="queue-inspector-value">{item.queueId}</code>
        </div>
        <div className="queue-inspector-field">
          <span className="queue-inspector-label">Status</span>
          <span className={`queue-status-badge queue-status--${item.status}`}>{item.status}</span>
        </div>
        <div className="queue-inspector-field">
          <span className="queue-inspector-label">Priority</span>
          <span className={`queue-priority-badge queue-priority--${item.priority}`}>{item.priority}</span>
        </div>
        <div className="queue-inspector-field">
          <span className="queue-inspector-label">Scheduled</span>
          <span className="queue-inspector-value">{new Date(item.scheduledForLocal).toLocaleString()}</span>
        </div>
        <div className="queue-inspector-field">
          <span className="queue-inspector-label">Timezone</span>
          <span className="queue-inspector-value">{item.timezone}</span>
        </div>
        <div className="queue-inspector-field">
          <span className="queue-inspector-label">Contact Window</span>
          <span className="queue-inspector-value">{item.contactWindow}</span>
        </div>
      </section>

      <section className="queue-inspector-section">
        <h3 className="queue-inspector-section__title">Seller & Property</h3>
        <div className="queue-inspector-field">
          <span className="queue-inspector-label">Seller</span>
          <span className="queue-inspector-value">{item.sellerName}</span>
        </div>
        <div className="queue-inspector-field">
          <span className="queue-inspector-label">Phone</span>
          <code className="queue-inspector-value">{item.phone}</code>
        </div>
        <div className="queue-inspector-field">
          <span className="queue-inspector-label">Property</span>
          <span className="queue-inspector-value">{item.propertyAddress}</span>
        </div>
        <div className="queue-inspector-field">
          <span className="queue-inspector-label">Market</span>
          <span className="queue-inspector-value">{item.market}</span>
        </div>
      </section>

      <section className="queue-inspector-section">
        <h3 className="queue-inspector-section__title">Message</h3>
        <div className="queue-inspector-field">
          <span className="queue-inspector-label">Template</span>
          <span className="queue-inspector-value">{item.templateName}</span>
        </div>
        <div className="queue-inspector-field">
          <span className="queue-inspector-label">Text</span>
          <div className="queue-inspector-message">{item.messageText}</div>
        </div>
        <div className="queue-inspector-field">
          <span className="queue-inspector-label">Characters</span>
          <span className="queue-inspector-value">{item.messageText.length}</span>
        </div>
      </section>

      <section className="queue-inspector-section">
        <h3 className="queue-inspector-section__title">Delivery & Retry</h3>
        <div className="queue-inspector-field">
          <span className="queue-inspector-label">Retry</span>
          <span className="queue-inspector-value">
            {item.retryCount}/{item.maxRetries}
          </span>
        </div>
        <div className="queue-inspector-field">
          <span className="queue-inspector-label">Delivery Status</span>
          <span className={`queue-delivery-badge queue-delivery--${item.deliveryStatus}`}>{item.deliveryStatus}</span>
        </div>
        {item.failureReason && (
          <div className="queue-inspector-field">
            <span className="queue-inspector-label">Failure</span>
            <span className="queue-inspector-value">{item.failureReason}</span>
          </div>
        )}
      </section>

      <div className="queue-inspector-actions">
        <button className="queue-btn queue-btn--primary">Approve</button>
        <button className="queue-btn queue-btn--secondary">Edit</button>
        <button className="queue-btn queue-btn--secondary">Hold</button>
        <button className="queue-btn queue-btn--secondary">Reschedule</button>
        {item.status === 'failed' && <button className="queue-btn queue-btn--secondary">Retry</button>}
        <button className="queue-btn queue-btn--secondary">Cancel</button>
        <button className="queue-btn queue-btn--secondary">Open in Inbox</button>
      </div>
    </div>
  )
}

// ── Command Palette Modal ──────────────────────────────────────────────────

const QueueCommandPalette: React.FC<{
  isOpen: boolean
  onClose: () => void
  items: QueueItem[]
}> = ({ isOpen, onClose, items: _items }) => {
  const [query, setQuery] = useState('')

  const commands = [
    { id: '1', label: 'Show ready now', action: () => {} },
    { id: '2', label: 'Show awaiting approval', action: () => {} },
    { id: '3', label: 'Show failed messages', action: () => {} },
    { id: '4', label: 'Show retry queue', action: () => {} },
    { id: '5', label: 'Show outside contact window', action: () => {} },
    { id: '6', label: 'Filter Dallas', action: () => {} },
    { id: '7', label: 'Filter Minneapolis', action: () => {} },
    { id: '8', label: 'Filter P0', action: () => {} },
    { id: '9', label: 'Filter AI confidence below 70', action: () => {} },
  ]

  if (!isOpen) return null

  return (
    <div className="queue-modal queue-modal--command-palette" onClick={onClose}>
      <div className="queue-modal__content" onClick={(e) => e.stopPropagation()}>
        <input
          type="text"
          className="queue-command-input"
          placeholder="Type a command…"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
          }}
        />
        <div className="queue-command-list">
          {commands
            .filter((cmd) => cmd.label.toLowerCase().includes(query.toLowerCase()))
            .map((cmd) => (
              <div
                key={cmd.id}
                className="queue-command-item"
                onClick={() => {
                  cmd.action()
                  onClose()
                }}
              >
                {cmd.label}
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

// ── Schedule Modal ─────────────────────────────────────────────────────────

const QueueScheduleModal: React.FC<{
  isOpen: boolean
  onClose: () => void
  item: QueueItem | null
}> = ({ isOpen, onClose, item }) => {
  if (!isOpen || !item) return null

  return (
    <div className="queue-modal queue-modal--schedule" onClick={onClose}>
      <div className="queue-modal__content" onClick={(e) => e.stopPropagation()}>
        <h3 className="queue-modal__title">Reschedule Message</h3>
        <div className="queue-schedule-options">
          <button className="queue-schedule-option">Today</button>
          <button className="queue-schedule-option">Tomorrow</button>
          <button className="queue-schedule-option">Next business day</button>
          <button className="queue-schedule-option">Custom date/time</button>
        </div>
        <div className="queue-schedule-settings">
          <label className="queue-checkbox">
            <input type="checkbox" defaultChecked />
            Respect contact window
          </label>
        </div>
        <div className="queue-modal-actions">
          <button className="queue-btn queue-btn--primary" onClick={onClose}>
            Save
          </button>
          <button className="queue-btn queue-btn--secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Queue Page ────────────────────────────────────────────────────────

export const QueuePage: React.FC<QueuePageProps> = ({ data }) => {
  const [view, setView] = useState<QueueView>('today')
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedBucket, setSelectedBucket] = useState<QueueBucket | null>(null)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false)
  const [filters, setFilters] = useState<QueueFilters>({
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

  // Filtered items
  const filteredItems = useMemo(() => {
    let items = data.items

    if (selectedBucket) {
      items = items.filter((i) => i.status === selectedBucket || (selectedBucket === 'delivered' && i.status === 'delivered'))
    }

    if (filters.markets.length > 0) {
      items = items.filter((i) => filters.markets.includes(i.market))
    }

    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase()
      items = items.filter(
        (i) =>
          i.sellerName.toLowerCase().includes(q) ||
          i.propertyAddress.toLowerCase().includes(q) ||
          i.market.toLowerCase().includes(q) ||
          i.templateName.toLowerCase().includes(q),
      )
    }

    return items
  }, [data.items, selectedBucket, filters])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't fire shortcuts while typing in input
      const target = e.target as HTMLElement
      if (target?.closest('input, textarea, [contenteditable]')) {
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsCommandPaletteOpen(!isCommandPaletteOpen)
      } else if (e.key === '1') {
        setView('today')
      } else if (e.key === '2') {
        setView('week')
      } else if (e.key === '3') {
        setView('month')
      } else if (e.key === '4') {
        setView('list')
      } else if (e.key === '5') {
        setView('approval')
      } else if (e.key === '6') {
        setView('failed')
      } else if (e.key === 'a' && selectedItem) {
        // Approve
        console.log('Approve:', selectedItem.id)
      } else if (e.key === 'h' && selectedItem) {
        // Hold
        console.log('Hold:', selectedItem.id)
      } else if (e.key === 'r' && selectedItem) {
        // Retry
        console.log('Retry:', selectedItem.id)
      } else if (e.key === 'e' && selectedItem) {
        // Edit
        console.log('Edit:', selectedItem.id)
      } else if (e.key === 's' && selectedItem) {
        // Schedule/Reschedule
        setIsScheduleModalOpen(true)
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && selectedItem?.status === 'approval') {
        // Approve/Send
        console.log('Quick approve:', selectedItem.id)
      } else if (e.key === 'Escape') {
        setSelectedItemId(null)
        setIsCommandPaletteOpen(false)
        setIsScheduleModalOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isCommandPaletteOpen, selectedItem])

  const handleSearch = (query: string) => {
    setFilters((prev) => ({ ...prev, searchQuery: query }))
  }

  const now = new Date()

  return (
    <div className="queue-page">
      {/* Header */}
      <div className="queue-header">
        <div className="queue-header__left">
          <h1 className="queue-header__title">Queue</h1>
          <div className="queue-status-chips">
            <span className="queue-status-chip queue-status-chip--ready">
              Ready <strong>{data.readyCount}</strong>
            </span>
            <span className="queue-status-chip queue-status-chip--scheduled">
              Scheduled <strong>{data.scheduledCount}</strong>
            </span>
            <span className="queue-status-chip queue-status-chip--approval">
              Approval <strong>{data.approvalCount}</strong>
            </span>
            <span className="queue-status-chip queue-status-chip--failed">
              Failed <strong>{data.failedCount}</strong>
            </span>
          </div>
        </div>

        <div className="queue-header__center">
          <input
            type="text"
            className="queue-search"
            placeholder="Search queue, seller, market, template, status…"
            value={filters.searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>

        <div className="queue-header__right">
          <div className="queue-view-switcher">
            {['today', 'week', 'month', 'list', 'approval', 'failed'].map((v) => (
              <button
                key={v}
                className={`queue-view-button ${view === v ? 'queue-view-button--active' : ''}`}
                onClick={() => setView(v as QueueView)}
                title={`${v} (${v === 'today' ? '1' : v.slice(0, 1).charCodeAt(0) - 96})`}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <span className="queue-header__time">{now.toLocaleTimeString()}</span>
          <button
            className="queue-header__command-hint"
            onClick={() => setIsCommandPaletteOpen(true)}
            title="Cmd+K"
          >
            ⌘K
          </button>
        </div>
      </div>

      {/* Main Layout */}
      <div className="queue-workspace">
        {/* Left Rail */}
        <div className="queue-column queue-column--left">
          <QueueLeftRail
            data={data}
            selectedBucket={selectedBucket}
            onSelectBucket={setSelectedBucket}
            filters={filters}
            onFiltersChange={setFilters}
          />
        </div>

        {/* Center Workspace */}
        <div className="queue-column queue-column--center">
          {view === 'today' && <TodayView items={filteredItems} selectedId={selectedItemId} onSelect={setSelectedItemId} />}
          {view === 'week' && <WeekView items={filteredItems} selectedId={selectedItemId} onSelect={setSelectedItemId} />}
          {view === 'month' && <MonthView items={filteredItems} selectedId={selectedItemId} onSelect={setSelectedItemId} />}
          {view === 'list' && <ListView items={filteredItems} selectedId={selectedItemId} onSelect={setSelectedItemId} />}
          {view === 'approval' && <ApprovalView items={filteredItems} selectedId={selectedItemId} onSelect={setSelectedItemId} />}
          {view === 'failed' && <FailedView items={filteredItems} selectedId={selectedItemId} onSelect={setSelectedItemId} />}
        </div>

        {/* Right Inspector */}
        <div className="queue-column queue-column--right">
          <QueueInspector item={selectedItem} onClose={() => setSelectedItemId(null)} />
        </div>
      </div>

      {/* Modals */}
      <QueueCommandPalette isOpen={isCommandPaletteOpen} onClose={() => setIsCommandPaletteOpen(false)} items={data.items} />
      <QueueScheduleModal isOpen={isScheduleModalOpen} onClose={() => setIsScheduleModalOpen(false)} item={selectedItem} />
    </div>
  )
}
