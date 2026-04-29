import { } from 'react'
import type { ThreadContext } from '../../../lib/data/inboxData'
import type { InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'

interface IntelligencePanelProps {
  thread: InboxWorkflowThread | null
  context: ThreadContext | null
}

export const IntelligencePanel = ({ thread, context }: IntelligencePanelProps) => {
  if (!thread) return (
    <aside className="nx-intelligence-panel">
      <div className="nx-inbox__workspace-empty">
        <p>Select a thread to view intelligence.</p>
      </div>
    </aside>
  )

  return (
    <aside className="nx-intelligence-panel">
      <header className="nx-intel-header">
        <span className="nx-intel-card__title">Intelligence Panel</span>
      </header>

      <section className="nx-intel-card">
        <span className="nx-intel-card__title">Property</span>
        <div className="nx-intel-row">
          <span className="nx-intel-label">Address</span>
          <span className="nx-intel-value">{context?.property?.address || thread.subject}</span>
        </div>
        <div className="nx-intel-row">
          <span className="nx-intel-label">Market</span>
          <span className="nx-intel-value">{context?.property?.market || thread.marketId || 'Unknown'}</span>
        </div>
      </section>

      <section className="nx-intel-card">
        <span className="nx-intel-card__title">Prospect</span>
        <div className="nx-intel-row">
          <span className="nx-intel-label">Name</span>
          <span className="nx-intel-value">{context?.seller?.name || thread.ownerName}</span>
        </div>
        <div className="nx-intel-row">
          <span className="nx-intel-label">Phone</span>
          <span className="nx-intel-value">{context?.phone || 'Hidden'}</span>
        </div>
      </section>

      <section className="nx-intel-card">
        <span className="nx-intel-card__title">Deal Intelligence</span>
        <div className="nx-intel-row">
          <span className="nx-intel-label">Sentiment</span>
          <span className={`nx-sent-pill is-${thread.sentiment}`}>{thread.sentiment}</span>
        </div>
        <div className="nx-intel-row">
          <span className="nx-intel-label">Priority</span>
          <span className={`nx-pri-pill is-${thread.priority}`}>{thread.priority}</span>
        </div>
      </section>

      <section className="nx-intel-card is-accent">
        <span className="nx-intel-card__title">Next Best Action</span>
        <p className="nx-nba-text">{context?.dealContext?.nextAction || 'Monitor for intent signals.'}</p>
        <button className="nx-utility-btn" style={{marginTop: 12, width: '100%', justifyContent: 'center'}}>
          Execute Suggested Action
        </button>
      </section>
    </aside>
  )
}
