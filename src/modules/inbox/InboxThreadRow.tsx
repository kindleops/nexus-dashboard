import type { InboxWorkflowThread } from '../../lib/data/inboxWorkflowData'
import { formatRelativeTime } from '../../shared/formatters'

const statusClass = (status?: string): string => `nx-thread-badge nx-thread-badge--${(status ?? 'unknown').replace(/_/g, '-')}`

export const InboxThreadRow = ({
  thread,
  selected,
  onSelect,
  onArchive,
  onMarkRead,
}: {
  thread: InboxWorkflowThread
  selected: boolean
  onSelect: () => void
  onArchive: () => void
  onMarkRead?: () => void
}) => {
  const chips = [
    thread.priority,
    thread.queueStatus || thread.inboxStage,
  ].filter(Boolean).slice(0, 2)

  return (
    <button
      type="button"
      className={`nx-thread-card nx-thread-row ${selected ? 'is-selected' : ''} ${!thread.isRead ? 'is-unread' : ''}`}
      onClick={onSelect}
    >
      <div className="nx-thread-row__top">
        <div className="nx-thread-row__title">
          {!thread.isRead && <span className="nx-thread-row__unread-dot" />}
          <span className="nx-thread-row__owner">{thread.ownerName}</span>
          <span className="nx-thread-row__phone">{thread.phoneNumber || thread.canonicalE164 || 'no phone'}</span>
        </div>
        <span className="nx-thread-row__time">{formatRelativeTime(thread.lastMessageAt)}</span>
      </div>

      <div className="nx-thread-row__preview">{thread.lastMessageBody || thread.preview}</div>

      <div className="nx-thread-row__meta">
        {chips.map((chip) => (
          <span key={chip} className={statusClass(chip)}>{chip}</span>
        ))}
        {thread.isPinned && <span className="nx-thread-row__pin">Pinned</span>}
      </div>

      <div className="nx-thread-row__footer nx-thread-row__hover-actions">
        {!thread.isArchived && (
          <>
            {onMarkRead && !thread.isRead && (
              <button type="button" className="nx-inline-button" onClick={(e) => { e.stopPropagation(); onMarkRead() }}>
                Read
              </button>
            )}
            <button type="button" className="nx-inline-button" onClick={(e) => { e.stopPropagation(); onArchive() }}>
              Archive
            </button>
          </>
        )}
        {thread.isArchived && <span className="nx-thread-row__archived">Archived</span>}
      </div>
    </button>
  )
}
