/**
 * NEXUS Copilot — State Machine + Action Engine
 *
 * Provides:
 * - CopilotState: 14 distinct intelligence states
 * - State metadata (labels, colors, orb behavior descriptors)
 * - Normalized action/intent engine for converting natural language → structured ops
 * - Room-aware context resolution
 * - Action permission system
 */

// ── Copilot States ────────────────────────────────────────────────────────

export type CopilotState =
  | 'idle'
  | 'greeting'
  | 'listening'
  | 'transcribing'
  | 'understanding'
  | 'searching'
  | 'analyzing'
  | 'planning'
  | 'drafting'
  | 'executing'
  | 'confirming'
  | 'completed'
  | 'error'

export interface StateMeta {
  label: string
  sublabel: string
  orbSpeed: number      // pulse frequency multiplier (0 = static, 1 = normal, 3 = fast)
  orbIntensity: number  // glow intensity 0–1
  hue: string           // rgb string for canvas rendering
  accentClass: string   // css modifier
}

export const STATE_META: Record<CopilotState, StateMeta> = {
  idle:          { label: 'Standing by',            sublabel: 'Awaiting input',              orbSpeed: 0.3, orbIntensity: 0.12, hue: '56,208,240',  accentClass: 'is-idle' },
  greeting:      { label: 'Initializing',           sublabel: 'Loading context…',            orbSpeed: 0.8, orbIntensity: 0.25, hue: '56,208,240',  accentClass: 'is-greeting' },
  listening:     { label: 'Listening',               sublabel: 'Hearing voice input…',        orbSpeed: 1.2, orbIntensity: 0.40, hue: '56,208,240',  accentClass: 'is-listening' },
  transcribing:  { label: 'Transcribing',            sublabel: 'Converting speech…',          orbSpeed: 1.5, orbIntensity: 0.45, hue: '56,208,240',  accentClass: 'is-transcribing' },
  understanding: { label: 'Understanding',           sublabel: 'Parsing intent…',             orbSpeed: 1.4, orbIntensity: 0.42, hue: '153,102,255', accentClass: 'is-understanding' },
  searching:     { label: 'Searching',               sublabel: 'Querying intelligence…',      orbSpeed: 1.8, orbIntensity: 0.50, hue: '153,102,255', accentClass: 'is-searching' },
  analyzing:     { label: 'Analyzing',               sublabel: 'Processing signals…',         orbSpeed: 1.6, orbIntensity: 0.48, hue: '153,102,255', accentClass: 'is-analyzing' },
  planning:      { label: 'Planning',                sublabel: 'Decomposing actions…',        orbSpeed: 1.4, orbIntensity: 0.44, hue: '153,102,255', accentClass: 'is-planning' },
  drafting:      { label: 'Drafting',                sublabel: 'Composing response…',         orbSpeed: 1.2, orbIntensity: 0.38, hue: '44,184,122',  accentClass: 'is-drafting' },
  executing:     { label: 'Executing',               sublabel: 'Running action…',             orbSpeed: 2.0, orbIntensity: 0.55, hue: '216,149,48',  accentClass: 'is-executing' },
  confirming:    { label: 'Awaiting confirmation',   sublabel: 'Action requires approval',    orbSpeed: 0.6, orbIntensity: 0.30, hue: '216,149,48',  accentClass: 'is-confirming' },
  completed:     { label: 'Intelligence ready',      sublabel: 'Results available',           orbSpeed: 0.4, orbIntensity: 0.20, hue: '44,184,122',  accentClass: 'is-completed' },
  error:         { label: 'Error',                   sublabel: 'Something went wrong',        orbSpeed: 0.5, orbIntensity: 0.25, hue: '212,64,76',   accentClass: 'is-error' },
}

// ── Copilot Presence Modes ────────────────────────────────────────────────

export type CopilotMode = 'orb' | 'sidecar' | 'console'

// ── Normalized Intents ────────────────────────────────────────────────────

export type IntentDomain =
  | 'room' | 'map' | 'inbox' | 'alerts' | 'markets'
  | 'buyers' | 'title' | 'split_view' | 'briefing'
  | 'notification' | 'settings' | 'watchlist'
  | 'autopilot' | 'copilot' | 'system'

export type IntentAction = string // e.g. 'open', 'focus', 'zoom_to', 'set_layer', etc.

export interface ResolvedIntent {
  domain: IntentDomain
  action: IntentAction
  params: Record<string, string>
  raw: string
  confidence: number
  preview: string  // human-readable preview
}

// ── Room Context ──────────────────────────────────────────────────────────

export interface RoomContext {
  path: string
  label: string
  room: string
}

export const ROOM_MAP: Record<string, RoomContext> = {
  '/dashboard/live': { path: '/dashboard/live', label: 'Home',           room: 'Command Floor' },
  '/inbox':          { path: '/inbox',          label: 'Inbox',          room: 'Comms Deck' },
  '/alerts':         { path: '/alerts',         label: 'Alerts',         room: 'Threat Board' },
  '/stats':          { path: '/stats',          label: 'Intelligence',   room: 'Strategy Room' },
  '/markets':        { path: '/markets',        label: 'Markets',        room: 'Operations Room' },
  '/buyer':          { path: '/buyer',          label: 'Buyers',         room: 'Capital Deployment' },
  '/title':          { path: '/title',          label: 'Title',          room: 'Execution Room' },
  '/watchlists':     { path: '/watchlists',     label: 'Watchlists',     room: 'Tracked Targets' },
  '/notifications':  { path: '/notifications',  label: 'Notifications',  room: 'Event Stream' },
  '/settings':       { path: '/settings',       label: 'Settings',       room: 'Control Layer' },
}

export function resolveRoom(path: string): RoomContext {
  return ROOM_MAP[path] ?? ROOM_MAP['/dashboard/live']
}

// ── Action Permission ─────────────────────────────────────────────────────

export type ActionPermission = 'read-only' | 'suggest-only' | 'confirm-before' | 'low-risk-auto' | 'full-assist'

export const ACTION_PERMISSION_META: Record<ActionPermission, { label: string; description: string }> = {
  'read-only':      { label: 'Read Only',           description: 'Copilot can only observe and report' },
  'suggest-only':   { label: 'Suggest Only',         description: 'Copilot suggests but never acts' },
  'confirm-before': { label: 'Confirm Before Acting', description: 'All actions require your approval' },
  'low-risk-auto':  { label: 'Low-Risk Auto-Act',    description: 'Navigation and view changes are automatic' },
  'full-assist':    { label: 'Full Operator Assist',  description: 'Copilot acts freely on your behalf' },
}

// ── Intent Parser ─────────────────────────────────────────────────────────

interface IntentRule {
  patterns: RegExp[]
  domain: IntentDomain
  action: IntentAction
  extract?: (match: RegExpMatchArray) => Record<string, string>
  preview: (params: Record<string, string>) => string
}

const INTENT_RULES: IntentRule[] = [
  // Room navigation
  { patterns: [/\b(?:open|go\s+to|navigate\s+to|show)\s+(inbox|comms)/i],
    domain: 'room', action: 'open', extract: () => ({ target: '/inbox' }),
    preview: () => 'Navigate to Comms Deck' },
  { patterns: [/\b(?:open|go\s+to|show)\s+(alerts?|threat)/i],
    domain: 'room', action: 'open', extract: () => ({ target: '/alerts' }),
    preview: () => 'Navigate to Threat Board' },
  { patterns: [/\b(?:open|go\s+to|show)\s+(markets?|operations)/i],
    domain: 'room', action: 'open', extract: () => ({ target: '/markets' }),
    preview: () => 'Navigate to Operations Room' },
  { patterns: [/\b(?:open|go\s+to|show)\s+(buyer|capital)/i],
    domain: 'room', action: 'open', extract: () => ({ target: '/buyer' }),
    preview: () => 'Navigate to Capital Deployment' },
  { patterns: [/\b(?:open|go\s+to|show)\s+(title|closing|execution)/i],
    domain: 'room', action: 'open', extract: () => ({ target: '/title' }),
    preview: () => 'Navigate to Execution Room' },
  { patterns: [/\b(?:open|go\s+to|show)\s+(settings?|config)/i],
    domain: 'room', action: 'open', extract: () => ({ target: '/settings' }),
    preview: () => 'Navigate to Settings' },
  { patterns: [/\b(?:open|go\s+to|show)\s+(home|dashboard|command\s+floor)/i],
    domain: 'room', action: 'open', extract: () => ({ target: '/dashboard/live' }),
    preview: () => 'Navigate to Command Floor' },
  { patterns: [/\b(?:open|go\s+to|show)\s+(intelligence|stats|strategy)/i],
    domain: 'room', action: 'open', extract: () => ({ target: '/stats' }),
    preview: () => 'Navigate to Strategy Room' },
  { patterns: [/\b(?:open|go\s+to|show)\s+(watchlist|tracked)/i],
    domain: 'room', action: 'open', extract: () => ({ target: '/watchlists' }),
    preview: () => 'Navigate to Watchlists' },

  // Map operations
  { patterns: [/\bshow\s+(?:hottest|hot)\s+leads?\s+(?:in\s+)?(\w+)/i],
    domain: 'map', action: 'focus_market',
    extract: (m) => ({ market: m[1] }),
    preview: (p) => `Focus hot leads in ${p.market}` },
  { patterns: [/\bzoom\s+to\s+(.+)/i],
    domain: 'map', action: 'zoom_to',
    extract: (m) => ({ target: m[1].trim() }),
    preview: (p) => `Zoom map to ${p.target}` },
  { patterns: [/\b(?:switch|change|set)\s+map\s+(?:to\s+)?(\w+)\s*(?:mode)?/i],
    domain: 'map', action: 'set_mode',
    extract: (m) => ({ mode: m[1].toLowerCase() }),
    preview: (p) => `Switch map to ${p.mode} mode` },
  { patterns: [/\bshow\s+(heatmap|heat\s+map)/i],
    domain: 'map', action: 'set_mode', extract: () => ({ mode: 'heat' }),
    preview: () => 'Switch map to heatmap mode' },
  { patterns: [/\bshow\s+(pressure|market\s+pressure)/i],
    domain: 'map', action: 'set_mode', extract: () => ({ mode: 'pressure' }),
    preview: () => 'Switch map to pressure mode' },

  // Inbox operations
  { patterns: [/\bdraft\s+(?:a\s+)?repl(?:y|ies?)(?:\s+(.+))?/i],
    domain: 'inbox', action: 'draft_reply',
    extract: (m) => ({ tone: m[1]?.trim() ?? 'professional' }),
    preview: (p) => `Draft reply with ${p.tone} tone` },
  { patterns: [/\bbatch\s+(?:ai\s+)?repl(?:y|ies)/i],
    domain: 'inbox', action: 'batch_reply', extract: () => ({}),
    preview: () => 'Batch review AI draft replies' },

  // Alerts operations
  { patterns: [/\bsummarize\s+alerts?/i],
    domain: 'alerts', action: 'summarize', extract: () => ({}),
    preview: () => 'Summarize active alerts' },
  { patterns: [/\backnowledge\s+(?:all\s+)?(?:critical|p0)\s*(?:alerts?)?/i],
    domain: 'alerts', action: 'ack_critical', extract: () => ({}),
    preview: () => 'Acknowledge critical alerts' },

  // Markets
  { patterns: [/\bfocus\s+(\w+)(?:\s+market)?/i],
    domain: 'markets', action: 'focus',
    extract: (m) => ({ market: m[1] }),
    preview: (p) => `Focus on ${p.market} market` },

  // Buyers
  { patterns: [/\bshow\s+(?:buyer\s+)?match(?:es)?\s+(?:for\s+)?(.+)/i],
    domain: 'buyers', action: 'show_matches',
    extract: (m) => ({ property: m[1].trim() }),
    preview: (p) => `Show buyer matches for ${p.property}` },

  // Title
  { patterns: [/\b(?:focus|show)\s+(?:title\s+)?blockers?/i],
    domain: 'title', action: 'focus_blockers', extract: () => ({}),
    preview: () => 'Focus on title pipeline blockers' },

  // Split view
  { patterns: [/\bopen\s+split\s*(?:view)?/i],
    domain: 'split_view', action: 'open', extract: () => ({}),
    preview: () => 'Open split view panel' },

  // Briefing
  { patterns: [/\b(?:generate|show|open)\s+briefing/i],
    domain: 'briefing', action: 'generate', extract: () => ({}),
    preview: () => 'Generate operator briefing' },

  // System queries
  { patterns: [/\bwhat\s+changed\s+(?:in\s+)?(?:the\s+)?(?:last\s+)?(\w+)?/i],
    domain: 'system', action: 'recent_changes',
    extract: (m) => ({ period: m[1] ?? 'hour' }),
    preview: (p) => `Show changes in last ${p.period}` },
]

export function parseIntent(input: string): ResolvedIntent | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  for (const rule of INTENT_RULES) {
    for (const pattern of rule.patterns) {
      const match = trimmed.match(pattern)
      if (match) {
        const params = rule.extract?.(match) ?? {}
        return {
          domain: rule.domain,
          action: rule.action,
          params,
          raw: trimmed,
          confidence: 90 + Math.random() * 8, // simulated
          preview: rule.preview(params),
        }
      }
    }
  }

  // Fallback — treat as general query
  return {
    domain: 'system',
    action: 'query',
    params: { query: trimmed },
    raw: trimmed,
    confidence: 60 + Math.random() * 15,
    preview: `Query: "${trimmed}"`,
  }
}

// ── Slash Commands ────────────────────────────────────────────────────────

export interface SlashCommand {
  command: string
  label: string
  description: string
  category: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/go',       label: 'Navigate',        description: 'Open a room or surface',        category: 'Navigation' },
  { command: '/focus',    label: 'Focus',            description: 'Focus on a market or entity',   category: 'Navigation' },
  { command: '/zoom',     label: 'Zoom',             description: 'Zoom map to location',          category: 'Map' },
  { command: '/mode',     label: 'Map Mode',         description: 'Switch map visualization',      category: 'Map' },
  { command: '/draft',    label: 'Draft Reply',      description: 'Draft an AI reply',             category: 'Inbox' },
  { command: '/batch',    label: 'Batch Reply',      description: 'Review batch AI drafts',        category: 'Inbox' },
  { command: '/alerts',   label: 'Alerts',           description: 'Summarize or manage alerts',    category: 'Alerts' },
  { command: '/buyers',   label: 'Buyer Matches',    description: 'Show buyer intelligence',       category: 'Buyers' },
  { command: '/briefing', label: 'Briefing',         description: 'Generate operator briefing',    category: 'AI' },
  { command: '/status',   label: 'System Status',    description: 'Show system health',            category: 'System' },
  { command: '/recent',   label: 'Recent Changes',   description: 'What changed recently',         category: 'System' },
  { command: '/split',    label: 'Split View',       description: 'Open or toggle split view',     category: 'Interface' },
  { command: '/help',     label: 'Command Help',     description: 'Show available commands',       category: 'System' },
]

export function matchSlashCommands(query: string): SlashCommand[] {
  if (!query.startsWith('/')) return []
  const q = query.toLowerCase()
  return SLASH_COMMANDS.filter(c => c.command.startsWith(q) || c.label.toLowerCase().includes(q.slice(1)))
}

// ── Room-Aware Suggestions ────────────────────────────────────────────────

export interface CopilotSuggestion {
  id: string
  type: 'action' | 'insight' | 'warning' | 'brief'
  title: string
  detail: string
  confidence: number
  intentDomain?: IntentDomain
  intentAction?: IntentAction
  actionId?: string
  actionLabel?: string
}

export function generateRoomSuggestions(roomPath: string, context?: {
  hotCount?: number; alertCount?: number; pendingActions?: number
}): CopilotSuggestion[] {
  const suggestions: CopilotSuggestion[] = []
  const hot = context?.hotCount ?? 0
  const alerts = context?.alertCount ?? 0
  const pending = context?.pendingActions ?? 0

  switch (roomPath) {
    case '/dashboard/live':
      suggestions.push({
        id: 'brief-home', type: 'brief', title: 'Command Floor Briefing',
        detail: `${hot} hot leads require attention. ${alerts} alerts active. ${pending} autopilot actions pending.`,
        confidence: 95,
      })
      if (hot > 0) suggestions.push({
        id: 'act-hot', type: 'action', title: 'Prioritize Hot Leads',
        detail: 'Hot leads are aging. Engage top-urgency leads for maximum conversion.',
        confidence: 88, actionId: 'focus-hot', actionLabel: 'Focus Hot',
        intentDomain: 'room', intentAction: 'open',
      })
      if (alerts > 3) suggestions.push({
        id: 'warn-alerts', type: 'warning', title: 'Alert Volume Elevated',
        detail: `${alerts} active alerts exceeds the daily average. Review on the Threat Board.`,
        confidence: 92, actionId: 'go-alerts', actionLabel: 'Open Alerts',
        intentDomain: 'room', intentAction: 'open',
      })
      suggestions.push({
        id: 'insight-pipeline', type: 'insight', title: 'Pipeline Velocity',
        detail: 'Pipeline velocity tracking 12% above weekly average. Pressure in Dallas and Phoenix.',
        confidence: 76,
      })
      break

    case '/inbox':
      suggestions.push({
        id: 'brief-inbox', type: 'brief', title: 'Comms Deck Intelligence',
        detail: 'Threads requiring response detected. AI drafts ready for review.',
        confidence: 90,
      })
      suggestions.push({
        id: 'act-batch', type: 'action', title: 'Batch AI Replies',
        detail: 'AI has pre-drafted responses for unread threads. Review and approve.',
        confidence: 82, actionId: 'batch-reply', actionLabel: 'Review Drafts',
        intentDomain: 'inbox', intentAction: 'batch_reply',
      })
      suggestions.push({
        id: 'insight-comms', type: 'insight', title: 'Response Pattern',
        detail: 'Reply rates peak 10am–2pm. Scheduling sends in this window increases engagement 23%.',
        confidence: 71,
      })
      break

    case '/alerts':
      suggestions.push({
        id: 'brief-alerts', type: 'brief', title: 'Threat Board Briefing',
        detail: 'Active alerts span multiple markets. P0 items need acknowledgment.',
        confidence: 94,
      })
      suggestions.push({
        id: 'act-ack', type: 'action', title: 'Acknowledge Critical',
        detail: 'Unacknowledged P0 alerts degrade system health. Clear highest-severity first.',
        confidence: 90, actionId: 'ack-alerts', actionLabel: 'Review P0',
        intentDomain: 'alerts', intentAction: 'ack_critical',
      })
      break

    case '/markets':
      suggestions.push({
        id: 'brief-markets', type: 'brief', title: 'Operations Intelligence',
        detail: 'Market coverage nominal. Delivery rates stable. Phoenix showing accelerating pressure.',
        confidence: 87,
      })
      suggestions.push({
        id: 'act-pressure', type: 'action', title: 'Pressure Analysis',
        detail: 'Switch to pressure mode to visualize market heat distribution.',
        confidence: 78, actionId: 'map-pressure', actionLabel: 'Pressure Mode',
        intentDomain: 'map', intentAction: 'set_mode',
      })
      break

    case '/buyer':
      suggestions.push({
        id: 'brief-buyer', type: 'brief', title: 'Capital Deployment Brief',
        detail: 'Active buyer pool healthy. Match quality averaging 78%. Pre-approved: 62%.',
        confidence: 83,
      })
      break

    case '/title':
      suggestions.push({
        id: 'brief-title', type: 'brief', title: 'Execution Status',
        detail: 'Title pipeline normal. No critical blockers. Days-in-phase within range.',
        confidence: 89,
      })
      suggestions.push({
        id: 'act-blockers', type: 'action', title: 'Surface Blockers',
        detail: 'Review any items stalled in title or closing phases.',
        confidence: 80, actionId: 'title-blockers', actionLabel: 'Show Blockers',
        intentDomain: 'title', intentAction: 'focus_blockers',
      })
      break

    case '/settings':
      suggestions.push({
        id: 'brief-settings', type: 'brief', title: 'Configuration Summary',
        detail: 'Current theme, sound profile, and copilot settings loaded. Adjust as needed.',
        confidence: 85,
      })
      break

    default:
      suggestions.push({
        id: 'brief-gen', type: 'brief', title: 'NEXUS Intelligence',
        detail: 'System operating normally. No anomalies detected across active markets.',
        confidence: 85,
      })
      break
  }
  return suggestions
}

// ── Greeting Builder ──────────────────────────────────────────────────────

export function getTimeGreeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Late night session'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 21) return 'Good evening'
  return 'Late session'
}

export function buildGreeting(operatorName: string, style: string, roomPath: string, context?: {
  hotCount?: number; alertCount?: number; pendingActions?: number
}): string[] {
  const name = operatorName || 'Operator'
  const room = resolveRoom(roomPath)
  const lines: string[] = []

  switch (style) {
    case 'cinematic':
      lines.push(`${getTimeGreeting()}, ${name}.`)
      lines.push(`${room.room} is online.`)
      if (context?.hotCount && context.hotCount > 0) lines.push(`${context.hotCount} targets require engagement.`)
      if (context?.alertCount && context.alertCount > 3) lines.push(`${context.alertCount} threat signals detected.`)
      break
    case 'casual':
      lines.push(`Hey ${name} — you're on ${room.room}.`)
      if (context?.hotCount && context.hotCount > 0) lines.push(`${context.hotCount} hot leads waiting.`)
      break
    case 'minimal':
      lines.push(`${room.room} active.`)
      break
    default: // formal
      lines.push(`${getTimeGreeting()}, ${name}.`)
      lines.push(`${room.room} is live.`)
      if (context?.hotCount && context.hotCount > 0) lines.push(`${context.hotCount} hot lead${context.hotCount > 1 ? 's' : ''} require attention.`)
      if (context?.alertCount && context.alertCount > 3) lines.push(`${context.alertCount} active alerts — review recommended.`)
      if (context?.pendingActions && context.pendingActions > 0) lines.push(`${context.pendingActions} autopilot action${context.pendingActions > 1 ? 's' : ''} pending review.`)
      break
  }

  return lines
}

// ── Mission Trace Events ──────────────────────────────────────────────────

export type TraceEventType =
  | 'context' | 'parse' | 'search' | 'analysis'
  | 'draft' | 'execution' | 'completion' | 'error'
  | 'voice' | 'greeting' | 'confirmation' | 'system'

export interface TraceEvent {
  id: string
  ts: number
  type: TraceEventType
  label: string
  detail?: string
  room?: string
  pinned?: boolean
}

let _traceCounter = 0

export function createTraceEvent(type: TraceEventType, label: string, detail?: string, room?: string): TraceEvent {
  return {
    id: `trace-${++_traceCounter}-${Date.now()}`,
    ts: Date.now(),
    type,
    label,
    detail,
    room,
  }
}

// ── Model Options ─────────────────────────────────────────────────────────

export interface ModelOption {
  id: string
  label: string
  description: string
  speed: 'fast' | 'balanced' | 'thorough'
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'nexus-fast',      label: 'NEXUS Fast',      description: 'Quick responses, lower depth',    speed: 'fast' },
  { id: 'nexus-balanced',  label: 'NEXUS Balanced',  description: 'Default intelligence depth',      speed: 'balanced' },
  { id: 'nexus-deep',      label: 'NEXUS Deep',      description: 'Maximum reasoning, slower',       speed: 'thorough' },
]
