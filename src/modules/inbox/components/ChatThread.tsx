import type { ThreadMessage } from '../../../lib/data/inboxData'
import type { InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import { Icon } from '../../../shared/icons'
import { formatRelativeTime } from '../../../shared/formatters'

const cls = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

interface ChatThreadProps {
  thread: InboxWorkflowThread | null
  messages: ThreadMessage[]
  loading: boolean
  isSuppressed: boolean
  isStarred?: boolean
  onTogglePin?: () => void
  onToggleStar?: () => void
  onToggleArchive?: () => void
}

const fallback = (value: unknown, placeholder = 'Unknown') => {
  const text = String(value ?? '').trim()
  return text || placeholder
}

const titleCase = (value: string) =>
  value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

type ThreadDealFields = InboxWorkflowThread & {
  askingPrice?: unknown
  dealValue?: unknown
}

export const ChatThread = ({
  thread,
  messages,
  loading,
  isSuppressed,
  isStarred = false,
  onTogglePin,
  onToggleStar,
  onToggleArchive,
}: ChatThreadProps) => {
  if (!thread) return (
    <div className="nx-chat-container is-empty">
      <div className="nx-inbox__workspace-empty">
        <p>Select a thread to view the conversation history.</p>
      </div>
    </div>
  )

  if (loading && messages.length === 0) return (
    <div className="nx-chat-container">
      <div className="nx-inbox__messages-loading">
        <Icon name="activity" className="nx-inbox__messages-loading-icon" />
        <span>Loading messages…</span>
      </div>
    </div>
  )

  return (
    <div className="nx-chat-container">
      <header className="nx-chat-header">
        <div className="nx-chat-header__info">
          <span className="nx-chat-header__name">{fallback(thread.ownerName, 'Unknown Seller')}</span>
          <span className="nx-chat-header__subject">{fallback(thread.propertyAddress || thread.subject, 'Property Unknown')}</span>
          <div className="nx-thread-meta-line">
            <span className="nx-market-tag">{fallback(thread.market || thread.marketId, 'Market Unknown')}</span>
            <span className="nx-thread-value">Asking: {fallback((thread as ThreadDealFields).askingPrice || (thread as ThreadDealFields).dealValue, 'Unknown')}</span>
            {isSuppressed && <span className="nx-suppression-badge">Opted Out / Suppressed</span>}
          </div>
        </div>
        <div className="nx-chat-header__actions">
          <span className={cls('nx-stage-pill', `is-${isSuppressed ? 'dnc_opt_out' : thread.inboxStage}`)}>
            {isSuppressed ? 'Suppressed' : titleCase(thread.inboxStage)}
          </span>
          <button
            type="button"
            className={cls('nx-chat-action', isStarred && 'is-active')}
            title={isStarred ? 'Unstar thread' : 'Star thread'}
            onClick={onToggleStar}
          >
            <Icon name="star" />
          </button>
          <button
            type="button"
            className={cls('nx-chat-action', thread.isPinned && 'is-active')}
            title={thread.isPinned ? 'Unpin thread' : 'Pin thread'}
            onClick={onTogglePin}
          >
            <Icon name="pin" />
          </button>
          <button
            type="button"
            className="nx-chat-action"
            title={thread.isArchived ? 'Unarchive thread' : 'Archive thread'}
            onClick={onToggleArchive}
          >
            <Icon name="archive" />
          </button>
        </div>
      </header>

      <div className="nx-message-list">
        {messages.map(msg => (
          <div key={msg.id} className={cls('nx-bubble-wrap', msg.direction === 'inbound' ? 'is-inbound' : 'is-outbound')}>
            <div className="nx-chat-bubble">
              {msg.body}
            </div>
            <span className="nx-bubble-time">
              {formatRelativeTime(msg.createdAt)}
              {msg.direction === 'outbound' && msg.deliveryStatus && (
                <b>{titleCase(msg.deliveryStatus)}</b>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
