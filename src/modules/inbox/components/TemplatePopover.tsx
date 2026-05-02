import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../shared/icons'

const TEMPLATE_STAGES = ['All', 'new_reply', 'needs_response', 'interested', 'needs_offer', 'nurture', 'sent_waiting'] as const
const TEMPLATE_LANGUAGES = ['All', 'English', 'Spanish', 'Bilingual'] as const
const TEMPLATE_USE_CASES = ['All', 'Initial Outreach', 'Follow-Up', 'Offer', 'Appointment', 'Objection Handle', 'Closing'] as const

interface TemplateDef {
  id: string
  title: string
  content: string
  stage: string
  useCase: string
  language: string
  agent?: string
  active: boolean
}

// Built-in template library — extend as needed
const BUILT_IN_TEMPLATES: TemplateDef[] = [
  {
    id: 'initial-en',
    title: 'Professional Introduction',
    content: 'Hi [FirstName], I came across your property at [Address] and wanted to reach out. We buy homes in your area and can close quickly, cash, any condition. Would you be open to hearing a number?',
    stage: 'new_reply',
    useCase: 'Initial Outreach',
    language: 'English',
    active: true,
  },
  {
    id: 'initial-es',
    title: 'Introducción (Español)',
    content: 'Hola [FirstName], vi su propiedad en [Address]. Compramos casas en efectivo en cualquier condición. ¿Le interesaría escuchar una oferta?',
    stage: 'new_reply',
    useCase: 'Initial Outreach',
    language: 'Spanish',
    active: true,
  },
  {
    id: 'followup-warm',
    title: 'Warm Follow-Up',
    content: "Hey [FirstName], just circling back on the property at [Address]. We're still interested and could move quickly. What's the best number to reach you?",
    stage: 'sent_waiting',
    useCase: 'Follow-Up',
    language: 'English',
    active: true,
  },
  {
    id: 'offer-ready',
    title: 'Offer Ready',
    content: 'Hi [FirstName], based on what we know about [Address], we can offer around [OfferAmount] cash, close in as little as 14 days. Does that range work for you?',
    stage: 'needs_offer',
    useCase: 'Offer',
    language: 'English',
    active: true,
  },
  {
    id: 'objection-price',
    title: 'Price Objection Handle',
    content: "I completely understand you're looking for more. Our number is based on as-is condition and a fast, all-cash close. Is there a number that would work for you?",
    stage: 'needs_response',
    useCase: 'Objection Handle',
    language: 'English',
    active: true,
  },
  {
    id: 'appointment-set',
    title: 'Appointment Confirm',
    content: 'Great! Let me confirm our walkthrough at [Address] on [Date] at [Time]. Reply CONFIRM or let me know if you need to reschedule.',
    stage: 'needs_call',
    useCase: 'Appointment',
    language: 'English',
    active: true,
  },
  {
    id: 'nurture-checkin',
    title: 'Nurture Check-In',
    content: "Hey [FirstName], no pressure at all — just wanted to check if your situation has changed with [Address]. We're still here when you're ready.",
    stage: 'nurture',
    useCase: 'Follow-Up',
    language: 'English',
    active: true,
  },
  {
    id: 'closing-congrats',
    title: 'Closing Congratulations',
    content: "Congrats [FirstName]! We're excited to move forward on [Address]. Our team will be in touch shortly with next steps. Thank you for trusting us!",
    stage: 'interested',
    useCase: 'Closing',
    language: 'English',
    active: true,
  },
]

interface TemplatePopoverProps {
  open: boolean
  anchorRef: React.RefObject<HTMLElement>
  onClose: () => void
  onInsert: (text: string) => void
  onReplace: (text: string) => void
  onSendNow: (text: string) => void
}

const stageLabel = (stage: string) => stage.replaceAll('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())

const FilterChip = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
  <button
    type="button"
    className={`nx-tpl-chip${active ? ' is-active' : ''}`}
    onClick={onClick}
  >
    {label}
  </button>
)

export const TemplatePopover = ({
  open,
  anchorRef,
  onClose,
  onInsert,
  onReplace,
  onSendNow,
}: TemplatePopoverProps) => {
  const [search, setSearch] = useState('')
  const [filterStage, setFilterStage] = useState<string>('All')
  const [filterLang, setFilterLang] = useState<string>('All')
  const [filterUseCase, setFilterUseCase] = useState<string>('All')
  const [activeOnly, setActiveOnly] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    // Focus search on open
    const t = setTimeout(() => searchRef.current?.focus(), 60)
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(event.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(event.target as Node)
      ) {
        onClose()
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, onClose, anchorRef])

  // Reset filters when closed
  useEffect(() => {
    if (!open) {
      setSearch('')
      setFilterStage('All')
      setFilterLang('All')
      setFilterUseCase('All')
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return BUILT_IN_TEMPLATES.filter((t) => {
      if (activeOnly && !t.active) return false
      if (filterStage !== 'All' && t.stage !== filterStage) return false
      if (filterLang !== 'All' && t.language !== filterLang) return false
      if (filterUseCase !== 'All' && t.useCase !== filterUseCase) return false
      if (q && !t.title.toLowerCase().includes(q) && !t.content.toLowerCase().includes(q) && !t.useCase.toLowerCase().includes(q)) return false
      return true
    })
  }, [search, filterStage, filterLang, filterUseCase, activeOnly])

  if (!open) return null
  
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={popoverRef}
      className="nx-template-modal-overlay"
      role="presentation"
      aria-hidden="false"
    >
      <div
        className="nx-template-modal"
        role="dialog"
        aria-label="Template Library"
        aria-modal="true"
      >
        {/* Header */}
        <div className="nx-tpl-header">
          <div className="nx-tpl-header__left">
            <div className="nx-tpl-header__icon">
              <Icon name="file-text" />
            </div>
            <div>
              <div className="nx-tpl-header__title">Template Library</div>
              <div className="nx-tpl-header__sub">{filtered.length} templates available</div>
            </div>
          </div>
          <button
            type="button"
            className="nx-tpl-close"
            onClick={onClose}
            aria-label="Close template library"
          >
            <Icon name="close" />
          </button>
        </div>

        {/* Search */}
        <div className="nx-tpl-search-row">
          <div className="nx-tpl-search-wrap">
            <Icon name="search" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search templates…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="nx-tpl-search"
            />
            {search && (
              <button type="button" className="nx-tpl-search-clear" onClick={() => setSearch('')}>
                <Icon name="close" />
              </button>
            )}
          </div>
          <label className="nx-tpl-active-toggle">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
            />
            Active only
          </label>
        </div>

        {/* Filters */}
        <div className="nx-tpl-filters">
          <div className="nx-tpl-filter-group">
            <span className="nx-tpl-filter-label">Stage</span>
            <div className="nx-tpl-chip-row">
              {TEMPLATE_STAGES.map((s) => (
                <FilterChip
                  key={s}
                  label={s === 'All' ? 'All Stages' : stageLabel(s)}
                  active={filterStage === s}
                  onClick={() => setFilterStage(s)}
                />
              ))}
            </div>
          </div>
          <div className="nx-tpl-filter-group">
            <span className="nx-tpl-filter-label">Use Case</span>
            <div className="nx-tpl-chip-row">
              {TEMPLATE_USE_CASES.map((u) => (
                <FilterChip
                  key={u}
                  label={u}
                  active={filterUseCase === u}
                  onClick={() => setFilterUseCase(u)}
                />
              ))}
            </div>
          </div>
          <div className="nx-tpl-filter-group">
            <span className="nx-tpl-filter-label">Language</span>
            <div className="nx-tpl-chip-row">
              {TEMPLATE_LANGUAGES.map((l) => (
                <FilterChip
                  key={l}
                  label={l}
                  active={filterLang === l}
                  onClick={() => setFilterLang(l)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="nx-tpl-list">
          {filtered.length === 0 ? (
            <div className="nx-tpl-empty">
              <Icon name="search" />
              <p>No templates match your filters</p>
              <button type="button" className="nx-tpl-reset" onClick={() => { setSearch(''); setFilterStage('All'); setFilterLang('All'); setFilterUseCase('All') }}>
                Reset filters
              </button>
            </div>
          ) : (
            filtered.map((template) => (
              <div key={template.id} className="nx-tpl-card">
                <div className="nx-tpl-card__meta">
                  <span className="nx-tpl-pill nx-tpl-pill--stage">{stageLabel(template.stage)}</span>
                  <span className="nx-tpl-pill nx-tpl-pill--usecase">{template.useCase}</span>
                  <span className="nx-tpl-pill nx-tpl-pill--lang">{template.language}</span>
                  {template.agent && <span className="nx-tpl-pill nx-tpl-pill--agent">{template.agent}</span>}
                  {!template.active && <span className="nx-tpl-pill nx-tpl-pill--inactive">Inactive</span>}
                </div>
                <div className="nx-tpl-card__title">{template.title}</div>
                <p className="nx-tpl-card__preview">{template.content}</p>
                <div className="nx-tpl-card__actions">
                  <button
                    type="button"
                    className="nx-tpl-action nx-tpl-action--insert"
                    onClick={() => { onInsert(template.content); onClose() }}
                  >
                    <Icon name="check" />
                    Insert
                  </button>
                  <button
                    type="button"
                    className="nx-tpl-action nx-tpl-action--replace"
                    onClick={() => { onReplace(template.content); onClose() }}
                  >
                    <Icon name="palette" />
                    Replace
                  </button>
                  <button
                    type="button"
                    className="nx-tpl-action nx-tpl-action--send"
                    onClick={() => { onSendNow(template.content); onClose() }}
                  >
                    <Icon name="send" />
                    Send Now
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}