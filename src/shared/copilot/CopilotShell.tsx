import { useCallback, useEffect, useRef, useState } from 'react'
import type { CopilotContext, CopilotMode, CopilotState, ResolvedIntent } from './copilot-state'
import { CopilotConsole } from './CopilotConsole'
import { CopilotOrb } from './CopilotOrb'
import { CopilotSidecar } from './CopilotSidecar'
import { loadSettings, subscribeSettings } from '../settings'
import type { NexusSettings } from '../settings'
import { useVoiceMode } from './copilot-voice'
import { parseIntent } from './copilot-state'

interface CopilotShellProps {
  open: boolean
  context: CopilotContext
  onClose: () => void
  onAction: (intent: ResolvedIntent) => void
  onToggle: () => void
}

export function CopilotShell({ open, context, onClose, onAction, onToggle }: CopilotShellProps) {
  const [settings, setSettings] = useState<NexusSettings>(loadSettings)
  const [orbState, setOrbState] = useState<CopilotState>('idle')
  const [orbAmplitude, setOrbAmplitude] = useState(0)
  const prevRoomRef = useRef(context.roomPath)
  const [overlayText, setOverlayText] = useState<string | null>(null)
  const [overlayInterim, setOverlayInterim] = useState(false)
  const overlayTimerRef = useRef<number | null>(null)
  const settingsRef = useRef<NexusSettings | null>(null)
  const bgVoiceRef = useRef<any>(null)

  useEffect(() => subscribeSettings(() => setSettings(loadSettings())), [])

  useEffect(() => { settingsRef.current = loadSettings() }, [])
  useEffect(() => { settingsRef.current = settings }, [settings])

  // Headless background voice capture: when sidecar/console are closed and autonomous mode is enabled,
  // allow voice activation to run intents without opening the sidecar. This keeps the orb lightweight.
  const bgVoice = useVoiceMode({
    onStart() {
      setOrbState('listening')
      setOrbAmplitude(0.45)
    },
    onInterim(text) {
      setOverlayText(text)
      setOverlayInterim(true)
      window.dispatchEvent(new CustomEvent('nx:copilot-voice-text', { detail: { interim: text, state: 'transcribing' } }))
    },
    onTranscript(text) {
      setOverlayInterim(false)
      setOverlayText(text)
      window.dispatchEvent(new CustomEvent('nx:copilot-voice-text', { detail: { transcript: text, state: 'transcribing' } }))
      try {
        const intent = parseIntent(text)
        // Broadcast command for visuals
        try { window.dispatchEvent(new CustomEvent('nx:copilot-command', { detail: { text, intent } })) } catch (_) { }
        const current = settingsRef.current
        if (current?.copilotAutonomous) {
          if (!intent) return
          // Execute directly when autonomous background mode is enabled
          onAction(intent)
          // announce execution with lightweight TTS so operator hears result
          if (current.copilotVoiceMode === 'full' && 'speechSynthesis' in window) {
            try {
              window.speechSynthesis.cancel()
              const u = new SpeechSynthesisUtterance(`Executed: ${intent.preview}`)
              const persona = current.ttsPersona ?? 'neutral'
              const PERSONA: Record<string, { rate: number; pitch: number; vol: number }> = {
                neutral: { rate: 1, pitch: 1, vol: 1 },
                warm: { rate: 0.95, pitch: 0.92, vol: 0.98 },
                energetic: { rate: 1.12, pitch: 1.06, vol: 1 },
                calm: { rate: 0.88, pitch: 0.86, vol: 0.95 },
                robotic: { rate: 1.0, pitch: 0.56, vol: 1 },
                friendly: { rate: 1.02, pitch: 1.05, vol: 1 },
                authoritative: { rate: 0.95, pitch: 0.9, vol: 1.05 },
                narrator: { rate: 0.92, pitch: 0.88, vol: 1 },
              }
              const p = PERSONA[persona] ?? PERSONA.neutral
              u.volume = (current.ttsVolume ?? 1) * p.vol
              u.rate = (current.ttsRate ?? 1) * p.rate
              u.pitch = (current.ttsPitch ?? 1) * p.pitch
              if (current.ttsVoice) {
                try {
                  const found = window.speechSynthesis.getVoices().find(v => (v.voiceURI || v.name) === current.ttsVoice)
                  if (found) u.voice = found
                } catch (_) { /* noop */ }
              }
              window.speechSynthesis.speak(u)
            } catch (_) { /* ignore TTS errors */ }
          }
        } else {
          // Bring up the copilot UI for confirmation if not autonomous
          onToggle()
          // emit a small delay so the deck can hookup and display transcript
          window.setTimeout(() => window.dispatchEvent(new CustomEvent('nx:copilot-voice-text', { detail: { transcript: text, state: 'transcribing' } })), 300)
        }
      } catch (err) {
        // parsing failure — open UI for manual handling
        onToggle()
      }
    },
    onEnd() {
      setOrbState((s) => s === 'listening' ? 'idle' : s)
      setOrbAmplitude(0)
      setOverlayText(null)
      setOverlayInterim(false)
    },
    onError(err) {
      setOrbState('error')
      setOverlayText(String(err))
      setOverlayInterim(false)
    },
  })
  bgVoiceRef.current = bgVoice

  const mode = (settings.copilotMode as CopilotMode) ?? 'sidecar'
  const enabled = settings.copilotEnabled !== false
  const orbPlacement = settings.orbPlacement ?? 'dock'
  const autoOpenOnRoomChange = settings.copilotAutoOpen ?? false
  const showOrb = settings.copilotOrbAlwaysVisible || !open

  useEffect(() => {
    if (autoOpenOnRoomChange && context.roomPath !== prevRoomRef.current && !open) {
      prevRoomRef.current = context.roomPath
      onToggle()
      return
    }
    prevRoomRef.current = context.roomPath
  }, [autoOpenOnRoomChange, context.roomPath, onToggle, open])

  useEffect(() => {
    if (!open) {
      setOrbState('idle')
      setOrbAmplitude(0)
    }
  }, [open])

  const handlePresenceChange = useCallback((state: CopilotState, amplitude: number) => {
    setOrbState(state)
    // If amplitude is zero but we're in speaking state, use a soft fallback so orb still animates
    const amp = amplitude || (state === 'speaking' ? 0.55 : 0)
    setOrbAmplitude(amp)
  }, [])

  const handleOrbClick = useCallback(() => {
    onToggle()
  }, [onToggle])

  const handlePushToTalk = useCallback(() => {
    setOrbState('listening')
    if (!open) onToggle()
  }, [onToggle, open])

  const handlePushToTalkRelease = useCallback(() => {
    if (!open) {
      setOrbState('idle')
      setOrbAmplitude(0)
    }
  }, [open])

  // Listen for global transcript events and surface text overlay when voice-mode text is enabled
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ transcript?: string; interim?: string; state?: string }>).detail
      if (!detail) return
      if (settings.copilotVoiceMode !== 'text') return
      const text = detail.interim ?? detail.transcript ?? null
      const isInterim = Boolean(detail.interim && !detail.transcript)
      setOverlayText(text)
      setOverlayInterim(isInterim)
      if (overlayTimerRef.current) {
        window.clearTimeout(overlayTimerRef.current)
        overlayTimerRef.current = null
      }
      if (detail.transcript) {
        overlayTimerRef.current = window.setTimeout(() => { setOverlayText(null); setOverlayInterim(false); overlayTimerRef.current = null }, 2400)
      } else if (!detail.interim) {
        overlayTimerRef.current = window.setTimeout(() => { setOverlayText(null); setOverlayInterim(false); overlayTimerRef.current = null }, 1200)
      }
    }

    window.addEventListener('nx:copilot-voice-text', handler)
    return () => {
      window.removeEventListener('nx:copilot-voice-text', handler)
      if (overlayTimerRef.current) {
        window.clearTimeout(overlayTimerRef.current)
        overlayTimerRef.current = null
      }
    }
  }, [settings.copilotVoiceMode])

  // Global hotkey activation: if the copilot UI is closed and autonomous background mode is enabled,
  // start the headless voice capture; otherwise open the copilot UI so a deck can handle voice.
  useEffect(() => {
    const handler = () => {
      if (open) return // if UI is open let the deck handle voice
      const current = settingsRef.current
      if (current?.copilotAutonomous) {
        try { bgVoiceRef.current?.toggleListening() } catch (_) { }
      } else {
        onToggle()
      }
    }
    window.addEventListener('nx:copilot-voice-activate', handler)
    return () => window.removeEventListener('nx:copilot-voice-activate', handler)
  }, [open, onToggle])

  // Listen for TTS amplitude events to animate orb during speech synthesis
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ amplitude?: number }>).detail
      if (!detail) return
      if (settings.copilotVoiceMode !== 'full') return
      if (orbState === 'speaking') {
        setOrbAmplitude(detail.amplitude ?? 0)
      }
    }

    window.addEventListener('nx:copilot-tts-amplitude', handler)
    return () => window.removeEventListener('nx:copilot-tts-amplitude', handler)
  }, [settings.copilotVoiceMode, orbState])

  const handleAction = useCallback((intent: ResolvedIntent) => {
    onAction(intent)
  }, [onAction])

  if (!enabled) return null

  const orbClass = [
    orbPlacement === 'corner' ? 'nx-copilot-orb--corner' : 'nx-copilot-orb--floating',
    open ? 'nx-copilot-orb--ambient' : '',
  ].filter(Boolean).join(' ')

  return (
    <>
      {showOrb && (
        <CopilotOrb
          state={orbState}
          amplitude={orbAmplitude}
          onClick={handleOrbClick}
          onPushToTalk={handlePushToTalk}
          onPushToTalkRelease={handlePushToTalkRelease}
          className={orbClass}
          textOverlay={overlayText}
          textInterim={overlayInterim}
        />
      )}

      {(mode === 'sidecar' || mode === 'orb') && (
        <CopilotSidecar
          open={open}
          context={context}
          onClose={onClose}
          onAction={handleAction}
          onPresenceChange={handlePresenceChange}
        />
      )}

      {mode === 'console' && (
        <CopilotConsole
          open={open}
          context={context}
          onClose={onClose}
          onAction={handleAction}
          onPresenceChange={handlePresenceChange}
        />
      )}
    </>
  )
}

export type { CopilotContext } from './copilot-state'