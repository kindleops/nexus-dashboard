import { useState } from 'react'
import type { NotificationsModel, NotificationItem } from './notifications.adapter'
import { Icon } from '../../shared/icons'
import { pushRoutePath } from '../../app/router'

const classes = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

const kindIcon: Record<NotificationItem['kind'], string> = {
  autopilot: 'zap',
  alert: 'alert',
  deal: 'target',
  system: 'settings',
  inbox: 'message',
}

const severityClass: Record<NotificationItem['severity'], string> = {
  critical: 'is-critical',
  warning: 'is-warning',
  info: 'is-info',
}

export const NotificationsPage = ({ data }: { data: NotificationsModel }) => {
  const [readIds, setReadIds] = useState<string[]>(
    data.items.filter((i) => i.read).map((i) => i.id),
  )

  const markRead = (id: string) => {
    setReadIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }

  const markAllRead = () => {
    setReadIds(data.items.map((i) => i.id))
  }

  return (
    <div className="nx-notifications">
      <header className="nx-surface-header">
        <div className="nx-surface-header__title">
          <Icon className="nx-surface-icon" name="bell" />
          <h1>Notifications</h1>
        </div>
        <div className="nx-surface-header__stats">
          <span className="nx-badge nx-badge--primary">
            {data.unreadCount} unread
          </span>
          <button className="nx-inline-button" type="button" onClick={markAllRead}>
            Mark all read
          </button>
        </div>
      </header>

      <div className="nx-notifications__list">
        {data.items.map((item) => {
          const isRead = readIds.includes(item.id)
          return (
            <article
              key={item.id}
              className={classes(
                'nx-notif-card',
                severityClass[item.severity],
                isRead && 'is-read',
              )}
            >
              <div className="nx-notif-card__icon-wrap">
                <Icon
                  className="nx-notif-card__icon"
                  name={kindIcon[item.kind] as any}
                />
              </div>
              <div className="nx-notif-card__body">
                <div className="nx-notif-card__header">
                  <strong>{item.title}</strong>
                  <span className="nx-notif-card__time">{item.timestampLabel}</span>
                </div>
                <p>{item.detail}</p>
                <div className="nx-notif-card__actions">
                  {item.actionLabel && item.actionRoute && (
                    <button
                      className="nx-action-button"
                      type="button"
                      onClick={() => {
                        markRead(item.id)
                        pushRoutePath(item.actionRoute!)
                      }}
                    >
                      {item.actionLabel}
                    </button>
                  )}
                  {!isRead && (
                    <button
                      className="nx-action-button nx-action-button--muted"
                      type="button"
                      onClick={() => markRead(item.id)}
                    >
                      Mark Read
                    </button>
                  )}
                </div>
              </div>
            </article>
          )
        })}
        {data.items.length === 0 && (
          <div className="nx-empty-state">
            <Icon className="nx-empty-icon" name="bell" />
            <p>No notifications</p>
          </div>
        )}
      </div>
    </div>
  )
}
