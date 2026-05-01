import { useState, useRef, useEffect } from 'react'
import type { InboxThread } from '../inbox.adapter'
import type { ThreadContext } from '../../../lib/data/inboxData'
import { Icon } from '../../../shared/icons'

interface TemplatePopoverProps {
  open: boolean
  anchorRef: React.RefObject<HTMLElement>
  onClose: () => void
  onInsert: (text: string) => void
  onReplace: (text: string) => void
  onSendNow: (text: string) => void
}

const templates = [
  {
    id: 'greeting',
    category: 'General',
    title: 'Professional Greeting',
    content: 'Hi [Name], I hope this message finds you well. I wanted to follow up regarding the property at [Address].',
  },
  {
    id: 'availability',
    category: 'Scheduling',
    title: 'Check Availability',
    content: 'Are you available to discuss the property this week? I have some time slots open and would love to show you around.',
  },
  {
    id: 'follow_up',
    category: 'Follow-up',
    title: 'Follow Up Interest',
    content: 'Following up on our previous conversation about [Property]. Have you had a chance to think about next steps?',
  },
  {
    id: 'closing',
    category: 'Closing',
    title: 'Closing Question',
    content: 'Based on what we\'ve discussed, does this property meet your needs? I\'d be happy to help you move forward.',
  },
]

export const TemplatePopover = ({
  open,
  anchorRef,
  onClose,
  onInsert,
  onReplace,
  onSendNow,
}: TemplatePopoverProps) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const popoverRef = useRef<HTMLDivElement>(null)

  const categories = ['all', ...Array.from(new Set(templates.map(t => t.category)))]

  const filteredTemplates = templates.filter(template => {
    const matchesSearch = template.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         template.content.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = selectedCategory === 'all' || template.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  useEffect(() => {
    if (!open) return

    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, onClose, anchorRef])

  if (!open) return null

  return (
    <div
      ref={popoverRef}
      className="nx-template-popover"
      role="dialog"
      aria-label="SMS template library"
    >
      <div className="nx-template-popover__header">
        <div className="nx-template-popover__title">
          <Icon name="file-text" />
          <span>Templates</span>
        </div>
        <button
          type="button"
          className="nx-template-popover__close"
          onClick={onClose}
          aria-label="Close templates"
        >
          <Icon name="close" />
        </button>
      </div>

      <div className="nx-template-popover__search">
        <input
          type="text"
          placeholder="Search templates..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="nx-template-popover__categories">
        {categories.map(category => (
          <button
            key={category}
            type="button"
            className={`nx-template-category ${selectedCategory === category ? 'active' : ''}`}
            onClick={() => setSelectedCategory(category)}
          >
            {category === 'all' ? 'All' : category}
          </button>
        ))}
      </div>

      <div className="nx-template-popover__list">
        {filteredTemplates.map(template => (
          <div key={template.id} className="nx-template-item">
            <div className="nx-template-item__header">
              <span className="nx-template-item__category">{template.category}</span>
              <h4 className="nx-template-item__title">{template.title}</h4>
            </div>
            <p className="nx-template-item__content">{template.content}</p>
            <div className="nx-template-item__actions">
              <button
                type="button"
                className="nx-template-action"
                onClick={() => {
                  onInsert(template.content)
                  onClose()
                }}
                title="Insert into draft"
              >
                <Icon name="check" />
                Insert
              </button>
              <button
                type="button"
                className="nx-template-action"
                onClick={() => {
                  onReplace(template.content)
                  onClose()
                }}
                title="Replace draft"
              >
                <Icon name="palette" />
                Replace
              </button>
              <button
                type="button"
                className="nx-template-action nx-template-action--send"
                onClick={() => {
                  onSendNow(template.content)
                  onClose()
                }}
                title="Send immediately"
              >
                <Icon name="send" />
                Send
              </button>
            </div>
          </div>
        ))}
        {filteredTemplates.length === 0 && (
          <div className="nx-template-empty">
            <Icon name="search" />
            <p>No templates found</p>
          </div>
        )}
      </div>
    </div>
  )
}