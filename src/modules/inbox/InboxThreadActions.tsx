import { Icon } from '../../shared/icons'
import type { InboxWorkflowThread } from '../../lib/data/inboxWorkflowData'

export const InboxThreadActions = ({
  thread,
  onArchive,
  onUnarchive,
  onMarkRead,
  onMarkUnread,
  onPin,
  onUnpin,
}: {
  thread: InboxWorkflowThread
  onArchive: () => void
  onUnarchive: () => void
  onMarkRead: () => void
  onMarkUnread: () => void
  onPin: () => void
  onUnpin: () => void
}) => {
  return (
    <div className="nx-inbox-thread-actions">
      <button type="button" className="nx-inbox__conv-btn nx-inbox__conv-btn--ghost" onClick={thread.isPinned ? onUnpin : onPin}>
        <Icon name="flag" className="nx-inbox__conv-btn-icon" />
        {thread.isPinned ? 'Unpin' : 'Pin'}
      </button>
      <button type="button" className="nx-inbox__conv-btn nx-inbox__conv-btn--ghost" onClick={thread.isRead ? onMarkUnread : onMarkRead}>
        <Icon name="inbox" className="nx-inbox__conv-btn-icon" />
        {thread.isRead ? 'Mark Unread' : 'Mark Read'}
      </button>
      {!thread.isArchived ? (
        <button type="button" className="nx-inbox__conv-btn nx-inbox__conv-btn--ghost" onClick={onArchive}>
          <Icon name="archive" className="nx-inbox__conv-btn-icon" />
          Archive
        </button>
      ) : (
        <button type="button" className="nx-inbox__conv-btn nx-inbox__conv-btn--ghost" onClick={onUnarchive}>
          <Icon name="archive" className="nx-inbox__conv-btn-icon" />
          Unarchive
        </button>
      )}
    </div>
  )
}
