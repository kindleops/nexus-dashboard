import type { InboxStatus, SellerStage, AutomationState } from '../../lib/data/inboxWorkflowData'

export interface StatusVisual {
  label: string
  color: string
  bg: string
  border: string
  dot: string
  pulse: string
  description: string
}

export const inboxStatusVisuals: Record<InboxStatus, StatusVisual> = {
  new_reply: {
    label: 'New Reply',
    color: '#0a84ff',
    bg: 'rgba(10,132,255,0.14)',
    border: 'rgba(10,132,255,0.42)',
    dot: '#0a84ff',
    pulse: 'rgba(10,132,255,0.42)',
    description: 'Fresh inbound message ready for triage.',
  },
  needs_review: {
    label: 'Needs Review',
    color: '#ff9f43',
    bg: 'rgba(255,159,67,0.12)',
    border: 'rgba(255,159,67,0.34)',
    dot: '#ff9f43',
    pulse: 'rgba(255,159,67,0.32)',
    description: 'Complexity requires operator review.',
  },
  ai_draft_ready: {
    label: 'Auto Reply Ready',
    color: '#a78bfa',
    bg: 'rgba(167,139,250,0.15)',
    border: 'rgba(167,139,250,0.42)',
    dot: '#a78bfa',
    pulse: 'rgba(167,139,250,0.42)',
    description: 'AI draft ready for approval.',
  },
  queued: {
    label: 'Queued',
    color: '#5bb6ff',
    bg: 'rgba(91,182,255,0.14)',
    border: 'rgba(91,182,255,0.4)',
    dot: '#5bb6ff',
    pulse: 'rgba(91,182,255,0.4)',
    description: 'Message scheduled or sending.',
  },
  waiting: {
    label: 'Waiting',
    color: '#ffd60a',
    bg: 'rgba(255,214,10,0.12)',
    border: 'rgba(255,214,10,0.38)',
    dot: '#ffd60a',
    pulse: 'rgba(255,214,10,0.38)',
    description: 'Awaiting seller response.',
  },
  suppressed: {
    label: 'Suppressed',
    color: '#ff6b64',
    bg: 'rgba(255,69,58,0.1)',
    border: 'rgba(255,69,58,0.28)',
    dot: '#ff453a',
    pulse: 'rgba(255,69,58,0.28)',
    description: 'Compliance suppression active.',
  },
  closed: {
    label: 'Closed',
    color: '#7d8797',
    bg: 'rgba(125,135,151,0.1)',
    border: 'rgba(125,135,151,0.24)',
    dot: '#7d8797',
    pulse: 'rgba(125,135,151,0.2)',
    description: 'Thread completed or archived.',
  },
}

export const sellerStageVisuals: Record<SellerStage, StatusVisual> = {
  ownership_check: {
    label: 'Ownership Check',
    color: '#0a84ff',
    bg: 'rgba(10,132,255,0.1)',
    border: 'rgba(10,132,255,0.2)',
    dot: '#0a84ff',
    pulse: 'rgba(10,132,255,0.2)',
    description: 'Verifying property ownership.',
  },
  interest_probe: {
    label: 'Interest Probe',
    color: '#0a84ff',
    bg: 'rgba(10,132,255,0.1)',
    border: 'rgba(10,132,255,0.2)',
    dot: '#0a84ff',
    pulse: 'rgba(10,132,255,0.2)',
    description: 'Gauging interest in selling.',
  },
  seller_response: {
    label: 'Seller Response',
    color: '#0a84ff',
    bg: 'rgba(10,132,255,0.1)',
    border: 'rgba(10,132,255,0.2)',
    dot: '#0a84ff',
    pulse: 'rgba(10,132,255,0.2)',
    description: 'Seller engaged in conversation.',
  },
  price_discovery: {
    label: 'Price Discovery',
    color: '#0a84ff',
    bg: 'rgba(10,132,255,0.1)',
    border: 'rgba(10,132,255,0.2)',
    dot: '#0a84ff',
    pulse: 'rgba(10,132,255,0.2)',
    description: 'Identifying price expectations.',
  },
  condition_details: {
    label: 'Condition / Details',
    color: '#0a84ff',
    bg: 'rgba(10,132,255,0.1)',
    border: 'rgba(10,132,255,0.2)',
    dot: '#0a84ff',
    pulse: 'rgba(10,132,255,0.2)',
    description: 'Gathering property details.',
  },
  offer_reveal: {
    label: 'Offer Reveal',
    color: '#30d158',
    bg: 'rgba(48,209,88,0.1)',
    border: 'rgba(48,209,88,0.2)',
    dot: '#30d158',
    pulse: 'rgba(48,209,88,0.2)',
    description: 'Presenting acquisition offer.',
  },
  negotiation: {
    label: 'Negotiation',
    color: '#30d158',
    bg: 'rgba(48,209,88,0.1)',
    border: 'rgba(48,209,88,0.2)',
    dot: '#30d158',
    pulse: 'rgba(48,209,88,0.2)',
    description: 'Terms negotiation in progress.',
  },
  contract_path: {
    label: 'Contract Path',
    color: '#30d158',
    bg: 'rgba(48,209,88,0.1)',
    border: 'rgba(48,209,88,0.2)',
    dot: '#30d158',
    pulse: 'rgba(48,209,88,0.2)',
    description: 'Moving toward executed contract.',
  },
  dead_suppressed: {
    label: 'Dead / Suppressed',
    color: '#7d8797',
    bg: 'rgba(125,135,151,0.1)',
    border: 'rgba(125,135,151,0.2)',
    dot: '#7d8797',
    pulse: 'rgba(125,135,151,0.2)',
    description: 'Lead dead or suppressed.',
  },
}

export const automationStateVisuals: Record<AutomationState, { label: string; color: string }> = {
  active: { label: 'Automation Active', color: '#30d158' },
  paused: { label: 'Automation Paused', color: '#ffd60a' },
  completed: { label: 'Automation Completed', color: '#7d8797' },
  manual_control: { label: 'Manual Control', color: '#ff9f43' },
}

export const inboxStatusOptions = Object.entries(inboxStatusVisuals).map(([value, visual]) => ({
  value: value as InboxStatus,
  ...visual,
}))

export const sellerStageOptions = Object.entries(sellerStageVisuals).map(([value, visual]) => ({
  value: value as SellerStage,
  ...visual,
}))

export const getStatusVisual = (status?: string | null): StatusVisual => {
  const key = (status || 'new_reply') as InboxStatus
  return inboxStatusVisuals[key] ?? {
    label: String(status || 'Unknown').replaceAll('_', ' '),
    color: '#94a3b8',
    bg: 'rgba(148,163,184,0.12)',
    border: 'rgba(148,163,184,0.24)',
    dot: '#94a3b8',
    pulse: 'rgba(148,163,184,0.22)',
    description: 'Unknown status.',
  }
}

export const getSellerStageVisual = (stage?: string | null): StatusVisual => {
  const key = (stage || 'ownership_check') as SellerStage
  return sellerStageVisuals[key] ?? {
    label: String(stage || 'Unknown').replaceAll('_', ' '),
    color: '#94a3b8',
    bg: 'rgba(148,163,184,0.12)',
    border: 'rgba(148,163,184,0.24)',
    dot: '#94a3b8',
    pulse: 'rgba(148,163,184,0.22)',
    description: 'Unknown stage.',
  }
}

export const statusStyleVars = (visual: StatusVisual) => ({
  '--status-color': visual.color,
  '--status-bg': visual.bg,
  '--status-border': visual.border,
  '--status-dot': visual.dot,
  '--status-pulse': visual.pulse,
}) as Record<string, string>
