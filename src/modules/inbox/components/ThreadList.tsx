import { useMemo, useState, memo } from 'react'
import { List } from 'react-window'
import type { InboxWorkflowThread, InboxStatusTab, InboxThreadsQuery, InboxStage } from '../../../lib/data/inboxWorkflowData'
import { Icon } from '../../../shared/icons'
import { formatRelativeTime } from '../../../shared/formatters'

const cls = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

interface ThreadListProps {
  threads: InboxWorkflowThread[]
  selectedId: string | null
  onSelect: (id: string) => void
  workflowTab: InboxStatusTab
  setWorkflowTab: (tab: InboxStatusTab) => void
  workflowFilters?: InboxThreadsQuery
  setWorkflowFilters?: (f: any) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  onUpdateStage?: (id: string, stage: InboxStage) => void
  onArchive?: (thread: InboxWorkflowThread) => void
  onMarkRead?: (thread: InboxWorkflowThread) => void
}

const ThreadRow = memo(({ thread, isSelected, onSelect }: { thread: InboxWorkflowThread, isSelected: boolean, onSelect: (id: string) => void }) => (
  <div 
    className={cls('nx-thread-row', isSelected && 'is-selected')}
    onClick={() => onSelect(thread.id)}
  >
    <div className="nx-thread-row__avatar">
      {thread.ownerName[0]}
    </div>
    <div className="nx-thread-row__content">
      <div className="nx-thread-row__header">
        <span className="nx-thread-row__name">{thread.ownerName}</span>
        <span className="nx-thread-row__time">{formatRelativeTime(thread.lastInboundAt || thread.lastMessageAt)}</span>
      </div>
      <div className="nx-thread-row__subject">{thread.subject}</div>
      <div className="nx-thread-row__preview">{thread.preview}</div>
      <div className="nx-thread-row__meta">
        <span className={cls('nx-stage-pill', `is-${thread.inboxStage}`)}>{thread.inboxStage}</span>
        {thread.unreadCount > 0 && <span className="nx-unread-dot" />}
      </div>
    </div>
  </div>
))

export const ThreadList = memo(({
  threads,
  selectedId,
  onSelect,
  workflowTab,
  setWorkflowTab,
  searchQuery,
  setSearchQuery,
}: ThreadListProps) => {
  const [filterOpen, setFilterOpen] = useState(false)

  const filtered = useMemo(() => {
    return threads.filter(t => {
      const matchTab = workflowTab === 'all' || t.inboxStage === workflowTab
      const matchSearch = !searchQuery || 
        t.ownerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.subject.toLowerCase().includes(searchQuery.toLowerCase())
      return matchTab && matchSearch
    })
  }, [threads, workflowTab, searchQuery])

  const Row = ({ index, style }: { index: number, style: React.CSSProperties }) => {
    const thread = filtered[index]
    return (
      <div style={style}>
        <ThreadRow 
          thread={thread} 
          isSelected={selectedId === thread.id} 
          onSelect={onSelect} 
        />
      </div>
    )
  }

  return (
    <aside className="nx-thread-rail">
      <div className="nx-rail-header">
        <div className="nx-rail-title-row">
          <h1>Inbox</h1>
          <div className="nx-header-actions">
            <button className="nx-icon-button" onClick={() => setFilterOpen(!filterOpen)}>
              <Icon name="filter" style={{width: 16}} />
            </button>
          </div>
        </div>
        
        <div className="nx-search-container">
          <Icon name="search" className="nx-search-icon" />
          <input 
            type="text" 
            placeholder="Search threads..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="nx-quick-stages">
          {(['all', 'lead', 'qualified', 'offer'] as InboxStatusTab[]).map(stage => (
            <button 
              key={stage}
              className={cls('nx-stage-filter', workflowTab === stage && 'is-active')}
              onClick={() => setWorkflowTab(stage)}
            >
              {stage}
            </button>
          ))}
        </div>
      </div>

      <div className="nx-rail-list">
        {filtered.length === 0 ? (
          <div className="nx-rail-empty">
            <p>No threads match your filters.</p>
          </div>
        ) : (
          <List {...{
            height: 800,
            itemCount: filtered.length,
            itemSize: 92,
            width: '100%'
          } as any}>
            {Row as any}
          </List>
        )}
      </div>
    </aside>
  )
})
