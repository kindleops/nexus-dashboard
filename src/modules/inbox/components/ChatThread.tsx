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

const normalizeDeliveryBadge = (message: ThreadMessage): 'failed' | 'pending' | 'delivered' | 'unknown' => {
  const status = String(message.deliveryStatus || message.rawStatus || '').toLowerCase()
  if (status.includes('fail') || status.includes('error') || status.includes('undeliver')) return 'failed'
  if (status.includes('delivered') || status.includes('sent') || status === 'success') return 'delivered'
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
        <Icon name="Mail" style={{ width: 48, height: 48, opacity: 0.1, marginBottom: 16 }} />
        <p>Select a thread to view the conversation.</p>
      </div>
    </div>
  )

  if (loading && messages.length === 0) return (
    <div className="nx-chat-container">
      <div className="nx-inbox__messages-loading">
        <Icon name="Activity" className="nx-inbox__messages-loading-icon" />
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
        <div className="nx-chat-header__info">
          <div className="nx-chat-header__name-row">
            <span className="nx-chat-header__name">{ownerName}</span>
            {phoneNumber && (
              <span className="nx-chat-header__phone">{phoneNumber}</span>
            )}
            {import.meta.env.DEV && (
              <button className="nx-debug-btn-mini" onClick={onOpenDebug} title="Debug Thread">
                <Icon name="Cpu" />
              </button>
            )}
          </div>
          {propertyAddress && (
            <span className="nx-chat-header__address">{propertyAddress}</span>
          )}
          <div className="nx-thread-meta-line">
            {market && <span className="nx-market-tag">{market}</span>}
            <span className="nx-stage-pill nx-conv-stage-pill">{stageVisual.label}</span>
            <span className="nx-stage-pill" style={{ '--pill-color': statusVisual.color, '--pill-bg': statusVisual.bg, '--pill-border': statusVisual.border } as any}>
              {statusVisual.label}
            </span>
            {isSuppressed && <span className="nx-suppression-badge">Opted Out</span>}
          </div>
        </div>
        <div className="nx-chat-header__actions">
          <button
            type="button"
            className={cls('nx-chat-action', isStarred && 'is-active')}
            title={isStarred ? 'Unstar thread' : 'Star thread'}
            onClick={() => onToggleStar?.()}
          >
            <Icon name="Star" />
          </button>
          <button
            type="button"
            className={cls('nx-chat-action', thread.isPinned && 'is-active')}
            title={thread.isPinned ? 'Unpin thread' : 'Pin thread'}
            onClick={() => onTogglePin?.()}
          >
            <Icon name="Bookmark" />
          </button>
          <button
            type="button"
            className="nx-chat-action"
            title={thread.isArchived ? 'Unarchive thread' : 'Archive thread'}
            onClick={() => onToggleArchive?.()}
          >
            <Icon name="Archive" />
          </button>
        </div>
      </header>

      {/* Operator Rail */}
      <div className="nx-operator-rail">
        <div className="nx-rail-group">
          <button className="nx-rail-btn is-hot" onClick={() => onThreadAction?.(thread.id, 'mark_hot')}>
            <Icon name="Zap" /> HOT
          </button>
          <button className="nx-rail-btn" onClick={() => onThreadAction?.(thread.id, 'snooze')}>
            <Icon name="Clock" /> SNOOZE
          </button>
        </div>
        <div className="nx-rail-divider" />
        <div className="nx-rail-group">
          {isAutoPaused ? (
            <button className="nx-rail-btn is-resume" onClick={() => onThreadAction?.(thread.id, 'resume_automation')}>
              <Icon name="Play" /> RESUME AUTO
            </button>
          ) : (
            <button className="nx-rail-btn is-pause" onClick={() => onThreadAction?.(thread.id, 'pause_automation')}>
              <Icon name="Pause" /> PAUSE AUTO
            </button>
          )}
          <button className="nx-rail-btn is-dnc" onClick={() => onThreadAction?.(thread.id, 'suppress')}>
            <Icon name="Slash" /> DNC
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
                    <span className={cls('nx-delivery-pill', `is-${deliveryBadge}`)}>
                      {titleCase(deliveryBadge)}
                    </span>
                    {deliveryBadge === 'failed' && (
                      <button className="nx-retry-btn" onClick={() => onThreadAction?.(thread.id, 'retry_send')} title="Retry sending">
                        <Icon name="RefreshCw" />
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
            <Icon name="MessageSquare" style={{ opacity: 0.1, width: 40, height: 40, marginBottom: 12 }} />
            <p>No messages in timeline.</p>
            {console.warn(`[Timeline] No messages for thread_key: ${thread.threadKey || thread.id}`)}
          </div>
        )}
      </div>
    </div>
  )
}
