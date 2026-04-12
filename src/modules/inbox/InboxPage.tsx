import { useState } from 'react'
import type { InboxModel, InboxThread } from './inbox.adapter'
import { Icon } from '../../shared/icons'

const classes = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

const priorityClass: Record<InboxThread['priority'], string> = {
  urgent: 'is-urgent',
  high: 'is-high',
  normal: 'is-normal',
  low: 'is-low',
}

const sentimentClass: Record<InboxThread['sentiment'], string> = {
  hot: 'is-hot',
  warm: 'is-warm',
  neutral: 'is-neutral',
  cold: 'is-cold',
}

export const InboxPage = ({ data }: { data: InboxModel }) => {
  const [selectedId, setSelectedId] = useState<string | null>(data.threads[0]?.id ?? null)
  const [filterStatus, setFilterStatus] = useState<string>('all')

  const filtered = filterStatus === 'all'
    ? data.threads
    : data.threads.filter((t) => t.status === filterStatus)

  const selected = data.threads.find((t) => t.id === selectedId) ?? null

  return (
    <div className="nx-inbox">
      <header className="nx-inbox__header">
        <div className="nx-inbox__title-row">
          <Icon className="nx-surface-icon" name="inbox" />
          <h1>Inbox</h1>
          <span className="nx-badge nx-badge--primary">{data.unreadCount} unread</span>
          {data.urgentCount > 0 && (
            <span className="nx-badge nx-badge--danger">{data.urgentCount} urgent</span>
          )}
        </div>
        <div className="nx-inbox__filters">
          {['all', 'unread', 'read', 'replied', 'archived'].map((status) => (
            <button
              key={status}
              type="button"
              className={classes('nx-filter-pill', filterStatus === status && 'is-active')}
              onClick={() => setFilterStatus(status)}
            >
              {status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </header>

      <div className="nx-inbox__body">
        <aside className="nx-inbox__list">
          {filtered.map((thread) => (
            <button
              key={thread.id}
              type="button"
              className={classes(
                'nx-inbox-thread',
                selectedId === thread.id && 'is-selected',
                thread.status === 'unread' && 'is-unread',
              )}
              onClick={() => setSelectedId(thread.id)}
            >
              <div className="nx-inbox-thread__top">
                <span className={classes('nx-sentiment-dot', sentimentClass[thread.sentiment])} />
                <strong className="nx-inbox-thread__name">{thread.ownerName}</strong>
                <span className="nx-inbox-thread__time">{thread.lastMessageLabel}</span>
              </div>
              <div className="nx-inbox-thread__subject">{thread.subject}</div>
              <div className="nx-inbox-thread__preview">{thread.preview}</div>
              <div className="nx-inbox-thread__meta">
                <span className={classes('nx-priority-pill', priorityClass[thread.priority])}>
                  {thread.priority.toUpperCase()}
                </span>
                {thread.aiDraft && (
                  <span className="nx-ai-badge">
                    <Icon className="nx-ai-badge__icon" name="spark" />
                    AI Draft
                  </span>
                )}
                {thread.labels.map((label) => (
                  <span key={label} className="nx-label-chip">{label}</span>
                ))}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="nx-empty-state">No threads match this filter.</div>
          )}
        </aside>

        <main className="nx-inbox__detail">
          {selected ? (
            <div className="nx-inbox-detail">
              <div className="nx-inbox-detail__header">
                <div>
                  <h2>{selected.subject}</h2>
                  <span className="nx-inbox-detail__from">{selected.ownerName}</span>
                </div>
                <div className="nx-inbox-detail__actions">
                  <button className="nx-action-button" type="button">
                    <Icon className="nx-action-button__icon" name="send" />
                    Reply
                  </button>
                  <button className="nx-action-button nx-action-button--muted" type="button">
                    <Icon className="nx-action-button__icon" name="archive" />
                    Archive
                  </button>
                </div>
              </div>

              <div className="nx-inbox-detail__thread">
                <div className="nx-inbox-message is-inbound">
                  <div className="nx-inbox-message__header">
                    <strong>{selected.ownerName}</strong>
                    <span>{selected.lastMessageLabel}</span>
                  </div>
                  <p>{selected.preview}</p>
                </div>
              </div>

              {selected.aiDraft && (
                <div className="nx-inbox-detail__draft">
                  <div className="nx-inbox-detail__draft-header">
                    <Icon className="nx-ai-draft-icon" name="spark" />
                    <span>AI-Generated Draft</span>
                  </div>
                  <p>{selected.aiDraft}</p>
                  <div className="nx-inbox-detail__draft-actions">
                    <button className="nx-primary-button" type="button">
                      <Icon className="nx-primary-button__icon" name="send" />
                      Send Draft
                    </button>
                    <button className="nx-secondary-button" type="button">Edit</button>
                  </div>
                </div>
              )}

              <div className="nx-inbox-detail__info">
                <span>{selected.messageCount} messages</span>
                <span className={classes('nx-sentiment-pill', sentimentClass[selected.sentiment])}>
                  {selected.sentiment.toUpperCase()}
                </span>
                <span className={classes('nx-priority-pill', priorityClass[selected.priority])}>
                  {selected.priority.toUpperCase()}
                </span>
              </div>
            </div>
          ) : (
            <div className="nx-empty-state nx-empty-state--large">
              <Icon className="nx-empty-icon" name="inbox" />
              <p>Select a thread to view</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
