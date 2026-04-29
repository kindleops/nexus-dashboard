import type { InboxStage, InboxThreadsQuery, InboxWorkflowStatus, InboxPriority } from '../../lib/data/inboxWorkflowData'

export const InboxFilterBar = ({
  filters,
  markets,
  onChange,
  onReset,
}: {
  filters: InboxThreadsQuery
  markets: string[]
  onChange: (patch: Partial<InboxThreadsQuery>) => void
  onReset: () => void
}) => {
  const statusOptions: Array<InboxWorkflowStatus | 'all'> = ['all', 'open', 'unread', 'read', 'queued', 'scheduled', 'sent', 'failed', 'archived', 'suppressed', 'closed']
  const stageOptions: Array<InboxStage | 'all'> = ['all', 'new_reply', 'needs_response', 'ai_draft_ready', 'queued_reply', 'sent_waiting', 'interested', 'needs_offer', 'needs_call', 'nurture', 'not_interested', 'wrong_number', 'dnc_opt_out', 'archived', 'closed_converted']
  const priorityOptions: Array<InboxPriority | 'all'> = ['all', 'urgent', 'high', 'normal', 'low']

  return (
    <div className="nx-inbox-filter-bar">
      <label>
        <span>Market</span>
        <select value={filters.market ?? ''} onChange={(e) => onChange({ market: e.target.value || undefined })}>
          <option value="">All Markets</option>
          {markets.map((market) => (
            <option key={market} value={market}>{market}</option>
          ))}
        </select>
      </label>

      <label>
        <span>Direction</span>
        <select value={filters.direction ?? 'all'} onChange={(e) => onChange({ direction: e.target.value as InboxThreadsQuery['direction'] })}>
          <option value="all">All</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>
      </label>

      <label>
        <span>Stage</span>
        <select value={filters.stage ?? 'all'} onChange={(e) => onChange({ stage: e.target.value as InboxStage | 'all' })}>
          {stageOptions.map((stage) => (
            <option key={stage} value={stage}>{stage}</option>
          ))}
        </select>
      </label>

      <label>
        <span>Status</span>
        <select value={filters.status ?? 'all'} onChange={(e) => onChange({ status: e.target.value as InboxWorkflowStatus | 'all' })}>
          {statusOptions.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </label>

      <label>
        <span>Priority</span>
        <select value={filters.priority ?? 'all'} onChange={(e) => onChange({ priority: e.target.value as InboxPriority | 'all' })}>
          {priorityOptions.map((priority) => (
            <option key={priority} value={priority}>{priority}</option>
          ))}
        </select>
      </label>

      <label>
        <span>Read</span>
        <select value={filters.read ?? 'all'} onChange={(e) => onChange({ read: e.target.value as InboxThreadsQuery['read'] })}>
          <option value="all">All</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
        </select>
      </label>

      <label>
        <span>From</span>
        <input type="date" value={filters.startDate ?? ''} onChange={(e) => onChange({ startDate: e.target.value || undefined })} />
      </label>
      <label>
        <span>To</span>
        <input type="date" value={filters.endDate ?? ''} onChange={(e) => onChange({ endDate: e.target.value || undefined })} />
      </label>

      <div className="nx-inbox-filter-bar__toggles">
        <label><input type="checkbox" checked={Boolean(filters.hasPropertyLink)} onChange={(e) => onChange({ hasPropertyLink: e.target.checked || undefined })} /> Property</label>
        <label><input type="checkbox" checked={Boolean(filters.hasOwnerLink)} onChange={(e) => onChange({ hasOwnerLink: e.target.checked || undefined })} /> Owner</label>
        <label><input type="checkbox" checked={Boolean(filters.hasPhoneLink)} onChange={(e) => onChange({ hasPhoneLink: e.target.checked || undefined })} /> Phone</label>
        <label><input type="checkbox" checked={Boolean(filters.dncOptOut)} onChange={(e) => onChange({ dncOptOut: e.target.checked || undefined })} /> DNC/Opt Out</label>
      </div>

      <button type="button" className="nx-inline-button" onClick={onReset}>Reset Filters</button>
    </div>
  )
}
