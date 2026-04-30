import type { InboxStage } from '../../lib/data/inboxWorkflowData'

export interface StatusVisual {
  label: string
  color: string
  bg: string
  border: string
  dot: string
  pulse: string
  description: string
}

export const statusDescriptions: Record<InboxStage, string> = {
  new_reply: 'Fresh seller response ready for triage.',
  needs_response: 'Operator response is needed now.',
  ai_draft_ready: 'AI drafted a response for review.',
  queued_reply: 'Reply is queued or has been auto-sent.',
  sent_waiting: 'Outbound sent, waiting for seller movement.',
  interested: 'Seller is open or qualified for acquisition.',
  needs_offer: 'Deal needs pricing or an offer action.',
  needs_call: 'Call, appointment, or schedule action is next.',
  nurture: 'Keep warm with lower urgency follow-up.',
  not_interested: 'Seller declined or is low-value for now.',
  wrong_number: 'Contact mismatch or wrong person.',
  dnc_opt_out: 'Suppressed for compliance.',
  archived: 'Closed out of active inbox flow.',
  closed_converted: 'Deal is closed, dead, or converted.',
}

const statusVisuals: Record<InboxStage, StatusVisual> = {
  new_reply: {
    label: 'New Lead',
    color: '#0a84ff',
    bg: 'rgba(10,132,255,0.14)',
    border: 'rgba(10,132,255,0.42)',
    dot: '#0a84ff',
    pulse: 'rgba(10,132,255,0.42)',
    description: statusDescriptions.new_reply,
  },
  needs_response: {
    label: 'Needs Response',
    color: '#ff453a',
    bg: 'rgba(255,69,58,0.13)',
    border: 'rgba(255,69,58,0.42)',
    dot: '#ff453a',
    pulse: 'rgba(255,69,58,0.42)',
    description: statusDescriptions.needs_response,
  },
  ai_draft_ready: {
    label: 'Auto Reply Ready',
    color: '#a78bfa',
    bg: 'rgba(167,139,250,0.15)',
    border: 'rgba(167,139,250,0.42)',
    dot: '#a78bfa',
    pulse: 'rgba(167,139,250,0.42)',
    description: statusDescriptions.ai_draft_ready,
  },
  queued_reply: {
    label: 'Auto Reply Sent',
    color: '#5bb6ff',
    bg: 'rgba(91,182,255,0.14)',
    border: 'rgba(91,182,255,0.4)',
    dot: '#5bb6ff',
    pulse: 'rgba(91,182,255,0.4)',
    description: statusDescriptions.queued_reply,
  },
  sent_waiting: {
    label: 'Follow-Up Watch',
    color: '#ffd60a',
    bg: 'rgba(255,214,10,0.12)',
    border: 'rgba(255,214,10,0.38)',
    dot: '#ffd60a',
    pulse: 'rgba(255,214,10,0.38)',
    description: statusDescriptions.sent_waiting,
  },
  interested: {
    label: 'Qualified',
    color: '#0a84ff',
    bg: 'rgba(10,132,255,0.18)',
    border: 'rgba(10,132,255,0.5)',
    dot: '#0a84ff',
    pulse: 'rgba(10,132,255,0.5)',
    description: statusDescriptions.interested,
  },
  needs_offer: {
    label: 'Offer Needed',
    color: '#f7b733',
    bg: 'rgba(247,183,51,0.14)',
    border: 'rgba(247,183,51,0.42)',
    dot: '#f7b733',
    pulse: 'rgba(247,183,51,0.42)',
    description: statusDescriptions.needs_offer,
  },
  needs_call: {
    label: 'Scheduled',
    color: '#7c8cff',
    bg: 'rgba(124,140,255,0.14)',
    border: 'rgba(124,140,255,0.42)',
    dot: '#7c8cff',
    pulse: 'rgba(124,140,255,0.42)',
    description: statusDescriptions.needs_call,
  },
  nurture: {
    label: 'Nurture',
    color: '#94a3b8',
    bg: 'rgba(148,163,184,0.12)',
    border: 'rgba(148,163,184,0.28)',
    dot: '#94a3b8',
    pulse: 'rgba(148,163,184,0.25)',
    description: statusDescriptions.nurture,
  },
  not_interested: {
    label: 'Not Interested',
    color: '#8a96a8',
    bg: 'rgba(138,150,168,0.1)',
    border: 'rgba(138,150,168,0.25)',
    dot: '#8a96a8',
    pulse: 'rgba(138,150,168,0.22)',
    description: statusDescriptions.not_interested,
  },
  wrong_number: {
    label: 'Wrong Person',
    color: '#ff9f43',
    bg: 'rgba(255,159,67,0.12)',
    border: 'rgba(255,159,67,0.34)',
    dot: '#ff9f43',
    pulse: 'rgba(255,159,67,0.32)',
    description: statusDescriptions.wrong_number,
  },
  dnc_opt_out: {
    label: 'Suppressed',
    color: '#ff6b64',
    bg: 'rgba(255,69,58,0.1)',
    border: 'rgba(255,69,58,0.28)',
    dot: '#ff453a',
    pulse: 'rgba(255,69,58,0.28)',
    description: statusDescriptions.dnc_opt_out,
  },
  archived: {
    label: 'Archived',
    color: '#7d8797',
    bg: 'rgba(125,135,151,0.1)',
    border: 'rgba(125,135,151,0.24)',
    dot: '#7d8797',
    pulse: 'rgba(125,135,151,0.2)',
    description: statusDescriptions.archived,
  },
  closed_converted: {
    label: 'Closed / Dead',
    color: '#687386',
    bg: 'rgba(31,41,55,0.22)',
    border: 'rgba(104,115,134,0.28)',
    dot: '#687386',
    pulse: 'rgba(104,115,134,0.22)',
    description: statusDescriptions.closed_converted,
  },
}

export const inboxStatusOptions = Object.entries(statusVisuals).map(([value, visual]) => ({
  value: value as InboxStage,
  ...visual,
}))

export const getStatusVisual = (status?: string | null, suppressed = false): StatusVisual => {
  if (suppressed) return statusVisuals.dnc_opt_out
  const key = (status || 'new_reply') as InboxStage
  return statusVisuals[key] ?? {
    label: String(status || 'Unknown').replaceAll('_', ' '),
    color: '#94a3b8',
    bg: 'rgba(148,163,184,0.12)',
    border: 'rgba(148,163,184,0.24)',
    dot: '#94a3b8',
    pulse: 'rgba(148,163,184,0.22)',
    description: 'No workflow metadata available yet.',
  }
}

export const statusStyleVars = (visual: StatusVisual) => ({
  '--status-color': visual.color,
  '--status-bg': visual.bg,
  '--status-border': visual.border,
  '--status-dot': visual.dot,
  '--status-pulse': visual.pulse,
}) as Record<string, string>
