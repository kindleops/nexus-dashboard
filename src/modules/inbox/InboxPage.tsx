import { useEffect, useRef, useState } from 'react'
import type { InboxModel, InboxThread } from './inbox.adapter'
import { Icon } from '../../shared/icons'
import { SplitView } from '../../shared/SplitView'
import { emitNotification } from '../../shared/NotificationToast'

const classes = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

const priorityClass: Record<InboxThread['priority'], string> = {
  urgent: 'is-urgent',
  high: 'is-high',
  normal: 'is-normal',
  low: 'is-low',
}

const priorityLabel: Record<InboxThread['priority'], string> = {
  urgent: 'P0',
  high: 'P1',
  normal: 'P2',
  low: 'P3',
}

const sentimentClass: Record<InboxThread['sentiment'], string> = {
  hot: 'is-hot',
  warm: 'is-warm',
  neutral: 'is-neutral',
  cold: 'is-cold',
}

const statusIcon: Record<InboxThread['status'], string> = {
  unread: 'message',
  read: 'check',
  replied: 'send',
  archived: 'archive',
}

export const InboxPage = ({ data }: { data: InboxModel }) => {
  const [selectedId, setSelectedId] = useState<string | null>(data.threads[0]?.id ?? null)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterPriority, setFilterPriority] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [draftText, setDraftText] = useState('')
  const [showAiActions, setShowAiActions] = useState(false)
  const [splitThread, setSplitThread] = useState<InboxThread | null>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  const filtered = data.threads
    .filter((t) => filterStatus === 'all' || t.status === filterStatus)
    .filter((t) => filterPriority === 'all' || t.priority === filterPriority)
    .filter((t) => {
      if (!searchQuery) return true
      const q = searchQuery.toLowerCase()
      return t.ownerName.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        t.preview.toLowerCase().includes(q)
    })

  const selected = data.threads.find((t) => t.id === selectedId) ?? null

  useEffect(() => {
    const handleCopilotSplitView = (event: Event) => {
      const detail = (event as CustomEvent<{ surfacePath?: string; target?: string }>).detail
      if (detail?.surfacePath !== '/inbox') return
      if (selected) {
        setSplitThread(selected)
      }
    }

    window.addEventListener('nx:copilot-split-view', handleCopilotSplitView)
    return () => window.removeEventListener('nx:copilot-split-view', handleCopilotSplitView)
  }, [selected])

  const handleSelectThread = (id: string) => {
    setSelectedId(id)
    setDraftText('')
    setShowAiActions(false)
    detailRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const hotCount = data.threads.filter(t => t.sentiment === 'hot' && t.status !== 'archived').length
  const aiDraftReady = data.threads.filter(t => t.aiDraft && t.status === 'unread').length
  const stalledCount = data.threads.filter(t => t.sentiment === 'cold' && t.status !== 'archived').length

  return (
    <div className="nx-inbox">
      {/* ── Comms Deck Header ──────────────────────────────────── */}
      <header className="nx-inbox__header">
        <div className="nx-inbox__title-row">
          <Icon className="nx-surface-icon" name="inbox" />
          <h1>Comms Deck</h1>
          <div className="nx-inbox__indicators">
            <span className="nx-badge nx-badge--primary">{data.unreadCount} unread</span>
            {data.urgentCount > 0 && (
              <span className="nx-badge nx-badge--danger">{data.urgentCount} urgent</span>
            )}
            {hotCount > 0 && (
              <span className="nx-badge nx-badge--hot">{hotCount} hot</span>
            )}
            {aiDraftReady > 0 && (
              <span className="nx-badge nx-badge--ai">{aiDraftReady} AI ready</span>
            )}
            {stalledCount > 0 && (
              <span className="nx-badge nx-badge--stalled">{stalledCount} stalled</span>
            )}
          </div>
        </div>
        <div className="nx-inbox__controls">
          <div className="nx-inbox__search-wrap">
            <Icon name="search" className="nx-inbox__search-icon" />
            <input
              className="nx-inbox__search"
              type="search"
              placeholder="Search threads…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="nx-inbox__filter-row">
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
            <div className="nx-inbox__priority-filters">
              {['all', 'urgent', 'high', 'normal'].map((p) => (
                <button
                  key={p}
                  type="button"
                  className={classes('nx-filter-pill nx-filter-pill--priority', filterPriority === p && 'is-active')}
                  onClick={() => setFilterPriority(p)}
                >
                  {p === 'all' ? 'Any Priority' : p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* ── Two-Column Body ────────────────────────────────────── */}
      <div className="nx-inbox__body">
        {/* Thread list */}
        <aside className="nx-inbox__list">
          <div className="nx-inbox__list-meta">
            <span>{filtered.length} threads</span>
            {filtered.length !== data.threads.length && (
              <button type="button" className="nx-inline-button" onClick={() => { setFilterStatus('all'); setFilterPriority('all'); setSearchQuery('') }}>
                Clear filters
              </button>
            )}
          </div>
          {filtered.map((thread) => (
            <button
              key={thread.id}
              type="button"
              className={classes(
                'nx-inbox-thread',
                selectedId === thread.id && 'is-selected',
                thread.status === 'unread' && 'is-unread',
                thread.sentiment === 'hot' && 'is-hot-thread',
                thread.sentiment === 'cold' && thread.status !== 'archived' && 'is-stalled',
              )}
              onClick={() => handleSelectThread(thread.id)}
            >
              <div className="nx-inbox-thread__top">
                <div className="nx-inbox-thread__left">
                  <span className={classes('nx-sentiment-dot', sentimentClass[thread.sentiment])} />
                  <Icon name={statusIcon[thread.status] as Parameters<typeof Icon>[0]['name']} className="nx-inbox-thread__status-icon" />
                  <strong className="nx-inbox-thread__name">{thread.ownerName}</strong>
                </div>
                <div className="nx-inbox-thread__right">
                  <span className={classes('nx-priority-micro', priorityClass[thread.priority])}>
                    {priorityLabel[thread.priority]}
                  </span>
                  <span className="nx-inbox-thread__time">{thread.lastMessageLabel}</span>
                </div>
              </div>
              <div className="nx-inbox-thread__subject">{thread.subject}</div>
              <div className="nx-inbox-thread__preview">{thread.preview}</div>
              <div className="nx-inbox-thread__meta">
                {thread.unreadCount > 0 && (
                  <span className="nx-inbox-thread__unread-count">{thread.unreadCount}</span>
                )}
                {thread.aiDraft && (
                  <span className="nx-ai-badge">
                    <Icon className="nx-ai-badge__icon" name="spark" />
                    Draft
                  </span>
                )}
                <span className="nx-inbox-thread__msg-count">{thread.messageCount} msgs</span>
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

        {/* Detail panel */}
        <main className="nx-inbox__detail" ref={detailRef}>
          {selected ? (
            <div className="nx-inbox-detail">
              {/* Detail header */}
              <div className="nx-inbox-detail__header">
                <div className="nx-inbox-detail__heading">
                  <h2>{selected.subject}</h2>
                  <div className="nx-inbox-detail__badges">
                    <span className={classes('nx-sentiment-pill', sentimentClass[selected.sentiment])}>
                      {selected.sentiment.toUpperCase()}
                    </span>
                    <span className={classes('nx-priority-pill', priorityClass[selected.priority])}>
                      {selected.priority.toUpperCase()}
                    </span>
                    <span className="nx-inbox-detail__msg-count">
                      {selected.messageCount} messages
                    </span>
                  </div>
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
                  <button className="nx-action-button nx-action-button--muted" type="button">
                    <Icon className="nx-action-button__icon" name="flag" />
                    Flag
                  </button>
                  <button
                    className="nx-action-button nx-action-button--accent"
                    type="button"
                    onClick={() => setSplitThread(selected)}
                    title="Focus View (Enter)"
                  >
                    <Icon className="nx-action-button__icon" name="maximize" />
                    Focus
                  </button>
                </div>
              </div>

              {/* Thread intelligence summary */}
              <div className="nx-inbox-detail__intel">
                <div className="nx-intel-card">
                  <Icon name="spark" className="nx-intel-card__icon" />
                  <div className="nx-intel-card__body">
                    <span className="nx-intel-card__title">Thread Intelligence</span>
                    <span className="nx-intel-card__detail">
                      {selected.sentiment === 'hot'
                        ? `High urgency — ${selected.ownerName} is highly engaged. Respond within 2 hours.`
                        : selected.sentiment === 'warm'
                        ? `Active interest — ${selected.ownerName} is evaluating options. Maintain momentum.`
                        : selected.sentiment === 'cold'
                        ? `Stalled thread — No engagement in ${selected.lastMessageLabel}. Consider re-engagement.`
                        : `Neutral — ${selected.ownerName} acknowledged. Monitor for intent signals.`}
                    </span>
                  </div>
                  <div className="nx-intel-card__actions">
                    <span className="nx-intel-nba">
                      {selected.sentiment === 'hot' ? 'NBA: Send Offer' : selected.sentiment === 'warm' ? 'NBA: Follow Up' : 'NBA: Re-engage'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Last message */}
              <div className="nx-inbox-detail__thread">
                <div className={classes('nx-inbox-message', 'is-inbound')}>
                  <div className="nx-inbox-message__header">
                    <div className="nx-inbox-message__sender">
                      <span className={classes('nx-sentiment-dot nx-sentiment-dot--sm', sentimentClass[selected.sentiment])} />
                      <strong>{selected.ownerName}</strong>
                    </div>
                    <span className="nx-inbox-message__time">{selected.lastMessageLabel}</span>
                  </div>
                  <p className="nx-inbox-message__content">{selected.preview}</p>
                  <div className="nx-inbox-message__footer">
                    <span className="nx-inbox-message__channel">
                      <Icon name="message" className="nx-inbox-message__channel-icon" />
                      SMS
                    </span>
                  </div>
                </div>
              </div>

              {/* AI Draft Block */}
              {selected.aiDraft && (
                <div className="nx-inbox-detail__draft">
                  <div className="nx-inbox-detail__draft-header">
                    <div className="nx-inbox-detail__draft-label">
                      <Icon className="nx-ai-draft-icon" name="spark" />
                      <span>AI-Generated Response</span>
                    </div>
                    <div className="nx-inbox-detail__draft-confidence">
                      <span className="nx-confidence-bar">
                        <span className="nx-confidence-bar__fill" style={{ width: '87%' }} />
                      </span>
                      <span className="nx-confidence-label">87% confidence</span>
                    </div>
                  </div>
                  <p className="nx-inbox-detail__draft-text">{selected.aiDraft}</p>
                  <div className="nx-inbox-detail__draft-actions">
                    <button className="nx-primary-button" type="button">
                      <Icon className="nx-primary-button__icon" name="send" />
                      Send Draft
                    </button>
                    <button className="nx-secondary-button" type="button" onClick={() => { setDraftText(selected.aiDraft ?? ''); setShowAiActions(true) }}>
                      Edit & Send
                    </button>
                    <button className="nx-secondary-button nx-secondary-button--muted" type="button">
                      Regenerate
                    </button>
                  </div>
                  <div className="nx-inbox-detail__draft-hints">
                    <span className="nx-hint">
                      <Icon name="alert" className="nx-hint__icon" />
                      {selected.sentiment === 'hot' ? 'Owner is actively negotiating — personalize pricing' : 'Consider adding property-specific details'}
                    </span>
                  </div>
                </div>
              )}

              {/* Compose area */}
              <div className="nx-inbox-detail__compose">
                <textarea
                  className="nx-inbox-detail__compose-input"
                  placeholder="Type a reply…"
                  rows={3}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                />
                <div className="nx-inbox-detail__compose-bar">
                  <div className="nx-inbox-detail__compose-tools">
                    <button type="button" className="nx-compose-tool" title="AI Assist" onClick={() => setShowAiActions(!showAiActions)}>
                      <Icon name="spark" className="nx-compose-tool__icon" />
                    </button>
                    <button type="button" className="nx-compose-tool" title="Templates">
                      <Icon name="file-text" className="nx-compose-tool__icon" />
                    </button>
                  </div>
                  <button type="button" className="nx-primary-button" disabled={!draftText.trim()} onClick={() => {
                    if (draftText.trim()) {
                      emitNotification({ title: 'Reply Sent', detail: `Response sent to ${selected.ownerName}`, severity: 'success', sound: 'ui-confirm' })
                      setDraftText('')
                    }
                  }}>
                    <Icon className="nx-primary-button__icon" name="send" />
                    Send
                  </button>
                </div>
                {showAiActions && (
                  <div className="nx-inbox-detail__ai-bar">
                    <button type="button" className="nx-ai-action">Generate Reply</button>
                    <button type="button" className="nx-ai-action">Soften Tone</button>
                    <button type="button" className="nx-ai-action">Add Urgency</button>
                    <button type="button" className="nx-ai-action">Translate</button>
                  </div>
                )}
              </div>

              {/* Thread meta sidebar */}
              <div className="nx-inbox-detail__sidebar">
                <div className="nx-inbox-detail__info-card">
                  <h4>Contact</h4>
                  <div className="nx-info-row"><span>Name</span><strong>{selected.ownerName}</strong></div>
                  <div className="nx-info-row"><span>Priority</span><strong className={priorityClass[selected.priority]}>{selected.priority}</strong></div>
                  <div className="nx-info-row"><span>Sentiment</span><strong className={sentimentClass[selected.sentiment]}>{selected.sentiment}</strong></div>
                  <div className="nx-info-row"><span>Messages</span><strong>{selected.messageCount}</strong></div>
                  <div className="nx-info-row"><span>Last Active</span><strong>{selected.lastMessageLabel}</strong></div>
                </div>
                {selected.labels.length > 0 && (
                  <div className="nx-inbox-detail__info-card">
                    <h4>Labels</h4>
                    <div className="nx-tag-row">
                      {selected.labels.map(l => <span key={l} className="nx-label-chip">{l}</span>)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="nx-empty-state nx-empty-state--large">
              <Icon className="nx-empty-icon" name="inbox" />
              <p>Select a thread to begin</p>
            </div>
          )}
        </main>
      </div>

      {/* Split View — Focus mode for thread detail */}
      <SplitView
        open={!!splitThread}
        title={splitThread?.subject ?? ''}
        subtitle={splitThread?.ownerName}
        badge={
          splitThread ? (
            <span className={`nx-sentiment-pill ${sentimentClass[splitThread.sentiment]}`}>
              {splitThread.sentiment.toUpperCase()}
            </span>
          ) : undefined
        }
        onClose={() => setSplitThread(null)}
      >
        {splitThread && (
          <div className="nx-split-thread">
            <div className="nx-split-thread__intel">
              <Icon name="spark" className="nx-split-thread__icon" />
              <span>
                {splitThread.sentiment === 'hot'
                  ? `High urgency thread — ${splitThread.ownerName} is actively engaged.`
                  : splitThread.sentiment === 'warm'
                  ? `Active interest — maintain momentum with ${splitThread.ownerName}.`
                  : `Monitor thread for intent signals from ${splitThread.ownerName}.`}
              </span>
            </div>
            <div className="nx-split-thread__message">
              <strong>{splitThread.ownerName}</strong>
              <p>{splitThread.preview}</p>
              <span className="nx-split-thread__time">{splitThread.lastMessageLabel}</span>
            </div>
            {splitThread.aiDraft && (
              <div className="nx-split-thread__draft">
                <div className="nx-split-thread__draft-label">
                  <Icon name="spark" className="nx-split-thread__draft-icon" />
                  AI Draft Ready
                </div>
                <p>{splitThread.aiDraft}</p>
                <button type="button" className="nx-primary-button">
                  <Icon className="nx-primary-button__icon" name="send" />
                  Send Draft
                </button>
              </div>
            )}
            <div className="nx-split-thread__meta">
              <div className="nx-info-row"><span>Priority</span><strong>{splitThread.priority}</strong></div>
              <div className="nx-info-row"><span>Messages</span><strong>{splitThread.messageCount}</strong></div>
              <div className="nx-info-row"><span>Unread</span><strong>{splitThread.unreadCount}</strong></div>
            </div>
          </div>
        )}
      </SplitView>
    </div>
  )
}
