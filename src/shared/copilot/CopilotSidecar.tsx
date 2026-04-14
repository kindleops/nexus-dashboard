/**
 * NEXUS CopilotSidecar — Right-Edge Intelligence Rail
 *
 * The primary copilot interaction surface. Contains:
 * - Greeting zone with operator name + room context
 * - Text input with slash-command hints + suggestion chips
 * - Voice toggle with real-time transcript
 * - Suggestion cards with confidence + action buttons
 * - Mini mission trace
 * - Model picker footer
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { CopilotState, ResolvedIntent, TraceEvent, ActionPermission, CopilotSuggestion } from './copilot-state'
import {
  STATE_META, parseIntent, matchSlashCommands,
  generateRoomSuggestions, buildGreeting, createTraceEvent,
} from './copilot-state'
import { useVoiceMode } from './copilot-voice'
import { MissionTrace } from './MissionTrace'
import { ModelPicker } from './ModelPicker'
import { loadSettings, updateSetting, subscribeSettings } from '../settings'
import type { NexusSettings } from '../settings'

// ── Types ─────────────────────────────────────────────────────────────────

export interface CopilotContext {
  surface: string
  roomPath: string
  entityType?: string
  entityId?: string
  entityLabel?: string
  hotCount?: number
  alertCount?: number
  pendingActions?: number
}

interface CopilotSidecarProps {
  open: boolean
  context: CopilotContext
  onClose: () => void
  onAction: (intent: ResolvedIntent) => void
}

// ── Component ─────────────────────────────────────────────────────────────

export function CopilotSidecar({ open, context, onClose, onAction }: CopilotSidecarProps) {
  const [settings, setSettings] = useState<NexusSettings>(loadSettings)
  const [copilotState, setCopilotState] = useState<CopilotState>('idle')
  const [input, setInput] = useState('')
  const [slashHints, setSlashHints] = useState<ReturnType<typeof matchSlashCommands>>([])
  const [suggestions, setSuggestions] = useState<CopilotSuggestion[]>([])
  const [greetingLines, setGreetingLines] = useState<string[]>([])
  const [trace, setTrace] = useState<TraceEvent[]>([])
  const [showGreeting, setShowGreeting] = useState(false)
  const [lastContext, setLastContext] = useState(context.roomPath)

  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const prevOpenRef = useRef(open)

  const meta = STATE_META[copilotState]

  // ── Settings subscription ───────────────────────────────────────────────
  useEffect(() => subscribeSettings(() => setSettings(loadSettings())), [])

  // ── Voice mode ──────────────────────────────────────────────────────────
  const voice = useVoiceMode({
    onTranscript(text) {
      handleSubmit(text)
    },
    onStart() {
      setCopilotState('listening')
      addTrace('voice', 'Voice input started')
    },
    onEnd() {
      if (copilotState === 'listening' || copilotState === 'transcribing') {
        setCopilotState('idle')
      }
    },
    onError(error) {
      addTrace('error', 'Voice error', error)
    },
  })

  // ── Trace helper ────────────────────────────────────────────────────────
  const addTrace = useCallback((type: TraceEvent['type'], label: string, detail?: string) => {
    setTrace(prev => [createTraceEvent(type, label, detail, context.roomPath), ...prev].slice(0, 100))
  }, [context.roomPath])

  // ── Greeting sequence on open ───────────────────────────────────────────
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const lines = buildGreeting(
        settings.operatorName, settings.greetingStyle, context.roomPath,
        { hotCount: context.hotCount, alertCount: context.alertCount, pendingActions: context.pendingActions }
      )
      setGreetingLines(lines)
      setShowGreeting(true)
      setCopilotState('greeting')
      addTrace('greeting', 'Session initialized', lines[0])

      // Transition to idle after greeting
      const timer = setTimeout(() => {
        setCopilotState('idle')
        setShowGreeting(false)
      }, 2400)

      // Generate room suggestions
      const sugTimer = setTimeout(() => {
        const sug = generateRoomSuggestions(context.roomPath, {
          hotCount: context.hotCount, alertCount: context.alertCount, pendingActions: context.pendingActions,
        })
        setSuggestions(sug)
        if (sug.length > 0) addTrace('analysis', 'Room intelligence loaded', `${sug.length} signals`)
      }, 1200)

      return () => { clearTimeout(timer); clearTimeout(sugTimer) }
    }
    prevOpenRef.current = open
  }, [open])

  // ── Room context change detection ───────────────────────────────────────
  useEffect(() => {
    if (context.roomPath !== lastContext && open) {
      setLastContext(context.roomPath)
      addTrace('context', 'Room changed', context.roomPath)
      setCopilotState('analyzing')
      const timer = setTimeout(() => {
        const sug = generateRoomSuggestions(context.roomPath, {
          hotCount: context.hotCount, alertCount: context.alertCount, pendingActions: context.pendingActions,
        })
        setSuggestions(sug)
        setCopilotState('idle')
        addTrace('analysis', 'New room context analyzed', `${sug.length} signals`)
      }, 800)
      return () => clearTimeout(timer)
    }
  }, [context.roomPath, open])

  // ── Slash command hints ─────────────────────────────────────────────────
  useEffect(() => {
    if (input.startsWith('/')) {
      setSlashHints(matchSlashCommands(input))
    } else {
      setSlashHints([])
    }
  }, [input])

  // ── Focus input on open ─────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [open])

  // ── Submit handler ──────────────────────────────────────────────────────
  const handleSubmit = useCallback((text?: string) => {
    const raw = text ?? input.trim()
    if (!raw) return

    addTrace('parse', 'Parsing input', raw)
    setCopilotState('understanding')

    // Parse intent
    const intent = parseIntent(raw)
    setInput('')

    if (!intent) {
      setCopilotState('error')
      addTrace('error', 'Could not parse intent', raw)
      setTimeout(() => setCopilotState('idle'), 1500)
      return
    }

    addTrace('analysis', `Intent: ${intent.domain}.${intent.action}`, intent.preview)

    // Permission check
    const perm = settings.actionPermission ?? 'confirm-before'
    const isNavigation = intent.domain === 'room' || (intent.domain === 'map' && intent.action === 'set_mode')
    const needsConfirm =
      perm === 'read-only' ||
      perm === 'suggest-only' ||
      (perm === 'confirm-before') ||
      (perm === 'low-risk-auto' && !isNavigation)

    if (perm === 'read-only') {
      setCopilotState('completed')
      addTrace('system', 'Read-only mode — action logged only', intent.preview)
      setTimeout(() => setCopilotState('idle'), 2000)
      return
    }

    if (needsConfirm) {
      setCopilotState('confirming')
      addTrace('confirmation', 'Awaiting confirmation', intent.preview)
      // Store pending intent for confirm/reject
      setPendingIntent(intent)
      return
    }

    // Auto-execute
    executeIntent(intent)
  }, [input, settings.actionPermission, addTrace])

  // ── Pending intent ──────────────────────────────────────────────────────
  const [pendingIntent, setPendingIntent] = useState<ResolvedIntent | null>(null)

  const confirmIntent = useCallback(() => {
    if (pendingIntent) {
      executeIntent(pendingIntent)
      setPendingIntent(null)
    }
  }, [pendingIntent])

  const rejectIntent = useCallback(() => {
    setPendingIntent(null)
    setCopilotState('idle')
    addTrace('system', 'Action rejected by operator')
  }, [addTrace])

  // ── Execute ─────────────────────────────────────────────────────────────
  const executeIntent = useCallback((intent: ResolvedIntent) => {
    setCopilotState('executing')
    addTrace('execution', 'Executing', intent.preview)

    // Simulate execution time
    setTimeout(() => {
      onAction(intent)
      setCopilotState('completed')
      addTrace('completion', 'Action completed', intent.preview)

      setTimeout(() => setCopilotState('idle'), 1500)
    }, 600)
  }, [onAction, addTrace])

  // ── Suggestion action ───────────────────────────────────────────────────
  const handleSuggestionAction = useCallback((sug: CopilotSuggestion) => {
    if (sug.actionId && sug.intentDomain) {
      const intent: ResolvedIntent = {
        domain: sug.intentDomain,
        action: sug.intentAction ?? 'open',
        params: {},
        raw: sug.actionLabel ?? sug.title,
        confidence: sug.confidence,
        preview: sug.title,
      }
      handleSubmit(intent.raw)
    }
  }, [handleSubmit])

  // ── Keyboard ────────────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      onClose()
    }
  }, [handleSubmit, onClose])

  // ── Recent commands (chips) ─────────────────────────────────────────────
  const recentCommands = useMemo(() => {
    return trace
      .filter(e => e.type === 'parse')
      .slice(0, 3)
      .map(e => e.detail ?? e.label)
  }, [trace])

  if (!open) return null

  return (
    <div ref={panelRef} className={`nx-sidecar ${meta.accentClass}`}>
      <div className="nx-sidecar__header">
        <div className="nx-sidecar__header-left">
          <span className="nx-sidecar__assistant-name">{settings.assistantName || 'NEXUS'}</span>
          <span className="nx-sidecar__state-badge">{meta.label}</span>
        </div>
        <button className="nx-sidecar__close" onClick={onClose} aria-label="Close copilot">×</button>
      </div>

      {/* Greeting */}
      {showGreeting && (
        <div className="nx-sidecar__greeting">
          {greetingLines.map((line, i) => (
            <p key={i} className="nx-sidecar__greeting-line" style={{ animationDelay: `${i * 200}ms` }}>{line}</p>
          ))}
        </div>
      )}

      {/* Confirmation bar */}
      {copilotState === 'confirming' && pendingIntent && (
        <div className="nx-sidecar__confirm">
          <span className="nx-sidecar__confirm-label">{pendingIntent.preview}</span>
          <div className="nx-sidecar__confirm-actions">
            <button className="nx-sidecar__confirm-btn nx-sidecar__confirm-btn--approve" onClick={confirmIntent}>Approve</button>
            <button className="nx-sidecar__confirm-btn nx-sidecar__confirm-btn--reject" onClick={rejectIntent}>Reject</button>
          </div>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && copilotState !== 'confirming' && (
        <div className="nx-sidecar__suggestions">
          {suggestions.map((sug, i) => (
            <div key={sug.id} className={`nx-sidecar__suggestion nx-sidecar__suggestion--${sug.type}`}
                 style={{ animationDelay: `${i * 80}ms` }}>
              <div className="nx-sidecar__sug-header">
                <span className="nx-sidecar__sug-title">{sug.title}</span>
                <span className="nx-sidecar__sug-confidence">{Math.round(sug.confidence)}%</span>
              </div>
              <p className="nx-sidecar__sug-detail">{sug.detail}</p>
              {sug.actionLabel && (
                <button className="nx-sidecar__sug-action" onClick={() => handleSuggestionAction(sug)}>
                  {sug.actionLabel}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Voice transcript */}
      {voice.listening && (
        <div className="nx-sidecar__voice-zone">
          <div className="nx-sidecar__voice-indicator">
            <span className="nx-sidecar__voice-dot" />
            <span className="nx-sidecar__voice-label">Listening…</span>
          </div>
          {voice.interimTranscript && (
            <p className="nx-sidecar__voice-interim">{voice.interimTranscript}</p>
          )}
          {voice.transcript && (
            <p className="nx-sidecar__voice-final">{voice.transcript}</p>
          )}
        </div>
      )}

      {/* Mission Trace */}
      <MissionTrace events={trace} />

      {/* Input zone */}
      <div className="nx-sidecar__input-zone">
        {/* Recent command chips */}
        {recentCommands.length > 0 && (
          <div className="nx-sidecar__chips">
            {recentCommands.map((cmd, i) => (
              <button key={i} className="nx-sidecar__chip" onClick={() => { setInput(cmd); inputRef.current?.focus() }}>
                {cmd.length > 30 ? cmd.slice(0, 30) + '…' : cmd}
              </button>
            ))}
          </div>
        )}

        {/* Slash command hints */}
        {slashHints.length > 0 && (
          <div className="nx-sidecar__slash-hints">
            {slashHints.map(h => (
              <button key={h.command} className="nx-sidecar__slash-hint"
                      onClick={() => { setInput(h.command + ' '); inputRef.current?.focus() }}>
                <span className="nx-sidecar__slash-cmd">{h.command}</span>
                <span className="nx-sidecar__slash-desc">{h.description}</span>
              </button>
            ))}
          </div>
        )}

        <div className="nx-sidecar__input-row">
          <input
            ref={inputRef}
            className="nx-sidecar__input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Command or ask…"
            aria-label="Copilot command input"
          />
          {voice.supported && (
            <button
              className={`nx-sidecar__mic ${voice.listening ? 'is-active' : ''}`}
              onClick={voice.toggleListening}
              aria-label={voice.listening ? 'Stop listening' : 'Start voice input'}
            >
              {voice.listening ? '■' : '◉'}
            </button>
          )}
          <button className="nx-sidecar__send" onClick={() => handleSubmit()} disabled={!input.trim()}>
            ↵
          </button>
        </div>

        {/* Model picker */}
        <ModelPicker
          model={settings.copilotModel ?? 'nexus-balanced'}
          permission={(settings.actionPermission as ActionPermission) ?? 'confirm-before'}
          onModelChange={id => updateSetting('copilotModel', id)}
          onPermissionChange={p => updateSetting('actionPermission', p)}
        />
      </div>
    </div>
  )
}
