import type { InboxStage, InboxWorkflowStatus, InboxPriority } from '../../lib/data/inboxWorkflowData'

const STAGE_OPTIONS: Array<{ value: InboxStage; label: string }> = [
  { value: 'new_reply', label: 'New Reply' },
  { value: 'needs_response', label: 'Needs Response' },
  { value: 'ai_draft_ready', label: 'AI Draft Ready' },
  { value: 'queued_reply', label: 'Queued Reply' },
  { value: 'sent_waiting', label: 'Sent / Waiting' },
  { value: 'interested', label: 'Interested' },
  { value: 'needs_offer', label: 'Needs Offer' },
  { value: 'needs_call', label: 'Needs Call' },
  { value: 'nurture', label: 'Nurture' },
  { value: 'not_interested', label: 'Not Interested' },
  { value: 'wrong_number', label: 'Wrong Number' },
  { value: 'dnc_opt_out', label: 'DNC / Opt Out' },
  { value: 'archived', label: 'Archived' },
  { value: 'closed_converted', label: 'Closed / Converted' },
]

const STATUS_OPTIONS: Array<{ value: InboxWorkflowStatus; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'unread', label: 'Unread' },
  { value: 'read', label: 'Read' },
  { value: 'pending', label: 'Pending' },
  { value: 'queued', label: 'Queued' },
  { value: 'sent', label: 'Sent' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'failed', label: 'Failed' },
  { value: 'archived', label: 'Archived' },
  { value: 'suppressed', label: 'Suppressed' },
  { value: 'closed', label: 'Closed' },
]

const PRIORITY_OPTIONS: Array<{ value: InboxPriority; label: string }> = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
]

export const InboxStageDropdown = ({
  stage,
  status,
  priority,
  onStageChange,
  onStatusChange,
  onPriorityChange,
}: {
  stage: InboxStage
  status: InboxWorkflowStatus
  priority: InboxPriority
  onStageChange: (value: InboxStage) => void
  onStatusChange: (value: InboxWorkflowStatus) => void
  onPriorityChange: (value: InboxPriority) => void
}) => {
  return (
    <div className="nx-inbox-workflow-controls">
      <label className="nx-inbox-workflow-field">
        <span>Stage</span>
        <select value={stage} onChange={(e) => onStageChange(e.target.value as InboxStage)}>
          {STAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label className="nx-inbox-workflow-field">
        <span>Status</span>
        <select value={status} onChange={(e) => onStatusChange(e.target.value as InboxWorkflowStatus)}>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label className="nx-inbox-workflow-field">
        <span>Priority</span>
        <select value={priority} onChange={(e) => onPriorityChange(e.target.value as InboxPriority)}>
          {PRIORITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    </div>
  )
}
