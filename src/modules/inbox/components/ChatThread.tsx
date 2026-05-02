import type { ThreadMessage } from '../../../lib/data/inboxData'
import type { InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import { Icon } from '../../../shared/icons'
import { formatRelativeTime } from '../../../shared/formatters'
import { resolveThreadAddressLine, resolveThreadMarketBadge, resolveThreadPrimaryName } from '../inbox-ui-helpers'

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

const fallback = (value: unknown, placeholder = '') => {
  const text = String(value ?? '').trim()
  return text || placeholder
}

const titleCase = (value: string) =>
  value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

const normalizeDeliveryBadge = (message: ThreadMessage): 'failed' | 'pending' | 'delivered' | 'unknown' => {
  const status = String(message.deliveryStatus || message.rawStatus || '').toLowerCase()
  if (status.includes('fail') || status.includes('error') || status.includes('undeliver')) return 'failed'
  if (status.includes('delivered') || status.includes('sent')) return 'delivered'
  if (status.includes('queue') || status.includes('pending') || status.includes('schedule') || status.includes('approval')) return 'pending'
  return 'unknown'
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
        <p>Select a thread to view the conversation.</p>
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

  const ownerName = resolveThreadPrimaryName(thread)
  const phoneNumber = fallback(thread.phoneNumber || thread.canonicalE164, '')
  const propertyAddress = resolveThreadAddressLine(thread)
  const market = resolveThreadMarketBadge(thread)
  const stageName = isSuppressed ? 'Suppressed' : titleCase(thread.inboxStage)
  const stageClass = isSuppressed ? 'is-dnc_opt_out' : `is-${thread.inboxStage}`

  return (
    <div className="nx-chat-container">
      <header className="nx-chat-header">
        <div className="nx-chat-header__info">
          <div className="nx-chat-header__name-row">
            <span className="nx-chat-header__name">{ownerName}</span>
            {phoneNumber && (
              <span className="nx-chat-header__phone">{phoneNumber}</span>
            )}
          </div>
          {propertyAddress && (
            <span className="nx-chat-header__address">{propertyAddress}</span>
          )}
          <div className="nx-thread-meta-line">
            {market && <span className="nx-market-tag">{market}</span>}
            <span className={cls('nx-stage-pill', stageClass)}>{stageName}</span>
            {isSuppressed && <span className="nx-suppression-badge">Opted Out</span>}
          </div>
        </div>
        <div className="nx-chat-header__actions">
          <button
            type="button"
            className={cls('nx-chat-action', isStarred && 'is-active')}
            title={isStarred ? 'Unstar thread' : 'Star thread'}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              console.log(`[NexusInboxActionNoRefresh]`, {
                action: isStarred ? 'unstar' : 'star',
                thread_id: thread.id.slice(-8),
                optimistic: true,
                preventedDefault: true,
                stoppedPropagation: true
              })
              onToggleStar?.()
            }}
          >
            <Icon name="star" />
          </button>
          <button
            type="button"
            className={cls('nx-chat-action', thread.isPinned && 'is-active')}
            title={thread.isPinned ? 'Unpin thread' : 'Pin thread'}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              console.log(`[NexusInboxActionNoRefresh]`, {
                action: thread.isPinned ? 'unpin' : 'pin',
                thread_id: thread.id.slice(-8),
                optimistic: true,
                preventedDefault: true,
                stoppedPropagation: true
              })
              onTogglePin?.()
            }}
          >
            <Icon name="pin" />
          </button>
          <button
            type="button"
            className="nx-chat-action"
            title={thread.isArchived ? 'Unarchive thread' : 'Archive thread'}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              console.log(`[NexusInboxActionNoRefresh]`, {
                action: thread.isArchived ? 'unarchive' : 'archive',
                thread_id: thread.id.slice(-8),
                optimistic: true,
                preventedDefault: true,
                stoppedPropagation: true
              })
              onToggleArchive?.()
            }}
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

            <div className="nx-bubble-footer">
              <div className="nx-bubble-meta-badge">
                <time>{formatRelativeTime(msg.createdAt)}</time>
                
                {/* Dev Tooltip */}
                <div className="nx-dev-tooltip">
                  <span>Local Sent: <b>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b></span>
                  <span>System Time: <b>{msg.createdAt.split('T')[1].split('.')[0]}</b></span>
                  {msg.deliveryStatus && (
                    <span>Status: <b>{titleCase(msg.deliveryStatus)}</b></span>
                  )}
                  {msg.developerMeta?.provider_message_sid && (
                    <span>Provider ID: <b>{msg.developerMeta.provider_message_sid.slice(0, 12)}…</b></span>
                  )}
                </div>
              </div>

              {msg.direction === 'outbound' && (
                <span className={cls('nx-delivery-pill', `is-${normalizeDeliveryBadge(msg)}`)}>
                  {normalizeDeliveryBadge(msg)}
                </span>
              )}
            </div>
          </div>
        ))}
        {messages.length === 0 && !loading && (
          <div className="nx-inbox__messages-empty">
            <p>No messages in this thread yet.</p>
          </div>
        )}
      </div>
    </div>
  )
}
