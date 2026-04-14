/**
 * NEXUS CopilotConsole — Full Workspace Intelligence Surface
 *
 * The most expansive copilot mode. Takes over the right half of the stage.
 * Contains everything in Sidecar plus:
 * - Larger trace view
 * - Command history
 * - Plan decomposition preview
 * - Two-column layout with suggestions on left, trace on right
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
import type { CopilotContext } from './CopilotSidecar'

interface CopilotConsoleProps {
  open: boolean
  context: CopilotContext
  onClose: () => void
  onAction: (intent: ResolvedIntent) => void
}

export function CopilotConsole({ open, context, onClose, onAction }: CopilotConsoleProps) {
  const [settings, setSettings] = useState<NexusSettings>(loadSettings)
  const [copilotState, setCopilotState] = useState<CopilotState>('idle')
  const [input, setInput] = useState('')
  const [slashHints, setSlashHints] = useState<ReturnType<typeof matchSlashCommands>>([])
  const [suggestions, setSuggestions] = useState<CopilotSuggestion[]>([])
  const [greetingLines, setGreetingLines] = useState<string[]>([])
  const [trace, setTrace] = useState<TraceEvent[]>([])
  const [showGreeting, setShowGreeting] = useState(false)
  const [lastContext, setLastContext] = useState(context.roomPath)
  const [pendingIntent, setPendingIntent] = useState<ResolvedIntent | null>(null)
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const prevOpenRef = useRef(open)

  const meta = STATE_META[copilotState]

  useEffect(() => subscribeSettings(() => setSettings(loadSettings())), [])

  const voice = useVoiceMode({
    onTranscript(text) { handleSubmit(text) },
    onStart() { setCopilotState('listening'); addTrace('voice', 'Voice input started') },
    onEnd() { if (copilotState === 'listening') setCopilotState('idle') },
    onError(error) { addTrace('error', 'Voice error', error) },
  })

  const addTrace = useCallback((type: TraceEvent['type'], label: string, detail?: string) => {
    setTrace(prev => [createTraceEvent(type, label, detail, context.roomPath), ...prev].slice(0, 200))
  }, [context.roomPath])

  // Greeting on open
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const lines = buildGreeting(
        settings.operatorName, settings.greetingStyle, context.roomPath,
        { hotCount: context.hotCount, alertCount: context.alertCount, pendingActions: context.pendingActions }
      )
      setGreetingLines(lines)
      setShowGreeting(true)
      setCopilotState('greeting')
      addTrace('greeting', 'Console session initialized', lines[0])
      const t1 = setTimeout(() => { setCopilotState('idle'); setShowGreeting(false) }, 2400)
      const t2 = setTimeout(() => {
        const sug = generateRoomSuggestions(context.roomPath, {
          hotCount: context.hotCount, alertCount: context.alertCount, pendingActions: context.pendingActions,
        })
        setSuggestions(sug)
        if (sug.length > 0) addTrace('analysis', 'Room intelligence loaded', `${sug.length} signals`)
      }, 1200)
      return () => { clearTimeout(t1); clearTimeout(t2) }
    }
    prevOpenRef.current = open
  }, [open])

  // Room context change
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
        addTrace('analysis', 'New room context analyzed')
      }, 800)
      return () => clearTimeout(timer)
    }
  }, [context.roomPath, open])

  useEffect(() => {
    if (input.startsWith('/')) setSlashHints(matchSlashCommands(input))
    else setSlashHints([])
  }, [input])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200)
  }, [open])

  // Submit
  const handleSubmit = useCallback((text?: string) => {
    const raw = text ?? input.trim()
    if (!raw) return

    setCommandHistory(prev => [raw, ...prev].slice(0, 50))
    setHistoryIndex(-1)
    addTrace('parse', 'Parsing input', raw)
    setCopilotState('understanding')

    const intent = parseIntent(raw)
    setInput('')

    if (!intent) {
      setCopilotState('error')
      addTrace('error', 'Could not parse intent', raw)
      setTimeout(() => setCopilotState('idle'), 1500)
      return
    }

    addTrace('analysis', `Intent: ${intent.domain}.${intent.action}`, intent.preview)

    const perm = (settings.actionPermission ?? 'confirm-before') as ActionPermission
    const isNavigation = intent.domain === 'room' || (intent.domain === 'map' && intent.action === 'set_mode')
    const needsConfirm =
      perm === 'read-only' || perm === 'suggest-only' || perm === 'confirm-before' ||
      (perm === 'low-risk-auto' && !isNavigation)

    if (perm === 'read-only') {
      setCopilotState('completed')
      addTrace('system', 'Read-only mode — logged only', intent.preview)
      setTimeout(() => setCopilotState('idle'), 2000)
      return
    }

    if (needsConfirm) {
      setCopilotState('confirming')
      addTrace('confirmation', 'Awaiting confirmation', intent.preview)
      setPendingIntent(intent)
      return
    }

    executeIntent(intent)
  }, [input, settings.actionPermission, addTrace])

  const confirmIntent = useCallback(() => {
    if (pendingIntent) { executeIntent(pendingIntent); setPendingIntent(null) }
  }, [pendingIntent])

  const rejectIntent = useCallback(() => {
    setPendingIntent(null); setCopilotState('idle')
    addTrace('system', 'Action rejected by operator')
  }, [addTrace])

  const executeIntent = useCallback((intent: ResolvedIntent) => {
    setCopilotState('executing')
    addTrace('execution', 'Executing', intent.preview)
    setTimeout(() => {
      onAction(intent)
      setCopilotState('completed')
      addTrace('completion', 'Action completed', intent.preview)
      setTimeout(() => setCopilotState('idle'), 1500)
    }, 600)
  }, [onAction, addTrace])

  const handleSuggestionAction = useCallback((sug: CopilotSuggestion) => {
    if (sug.actionLabel) handleSubmit(sug.actionLabel)
  }, [handleSubmit])

  // Keyboard — support history navigation in console
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') onClose()
    if (e.key === 'ArrowUp' && !input) {
      e.preventDefault()
      const next = Math.min(historyIndex + 1, commandHistory.length - 1)
      setHistoryIndex(next)
      if (commandHistory[next]) setInput(commandHistory[next])
    }
    if (e.key === 'ArrowDown' && historyIndex >= 0) {
      e.preventDefault()
      const next = historyIndex - 1
      setHistoryIndex(next)
      setInput(next >= 0 ? (commandHistory[next] ?? '') : '')
    }
  }, [handleSubmit, onClose, input, historyIndex, commandHistory])

  const recentCommands = useMemo(() => {
    return commandHistory.slice(0, 5)
  }, [commandHistory])

  if (!open) return null

  return (
    <div className={`nx-console ${meta.accentClass}`}>
      <div className="nx-console__header">
        <div className="nx-console__header-left">
          <span className="nx-console__assistant-name">{settings.assistantName || 'NEXUS'}</span>
          <span className="nx-console__mode-badge">Console</span>
          <span className="nx-console__state-badge">{meta.label}</span>
        </div>
        <button className="nx-console__close" onClick={onClose} aria-label="Close console">×</button>
      </div>

      {/* Greeting */}
      {showGreeting && (
        <div className="nx-console__greeting">
          {greetingLines.map((l, i) => (
            <p key={i} className="nx-console__greeting-line" style={{ animationDelay: `${i * 200}ms` }}>{l}</p>
          ))}
        </div>
      )}

      <div className="nx-console__body">
        {/* Left column — suggestions + confirmation */}
        <div className="nx-console__primary">
          {/* Confirmation bar */}
          {copilotState === 'confirming' && pendingIntent && (
            <div className="nx-console__confirm">
              <span className="nx-console__confirm-label">{pendingIntent.preview}</span>
              <div className="nx-console__confirm-actions">
                <button className="nx-console__confirm-btn nx-console__confirm-btn--approve" onClick={confirmIntent}>Approve</button>
                <button className="nx-console__confirm-btn nx-console__confirm-btn--reject" onClick={rejectIntent}>Reject</button>
              </div>
            </div>
          )}

          {/* Suggestions */}
          {suggestions.length > 0 && copilotState !== 'confirming' && (
            <div className="nx-console__suggestions">
              {suggestions.map((sug, i) => (
                <div key={sug.id} className={`nx-console__suggestion nx-console__suggestion--${sug.type}`}
                     style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="nx-console__sug-header">
                    <span className="nx-console__sug-title">{sug.title}</span>
                    <span className="nx-console__sug-confidence">{Math.round(sug.confidence)}%</span>
                  </div>
                  <p className="nx-console__sug-detail">{sug.detail}</p>
                  {sug.actionLabel && (
                    <button className="nx-console__sug-action" onClick={() => handleSuggestionAction(sug)}>
                      {sug.actionLabel}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Voice zone */}
          {voice.listening && (
            <div className="nx-console__voice-zone">
              <div className="nx-console__voice-indicator">
                <span className="nx-console__voice-dot" />
                <span className="nx-console__voice-label">Listening…</span>
              </div>
              {voice.interimTranscript && <p className="nx-console__voice-interim">{voice.interimTranscript}</p>}
              {voice.transcript && <p className="nx-console__voice-final">{voice.transcript}</p>}
            </div>
          )}
        </div>

        {/* Right column — trace */}
        <div className="nx-console__trace-col">
          <MissionTrace events={trace} maxVisible={100} />
        </div>
      </div>

      {/* Input zone */}
      <div className="nx-console__input-zone">
        {recentCommands.length > 0 && (
          <div className="nx-console__chips">
            {recentCommands.map((cmd, i) => (
              <button key={i} className="nx-console__chip" onClick={() => { setInput(cmd); inputRef.current?.focus() }}>
                {cmd.length > 40 ? cmd.slice(0, 40) + '…' : cmd}
              </button>
            ))}
          </div>
        )}

        {slashHints.length > 0 && (
          <div className="nx-console__slash-hints">
            {slashHints.map(h => (
              <button key={h.command} className="nx-console__slash-hint"
                      onClick={() => { setInput(h.command + ' '); inputRef.current?.focus() }}>
                <span className="nx-console__slash-cmd">{h.command}</span>
                <span className="nx-console__slash-desc">{h.description}</span>
              </button>
            ))}
          </div>
        )}

        <div className="nx-console__input-row">
          <textarea
            ref={inputRef}
            className="nx-console__input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Command, ask, or type / for commands…"
            rows={2}
            aria-label="Console command input"
          />
          <div className="nx-console__input-actions">
            {voice.supported && (
              <button
                className={`nx-console__mic ${voice.listening ? 'is-active' : ''}`}
                onClick={voice.toggleListening}
                aria-label={voice.listening ? 'Stop listening' : 'Start voice input'}
              >
                {voice.listening ? '■' : '◉'}
              </button>
            )}
            <button className="nx-console__send" onClick={() => handleSubmit()} disabled={!input.trim()}>
              Execute ↵
            </button>
          </div>
        </div>

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
