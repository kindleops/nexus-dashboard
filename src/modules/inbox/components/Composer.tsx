import { Icon } from '../../../shared/icons'

interface ComposerProps {
  draftText: string
  setDraftText: (t: string) => void
  onSend: (text: string) => void
  onOpenTemplates: () => void
  onOpenSchedule: () => void
  onAI: () => void
}

export const Composer = ({ draftText, setDraftText, onSend, onOpenTemplates, onOpenSchedule, onAI }: ComposerProps) => {
  const tools = [
    { id: 'templates', label: 'Templates', icon: 'file-text', action: onOpenTemplates },
    { id: 'ai-assist', label: 'AI Assist', icon: 'spark', action: onAI },
    { id: 'offer', label: 'Offer', icon: 'zap', action: () => {} },
    { id: 'schedule', label: 'Schedule', icon: 'calendar', action: onOpenSchedule },
    { id: 'notes', label: 'Notes', icon: 'edit', action: () => {} },
  ]

  return (
    <div className="nx-sticky-composer">
      <div className="nx-composer-utility-row">
        {tools.map(tool => (
          <button key={tool.id} className="nx-utility-btn" onClick={tool.action}>
            <Icon name={tool.icon as any} style={{ width: 14, marginRight: 6 }} />
            {tool.label}
          </button>
        ))}
      </div>
      
      <div className="nx-composer-input-area">
        <textarea 
          placeholder="Type a message..."
          value={draftText}
          onChange={e => setDraftText(e.target.value)}
          rows={1}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement
            target.style.height = 'auto'
            target.style.height = `${Math.min(target.scrollHeight, 200)}px`
          }}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && draftText.trim()) {
              onSend(draftText)
              setDraftText('')
            }
          }}
        />
        <button 
          className="nx-send-button"
          disabled={!draftText.trim()}
          onClick={() => {
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
