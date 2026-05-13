import { memo, useMemo } from 'react'
import type { InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import { formatInboxThreadTimestamp } from '../../../shared/formatters'
import { resolveThreadAddressLine, resolveThreadMarketBadge, resolveThreadPrimaryName } from '../inbox-ui-helpers'
import { buildConversationDecision, type ConversationDecision } from '../inbox-decisioning'

const cls = (...tokens: Array<string | false | null | undefined>) => tokens.filter(Boolean).join(' ')

export type ConversationTableSort =
  | 'last_activity_desc'
  | 'priority_desc'
  | 'seller_asc'
  | 'temperature_desc'
  | 'follow_up_asc'

interface InboxConversationTableProps {
  threads: InboxWorkflowThread[]
  selectedId: string | null
  sort: ConversationTableSort
  density: 'comfortable' | 'compact' | 'ultra_compact'
  onSortChange: (sort: ConversationTableSort) => void
  onDensityChange: (density: 'comfortable' | 'compact' | 'ultra_compact') => void
  onSelect: (id: string) => void
}

const sorters: Record<ConversationTableSort, (a: RowModel, b: RowModel) => number> = {
  last_activity_desc: (a, b) => b.lastActivityMs - a.lastActivityMs,
  priority_desc: (a, b) => b.decision.priority_score - a.decision.priority_score,
  seller_asc: (a, b) => a.seller.localeCompare(b.seller),
  temperature_desc: (a, b) => rankTemperature(b.decision.lead_temperature) - rankTemperature(a.decision.lead_temperature),
  follow_up_asc: (a, b) => (a.followUpMs || Number.MAX_SAFE_INTEGER) - (b.followUpMs || Number.MAX_SAFE_INTEGER),
}

type RowModel = {
  thread: InboxWorkflowThread
  decision: ConversationDecision
  seller: string
  address: string
  market: string
  lastActivityMs: number
  followUpMs: number | null
}

const rankTemperature = (value: ConversationDecision['lead_temperature']) => {
  if (value === 'READY_TO_CLOSE') return 5
  if (value === 'VERY_HOT') return 4
  if (value === 'HOT') return 3
  if (value === 'WARM') return 2
  return 1
}

export const InboxConversationTable = memo(({
  threads,
  selectedId,
  sort,
  density,
  onSortChange,
  onDensityChange,
  onSelect,
}: InboxConversationTableProps) => {
  const rows = useMemo(() => {
    return threads
      .map((thread) => {
        const decision = buildConversationDecision(thread)
        const seller = resolveThreadPrimaryName(thread)
        const address = resolveThreadAddressLine(thread)
        const market = resolveThreadMarketBadge(thread)
        const lastActivityMs = new Date(thread.lastMessageAt || thread.lastMessageIso || 0).getTime()
        const followUpMs = decision.next_follow_up_at ? new Date(decision.next_follow_up_at).getTime() : null
        return { thread, decision, seller, address, market, lastActivityMs, followUpMs }
      })
      .sort(sorters[sort])
  }, [sort, threads])

  return (
    <section className={cls('nx-inbox-table-view', `is-${density}`)}>
      <header className="nx-inbox-table-view__header">
        <div>
          <span className="nx-section-label">LIST VIEW</span>
          <h2>Operational Conversations</h2>
        </div>
        <div className="nx-inbox-table-view__controls">
          <select value={sort} onChange={(event) => onSortChange(event.target.value as ConversationTableSort)}>
            <option value="last_activity_desc">Last Activity</option>
            <option value="priority_desc">Priority Score</option>
            <option value="seller_asc">Seller</option>
            <option value="temperature_desc">Temperature</option>
            <option value="follow_up_asc">Next Follow-Up</option>
          </select>
          <div className="nx-inbox-density-switch" role="tablist" aria-label="Table density">
            {([
              ['comfortable', 'Comfortable'],
              ['compact', 'Compact'],
              ['ultra_compact', 'Ultra Compact'],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" className={cls('nx-inbox-density-switch__btn', density === value && 'is-active')} onClick={() => onDensityChange(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="nx-inbox-table-wrap">
        <table className="nx-inbox-table">
          <thead>
            <tr>
              <th>Seller</th>
              <th>Property</th>
              <th>Last Message</th>
              <th>Stage</th>
              <th>Status</th>
              <th>Next Action</th>
              <th>Score</th>
              <th>Last Activity</th>
              <th>Auto</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ thread, decision, seller, address, market }) => {
              const ts = formatInboxThreadTimestamp(thread.lastMessageAt || thread.lastMessageIso)
              return (
                <tr
                  key={thread.id}
                  className={cls(selectedId === thread.id && 'is-selected')}
                  onClick={() => onSelect(thread.id)}
                >
                  <td>
                    <div className="nx-inbox-table__primary">{seller}</div>
                    <div className="nx-inbox-table__secondary">{market || '—'}</div>
                  </td>
                  <td>
                    <div className="nx-inbox-table__primary">{address || '—'}</div>
                    <div className="nx-inbox-table__secondary">{(thread as any).propertyType || (thread as any).property_type || '—'}</div>
                  </td>
                  <td className="is-preview">{thread.lastMessageBody || thread.preview || 'No recent message'}</td>
                  <td><span className="nx-table-pill is-stage">{decision.conversation_stage.replace(/_/g, ' ')}</span></td>
                  <td><span className="nx-table-pill">{decision.conversation_status.replace(/_/g, ' ')}</span></td>
                  <td className="is-preview">{decision.next_action}</td>
                  <td>{Number.isFinite(decision.priority_score) ? decision.priority_score : '—'}</td>
                  <td>{ts.fullLabel}</td>
                  <td><span className="nx-table-pill is-auto">{decision.automation_status}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
})

InboxConversationTable.displayName = 'InboxConversationTable'
