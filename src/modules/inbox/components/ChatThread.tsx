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
  onLoadMore?: () => void
  allLoaded?: boolean
  messageCount?: number
}

export const ChatThread = ({ 
  thread, 
  messages, 
  loading, 
  onLoadMore, 
  allLoaded = false,
  messageCount = 0 
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
          <span className="nx-chat-header__name">{thread.ownerName}</span>
          <span className="nx-chat-header__subject">{thread.subject}</span>
        </div>
        <div className="nx-chat-header__pills">
          <span className={cls('nx-stage-pill', `is-${thread.inboxStage}`)}>{thread.inboxStage}</span>
          <span className="nx-message-count">{messageCount} message{messageCount !== 1 ? 's' : ''}</span>
        </div>
      </header>

      <div className="nx-message-list">
        {!allLoaded && messages.length > 0 && (
          <div className="nx-load-more-container">
            <button 
              className="nx-load-more-button"
              onClick={onLoadMore}
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Load More Messages'}
            </button>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={cls('nx-bubble-wrap', msg.direction === 'inbound' ? 'is-inbound' : 'is-outbound')}>
            <div className="nx-chat-bubble">
              {msg.body}
            </div>
            <span className="nx-bubble-time">{formatRelativeTime(msg.createdAt)}</span>
          </div>
        ))}

        {allLoaded && messages.length > 0 && (
          <div className="nx-all-loaded-indicator">
            <span>No more messages to load</span>
          </div>
        )}
      </div>
    </div>
  )
}
