import { useLayoutEffect, useRef } from 'react'
import type { ThreadMessage } from '../../../lib/data/inboxData'
import type { InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import { Icon } from '../../../shared/icons'
import { formatMessageTime } from '../../../shared/formatters'
import { getThreadMatchedKeywords, resolveThreadAddressLine, resolveThreadMarketBadge, resolveThreadPrimaryName } from '../inbox-ui-helpers'
import { getStatusVisual, getSellerStageVisual } from '../status-visuals'

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
  onThreadAction?: (id: string, action: string) => void
  onOpenDebug?: () => void
  searchQuery?: string
}

const fallback = (value: unknown, placeholder = '') => {
  const text = String(value ?? '').trim()
  return text || placeholder
}

const titleCase = (value: string) =>
  value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const highlightText = (text: string, terms: string[]) => {
  const cleanTerms = terms.map((term) => term.trim()).filter((term) => term.length > 1).slice(0, 8)
  if (cleanTerms.length === 0) return text
  const re = new RegExp(`(${cleanTerms.map(escapeRegExp).join('|')})`, 'ig')
  return text.split(re).map((part, index) => (
    cleanTerms.some((term) => term.toLowerCase() === part.toLowerCase())
      ? <mark key={`${part}-${index}`} className="nx-keyword-highlight">{part}</mark>
      : part
  ))
}

const normalizeDeliveryBadge = (message: ThreadMessage): 'failed' | 'queued' | 'pending' | 'sent' | 'delivered' | 'approval' | 'unknown' => {
  const status = String(message.deliveryStatus || '').toLowerCase()
  if (status === 'failed') return 'failed'
  if (status === 'delivered') return 'delivered'
  if (status === 'sent') return 'sent'
  if (status === 'queued') return 'queued'
  if (status === 'pending') return 'pending'
  if (status === 'approval') return 'approval'
  
  const raw = String(message.rawStatus || '').toLowerCase()
  if (raw.includes('fail') || raw.includes('error') || raw.includes('undeliver')) return 'failed'
  if (raw.includes('delivered')) return 'delivered'
  if (raw.includes('sent') || raw === 'success') return 'sent'
  if (raw.includes('queue')) return 'queued'
  if (raw.includes('pending') || raw.includes('schedule')) return 'pending'
  if (raw.includes('approval')) return 'approval'
  
  return 'unknown'
}

const getDeliveryPillStyle = (badge: string) => {
  switch (badge) {
    case 'delivered': return { color: '#30d158', background: 'rgba(48, 209, 88, 0.15)', borderColor: 'rgba(48, 209, 88, 0.3)' }
    case 'sent': return { color: '#64d2ff', background: 'rgba(100, 210, 255, 0.15)', borderColor: 'rgba(100, 210, 255, 0.3)' }
    case 'failed': return { color: '#ff453a', background: 'rgba(255, 69, 58, 0.15)', borderColor: 'rgba(255, 69, 58, 0.3)' }
    case 'queued': return { color: '#ffd60a', background: 'rgba(255, 214, 10, 0.15)', borderColor: 'rgba(255, 214, 10, 0.3)' }
    case 'approval': return { color: '#a78bfa', background: 'rgba(167, 139, 250, 0.15)', borderColor: 'rgba(167, 139, 250, 0.3)' }
    case 'pending': return { color: '#9ba8c0', background: 'rgba(155, 168, 192, 0.15)', borderColor: 'rgba(155, 168, 192, 0.3)' }
    default: return { color: 'rgba(155, 168, 192, 0.6)', background: 'rgba(155, 168, 192, 0.05)', borderColor: 'transparent' }
  }
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
  onThreadAction,
  onOpenDebug,
  searchQuery = '',
}: ChatThreadProps) => {
  const listRef = useRef<HTMLDivElement | null>(null)
  const scrollSnapshotRef = useRef<{ height: number; top: number; nearBottom: boolean }>({
    height: 0,
    top: 0,
    nearBottom: true,
  })

  useLayoutEffect(() => {
    const node = listRef.current
    if (!node) return
    const previous = scrollSnapshotRef.current
    const nextHeight = node.scrollHeight
    if (previous.height > 0) {
      if (previous.nearBottom) {
        node.scrollTop = Math.max(0, nextHeight - node.clientHeight)
      } else {
        node.scrollTop = previous.top + (nextHeight - previous.height)
      }
    }
    const distanceFromBottom = node.scrollHeight - node.clientHeight - node.scrollTop
    scrollSnapshotRef.current = {
      height: node.scrollHeight,
      top: node.scrollTop,
      nearBottom: distanceFromBottom < 48,
    }
  }, [messages, loading, thread?.id])

  const handleScroll = () => {
    const node = listRef.current
    if (!node) return
    const distanceFromBottom = node.scrollHeight - node.clientHeight - node.scrollTop
    scrollSnapshotRef.current = {
      height: node.scrollHeight,
      top: node.scrollTop,
      nearBottom: distanceFromBottom < 48,
    }
  }

  if (!thread) return (
    <div className="nx-chat-container is-empty">
      <div className="nx-inbox__workspace-empty">
        <Icon name="mail" style={{ width: 48, height: 48, opacity: 0.1, marginBottom: 16 }} />
        <p>Select a thread to view the conversation.</p>
      </div>
    </div>
  )

  if (loading && messages.length === 0) return (
    <div className="nx-chat-container">
      <div className="nx-inbox__messages-loading">
        <Icon name="activity" className="nx-inbox__messages-loading-icon" />
        <span>Syncing timeline…</span>
      </div>
    </div>
  )

  const ownerName = resolveThreadPrimaryName(thread)
  const phoneNumber = fallback(thread.phoneNumber || thread.canonicalE164, '')
  const propertyAddress = resolveThreadAddressLine(thread)
  const market = resolveThreadMarketBadge(thread)
  const statusVisual = getStatusVisual(thread.inboxStatus, {
    latestDirection: thread.latestDirection || thread.directionUsed || null,
    lastOutboundAt: thread.lastOutboundAt ?? null,
    lastInboundAt: thread.lastInboundAt ?? null,
  })
  const stageVisual = getSellerStageVisual(thread.conversationStage)
  const matchedKeywords = getThreadMatchedKeywords(thread, searchQuery)

  const isAutoPaused = thread.status?.toLowerCase().includes('pause') || (thread as any).automationStatus === 'paused'

  return (
    <div className="nx-chat-container">
      <header className="nx-chat-header">
        <div className="nx-chat-header__main">
          <div className="nx-chat-header__name-row">
            <h1 className="nx-chat-header__name">{ownerName}</h1>
            {phoneNumber && (
              <div className="nx-chat-header__phone">
                <Icon name="phone" />
                <span>{phoneNumber}</span>
              </div>
            )}
            {import.meta.env.DEV && (
              <button className="nx-debug-btn-mini" onClick={onOpenDebug} title="Debug Thread">
                <Icon name="cpu" />
              </button>
            )}
          </div>
          
          {propertyAddress && (
            <span className="nx-chat-header__address">{propertyAddress}</span>
          )}

          <div className="nx-thread-meta-line">
            {market && <span className="nx-market-tag"><Icon name="map-pin" /> {market}</span>}
            <span className="nx-stage-pill nx-conv-stage-pill">{stageVisual.label}</span>
            <span className="nx-stage-pill" style={{ '--pill-color': statusVisual.color, '--pill-bg': statusVisual.bg, '--pill-border': statusVisual.border } as any}>
              {statusVisual.label}
            </span>
            {isSuppressed && <span className="nx-suppression-badge is-danger"><Icon name="slash" /> Opted Out</span>}
          </div>
        </div>
        <div className="nx-chat-header__actions">
          <button
            type="button"
            className={cls('nx-chat-action', isStarred && 'is-active')}
            title={isStarred ? 'Unstar thread' : 'Star thread'}
            onClick={() => onToggleStar?.()}
          >
            <Icon name="star" />
          </button>
          <button
            type="button"
            className={cls('nx-chat-action', thread.isPinned && 'is-active')}
            title={thread.isPinned ? 'Unpin thread' : 'Pin thread'}
            onClick={() => onTogglePin?.()}
          >
            <Icon name="bookmark" />
          </button>
          <button
            type="button"
            className="nx-chat-action"
            title={thread.isRead ? 'Mark as unread' : 'Mark as read'}
            onClick={() => onThreadAction?.(thread.id, thread.isRead ? 'unread' : 'read')}
          >
            <Icon name="inbox" />
          </button>
          <button
            type="button"
            className="nx-chat-action"
            title={thread.isArchived ? 'Unarchive thread' : 'Archive thread'}
            onClick={() => onToggleArchive?.()}
          >
            <Icon name="archive" />
          </button>
        </div>
      </header>

      {/* Operator Rail */}
      <div className="nx-operator-rail">
        <div className="nx-rail-group">
          {(thread.inboxStatus === 'new_reply' || (thread as any).inbox_category === 'new_inbound') && thread.automationState === 'active' && (
            <button className="nx-rail-btn is-auto-reply" onClick={() => onThreadAction?.(thread.id, 'auto_reply')} title="Queue Deterministic Auto-Reply">
              <Icon name="zap" /> <span>AUTO-REPLY</span>
            </button>
          )}
          <button className="nx-rail-btn is-hot" onClick={() => onThreadAction?.(thread.id, 'mark_hot')}>
            <Icon name="zap" /> <span>HOT</span>
          </button>
          <button className="nx-rail-btn" onClick={() => onThreadAction?.(thread.id, 'snooze')}>
            <Icon name="clock" /> <span>SNOOZE</span>
          </button>
        </div>
        
        <div className="nx-rail-divider" />
        
        <div className="nx-rail-group">
          {isAutoPaused ? (
            <button className="nx-rail-btn is-resume" onClick={() => onThreadAction?.(thread.id, 'resume_automation')}>
              <Icon name="play" /> <span>RESUME AUTO</span>
            </button>
          ) : (
            <button className="nx-rail-btn is-pause" onClick={() => onThreadAction?.(thread.id, 'pause_automation')}>
              <Icon name="pause" /> <span>PAUSE AUTO</span>
            </button>
          )}
          <button className="nx-rail-btn is-dnc" onClick={() => onThreadAction?.(thread.id, 'suppress')}>
            <Icon name="slash" /> <span>DNC</span>
          </button>
        </div>
      </div>


      <div className="nx-message-list" ref={listRef} onScroll={handleScroll}>
        {messages.map(msg => {
          const isOutbound = msg.direction === 'outbound'
          const deliveryBadge = normalizeDeliveryBadge(msg)
          return (
            <div key={msg.id} className={cls('nx-bubble-wrap', isOutbound ? 'is-outbound' : 'is-inbound')}>
              <div className="nx-chat-bubble">
                {highlightText(msg.body, matchedKeywords.length ? matchedKeywords : [searchQuery])}
              </div>

              <div className="nx-bubble-footer">
                <div className="nx-bubble-meta-badge">
                  <time>{formatMessageTime(msg.createdAt)}</time>
                  
                  <div className="nx-dev-tooltip">
                    <span>Source: <b>{msg.source}</b></span>
                    <span>Event: <b>{msg.eventType}</b></span>
                    {msg.deliveryStatus && (
                      <span>Status: <b>{titleCase(msg.deliveryStatus)}</b></span>
                    )}
                  </div>
                </div>

                {isOutbound && (
                  <div className="nx-delivery-row">
                    <span 
                      className={cls('nx-delivery-pill', `is-${deliveryBadge}`)}
                      style={getDeliveryPillStyle(deliveryBadge)}
                    >
                      {deliveryBadge === 'approval' ? 'Needs Approval' : titleCase(deliveryBadge)}
                    </span>
                    {deliveryBadge === 'approval' && (
                      <div className="nx-approval-actions">
                        <button className="nx-approve-btn" onClick={() => onThreadAction?.(thread.id, 'approve_queue:' + msg.id)} title="Approve & Send Now">
                          <Icon name="check" />
                        </button>
                        <button className="nx-edit-btn" onClick={() => onThreadAction?.(thread.id, 'edit_queue:' + msg.id)} title="Edit Draft">
                          <Icon name="file-text" />
                        </button>
                        <button className="nx-cancel-btn" onClick={() => onThreadAction?.(thread.id, 'cancel_queue:' + msg.id)} title="Cancel & Delete Draft">
                          <Icon name="x" />
                        </button>
                      </div>
                    )}
                    {deliveryBadge === 'failed' && (
                      <button className="nx-retry-btn" onClick={() => onThreadAction?.(thread.id, 'retry_send')} title="Retry sending">
                        <Icon name="refresh-cw" />
                      </button>
                    )}

                  </div>
                )}
              </div>
            </div>
          )
        })}
        {messages.length === 0 && !loading && (
          <div className="nx-inbox__messages-empty">
            <Icon name="message" style={{ opacity: 0.1, width: 40, height: 40, marginBottom: 12 }} />
            <p>No messages loaded for this thread.</p>
          </div>
        )}
      </div>
    </div>
  )
}
