import type { InboxWorkflowThread } from '../../lib/data/inboxWorkflowData'

export interface KpiData {
  id: string
  label: string
  count: number | string
  viewFilter: string
  details?: {
    label: string
    value: string | number
  }[]
}

export const buildInboxKpis = (
  viewCounts: any,
  threads: InboxWorkflowThread[]
): KpiData[] => {
  // Extract counts with fallbacks
  const newInbound = viewCounts.needs_reply || 0
  const hotLeads = viewCounts.positive_hot || 0
  const needsReview = viewCounts.manual_review || 0
  const allInbound = viewCounts.all || 0
  const automated = viewCounts.auto_replied || 0
  const outboundActive = viewCounts.active || 0
  const suppressed = viewCounts.suppressed || 0

  const latestHot = threads.find(t => t.inboxCategory === 'hot_lead')
  const oldestWaiting = threads.find(t => t.inboxStatus === 'waiting' || t.inboxStatus === 'new_reply')

  return [
    {
      id: 'new_inbound',
      label: 'New Inbound',
      count: newInbound,
      viewFilter: 'needs_reply',
      details: [
        { label: 'Unread Count', value: viewCounts.unread || newInbound },
        { label: 'Oldest Waiting', value: oldestWaiting ? `${oldestWaiting.id.slice(-6)}` : '—' }
      ]
    },
    {
      id: 'hot_leads',
      label: 'Hot Leads',
      count: hotLeads,
      viewFilter: 'positive_hot',
      details: [
        { label: 'Top Match', value: latestHot?.market || '—' },
        { label: 'Address', value: latestHot?.propertyAddress || '—' }
      ]
    },
    {
      id: 'needs_review',
      label: 'Needs Review',
      count: needsReview,
      viewFilter: 'manual_review',
      details: [
        { label: 'Unclear Intent', value: viewCounts.missing_context || 0 }
      ]
    },
    {
      id: 'all_inbound',
      label: 'All Inbound',
      count: allInbound,
      viewFilter: 'all',
      details: [
        { label: 'Total Threads', value: allInbound },
        { label: 'Visible', value: threads.length }
      ]
    },
    {
      id: 'automated',
      label: 'Automated',
      count: automated,
      viewFilter: 'auto_replied',
      details: [
        { label: 'Auto Replied', value: automated }
      ]
    },
    {
      id: 'outbound_active',
      label: 'Outbound Active',
      count: outboundActive,
      viewFilter: 'active',
      details: [
        { label: 'Active', value: outboundActive }
      ]
    },
    {
      id: 'dnc_opt_out',
      label: 'DNC / Opt-Out',
      count: suppressed,
      viewFilter: 'suppressed',
      details: [
        { label: 'Suppressed', value: suppressed },
        { label: 'Wrong Number', value: viewCounts.wrong_number || 0 }
      ]
    }
  ]
}
