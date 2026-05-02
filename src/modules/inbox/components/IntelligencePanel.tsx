import { useState } from 'react'
import type { ThreadContext, ThreadIntelligenceRecord, ThreadMessage } from '../../../lib/data/inboxData'
import type { InboxStage, InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import type { PanelMode } from '../inbox-layout-state'
import {
  normalizePropertySnapshot,
  buildPropertyExternalLinks,
} from '../inbox-normalization'
import { Icon } from '../../../shared/icons'
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
      <button 
        type="button" 
        className="nx-stage-btn" 
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
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
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                console.log(`[NexusInboxActionNoRefresh]`, {
                  action: `stage_change_${opt.value}`,
                  thread_id: 'unknown_panel',
                  optimistic: true,
                  preventedDefault: true,
                  stoppedPropagation: true
                })
                onChange(opt.value)
                setOpen(false)
              }}
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

const missingLabel = (value: unknown, placeholder = '—') => (
  isMissingValue(value) ? placeholder : normalizeText(value)
)


const CollapsibleIntelCard = ({ 
  title, 
  icon, 
  children, 
  defaultExpanded = true 
}: { 
  title: string; 
  icon: string; 
  children: React.ReactNode; 
  defaultExpanded?: boolean 
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded)
  return (
    <section className={cls('nx-intel-card', !expanded && 'is-collapsed')}>
      <button 
        type="button" 
        className="nx-intel-card__header" 
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setExpanded(!expanded)
        }}
      >
        <Icon name={icon as any} />
        <strong>{title}</strong>
        <Icon name="chevron-down" className={cls('nx-intel-card__chevron', expanded && 'is-rotated')} />
      </button>
      {expanded && <div className="nx-intel-card__body">{children}</div>}
    </section>
  )
}

const IntelRow = ({ label, value, icon }: { label: string; value: string | number; icon?: string }) => (
  <div className="nx-intel-pill">
    {icon && <i>{icon}</i>}
    <small>{label}</small>
    <b className={cls(isMissingValue(value) && 'is-missing')}>{missingLabel(value)}</b>
  </div>
)

const PropertySnapshotCard = ({
  thread,
  intelligence,
}: {
  thread: InboxWorkflowThread
  intelligence: ThreadIntelligenceRecord | null
}) => {
  const snapshot = normalizePropertySnapshot(intelligence, thread)
  const address = snapshot.fullAddress
  const streetViewUrl = snapshot.streetViewUrl
  const links = buildPropertyExternalLinks(address)

  return (
    <section className="nx-intel-card nx-property-card">
      <div className="nx-intel-card__media">
        {streetViewUrl ? (
          <img src={streetViewUrl} alt="Street View" onError={(e) => (e.currentTarget.style.display = 'none')} />
        ) : (
          <div className="nx-property-media-fallback">
             <Icon name="map" />
             <span>No Image Available</span>
          </div>
        )}
        <div className="nx-intel-card__media-actions">
           {links.zillow && <a href={links.zillow} target="_blank" rel="noreferrer" className="nx-prop-link"><Icon name="arrow-up-right" /> Zillow</a>}
           {links.realtor && <a href={links.realtor} target="_blank" rel="noreferrer" className="nx-prop-link"><Icon name="arrow-up-right" /> Realtor</a>}
           {links.googleSearch && <a href={links.googleSearch} target="_blank" rel="noreferrer" className="nx-prop-link"><Icon name="search" /> Google</a>}
           {links.streetView && <a href={links.streetView} target="_blank" rel="noreferrer" className="nx-prop-link"><Icon name="map" /> Maps</a>}
        </div>
      </div>
      
      <div className="nx-intel-card__header-static">
        <div className="nx-intel-card__title-row">
          <strong>{address}</strong>
        </div>
        <div className="nx-intel-card__sub-row">
          <span>{snapshot.market || 'Unknown Market'}</span>
          <span className="nx-divider">•</span>
          <span>{snapshot.propertyType || 'Residential'}</span>
        </div>
      </div>

      <div className="nx-intel-grid nx-stats-grid">
        <IntelRow label="Beds" value={snapshot.beds} icon="🛏" />
        <IntelRow label="Baths" value={snapshot.baths} icon="🛁" />
        <IntelRow label="Sqft" value={snapshot.sqft} icon="📐" />
        <IntelRow label="Year Built" value={snapshot.yearBuilt} icon="🗓" />
        <IntelRow label="Value" value={snapshot.estimatedValue} icon="💰" />
        <IntelRow label="Cash Offer" value={snapshot.cashOffer} icon="⚡" />
        <IntelRow label="Repair Est" value={snapshot.repairCost} icon="🛠" />
        <IntelRow label="Final Score" value={snapshot.finalScore} icon="🎯" />
      </div>
    </section>
  )
}

const DealIntelligenceCard = ({ thread }: { thread: InboxWorkflowThread }) => (
  <CollapsibleIntelCard title="Deal Intelligence" icon="stats">
    <div className="nx-intel-grid">
       <IntelRow label="Final Score" value={thread.finalAcquisitionScore as any} />
       <IntelRow label="Motivation Score" value={(thread as any).motivationScore} />
       <IntelRow label="Equity" value={(thread as any).equityAmount} />
       <IntelRow label="Offer/Value Spread" value={((thread as any).estimatedValue && (thread as any).cashOffer) ? (Number((thread as any).estimatedValue) - Number((thread as any).cashOffer)) : '—'} />
       <IntelRow label="Seller Intent" value={thread.uiIntent || '—'} />
       <IntelRow label="Next Step" value={(thread as any).dealNextStep || '—'} />
    </div>
  </CollapsibleIntelCard>
)

const OwnerContactCard = ({ thread, intelligence }: { thread: InboxWorkflowThread, intelligence: any }) => (
  <CollapsibleIntelCard title="Owner / Contact" icon="user">
    <div className="nx-intel-grid">
       <IntelRow label="Name" value={thread.ownerDisplayName || thread.ownerName} />
       <IntelRow label="Type" value={(thread as any).ownerType || '—'} />
       <IntelRow label="Phone" value={thread.phoneNumber || '—'} />
       <IntelRow label="Confidence" value={(thread as any).phoneConfidence || '—'} />
       <IntelRow label="Language" value={(thread as any).contactLanguage || '—'} />
       <IntelRow label="Last Contact" value={formatRelativeTime(thread.lastOutboundAt || thread.lastMessageAt)} />
       <IntelRow label="Timezone" value={(intelligence as any)?.timezone || '—'} />
    </div>
  </CollapsibleIntelCard>
)

const AutomationMetadataCard = ({ thread, intelligence }: { thread: InboxWorkflowThread, intelligence: any }) => (
  <CollapsibleIntelCard title="Automation / Metadata" icon="settings" defaultExpanded={false}>
    <div className="nx-intel-grid">
       <IntelRow label="Current Stage" value={thread.inboxStage} />
       <IntelRow label="Auto-Reply" value={(intelligence as any)?.auto_reply_status || '—'} />
       <IntelRow label="Queue Health" value={(thread as any).queueStatus || 'Healthy'} />
       <IntelRow label="Last Status" value={thread.deliveryStatus || '—'} />
       <IntelRow label="Source" value={(intelligence as any)?.source_app || '—'} />
       <IntelRow label="Record ID" value={thread.id} />
    </div>
  </CollapsibleIntelCard>
)


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

  if (!thread) return (
    <aside className="nx-intelligence-panel">
      <div className="nx-inbox__workspace-empty">
        <p>Select a thread to view intelligence.</p>
      </div>
    </aside>
  )

  return (
    <aside className={cls('nx-intelligence-panel', `is-mode-${panelMode}`)}>
      <header className="nx-intel-header">
        <span className="nx-section-label">INTELLIGENCE</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {onStageChange && (
            <StageSelector stage={thread.inboxStage} onChange={onStageChange} />
          )}
          <button 
            type="button" 
            className="nx-intel-collapse" 
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onCollapse()
            }} 
            title="Collapse intelligence panel"
          >
            <Icon name="chevron-right" />
          </button>
        </div>
      </header>

      <div className="nx-intel-scroll-body">
         <PropertySnapshotCard thread={thread} intelligence={intelligence} />
         <DealIntelligenceCard thread={thread} />
         <OwnerContactCard thread={thread} intelligence={intelligence} />
         <AutomationMetadataCard thread={thread} intelligence={intelligence} />

         <div className="nx-intel-action-rail">
            <button 
              type="button" 
              className="nx-intel-action-btn" 
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenMap(); }}
            >
              <Icon name="map" />
              <span>Map</span>
            </button>
            <button 
              type="button" 
              className="nx-intel-action-btn" 
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenDossier(); }}
            >
              <Icon name="briefing" />
              <span>Dossier</span>
            </button>
            <button 
              type="button" 
              className="nx-intel-action-btn" 
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenAi(); }} 
              disabled={isSuppressed}
            >
              <Icon name="spark" />
              <span>AI Assist</span>
            </button>
         </div>
      </div>
    </aside>
  )
}
