import { useState, useEffect } from 'react'
import { Icon } from '../../../shared/icons'
import { formatRelativeTime } from '../../../shared/formatters'
import { fetchInboxActivity, undoInboxActivity, type InboxActivityEvent } from '../../../lib/data/inboxActivityData'

const cls = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

export const InboxActivityPanel = ({
  threadKey,
  onClose,
  onViewThread,
}: {
  threadKey?: string
  onClose: () => void
  onViewThread?: (threadKey: string) => void
}) => {
  const [activities, setActivities] = useState<InboxActivityEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void fetchInboxActivity(threadKey).then(data => {
      if (!cancelled) {
        setActivities(data)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [threadKey])

  const handleUndo = async (id: string) => {
    const result = await undoInboxActivity(id)
    if (result.ok) {
      // Refresh
      setLoading(true)
      const data = await fetchInboxActivity(threadKey)
      setActivities(data)
      setLoading(false)
    }
  }

  const getIcon = (type: string) => {
    switch (type) {
      case 'stage_change': return 'trending-up'
      case 'archive_thread': return 'archive'
      case 'star_thread': return 'star'
      case 'pin_thread': return 'pin'
      case 'message_sent': return 'send'
      case 'message_received': return 'message'
      case 'message_failed': return 'alert'
      default: return 'activity'
    }
  }

  return (
    <aside className="nx-activity-panel nx-liquid-panel">
      <header>
        <div>
          <span>Command Center</span>
          <strong>Activity Log</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Close activity log">
          <Icon name="close" />
        </button>
      </header>

      <div className="nx-activity-list">
        {loading && <p className="nx-activity-empty">Loading history...</p>}
        {!loading && activities.length === 0 && <p className="nx-activity-empty">No recent activity found.</p>}
        
        {activities.map(item => (
          <article key={item.id} className="nx-activity-card">
            <div className="nx-activity-card__icon">
              <Icon name={getIcon(item.event_type) as any} />
            </div>
            <div className="nx-activity-card__main">
              <div className="nx-activity-card__top">
                <strong>{item.title}</strong>
                <time>{formatRelativeTime(item.created_at)}</time>
              </div>
              <p>{item.description}</p>
              <div className="nx-activity-card__footer">
                <small>By {item.actor}</small>
                <div className="nx-activity-card__actions">
                  {item.undo_payload && (
                    <button type="button" onClick={() => handleUndo(item.id)}>Undo</button>
                  )}
                  {onViewThread && (
                    <button type="button" onClick={() => onViewThread(item.thread_key)}>View</button>
                  )}
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </aside>
  )
}
