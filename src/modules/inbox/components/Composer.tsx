import { useRef, useState } from 'react'
import { Icon } from '../../../shared/icons'

type IconName = Parameters<typeof Icon>[0]['name']
type ComposerTool = {
  id: string
  label: string
  icon: IconName
  action: () => void
  disabled: boolean
}

interface ComposerProps {
  draftText: string
  setDraftText: (t: string) => void
  onSend: (text: string) => void
  onOpenTemplates: () => void
  onOpenSchedule: () => void
  onAI: () => void
  onOffer?: () => void
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
  onOpenTemplates,
  onOpenSchedule,
  onAI,
  onOffer,
  disabled = false,
  disabledReason,
}: ComposerProps) => {
  const [isListening, setIsListening] = useState(false)
  const [voiceUnsupported, setVoiceUnsupported] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const baseDraftRef = useRef('')

  const tools: ComposerTool[] = [
    { id: 'templates', label: 'Templates', icon: 'file-text', action: onOpenTemplates, disabled: false },
    { id: 'ai-assist', label: 'AI Assist', icon: 'spark', action: onAI, disabled: false },
    { id: 'offer', label: 'Offer', icon: 'zap', action: onOffer ?? (() => {}), disabled },
    { id: 'schedule', label: 'Schedule', icon: 'calendar', action: onOpenSchedule, disabled },
    { id: 'notes', label: 'Notes', icon: 'file-text', action: () => {}, disabled: false },
  ]

  const stopVoice = () => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setIsListening(false)
  }

  const toggleVoice = () => {
    if (disabled) return
    if (isListening) {
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
        transcript.push(event.results[index][0].transcript.trim())
      }
      const nextText = [baseDraftRef.current, transcript.join(' ')].filter(Boolean).join(' ').trim()
      setDraftText(nextText)
    }
    recognition.onerror = () => {
      recognitionRef.current = null
      setIsListening(false)
    }
    recognition.onend = () => {
      recognitionRef.current = null
      setIsListening(false)
    }
    recognitionRef.current = recognition
    recognition.start()
    setVoiceUnsupported(false)
    setIsListening(true)
  }

  return (
    <div className="nx-sticky-composer">
      <div className="nx-composer-utility-row">
        {tools.map(tool => (
          <button key={tool.id} type="button" className="nx-utility-btn" onClick={tool.action} disabled={tool.disabled}>
            <Icon name={tool.icon} style={{ width: 14, marginRight: 6 }} />
            {tool.label}
          </button>
        ))}
      </div>
      
      <div className={isListening ? 'nx-composer-input-area is-listening' : 'nx-composer-input-area'} aria-disabled={disabled}>
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
        <button
          type="button"
          className={isListening ? 'nx-composer-icon-btn nx-voice-button is-listening' : 'nx-composer-icon-btn nx-voice-button'}
          title={voiceUnsupported ? 'Voice dictation is not supported in this browser' : isListening ? 'Stop talk to type' : 'Talk to type'}
          disabled={disabled}
          onClick={toggleVoice}
          aria-pressed={isListening}
        >
          <span className="nx-voice-rings" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <Icon name="mic" />
        </button>
        <button 
          type="button"
          className="nx-send-button"
          disabled={disabled || !draftText.trim()}
          onClick={() => {
            if (disabled || !draftText.trim()) return
            onSend(draftText)
            setDraftText('')
          }}
        >
          <Icon name="send" style={{ width: 18 }} />
        </button>
      </div>
    </div>
  )
}
