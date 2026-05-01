import { useRef, useState } from 'react'
import { Icon } from '../../../shared/icons'
import { TemplatePopover } from './TemplatePopover'
import type { InboxThread } from '../inbox.adapter'
import type { ThreadContext } from '../../../lib/data/inboxData'

const cls = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

type IconName = Parameters<typeof Icon>[0]['name']
type ComposerTool = {
  id: string
  label: string
  icon: IconName
  action: () => void
  disabled: boolean
}

// Voice/microphone recording state
type MicState = 'idle' | 'recording' | 'processing'

interface ComposerProps {
  draftText: string
  setDraftText: (t: string) => void
  onSend: (text: string) => void
  onOpenSchedule: () => void
  onAI: () => void
  onOffer?: () => void
  thread: InboxThread | null
  threadContext: ThreadContext | null
  onInsertTemplate: (text: string) => void
  onReplaceTemplate: (text: string) => void
  onSendTemplate: (text: string) => void
  onScheduleTemplate: () => void
  onTranslate?: () => void
  isTranslating?: boolean
  disabled?: boolean
  disabledReason?: string
}

type SpeechRecognitionResultLike = {
  isFinal: boolean
  0: { transcript: string }
}

type SpeechRecognitionEventLike = {
  results: {
    length: number
    [index: number]: SpeechRecognitionResultLike
  }
}

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

const getSpeechRecognition = (): SpeechRecognitionConstructor | null => {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

export const Composer = ({
  draftText,
  setDraftText,
  onSend,
  onOpenSchedule,
  onAI,
  onOffer,
  thread,
  threadContext,
  onInsertTemplate,
  onReplaceTemplate,
  onSendTemplate,
  onScheduleTemplate,
  onTranslate,
  isTranslating = false,
  disabled = false,
  disabledReason,
}: ComposerProps) => {
  const [micState, setMicState] = useState<MicState>('idle')
  const [voiceUnsupported, setVoiceUnsupported] = useState(false)
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false)
  const [voiceLevel, setVoiceLevel] = useState(0)
  const [transcription, setTranscription] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const templatesButtonRef = useRef<HTMLButtonElement>(null)
  const baseDraftRef = useRef('')
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | undefined>(undefined)

  const isListening = micState === 'recording'
  const isProcessing = micState === 'processing'
  const hasDraft = draftText.trim().length > 0

  const tools: ComposerTool[] = [
    { id: 'templates', label: 'Templates', icon: 'file-text', action: () => setTemplatePopoverOpen(true), disabled: false },
    { id: 'ai-assist', label: 'AI Assist', icon: 'spark', action: onAI, disabled: false },
    { id: 'translate', label: isTranslating ? 'Original' : 'Translate', icon: 'globe', action: onTranslate ?? (() => {}), disabled: false },
    { id: 'offer', label: 'Offer', icon: 'zap', action: onOffer ?? (() => {}), disabled },
    { id: 'schedule', label: 'Schedule', icon: 'calendar', action: onOpenSchedule, disabled },
    { id: 'notes', label: 'Notes', icon: 'file-text', action: () => {}, disabled: false },
  ]

  // Expose unused params to avoid lint errors
  void thread
  void threadContext
  void onScheduleTemplate

  const stopVoiceAnalysis = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = undefined
    }
    analyserRef.current = null
    setVoiceLevel(0)
  }

  const startVoiceAnalysis = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const audioContext = new AudioContext()
      const analyser = audioContext.createAnalyser()
      const microphone = audioContext.createMediaStreamSource(stream)

      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      microphone.connect(analyser)
      analyserRef.current = analyser

      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const updateVoiceLevel = () => {
        if (!analyserRef.current) return

        analyserRef.current.getByteFrequencyData(dataArray)
        const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length
        const normalizedLevel = Math.min(average / 128, 1)
        setVoiceLevel(normalizedLevel)

        animationFrameRef.current = requestAnimationFrame(updateVoiceLevel)
      }

      updateVoiceLevel()
    } catch (error) {
      console.warn('Could not start voice analysis:', error)
    }
  }

  const stopVoice = () => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setMicState('idle')
    stopVoiceAnalysis()
    setTranscription('')
  }

  const toggleVoice = () => {
    if (disabled) return
    if (isListening || isProcessing) {
      stopVoice()
      return
    }

    const Recognition = getSpeechRecognition()
    if (!Recognition) {
      setVoiceUnsupported(true)
      return
    }

    const recognition = new Recognition()
    baseDraftRef.current = draftText.trim()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.onresult = (event) => {
      const transcript: string[] = []

      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]
        transcript.push(result[0].transcript.trim())
      }

      const currentTranscript = transcript.join(' ').trim()
      setTranscription(currentTranscript)

      const cleanedTranscript = currentTranscript
        .replace(/\bi\b/g, 'I')
        .replace(/(\w)\s*([.!?])/g, '$1$2')
        .replace(/([.!?])\s*(\w)/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim()

      const nextText = [baseDraftRef.current, cleanedTranscript].filter(Boolean).join(' ').trim()
      setDraftText(nextText)
    }
    recognition.onerror = () => {
      recognitionRef.current = null
      setMicState('idle')
      stopVoiceAnalysis()
      setTranscription('')
    }
    recognition.onend = () => {
      recognitionRef.current = null
      setMicState('processing')
      stopVoiceAnalysis()
      setTranscription('')
      // Brief processing state for UX, then go idle
      setTimeout(() => setMicState('idle'), 600)
    }
    recognitionRef.current = recognition
    recognition.start()
    setVoiceUnsupported(false)
    setMicState('recording')
    startVoiceAnalysis()
  }

  const micTitle = voiceUnsupported
    ? 'Voice dictation not supported in this browser'
    : isProcessing
      ? 'Processing…'
      : isListening
        ? 'Stop recording'
        : 'Talk to type'

  return (
    <div className="nx-sticky-composer">
      {/* Utility action row */}
      {/* Utility action row - Phase 2: Hidden until hover/focus */}
      <div className="nx-composer-utility-row">
        {tools.map(tool => (
          <button
            key={tool.id}
            ref={tool.id === 'templates' ? templatesButtonRef : undefined}
            type="button"
            className={cls(
              'nx-utility-btn',
              tool.id === 'templates' && templatePopoverOpen && 'is-active',
              tool.id === 'translate' && isTranslating && 'is-translating-active'
            )}
            onClick={tool.action}
            disabled={tool.disabled}
          >
            <Icon name={tool.icon} style={{ width: 13, marginRight: 5 }} />
            {tool.label}
          </button>
        ))}
      </div>

      {/* Main input area */}
      <div
        className={`nx-composer-input-area${isListening ? ' is-listening' : ''}`}
        aria-disabled={disabled}
      >
        <button type="button" className="nx-composer-icon-btn" title="Attach file" disabled={disabled}>
          <Icon name="paperclip" />
        </button>
        <textarea
          placeholder={disabled ? disabledReason ?? 'Messaging disabled for this thread' : 'Type a message…'}
          value={draftText}
          onChange={e => setDraftText(e.target.value)}
          rows={1}
          disabled={disabled}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement
            target.style.height = 'auto'
            target.style.height = `${Math.min(target.scrollHeight, 200)}px`
          }}
          onKeyDown={e => {
            if (!disabled && (e.metaKey || e.ctrlKey) && e.key === 'Enter' && draftText.trim()) {
              onSend(draftText)
              setDraftText('')
            }
          }}
        />

        {/* Mic button */}
        <button
          type="button"
          className={`nx-composer-icon-btn nx-voice-button${isListening ? ' is-listening' : ''}${isProcessing ? ' is-processing' : ''}`}
          title={micTitle}
          disabled={disabled}
          onClick={toggleVoice}
          aria-pressed={isListening}
          aria-label={micTitle}
        >
          {/* Animated rings when listening */}
          {isListening && (
            <span className="nx-voice-rings" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
          {/* Waveform bars when listening */}
          {isListening ? (
            <span className="nx-voice-waveform" aria-hidden="true">
              {Array.from({ length: 5 }, (_, i) => (
                <span
                  key={i}
                  className="nx-voice-waveform-bar"
                  style={{
                    height: `${Math.max(4, voiceLevel * 22 + 4)}px`,
                    animationDelay: `${i * 0.1}s`,
                  }}
                />
              ))}
            </span>
          ) : (
            <Icon name="mic" />
          )}
        </button>

        {/* Send button — glows when text is ready */}
        <button
          type="button"
          className={`nx-send-button${hasDraft && !disabled ? ' is-ready' : ''}`}
          disabled={disabled || !hasDraft}
          onClick={() => {
            if (disabled || !hasDraft) return
            onSend(draftText)
            setDraftText('')
          }}
          aria-label="Send message"
          title="Send (⌘ Enter)"
        >
          <Icon name="send" style={{ width: 18 }} />
        </button>
      </div>

      {/* Live transcription banner */}
      {isListening && transcription && (
        <div className="nx-voice-transcription">
          <div className="nx-voice-transcription__label">
            <Icon name="mic" />
            <span>Listening…</span>
          </div>
          <div className="nx-voice-transcription__text">
            {transcription}
          </div>
        </div>
      )}

      {/* Template popover/modal */}
      <TemplatePopover
        open={templatePopoverOpen}
        anchorRef={templatesButtonRef as React.RefObject<HTMLElement>}
        onClose={() => setTemplatePopoverOpen(false)}
        onInsert={onInsertTemplate}
        onReplace={onReplaceTemplate}
        onSendNow={onSendTemplate}
      />
    </div>
  )
}
