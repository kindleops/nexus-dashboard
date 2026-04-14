/**
 * NEXUS AI Copilot — Context-Aware Intelligence Assistant
 *
 * Not a chatbot. A persistent copilot panel that provides:
 * - Real-time intelligence briefs based on current surface/context
 * - Suggested next actions with confidence scores
 * - Quick-action buttons for common operator moves
 * - State machine: idle → listening → thinking → suggesting → completed
 *
 * Activated via ⌘J or the spark icon in the command strip.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { playSound } from './sounds'

// ── Types ─────────────────────────────────────────────────────────────────

export type CopilotState = 'idle' | 'listening' | 'thinking' | 'suggesting' | 'completed'

export interface CopilotSuggestion {
  id: string
  type: 'action' | 'insight' | 'warning' | 'brief'
  title: string
  detail: string
  confidence: number  // 0–100
  action?: string
  actionLabel?: string
}

export interface CopilotContext {
  surface: string       // current route/surface name
  entityType?: string   // lead | market | thread | alert
  entityId?: string
  entityLabel?: string
  hotCount?: number
  alertCount?: number
  pendingActions?: number
}

interface AICopilotProps {
  open: boolean
  context: CopilotContext
  onClose: () => void
  onAction?: (actionId: string) => void
}

// ── Simulated intelligence ────────────────────────────────────────────────
// Generates context-aware suggestions based on current surface context.
// In production this would call a real AI endpoint.

function generateSuggestions(ctx: CopilotContext): CopilotSuggestion[] {
  const suggestions: CopilotSuggestion[] = []

  // Contextual briefing based on surface
  switch (ctx.surface) {
    case '/dashboard/live':
      suggestions.push({
        id: 'brief-home',
        type: 'brief',
        title: 'Command Floor Briefing',
        detail: `${ctx.hotCount ?? 0} hot leads require attention. ${ctx.alertCount ?? 0} alerts active. ${ctx.pendingActions ?? 0} autopilot actions pending review.`,
        confidence: 95,
      })
      if ((ctx.hotCount ?? 0) > 0) {
        suggestions.push({
          id: 'act-hot-leads',
          type: 'action',
          title: 'Prioritize Hot Leads',
          detail: 'Hot leads have been waiting. Engage top-urgency leads within the next hour for maximum conversion probability.',
          confidence: 88,
          action: 'focus-hot',
          actionLabel: 'Focus Hot',
        })
      }
      if ((ctx.alertCount ?? 0) > 3) {
        suggestions.push({
          id: 'warn-alerts',
          type: 'warning',
          title: 'Alert Volume Elevated',
          detail: `${ctx.alertCount} active alerts exceeds the daily average. Review critical alerts on the Threat Board.`,
          confidence: 92,
          action: 'go-alerts',
          actionLabel: 'Open Alerts',
        })
      }
      suggestions.push({
        id: 'insight-pipeline',
        type: 'insight',
        title: 'Pipeline Velocity',
        detail: 'Pipeline velocity is tracking 12% above weekly average. Market pressure is concentrated in Dallas and Phoenix metros.',
        confidence: 76,
      })
      break

    case '/inbox':
      suggestions.push({
        id: 'brief-inbox',
        type: 'brief',
        title: 'Comms Deck Briefing',
        detail: 'You have threads requiring response. AI-drafted replies are ready for review. Prioritize hot sentiment threads first.',
        confidence: 90,
      })
      suggestions.push({
        id: 'act-batch-reply',
        type: 'action',
        title: 'Batch AI Replies',
        detail: 'AI has pre-drafted responses for unread threads. Review and approve in batch for faster throughput.',
        confidence: 82,
        action: 'batch-reply',
        actionLabel: 'Review Drafts',
      })
      break

    case '/alerts':
      suggestions.push({
        id: 'brief-alerts',
        type: 'brief',
        title: 'Threat Board Briefing',
        detail: 'Active alerts span multiple markets. Critical items need immediate acknowledgment. P0 alerts age faster.',
        confidence: 94,
      })
      break

    default:
      suggestions.push({
        id: 'brief-general',
        type: 'brief',
        title: 'NEXUS Intelligence',
        detail: 'System operating normally. No anomalies detected across active markets.',
        confidence: 85,
      })
      break
  }

  return suggestions
}

// ── State class mapping ───────────────────────────────────────────────────

const stateClass: Record<CopilotState, string> = {
  idle: 'is-idle',
  listening: 'is-listening',
  thinking: 'is-thinking',
  suggesting: 'is-suggesting',
  completed: 'is-completed',
}

const stateLabel: Record<CopilotState, string> = {
  idle: 'Ready',
  listening: 'Listening…',
  thinking: 'Analyzing…',
  suggesting: 'Intelligence Ready',
  completed: 'Briefing Complete',
}

const typeIcon: Record<CopilotSuggestion['type'], string> = {
  action: 'zap',
  insight: 'trending-up',
  warning: 'alert',
  brief: 'radar',
}

const typeClass: Record<CopilotSuggestion['type'], string> = {
  action: 'is-action',
  insight: 'is-insight',
  warning: 'is-warning',
  brief: 'is-brief',
}

// ── Component ─────────────────────────────────────────────────────────────

export const AICopilot = ({ open, context, onClose, onAction }: AICopilotProps) => {
  const [state, setState] = useState<CopilotState>('idle')
  const [suggestions, setSuggestions] = useState<CopilotSuggestion[]>([])
  const [transcript, setTranscript] = useState<string[]>([])
  const panelRef = useRef<HTMLDivElement>(null)

  const addTranscript = useCallback((msg: string) => {
    setTranscript((prev) => [...prev.slice(-19), msg])
  }, [])

  // Simulate AI analysis when opened or context changes
  useEffect(() => {
    if (!open) return

    setState('listening')
    addTranscript(`Context: ${context.surface}`)

    const thinkTimer = setTimeout(() => {
      setState('thinking')
      addTranscript('Analyzing intelligence data…')
      playSound('ai-response')
    }, 400)

    const suggestTimer = setTimeout(() => {
      const results = generateSuggestions(context)
      setSuggestions(results)
      setState('suggesting')
      addTranscript(`Generated ${results.length} suggestions`)
    }, 1200)

    return () => {
      clearTimeout(thinkTimer)
      clearTimeout(suggestTimer)
    }
  }, [open, context, addTranscript])

  // Keyboard: Escape closes
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  useEffect(() => {
    if (open) {
      panelRef.current?.scrollTo({ top: 0 })
    } else {
      setState('idle')
      setSuggestions([])
    }
  }, [open])

  if (!open) return null

  return (
    <aside className="nx-copilot" ref={panelRef} role="complementary" aria-label="AI Copilot">
      <header className="nx-copilot__header">
        <div className="nx-copilot__title-row">
          <div className={`nx-copilot__status-orb ${stateClass[state]}`} />
          <div className="nx-copilot__title-text">
            <h2 className="nx-copilot__title">Copilot</h2>
            <span className="nx-copilot__state">{stateLabel[state]}</span>
          </div>
        </div>
        <button type="button" className="nx-copilot__close" onClick={onClose} title="Close (Escape)">
          <Icon name="close" className="nx-copilot__close-icon" />
        </button>
      </header>

      {/* Suggestions */}
      <div className="nx-copilot__suggestions">
        {suggestions.map((s) => (
          <div key={s.id} className={`nx-copilot-card ${typeClass[s.type]}`}>
            <div className="nx-copilot-card__header">
              <Icon name={typeIcon[s.type] as Parameters<typeof Icon>[0]['name']} className="nx-copilot-card__icon" />
              <span className="nx-copilot-card__title">{s.title}</span>
              <span className="nx-copilot-card__confidence">{s.confidence}%</span>
            </div>
            <p className="nx-copilot-card__detail">{s.detail}</p>
            {s.actionLabel && (
              <button
                type="button"
                className="nx-copilot-card__action"
                onClick={() => {
                  playSound('ui-confirm')
                  onAction?.(s.action ?? s.id)
                  addTranscript(`Action: ${s.actionLabel}`)
                }}
              >
                {s.actionLabel}
              </button>
            )}
          </div>
        ))}

        {state === 'thinking' && (
          <div className="nx-copilot__loading">
            <div className="nx-copilot__pulse" />
            <span>Analyzing context…</span>
          </div>
        )}
      </div>

      {/* Transcript log */}
      <div className="nx-copilot__transcript">
        <span className="nx-copilot__transcript-label">LOG</span>
        {transcript.map((msg, i) => (
          <span key={`${msg}-${i}`} className="nx-copilot__transcript-line">
            {msg}
          </span>
        ))}
      </div>
    </aside>
  )
}
