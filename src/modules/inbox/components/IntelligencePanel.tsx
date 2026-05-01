import { useMemo, useState, type ReactNode } from 'react'
import type { ThreadContext } from '../../../lib/data/inboxData'
import type { ThreadIntelligenceRecord, ThreadMessage } from '../../../lib/data/inboxData'
import type { InboxStage, InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import type { PanelMode } from '../inbox-layout-state'
import {
  normalizePropertySnapshot,
  buildPropertyExternalLinks,
} from '../inbox-normalization'
import { Icon } from '../../../shared/icons'
import type { IconName } from '../../../shared/icons'
import { formatRelativeTime } from '../../../shared/formatters'

const cls = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

const STAGE_OPTIONS: { value: InboxStage; label: string; color: string }[] = [
  { value: 'new_reply', label: 'New Reply', color: '#0a84ff' },
  { value: 'needs_response', label: 'Needs Response', color: '#ffd60a' },
  { value: 'ai_draft_ready', label: 'AI Draft Ready', color: '#30d158' },
  { value: 'queued_reply', label: 'Queued Reply', color: '#5e5ce6' },
  { value: 'sent_waiting', label: 'Sent / Waiting', color: '#64d2ff' },
  { value: 'interested', label: 'Interested', color: '#30d158' },
  { value: 'needs_offer', label: 'Needs Offer', color: '#ff9f0a' },
  { value: 'needs_call', label: 'Needs Call', color: '#ff6961' },
  { value: 'nurture', label: 'Nurture', color: '#aab3c5' },
  { value: 'not_interested', label: 'Not Interested', color: '#6f7a8d' },
  { value: 'wrong_number', label: 'Wrong Number', color: '#6f7a8d' },
  { value: 'dnc_opt_out', label: 'DNC / Opt Out', color: '#ff453a' },
  { value: 'archived', label: 'Archived', color: '#6f7a8d' },
  { value: 'closed_converted', label: 'Closed / Converted', color: '#34c759' },
]

const StageSelector = ({ stage, onChange }: { stage: InboxStage; onChange: (s: InboxStage) => void }) => {
  const [open, setOpen] = useState(false)
  const current = STAGE_OPTIONS.find((o) => o.value === stage) ?? STAGE_OPTIONS[0]

  return (
    <div className="nx-stage-selector">
      <button type="button" className="nx-stage-btn" onClick={() => setOpen((v) => !v)}>
        <span className="nx-stage-dot" style={{ background: current.color }} />
        {current.label}
        <Icon name="chevron-down" />
      </button>
      {open && (
        <div className="nx-stage-dropdown">
          {STAGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={cls('nx-stage-option', stage === opt.value && 'is-active')}
              onClick={() => { onChange(opt.value); setOpen(false) }}
            >
              <span className="nx-stage-dot" style={{ background: opt.color }} />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface IntelligencePanelProps {
  thread: InboxWorkflowThread | null
  context: ThreadContext | null
  intelligence: ThreadIntelligenceRecord | null
  messages: ThreadMessage[]
  isSuppressed: boolean
  panelMode?: Exclude<PanelMode, 'hidden'>
  onCollapse: () => void
  onOpenMap: () => void
  onOpenDossier: () => void
  onOpenAi: () => void
  onStageChange?: (stage: InboxStage) => void
}

const normalizeText = (value: unknown): string => String(value ?? '').trim()

const isMissingValue = (value: unknown): boolean => {
  const text = normalizeText(value).toLowerCase()
  return !text || text === 'unknown' || text === 'n/a' || text === 'null' || text === 'undefined' || text === 'none' || text === '-'
}

const missingLabel = (value: unknown, placeholder = 'Not available yet') => (
  isMissingValue(value) ? placeholder : normalizeText(value)
)

const trimSummary = (value: string, max = 120) => (value.length > max ? `${value.slice(0, max - 3)}...` : value)

const stageToneClass = (stage: string) => `is-${String(stage || 'unknown').toLowerCase().replace(/[^a-z0-9_]+/g, '_')}`
const GOOGLE_MAPS_API_KEY = (import.meta.env as Record<string, string | undefined>).VITE_GOOGLE_MAPS_API_KEY

const asUrl = (value: unknown): string | null => {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (text.startsWith('http://') || text.startsWith('https://')) return text
  return null
}

const IntelRow = ({ label, value }: { label: string; value: string }) => (
  <div className="nx-intel-row">
    <span className="nx-intel-label">{label}</span>
    {asUrl(value) ? (
      <a className="nx-intel-value" href={asUrl(value) || '#'} target="_blank" rel="noreferrer">{value}</a>
    ) : (
      <span className={cls('nx-intel-value', isMissingValue(value) && 'is-missing')}>
        {missingLabel(value)}
      </span>
    )}
  </div>
)

const PropertyVisual = ({
  streetview,
  liveStreetViewEmbedUrl,
  mapsStreetViewUrl,
  propertyType,
}: {
  streetview: string | null
  liveStreetViewEmbedUrl: string | null
  mapsStreetViewUrl: string | null
  propertyType: string
}) => {
  if (liveStreetViewEmbedUrl) {
    return (
      <>
        <iframe
          className="nx-property-hero-media__image"
          src={liveStreetViewEmbedUrl}
          title="Live Street View"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
        {mapsStreetViewUrl && (
          <a className="nx-property-hero-media__cta" href={mapsStreetViewUrl} target="_blank" rel="noreferrer">
            Open Live Street View
          </a>
        )}
      </>
    )
  }

  if (streetview && streetview.startsWith('http')) {
    return <img className="nx-property-hero-media__image" src={streetview} alt="Street view" loading="lazy" />
  }

  return (
    <div className="nx-property-fallback">
      <div className="nx-property-fallback__bg" />
      <div className="nx-property-fallback__content">
        <div className="nx-property-fallback__icon">
          <Icon name="map" />
        </div>
        <div className="nx-property-fallback__info">
          <span className="nx-property-fallback__label">Property Visual Unavailable</span>
          <span className="nx-property-fallback__type">{propertyType || 'Residential Property'}</span>
        </div>
      </div>
    </div>
  )
}

const getField = (record: ThreadIntelligenceRecord | null, key: string): unknown => record?.[key]

const PropertyHeroCard = ({
  thread,
  intelligence,
}: {
  thread: InboxWorkflowThread
  intelligence: ThreadIntelligenceRecord | null
}) => {
  const snapshot = normalizePropertySnapshot(intelligence, thread)
  const address = snapshot.fullAddress || 'Property Unknown'
  const streetview = snapshot.streetViewUrl || (thread as any).streetviewImage
  
  const location = address
  const mapsStreetViewUrl = location
    ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(location)}`
    : null
  const liveStreetViewEmbedUrl = GOOGLE_MAPS_API_KEY && location
    ? `https://www.google.com/maps/embed/v1/streetview?${new URLSearchParams({ key: GOOGLE_MAPS_API_KEY, location, heading: '210', pitch: '0', fov: '80' }).toString()}`
    : null

  const stats: Array<{ icon: string; label: string; value: string }> = [
    { icon: '🏷', label: 'Type', value: snapshot.propertyType },
    { icon: '🛏', label: 'Beds', value: snapshot.beds },
    { icon: '🛁', label: 'Baths', value: snapshot.baths },
    { icon: '📐', label: 'Sqft', value: snapshot.sqft },
    { icon: '🗓', label: 'Year Built', value: snapshot.yearBuilt },
    { icon: '🗓', label: 'Effective Year', value: snapshot.effectiveYear },
    { icon: '💰', label: 'Estimated Value', value: snapshot.estimatedValue },
    { icon: '🛠', label: 'Repair Cost', value: snapshot.repairCost },
    { icon: '⚡', label: 'Cash Offer', value: snapshot.cashOffer },
    { icon: '🎯', label: 'Final Score', value: snapshot.finalScore },
  ].filter(s => !isMissingValue(s.value))

  const propertyType = snapshot.propertyType || 'Residential'

  return (
    <section className="nx-property-hero-card is-compact">
      <div className="nx-property-hero-media" aria-label="Street view snapshot">
        <span className="nx-property-hero-media__label">Property Snapshot</span>
        <PropertyVisual
          streetview={streetview}
          liveStreetViewEmbedUrl={liveStreetViewEmbedUrl}
          mapsStreetViewUrl={mapsStreetViewUrl}
          propertyType={propertyType}
        />
      </div>
      <div className="nx-property-hero-head">
        <strong>{address}</strong>
        <span>{missingLabel(snapshot.market || thread.market || thread.marketId, 'Market pending')}</span>
      </div>
      <div className="nx-property-hero-strip">
        <span className={cls('nx-stage-pill', stageToneClass(thread.inboxStage))}>{thread.inboxStage.replace(/_/g, ' ')}</span>
        <span className={cls('nx-pri-pill', `is-${thread.priority || 'unknown'}`)}>Priority {thread.priority}</span>
        <span className="nx-property-hero-strip__time">Updated {formatRelativeTime(thread.lastMessageAt)}</span>
      </div>
      <div className="nx-property-hero-stats">
        {stats.map((item) => (
          <span key={item.label} className="nx-property-pill">
            <i>{item.icon}</i>
            <small>{item.label}</small>
            <b>{item.value}</b>
          </span>
        ))}
      </div>
    </section>
  )
}

const SectionPreviewSummary = ({
  summary,
  chips,
}: {
  summary: string
  chips: string[]
}) => (
  <span className="nx-accordion-preview">
    <span className="nx-accordion-head__summary">{trimSummary(summary)}</span>
    {chips.length > 0 && (
      <span className="nx-accordion-chip-row">
        {chips.slice(0, 3).map((chip) => (
          <i key={chip}>{chip}</i>
        ))}
      </span>
    )}
  </span>
)

const AccordionCard = ({
  title,
  icon,
  preview,
  chips,
  meta,
  expanded,
  onToggle,
  children,
}: {
  title: string
  icon: IconName
  preview: string
  chips: string[]
  meta?: string
  expanded: boolean
  onToggle: () => void
  children: ReactNode
}) => (
  <section className={cls('nx-accordion-card', expanded && 'is-open')}>
    <button type="button" className="nx-accordion-head" onClick={onToggle} aria-expanded={expanded}>
      <span className="nx-accordion-head__title">
        <Icon name={icon} />
        <strong>{title}</strong>
      </span>
      <SectionPreviewSummary summary={preview} chips={chips} />
      {meta && <span className="nx-accordion-head__meta">{meta}</span>}
      <Icon name={expanded ? 'chevron-down' : 'chevron-right'} />
    </button>
    <div className="nx-accordion-body">{children}</div>
  </section>
)

const resolvePanelLayoutMode = (panelMode: Exclude<PanelMode, 'hidden'>): 'compact' | 'split' | 'workspace' => {
  if (panelMode === 'half') return 'split'
  if (panelMode === 'full') return 'workspace'
  return 'compact'
}

export const IntelligencePanel = (props: IntelligencePanelProps) => {
  const {
    thread,
    intelligence,
    isSuppressed,
    panelMode = 'default',
    onCollapse,
    onOpenMap,
    onOpenDossier,
    onOpenAi,
    onStageChange,
  } = props
  const [sectionStateByThread, setSectionStateByThread] = useState<Record<string, string[]>>({})
  const layoutMode = resolvePanelLayoutMode(panelMode)
  const sections = useMemo(() => {
    const dealRows = [
      { label: 'Final Acquisition Score', value: missingLabel(getField(intelligence, 'final_acquisition_score'), '—') },
      { label: 'Deal Strength Score', value: missingLabel(getField(intelligence, 'deal_strength_score'), '—') },
      { label: 'Structured Motivation Score', value: missingLabel(getField(intelligence, 'structured_motivation_score'), '—') },
    ].filter(r => !isMissingValue(r.value))

    const ownerRows = [
      { label: 'Owner Display Name', value: missingLabel(getField(intelligence, 'owner_display_name'), '—') },
      { label: 'Owner Type Guess', value: missingLabel(getField(intelligence, 'owner_type_guess'), '—') },
      { label: 'Priority Score', value: missingLabel(getField(intelligence, 'priority_score'), '—') },
      { label: 'Contactability Score', value: missingLabel(getField(intelligence, 'contactability_score'), '—') },
      { label: 'Financial Pressure Score', value: missingLabel(getField(intelligence, 'financial_pressure_score'), '—') },
      { label: 'Urgency Score', value: missingLabel(getField(intelligence, 'urgency_score'), '—') },
      { label: 'Priority Tier', value: missingLabel(getField(intelligence, 'priority_tier'), '—') },
      { label: 'Best Language', value: missingLabel(getField(intelligence, 'best_language'), '—') },
      { label: 'Best Contact Window', value: missingLabel(getField(intelligence, 'best_contact_window'), '—') },
      { label: 'Prospect Full Name', value: missingLabel(getField(intelligence, 'prospect_full_name'), '—') },
      { label: 'Language Preference', value: missingLabel(getField(intelligence, 'language_preference'), '—') },
      { label: 'SMS Eligible', value: missingLabel(getField(intelligence, 'sms_eligible'), '—') },
      { label: 'Contact Score Final', value: missingLabel(getField(intelligence, 'contact_score_final'), '—') },
      { label: 'Phone Score Final', value: missingLabel(getField(intelligence, 'phone_score_final'), '—') },
      { label: 'Est Household Income', value: missingLabel(getField(intelligence, 'est_household_income'), '—') },
      { label: 'Net Asset Value', value: missingLabel(getField(intelligence, 'net_asset_value'), '—') },
    ].filter(r => !isMissingValue(r.value))

    const rawRows = Object.entries(intelligence ?? {})
      .slice(0, 24)
      .map(([label, value]) => ({ label, value: missingLabel(value, '—') }))
      .filter(r => !isMissingValue(r.value))

    return [
      { id: 'property_snapshot', title: 'Property Snapshot', icon: 'map' as IconName, summary: 'Core property and valuation snapshot', rows: [] },
      { id: 'deal_intelligence', title: 'Deal Intelligence', icon: 'stats' as IconName, summary: 'Acquisition and motivation scoring', rows: dealRows },
      { id: 'owner_contact', title: 'Owner / Contact', icon: 'user' as IconName, summary: 'Owner profile and contact signals', rows: ownerRows },
      { id: 'metadata_automation', title: 'Metadata / Automation', icon: 'settings' as IconName, summary: 'Underlying intelligence payload', rows: rawRows },
    ]
  }, [intelligence, thread])
  const sectionById = useMemo(() => {
    const map = new Map<string, (typeof sections)[number]>()
    sections.forEach((section) => map.set(section.id, section))
    return map
  }, [sections])

  const modeScopeKey = thread ? `${thread.id}:${layoutMode}` : ''

  if (!thread) return (
    <aside className="nx-intelligence-panel">
      <div className="nx-inbox__workspace-empty">
        <p>Select a thread to view intelligence.</p>
      </div>
    </aside>
  )

  const allSectionIds = sections.map((section) => section.id)
  const defaultOpenSectionIds = ['property_snapshot', 'deal_intelligence']
  const openSectionIds = sectionStateByThread[modeScopeKey] ?? defaultOpenSectionIds

  const setOpenSections = (nextIds: string[]) => {
    setSectionStateByThread((current) => ({
      ...current,
      [modeScopeKey]: nextIds,
    }))
  }

  const toggleSection = (id: string) => {
    setSectionStateByThread((current) => {
      const active = current[modeScopeKey] ?? defaultOpenSectionIds
      const next = active.includes(id)
        ? active.filter((value) => value !== id)
        : [...active, id]
      return {
        ...current,
        [modeScopeKey]: next,
      }
    })
  }

  const valueByLabel = (rows: Array<{ label: string; value: string }>, labelIncludes: string): string => (
    rows.find((item) => item.label.toLowerCase().includes(labelIncludes.toLowerCase()))?.value ?? ''
  )

  const resolveSectionPreview = (id: string, summary: string, rows: Array<{ label: string; value: string }>): string => {
    const enriched = rows
      .map((item) => `${item.label} ${missingLabel(item.value, '—')}`)
      .filter((text) => !isMissingValue(text.replace(/^[^ ]+\s*/, '')))
      .slice(0, 2)

    if (enriched.length > 0) return enriched.join(' • ')
    if (!isMissingValue(summary) && !summary.toLowerCase().includes('unknown')) return summary

    const fallbackBySection: Record<string, string> = {
      property_snapshot: 'Property image and valuation summary',
      deal_intelligence: 'Acquisition scoring summary',
      owner_contact: 'Owner profile and contact signals',
      metadata_automation: 'Raw payload from nexus_thread_intelligence_v',
    }
    return fallbackBySection[id] ?? 'Pending enrichment'
  }

  const resolveSectionChips = (id: string, rows: Array<{ label: string; value: string }>): string[] => {
    if (id === 'deal_intelligence') {
      return [
        `Final ${missingLabel(valueByLabel(rows, 'Final Acquisition Score'), '—')}`,
        `Deal ${missingLabel(valueByLabel(rows, 'Deal Strength Score'), '—')}`,
        `Motivation ${missingLabel(valueByLabel(rows, 'Structured Motivation Score'), '—')}`,
      ]
    }
    if (id === 'property_snapshot') {
      const snapshot = normalizePropertySnapshot(intelligence, thread)
      return [
        missingLabel(snapshot.propertyType, 'type pending'),
        `Value ${missingLabel(snapshot.estimatedValue, '—')}`,
      ]
    }
    if (id === 'owner_contact') {
      return [
        missingLabel(valueByLabel(rows, 'Owner Display Name'), 'owner pending'),
        `Tier ${missingLabel(valueByLabel(rows, 'Priority Tier'), '—')}`,
      ]
    }
    return ['Metadata']
  }

  const renderSectionBody = (section: { id: string; rows: Array<{ label: string; value: string }> }) => {
    if (section.id === 'property_snapshot') {
      return <PropertyHeroCard thread={thread} intelligence={intelligence} />
    }

    // For data sections, hide rows that are purely '—' or missing to reduce noise
    const visibleRows = section.rows.filter((item) => !isMissingValue(item.value) && item.value !== '—')
    if (visibleRows.length === 0) {
      return (
        <div className="nx-intel-grid">
          <div className="nx-intel-empty-section">No data enriched yet</div>
        </div>
      )
    }

    return (
      <div className="nx-intel-grid">
        {visibleRows.map((item) => (
          <IntelRow key={`${section.id}-${item.label}`} label={item.label} value={item.value} />
        ))}
      </div>
    )
  }

  const renderSectionCard = (sectionId: string) => {
    const section = sectionById.get(sectionId)
    if (!section) return null
    const expanded = openSectionIds.includes(section.id)
    const preview = resolveSectionPreview(section.id, section.summary, section.rows)
    const chips = resolveSectionChips(section.id, section.rows)
    return (
      <AccordionCard
        key={section.id}
        title={section.title}
        icon={section.icon}
        preview={preview}
        chips={chips}
        expanded={expanded}
        onToggle={() => toggleSection(section.id)}
      >
        {renderSectionBody(section)}
      </AccordionCard>
    )
  }

  const renderPremiumQuickLinks = () => {
    const address = (getField(intelligence, 'property_address_full') || thread.propertyAddress || thread.subject || '') as string
    if (!address || typeof address !== 'string' || address.length < 5) return null

    const links = buildPropertyExternalLinks(address)

    return (
      <div className="nx-premium-quick-links" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', padding: '12px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <a href={links.zillow || '#'} target="_blank" rel="noreferrer" className={cls('nx-utility-btn', !links.zillow && 'is-disabled')} style={{ justifyContent: 'center' }}>
          <Icon name="arrow-up-right" /> Zillow
        </a>
        <a href={links.realtor || '#'} target="_blank" rel="noreferrer" className={cls('nx-utility-btn', !links.realtor && 'is-disabled')} style={{ justifyContent: 'center' }}>
          <Icon name="arrow-up-right" /> Realtor
        </a>
        <a href={links.googleSearch || '#'} target="_blank" rel="noreferrer" className={cls('nx-utility-btn', !links.googleSearch && 'is-disabled')} style={{ justifyContent: 'center' }}>
          <Icon name="search" /> Google
        </a>
        <a href={links.streetView || '#'} target="_blank" rel="noreferrer" className={cls('nx-utility-btn', !links.streetView && 'is-disabled')} style={{ justifyContent: 'center' }}>
          <Icon name="map" /> Street View
        </a>
      </div>
    )
  }

  return (
    <aside className={cls('nx-intelligence-panel', `is-mode-${layoutMode}`)}>
      <header className="nx-intel-header">
        <span className="nx-section-label">INTELLIGENCE</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {onStageChange && (
            <StageSelector stage={thread.inboxStage} onChange={onStageChange} />
          )}
          <button type="button" className="nx-intel-collapse" onClick={onCollapse} title="Collapse intelligence panel">
            <Icon name="chevron-right" />
          </button>
        </div>
      </header>

      <div className="nx-intel-scroll-body">
        <div className={cls('nx-intel-mode-stack', `is-${layoutMode}`)}>
          <div className="nx-intel-compact-stack">
            {['property_snapshot', 'deal_intelligence', 'owner_contact', 'metadata_automation'].map((sectionId) => renderSectionCard(sectionId))}
          </div>
          <div className="nx-intel-action-rail">
            <button type="button" className="nx-intel-action-btn" onClick={onOpenMap}><Icon name="map" /><span>Map</span></button>
            <button type="button" className="nx-intel-action-btn" onClick={onOpenDossier}><Icon name="briefing" /><span>Dossier</span></button>
            <button type="button" className="nx-intel-action-btn" onClick={onOpenAi} disabled={isSuppressed}><Icon name="spark" /><span>AI Assist</span></button>
          </div>
          {renderPremiumQuickLinks()}
          <div className="nx-intel-expand-row">
            <button type="button" className="nx-intel-expand-btn" onClick={() => setOpenSections(allSectionIds)}><Icon name="maximize" /><span>Expand All</span></button>
            <button type="button" className="nx-intel-expand-btn" onClick={() => setOpenSections([])}><Icon name="layout-split" /><span>Collapse All</span></button>
          </div>
        </div>
      </div>
    </aside>
  )
}
