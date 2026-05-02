import { useMemo, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { QueueProcessorHealth } from '../../../lib/data/inboxData'
import type { InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import { Icon } from '../../../shared/icons'
import { formatRelativeTime } from '../../../shared/formatters'

const cls = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

export type NotificationSeverity = 'info' | 'critical' | 'warning' | 'success' | 'neutral'
export type NotificationStatus = 'unread' | 'read' | 'dismissed'

export interface NexusNotification {
  id: string
  command_space: string
  type: string
  title: string
  body: string
  severity: NotificationSeverity
  status: NotificationStatus
  created_at: string
  read_at: string | null
  related_thread_id: string | null
  related_property_id: string | null
  related_owner_id: string | null
  related_queue_id: string | null
  related_offer_id: string | null
  related_contract_id: string | null
  source: string
  action_label: string
  action_href: string | null
}

const commandSpaces = ['All', 'Inbox', 'Queue', 'SMS', 'AI', 'Offers', 'Contracts', 'Title', 'Buyers', 'Properties', 'Owners', 'System', 'Errors']

const notificationIcon = (severity: NotificationSeverity) => {
  if (severity === 'critical') return 'alert'
  if (severity === 'warning') return 'flag'
  if (severity === 'success') return 'check'
  if (severity === 'neutral') return 'shield'
  return 'bell'
}

export const buildInboxNotifications = ({
  unreadCount,
  selectedThread,
  queueProcessorHealth,
}: {
  unreadCount: number
  selectedThread: InboxWorkflowThread | null
  queueProcessorHealth: QueueProcessorHealth | null
}): NexusNotification[] => {
  const notifications: NexusNotification[] = []
  const selectedCreatedAt = selectedThread?.lastMessageAt || selectedThread?.lastMessageIso || queueProcessorHealth?.checkedAt || ''

  if (unreadCount > 0) {
    notifications.push({
      id: 'inbox-unread',
      command_space: 'Inbox',
      type: 'inbound_reply_received',
      title: `${unreadCount} seller replies need attention`,
      body: 'Priority Inbox has active inbound conversations ready for triage.',
      severity: 'info',
      status: 'unread',
      created_at: selectedCreatedAt,
      read_at: null,
      related_thread_id: selectedThread?.id ?? null,
      related_property_id: selectedThread?.propertyId ?? null,
      related_owner_id: selectedThread?.ownerId ?? null,
      related_queue_id: null,
      related_offer_id: null,
      related_contract_id: null,
      source: 'Inbox',
      action_label: 'Open Inbox',
      action_href: '/inbox',
    })
  }

  if (selectedThread?.inboxStage === 'needs_offer') {
    notifications.push({
      id: `offer-needed-${selectedThread.id}`,
      command_space: 'Offers',
      type: 'offer_needs_review',
      title: 'Offer needed',
      body: `${selectedThread.ownerName || 'Seller'} is ready for pricing review.`,
      severity: 'warning',
      status: 'unread',
      created_at: selectedCreatedAt,
      read_at: null,
      related_thread_id: selectedThread.id,
      related_property_id: selectedThread.propertyId ?? null,
      related_owner_id: selectedThread.ownerId ?? null,
      related_queue_id: null,
      related_offer_id: null,
      related_contract_id: null,
      source: 'Offer Engine',
      action_label: 'Review Offer',
      action_href: '/dashboard/kpis',
    })
  }

  if (selectedThread?.isOptOut || selectedThread?.inboxStage === 'dnc_opt_out') {
    notifications.push({
      id: `suppressed-${selectedThread.id}`,
      command_space: 'SMS',
      type: 'stop_opt_out_detected',
      title: 'Suppression logged',
      body: 'This thread is suppressed. Do not recommend or send marketing messages.',
      severity: 'critical',
      status: 'unread',
      created_at: selectedCreatedAt,
      read_at: null,
      related_thread_id: selectedThread.id,
      related_property_id: selectedThread.propertyId ?? null,
      related_owner_id: selectedThread.ownerId ?? null,
      related_queue_id: null,
      related_offer_id: null,
      related_contract_id: null,
      source: 'Compliance',
      action_label: 'View Thread',
      action_href: '/inbox',
    })
  }

  if (queueProcessorHealth?.status === 'lagging') {
    notifications.push({
      id: 'queue-delayed',
      command_space: 'Queue',
      type: 'queue_delayed',
      title: 'Queue processor delayed',
      body: queueProcessorHealth.summary,
      severity: 'warning',
      status: 'unread',
      created_at: queueProcessorHealth.checkedAt,
      read_at: null,
      related_thread_id: null,
      related_property_id: null,
      related_owner_id: null,
      related_queue_id: null,
      related_offer_id: null,
      related_contract_id: null,
      source: 'Queue Processor',
      action_label: 'Open Queue',
      action_href: '/queue',
    })
  }

  notifications.push({
    id: 'system-realtime-ready',
    command_space: 'System',
    type: 'system_warning',
    title: 'Notification center ready',
    body: 'Local adapter is normalized and Supabase realtime-ready.',
    severity: 'neutral',
    status: 'read',
    created_at: queueProcessorHealth?.checkedAt || selectedCreatedAt,
    read_at: queueProcessorHealth?.checkedAt || selectedCreatedAt,
    related_thread_id: null,
    related_property_id: null,
    related_owner_id: null,
    related_queue_id: null,
    related_offer_id: null,
    related_contract_id: null,
    source: 'NEXUS OS',
    action_label: 'Review',
    action_href: null,
  })

  return notifications
}

export const NexusNotificationCenter = ({
  open,
  notifications,
  onClose,
  onOpenRecord,
}: {
  open: boolean
  notifications: NexusNotification[]
  onClose: () => void
  onOpenRecord: (notification: NexusNotification) => void
}) => {
  const [activeSpace, setActiveSpace] = useState('All')
  const [showUnreadOnly, setShowUnreadOnly] = useState(false)
  const [showCriticalOnly, setShowCriticalOnly] = useState(false)
  const [readIds, setReadIds] = useState<string[]>([])
  const [dismissedIds, setDismissedIds] = useState<string[]>([])

  const enriched = useMemo(() => (
    notifications
      .filter((item) => !dismissedIds.includes(item.id))
      .map((item) => ({
        ...item,
        status: readIds.includes(item.id) ? 'read' as const : item.status,
      }))
  ), [dismissedIds, notifications, readIds])

  const toastItems = useMemo(() => enriched.filter((item) => item.status !== 'read').slice(0, 3), [enriched])

  // Phase 2: Auto-dismiss toasts after 3 seconds
  useEffect(() => {
    const timers = toastItems.map(item => {
      return setTimeout(() => {
        setDismissedIds(prev => prev.includes(item.id) ? prev : [...prev, item.id])
      }, 3000)
    })
    return () => timers.forEach(clearTimeout)
  }, [toastItems])

  const unreadCount = enriched.filter((item) => item.status !== 'read').length
  const filtered = enriched.filter((item) => {
    if (activeSpace !== 'All' && item.command_space !== activeSpace && !(activeSpace === 'Errors' && item.severity === 'critical')) return false
    if (showUnreadOnly && item.status === 'read') return false
    if (showCriticalOnly && item.severity !== 'critical') return false
    return true
  })

  return (
    <>
      <div className="nx-toast-stack" aria-live="polite">
        {toastItems.map((item) => (
          <article key={`toast-${item.id}`} className={cls('nx-toast-card', `is-${item.severity}`)}>
            <Icon name={notificationIcon(item.severity)} />
            <div>
              <span>{item.command_space}</span>
              <strong>{item.title}</strong>
            </div>
            <button type="button" onClick={() => setDismissedIds((ids) => [...ids, item.id])} aria-label="Dismiss notification">
              <Icon name="close" />
            </button>
          </article>
        ))}
      </div>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <section className="nx-notification-center nx-liquid-panel" aria-label="Notification center">
              <header>
                <div>
                  <span>Command Space</span>
                  <strong>Notifications</strong>
                </div>
                <button type="button" onClick={onClose} aria-label="Close notifications">
                  <Icon name="close" />
                </button>
              </header>

              <div className="nx-notification-center__tools">
                <button 
                  type="button" 
                  className={showUnreadOnly ? 'is-active' : ''} 
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setShowUnreadOnly((value) => !value)
                  }}
                >
                  Unread {unreadCount}
                </button>
                <button 
                  type="button" 
                  className={showCriticalOnly ? 'is-active' : ''} 
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setShowCriticalOnly((value) => !value)
                  }}
                >
                  Critical
                </button>
                <button 
                  type="button" 
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setReadIds(enriched.map((item) => item.id))
                  }}
                >
                  Mark all read
                </button>
              </div>

              <div className="nx-notification-tabs" role="tablist" aria-label="Command spaces">
                {commandSpaces.map((space) => (
                  <button
                    key={space}
                    type="button"
                    className={activeSpace === space ? 'is-active' : ''}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setActiveSpace(space)
                    }}
                  >
                    {space}
                  </button>
                ))}
              </div>

              <div className="nx-notification-list">
                {filtered.map((item) => (
                  <article key={item.id} className={cls('nx-notification-card', `is-${item.severity}`, item.status === 'read' && 'is-read')}>
                    <button
                      type="button"
                      className="nx-notification-card__main"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setReadIds((ids) => ids.includes(item.id) ? ids : [...ids, item.id])
                        onOpenRecord(item)
                      }}
                    >
                      <span className="nx-notification-card__icon"><Icon name={notificationIcon(item.severity)} /></span>
                      <span>
                        <small>{item.command_space} · {item.source} · {item.created_at ? formatRelativeTime(item.created_at) : 'Now'}</small>
                        <strong>{item.title}</strong>
                        <em>{item.body}</em>
                      </span>
                      <b>{item.action_label}</b>
                    </button>
                    <button 
                      type="button" 
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setDismissedIds((ids) => [...ids, item.id])
                      }} 
                      aria-label="Dismiss notification"
                    >
                      <Icon name="close" />
                    </button>
                  </article>
                ))}
                {filtered.length === 0 && <p className="nx-notification-empty">No notifications match this command space.</p>}
              </div>
            </section>,
            document.body,
          )
        : null}
    </>
  )
}
