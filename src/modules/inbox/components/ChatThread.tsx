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
}

export const ChatThread = ({ thread, messages, loading }: ChatThreadProps) => {
  if (!thread) return (
    <div className="nx-chat-container is-empty">
      <div className="nx-inbox__workspace-empty">
        <p>Select a thread to view the conversation history.</p>
      </div>
    </div>
  )

  if (loading) return (
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
        </div>
      </header>

      <div className="nx-message-list">
        {messages.map(msg => (
          <div key={msg.id} className={cls('nx-bubble-wrap', msg.direction === 'inbound' ? 'is-inbound' : 'is-outbound')}>
            <div className="nx-chat-bubble">
              {msg.body}
            </div>
            <span className="nx-bubble-time">{formatRelativeTime(msg.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
