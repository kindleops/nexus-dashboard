import { useState, useEffect } from 'react'
import type { ThreadContext, ThreadIntelligenceRecord, ThreadMessage } from '../../../lib/data/inboxData'
import type { InboxStatus, SellerStage, InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import type { PanelMode } from '../inbox-layout-state'
import {
  normalizePropertySnapshot,
  buildPropertyExternalLinks,
} from '../inbox-normalization'
import { Icon } from '../../../shared/icons'
import { formatRelativeTime } from '../../../shared/formatters'
import {
  automationStateVisuals,
  getSellerStageVisual,
  getStatusVisual,
  inboxStatusOptions,
  sellerStageOptions,
  statusStyleVars,
} from '../status-visuals'

const DEV = Boolean(import.meta.env.DEV)

const cls = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

// ── Helpers ───────────────────────────────────────────────────────────────

const normalizeText = (value: unknown): string => String(value ?? '').trim()

const isMissingValue = (value: unknown): boolean => {
  const text = normalizeText(value).toLowerCase()
  return !text || text === 'unknown' || text === 'n/a' || text === 'null' || text === 'undefined' || text === 'none' || text === '-'
}

const asStr = (value: unknown): string => normalizeText(value)

const getMissingDataLabel = (value: unknown, context?: string): string => {
  if (isMissingValue(value)) {
    if (context === 'arv') return 'Needs ARV'
    if (context === 'condition') return 'Needs condition'
    if (context === 'rent_roll') return 'Needs rent roll'
    if (context === 'underwriting') return 'Needs underwriting'
    if (context === 'ask') return 'Ask seller'
    return 'Not available'
  }
  return normalizeText(value)
}

const fmtCurrency = (value: unknown): string | null => {
  const raw = String(value ?? '').replace(/[,$\s]/g, '')
  const num = Number(raw)
  if (!Number.isFinite(num) || num === 0) return null
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `$${Math.round(num / 1_000)}K`
  return `$${Math.round(num).toLocaleString()}`
}

const fmtPercent = (value: unknown): string | null => {
  const raw = String(value ?? '').replace(/[%\s]/g, '')
  const num = Number(raw)
  if (!Number.isFinite(num)) return null
  return `${Math.round(num)}%`
}

const fmtScore = (value: unknown): string | null => {
  const raw = String(value ?? '').replace(/[^0-9.]/g, '')
  const num = Number(raw)
  if (!Number.isFinite(num)) return null
  return `${Math.round(num)}/100`
}

const fmtPhone = (value: unknown): string | null => {
  const raw = normalizeText(value)
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return raw
}

const get = (thread: InboxWorkflowThread, key: string): unknown => {
  const row = thread as unknown as Record<string, unknown>
  return row[key] ?? row[key.replace(/_/g, '')] ?? row[key.charAt(0).toUpperCase() + key.slice(1)]
}

type PropertyCategory = 'sfh' | 'multifamily' | 'hotel' | 'storage' | 'retail' | 'office' | 'industrial' | 'land' | 'other'

const detectPropertyCategory = (thread: InboxWorkflowThread): PropertyCategory => {
  const pt = normalizeText(get(thread, 'propertyType') || get(thread, 'property_type')).toLowerCase()
  const units = Number(get(thread, 'unitCount') || get(thread, 'unit_count') || get(thread, 'units')) || 0
  if (units >= 5 || pt.includes('multifamily') || pt.includes('apartment')) return 'multifamily'
  if (pt.includes('hotel') || pt.includes('motel') || pt.includes('lodging') || pt.includes('hospitality')) return 'hotel'
  if (pt.includes('storage') || pt.includes('self-storage') || pt.includes('warehouse') && !pt.includes('industrial')) return 'storage'
  if (pt.includes('retail') || pt.includes('plaza') || pt.includes('strip') || pt.includes('shopping') || pt.includes('commercial') && pt.includes('store')) return 'retail'
  if (pt.includes('office') || pt.includes('medical office') || pt.includes('professional')) return 'office'
  if (pt.includes('industrial') || pt.includes('warehouse') || pt.includes('manufacturing') || pt.includes('flex')) return 'industrial'
  if (pt.includes('land') || pt.includes('lot') || pt.includes('acre') || pt.includes('vacant')) return 'land'
  if (units <= 4 && (pt.includes('single') || pt.includes('sfh') || pt.includes('residential') || pt === '')) return 'sfh'
  return 'other'
}

// ── Next Best Action Logic ────────────────────────────────────────────────

interface NextActionResult {
  title: string
  reason: string
  suggestedReply?: string
  urgency: 'high' | 'medium' | 'low'
}

const getNextBestAction = (thread: InboxWorkflowThread): NextActionResult => {
  const category = detectPropertyCategory(thread)
  const isMulti = category === 'multifamily'
  const stage = thread.conversationStage
  const inboxStatus = thread.inboxStatus
  const queueStatus = thread.queueStatus
  const hasArv = !isMissingValue(get(thread, 'arv') || get(thread, 'afterRepairValue'))
  const hasRentRoll = !isMissingValue(get(thread, 'rentRoll') || get(thread, 'rent_roll'))
  const hasCondition = !isMissingValue(get(thread, 'estimatedRepairCost') || get(thread, 'estimated_repair_cost'))
  const lastReplyPreview = thread.latestMessageBody || thread.lastMessageBody || ''

  // Waiting for seller response
  if (inboxStatus === 'waiting' || inboxStatus === 'queued') {
    const nextTouch = get(thread, 'nextTouchUseCase') || get(thread, 'next_touch_use_case')
    if (nextTouch) {
      return {
        title: `Waiting on seller — next: ${asStr(nextTouch)}`,
        reason: 'Follow-up will schedule when eligible.',
        urgency: 'low',
      }
    }
    return {
      title: 'Waiting on seller response',
      reason: 'Next follow-up will schedule when eligible.',
      urgency: 'low',
    }
  }

  // New reply needs review
  if (inboxStatus === 'new_reply') {
    const intent = thread.uiIntent || ''
    if (intent === 'info_request' || intent === 'language_switch') {
      return {
        title: 'Review seller question',
        reason: 'Seller is asking for information. Respond promptly.',
        suggestedReply: lastReplyPreview ? `Acknowledge: "${lastReplyPreview.slice(0, 80)}..."` : undefined,
        urgency: 'high',
      }
    }
    if (intent === 'potential_interest' || intent === 'price_anchor') {
      return {
        title: 'Seller showing interest',
        reason: 'Continue discovery — ask condition questions or reveal offer range.',
        urgency: 'high',
      }
    }
    return {
      title: 'Review new seller reply',
      reason: 'Classify intent and advance workflow.',
      suggestedReply: lastReplyPreview ? `Last message: "${lastReplyPreview.slice(0, 80)}..."` : undefined,
      urgency: 'high',
    }
  }

  // AI draft ready
  if (inboxStatus === 'ai_draft_ready') {
    return {
      title: 'Review AI draft reply',
      reason: 'AI has prepared a response. Review and approve before sending.',
      urgency: 'high',
    }
  }

  // Missing data blockers
  if (!hasArv && (stage === 'price_discovery' || stage === 'offer_reveal' || stage === 'negotiation')) {
    return {
      title: 'Verify ARV before revealing offer',
      reason: 'Cannot generate confident offer without ARV verification.',
      urgency: 'high',
    }
  }

  if (isMulti && !hasRentRoll && (stage === 'price_discovery' || stage === 'offer_reveal')) {
    return {
      title: 'Ask seller for rent roll and occupancy',
      reason: 'Multifamily requires rent roll and occupancy before offer underwriting.',
      suggestedReply: 'Could you share the current rent roll and occupancy rate for the property?',
      urgency: 'high',
    }
  }

  if (!hasCondition && (stage === 'condition_details' || stage === 'offer_reveal')) {
    return {
      title: 'Gather property condition details',
      reason: 'Repair estimate needed before offer can be finalized.',
      suggestedReply: 'Can you describe the current condition of the property? Any major repairs needed?',
      urgency: 'medium',
    }
  }

  // Suppressed
  if (thread.isSuppressed || thread.isOptOut) {
    return {
      title: 'Thread suppressed',
      reason: 'No further action required.',
      urgency: 'low',
    }
  }

  // Default based on stage
  if (stage === 'ownership_check') {
    return {
      title: 'Confirm ownership and property details',
      reason: 'Verify seller is the legal owner before proceeding.',
      urgency: 'medium',
    }
  }

  if (stage === 'interest_probe') {
    return {
      title: 'Probe seller motivation',
      reason: 'Understand why they are considering selling.',
      suggestedReply: 'What is motivating you to consider selling the property?',
      urgency: 'medium',
    }
  }

  if (stage === 'seller_response') {
    return {
      title: 'Awaiting seller response',
      reason: 'Seller has been contacted. Next follow-up pending.',
      urgency: 'low',
    }
  }

  if (stage === 'negotiation') {
    return {
      title: 'Active negotiation',
      reason: 'Review counter-offers and evaluate deal terms.',
      urgency: 'high',
    }
  }

  if (stage === 'contract_path') {
    return {
      title: 'Move toward contract',
      reason: 'Terms are aligned. Prepare contract or assignment.',
      urgency: 'high',
    }
  }

  // Queue status hints
  if (queueStatus === 'queued') {
    return {
      title: 'Message queued for delivery',
      reason: 'Next outbound message is scheduled.',
      urgency: 'low',
    }
  }

  return {
    title: thread.nextSystemAction || 'Review thread and determine next step',
    reason: 'No specific action detected. Evaluate thread manually.',
    urgency: 'medium',
  }
}

// ── Diagnostics ───────────────────────────────────────────────────────────

const logIntelligencePanelData = (thread: InboxWorkflowThread) => {
  if (!DEV) return
  const threadObj = thread as unknown as Record<string, unknown>
  const propertyFields = ['beds', 'baths', 'sqft', 'yearBuilt', 'lotSize', 'propertyType', 'occupancy', 'lastSaleDate', 'lastSalePrice', 'assessedValue', 'annualTaxes', 'county', 'apn']
  const sellerFields = ['ownerDisplayName', 'bestPhone', 'phoneType', 'contactLanguage', 'ownerType', 'mailingCity', 'mailingState', 'outOfStateOwner']
  const offerFields = ['cashOffer', 'aiRecommendedOffer', 'targetContract', 'walkawayPrice', 'offerConfidence', 'nextRequiredInfo']
  const automationFields = ['queueStatus', 'lastOutboundAt', 'lastInboundAt', 'automationState', 'conversationStage']

  const propPresent = propertyFields.filter((f) => threadObj[f] !== undefined && threadObj[f] !== null)
  const sellerPresent = sellerFields.filter((f) => threadObj[f] !== undefined && threadObj[f] !== null)
  const offerPresent = offerFields.filter((f) => threadObj[f] !== undefined && threadObj[f] !== null)
  const autoPresent = automationFields.filter((f) => threadObj[f] !== undefined && threadObj[f] !== null)

  const allKeyFields = [...propertyFields, ...sellerFields, ...offerFields, ...automationFields]
  const missingFields = allKeyFields.filter((f) => threadObj[f] === undefined || threadObj[f] === null)

  console.log('[IntelligencePanelData]', {
    thread_id: thread.id.slice(-8),
    has_property_snapshot: propPresent.length > 0,
    property_fields_present: propPresent.length,
    seller_fields_present: sellerPresent.length,
    offer_fields_present: offerPresent.length,
    automation_fields_present: autoPresent.length,
    missing_key_fields: missingFields.slice(0, 10),
  })
}

// ── Workflow Control Card ─────────────────────────────────────────────────

const WorkflowControlCard = ({
  thread,
  onStatusChange,
  onStageChange,
}: {
  thread: InboxWorkflowThread
  onStatusChange: (status: InboxStatus) => void
  onStageChange: (stage: SellerStage) => void
}) => {
  const [statusOpen, setStatusOpen] = useState(false)
  const [stageOpen, setStageOpen] = useState(false)
  const statusVisual = getStatusVisual(thread.inboxStatus)
  const stageVisual = getSellerStageVisual(thread.conversationStage)
  const autoVisual = automationStateVisuals[thread.automationState]

  const handleStatusChange = (status: InboxStatus) => {
    if (DEV) {
      console.log(`[NexusWorkflowStatus]`, {
        action: 'status_change',
        thread_id: thread.id.slice(-8),
        old_status: thread.inboxStatus,
        new_status: status
      })
    }
    onStatusChange(status)
    setStatusOpen(false)
  }

  const handleStageChange = (stage: SellerStage) => {
    if (DEV) {
      console.log(`[NexusWorkflowStatus]`, {
        action: 'stage_change',
        thread_id: thread.id.slice(-8),
        old_stage: thread.conversationStage,
        new_stage: stage
      })
    }
    onStageChange(stage)
    setStageOpen(false)
  }

  return (
    <section className="nx-intel-card nx-workflow-card">
      <header className="nx-intel-card__header-static">
        <strong>Workflow Control</strong>
      </header>

      <div className="nx-workflow-body">
        <div className="nx-workflow-row">
          <label>Inbox Status</label>
          <div className="nx-status-dropdown-wrap">
            <button
              type="button"
              className="nx-workflow-status-btn"
              style={statusStyleVars(statusVisual)}
              onClick={() => setStatusOpen(!statusOpen)}
            >
              <i className="nx-status-dot" />
              <span>{statusVisual.label}</span>
              <Icon name="chevron-down" />
            </button>
            {statusOpen && (
              <div className="nx-status-menu nx-liquid-panel">
                {inboxStatusOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={cls(opt.value === thread.inboxStatus && 'is-selected')}
                    style={statusStyleVars(opt)}
                    onClick={() => handleStatusChange(opt.value as InboxStatus)}
                  >
                    <i className="nx-status-dot" />
                    <span>
                      <strong>{opt.label}</strong>
                      <small>{opt.description}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="nx-workflow-row">
          <label>Seller Stage</label>
          <div className="nx-status-dropdown-wrap">
            <button
              type="button"
              className="nx-workflow-status-btn"
              style={statusStyleVars(stageVisual)}
              onClick={() => setStageOpen(!stageOpen)}
            >
              <i className="nx-status-dot" />
              <span>{stageVisual.label}</span>
              <Icon name="chevron-down" />
            </button>
            
            <div className="nx-stage-indicator" style={{ marginTop: 8 }}>
              <div className="nx-stage-progress">
                {sellerStageOptions.map((opt, idx) => {
                  const isCurrent = opt.value === thread.conversationStage
                  const isPast = !isCurrent && sellerStageOptions.findIndex(o => o.value === thread.conversationStage) > idx
                  return (
                    <div 
                      key={opt.value} 
                      className={cls('nx-stage-step', isCurrent && 'is-current', isPast && 'is-past')}
                      title={opt.label}
                    />
                  )
                })}
              </div>
            </div>

            {stageOpen && (
              <div className="nx-status-menu nx-liquid-panel">
                {sellerStageOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={cls(opt.value === thread.conversationStage && 'is-selected')}
                    style={statusStyleVars(opt)}
                    onClick={() => handleStageChange(opt.value as SellerStage)}
                  >
                    <i className="nx-status-dot" />
                    <span>
                      <strong>{opt.label}</strong>
                      <small>{opt.description}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="nx-workflow-row">
          <label>Automation</label>
          <span className="nx-auto-pill" style={{ '--auto-color': autoVisual.color } as any}>
            {autoVisual.label}
          </span>
        </div>

        <div className="nx-workflow-row nx-next-action-row">
          <Icon name="spark" />
          <p>{thread.nextSystemAction}</p>
        </div>
      </div>
    </section>
  )
}

// ── Collapsible Card ──────────────────────────────────────────────────────

const CollapsibleIntelCard = ({ 
  title, 
  icon, 
  children, 
  defaultExpanded = true,
  accent,
}: { 
  title: string; 
  icon: string; 
  children: React.ReactNode; 
  defaultExpanded?: boolean;
  accent?: 'blue' | 'green' | 'amber' | 'purple' | 'none';
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded)
  return (
    <section className={cls('nx-intel-card', !expanded && 'is-collapsed', accent && accent !== 'none' && `is-accent-${accent}`)}>
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

// ── Stat Chip ─────────────────────────────────────────────────────────────

const StatChip = ({ label, value, icon, color }: { label: string; value: string | null; icon?: string; color?: string }) => {
  const missing = isMissingValue(value)
  return (
    <div className={cls('nx-stat-chip', missing && 'is-missing', color && `is-${color}`)}>
      {icon && <span className="nx-stat-chip__icon">{icon}</span>}
      <div className="nx-stat-chip__content">
        <small>{label}</small>
        <b>{missing ? '—' : value}</b>
      </div>
    </div>
  )
}

// ── Grouped Row (for Deal Intelligence, etc.) ─────────────────────────────

const GroupedRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="nx-grouped-section">
    <div className="nx-grouped-label">{label}</div>
    <div className="nx-grouped-content">{children}</div>
  </div>
)

const DataRow = ({ label, value, accent, placeholder }: { label: string; value: string | null; accent?: 'green' | 'red' | 'amber' | 'blue'; placeholder?: string }) => {
  const display = value || placeholder || '—'
  const isPlaceholder = !value
  return (
    <div className={cls('nx-data-row', isPlaceholder && 'is-placeholder', accent && `is-${accent}`)}>
      <small>{label}</small>
      <b>{display}</b>
    </div>
  )
}

// ── Property Hero Card ────────────────────────────────────────────────────

const PropertyHeroCard = ({
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
  const market = snapshot.market || thread.market || thread.marketId || 'Unknown Market'
  const propertyType = normalizeText(snapshot.propertyType || (get(thread, 'propertyType') as string) || 'Residential')
  const category = detectPropertyCategory(thread)
  const isMulti = category === 'multifamily'
  const unitCount = get(thread, 'unitCount') || get(thread, 'unit_count') || get(thread, 'units') || (category === 'hotel' ? (get(thread, 'roomCount') || get(thread, 'room_count') || get(thread, 'rooms')) : null)
  const lotSize = get(thread, 'lotSize') || get(thread, 'lot_size_sqft') || get(thread, 'lotSizeSqft') || get(thread, 'lotSizeAcres')
  const occupancy = get(thread, 'occupancy')
  const ownerType = get(thread, 'ownerType') || get(thread, 'owner_type')

  return (
    <section className="nx-intel-card nx-property-hero-card">
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
      
      <div className="nx-intel-card__header-static nx-property-hero__info">
        <div className="nx-property-hero__address">
          <strong>{address || 'No Address'}</strong>
          {isMulti && <span className="nx-badge nx-badge--multi">MULTIFAMILY</span>}
          {category === 'hotel' && <span className="nx-badge nx-badge--commercial">HOTEL/MOTEL</span>}
          {category === 'storage' && <span className="nx-badge nx-badge--commercial">SELF-STORAGE</span>}
          {category === 'retail' && <span className="nx-badge nx-badge--commercial">RETAIL/PLAZA</span>}
          {category === 'office' && <span className="nx-badge nx-badge--commercial">OFFICE</span>}
          {category === 'industrial' && <span className="nx-badge nx-badge--commercial">INDUSTRIAL</span>}
          {category === 'land' && <span className="nx-badge nx-badge--land">LAND</span>}
        </div>
        <div className="nx-property-hero__meta">
          <span className="nx-market-tag">{market}</span>
          <span className="nx-divider">•</span>
          <span>{propertyType}</span>
          {(category === 'multifamily' || category === 'hotel') && Boolean(unitCount) && !isMissingValue(unitCount) && (<><span className="nx-divider">•</span><span>{asStr(unitCount)} {category === 'hotel' ? 'rooms' : 'units'}</span></>)}
        </div>
        <div className="nx-property-hero__chips">
          {Boolean(snapshot.beds) && !isMissingValue(snapshot.beds) && <span className="nx-pill">{snapshot.beds} Bed{snapshot.beds !== '1' ? 's' : ''}</span>}
          {Boolean(snapshot.baths) && !isMissingValue(snapshot.baths) && <span className="nx-pill">{snapshot.baths} Bath{snapshot.baths !== '1' ? 's' : ''}</span>}
          {Boolean(snapshot.sqft) && !isMissingValue(snapshot.sqft) && <span className="nx-pill">{Number(snapshot.sqft).toLocaleString()} sqft</span>}
          {Boolean(snapshot.yearBuilt) && !isMissingValue(snapshot.yearBuilt) && <span className="nx-pill">Built {snapshot.yearBuilt}</span>}
          {Boolean(lotSize) && !isMissingValue(lotSize) && <span className="nx-pill">{asStr(lotSize)} lot</span>}
          {Boolean(occupancy) && !isMissingValue(occupancy) && <span className="nx-pill">{asStr(occupancy)}</span>}
          {Boolean(ownerType) && !isMissingValue(ownerType) && <span className="nx-pill">{asStr(ownerType)}</span>}
        </div>
      </div>
    </section>
  )
}

// ── Next Best Action Section ──────────────────────────────────────────────

const NextBestActionSection = ({ thread, isSuppressed }: { thread: InboxWorkflowThread; isSuppressed: boolean }) => {
  const action = getNextBestAction(thread)
  const aiDraft = thread.aiDraft

  return (
    <section className="nx-intel-card nx-next-best-card">
      <header className="nx-section-header">
        <Icon name="spark" />
        <span>Next Best Action</span>
        <span className={cls('nx-action-urgency', `is-${action.urgency}`)}>
          {action.urgency === 'high' ? 'Urgent' : action.urgency === 'medium' ? 'Recommended' : 'Info'}
        </span>
      </header>
      <div className="nx-nba-body">
        <p className="nx-nba__title">{action.title}</p>
        <p className="nx-nba__reason">{action.reason}</p>
        {action.suggestedReply && (
          <div className="nx-nba__reply-preview">
            <small>Suggested Reply</small>
            <p>{action.suggestedReply}</p>
          </div>
        )}
      </div>
      {aiDraft && !isSuppressed && (
        <div className="nx-next-best__draft">
          <small>AI Draft</small>
          <p>{aiDraft}</p>
        </div>
      )}
      <div className="nx-next-best__actions">
        <button type="button" className="nx-nb-btn nx-nb-btn--primary" disabled={isSuppressed}>
          <Icon name="clock" />
          <span>Queue Reply</span>
        </button>
        <button type="button" className="nx-nb-btn">
          <Icon name="file-text" />
          <span>Edit</span>
        </button>
        <button type="button" className="nx-nb-btn nx-nb-btn--warn">
          <Icon name="alert" />
          <span>Mark Review</span>
        </button>
        <button type="button" className="nx-nb-btn nx-nb-btn--danger" disabled={isSuppressed}>
          <Icon name="shield" />
          <span>Suppress</span>
        </button>
      </div>
    </section>
  )
}

// ── Offer Intelligence Section ────────────────────────────────────────────

const OfferIntelligenceSection = ({ thread }: { thread: InboxWorkflowThread }) => {
  const category = detectPropertyCategory(thread)
  const isMulti = category === 'multifamily'
  const hasArv = !isMissingValue(get(thread, 'arv') || get(thread, 'afterRepairValue'))
  const hasCondition = !isMissingValue(get(thread, 'estimatedRepairCost') || get(thread, 'estimated_repair_cost'))
  const hasRentRoll = !isMissingValue(get(thread, 'rentRoll') || get(thread, 'rent_roll'))

  const cashOffer = get(thread, 'cashOffer') || get(thread, 'cash_offer') || get(thread, 'mao')
  const aiOffer = get(thread, 'aiRecommendedOffer') || get(thread, 'ai_offer') || get(thread, 'ai_recommended_opening_offer')
  const targetContract = get(thread, 'targetContract') || get(thread, 'target_contract')
  const walkaway = get(thread, 'walkawayPrice') || get(thread, 'walkaway_price') || get(thread, 'walkaway') || get(thread, 'walkaway_internal')
  const offerConfidence = get(thread, 'offerConfidence') || get(thread, 'offer_confidence') || get(thread, 'confidenceBand')
  const nextRequired = get(thread, 'nextRequiredInfo') || get(thread, 'next_required_info')
  const offerReason = get(thread, 'offerReason') || get(thread, 'offer_reason')
  const offerMethod = get(thread, 'offerMethod') || get(thread, 'offer_method')

  let aiOfferDisplay: string
  if (aiOffer && !isMissingValue(aiOffer)) {
    aiOfferDisplay = fmtCurrency(aiOffer) || normalizeText(aiOffer)
  } else if (isMulti && (!hasRentRoll)) {
    aiOfferDisplay = 'Needs rent roll'
  } else if (!hasArv) {
    aiOfferDisplay = 'Needs ARV'
  } else if (!hasCondition) {
    aiOfferDisplay = 'Needs condition'
  } else {
    aiOfferDisplay = 'Needs underwriting'
  }

  let nextRequiredDisplay: string
  if (nextRequired && !isMissingValue(nextRequired)) {
    nextRequiredDisplay = asStr(nextRequired)
  } else if (isMulti && !hasRentRoll) {
    nextRequiredDisplay = 'Need rent roll / occupancy'
  } else if (!hasArv) {
    nextRequiredDisplay = 'Need ARV verification'
  } else if (!hasCondition) {
    nextRequiredDisplay = 'Need condition details'
  } else {
    nextRequiredDisplay = 'Awaiting underwriting'
  }

  return (
    <CollapsibleIntelCard title="Offer Intelligence" icon="zap" accent="amber">
      <div className="nx-offer-stack">
        <div className="nx-offer-row nx-offer-row--legacy">
          <div className="nx-offer-row__label">
            <Icon name="clock" />
            <span>Legacy Cash Offer</span>
          </div>
          <div className="nx-offer-row__value">
            {fmtCurrency(cashOffer) || 'No offer generated'}
          </div>
        </div>

        <div className="nx-offer-row nx-offer-row--ai">
          <div className="nx-offer-row__label">
            <Icon name="spark" />
            <span>AI Recommended Opening</span>
          </div>
          <div className={cls('nx-offer-row__value', isMissingValue(aiOffer) && 'is-placeholder')}>
            {aiOfferDisplay}
          </div>
        </div>

        <div className="nx-offer-row">
          <div className="nx-offer-row__label">
            <span>Target Contract</span>
          </div>
          <div className="nx-offer-row__value">
            {fmtCurrency(targetContract) || 'Pending'}
          </div>
        </div>

        <div className="nx-offer-row nx-offer-row--internal">
          <div className="nx-offer-row__label">
            <Icon name="eye" />
            <span>Walkaway (Internal)</span>
          </div>
          <div className={cls('nx-offer-row__value', isMissingValue(walkaway) && 'is-placeholder')}>
            {fmtCurrency(walkaway) || 'Needs underwriting'}
          </div>
        </div>

        {Boolean(offerConfidence) && !isMissingValue(offerConfidence) && (
          <div className="nx-offer-row">
            <div className="nx-offer-row__label">
              <span>Offer Confidence</span>
            </div>
            <div className="nx-offer-row__value">
              {asStr(offerConfidence)}
            </div>
          </div>
        )}

        {Boolean(offerMethod) && !isMissingValue(offerMethod) && (
          <div className="nx-offer-row">
            <div className="nx-offer-row__label">
              <span>Offer Method</span>
            </div>
            <div className="nx-offer-row__value">
              {asStr(offerMethod)}
            </div>
          </div>
        )}

        {Boolean(offerReason) && !isMissingValue(offerReason) && (
          <div className="nx-offer-row">
            <div className="nx-offer-row__label">
              <span>Offer Reason</span>
            </div>
            <div className="nx-offer-row__value">
              {asStr(offerReason)}
            </div>
          </div>
        )}

        <div className="nx-offer-row nx-offer-row--next">
          <div className="nx-offer-row__label">
            <Icon name="alert" />
            <span>Next Required Info</span>
          </div>
          <div className="nx-offer-row__value is-placeholder">
            {nextRequiredDisplay}
          </div>
        </div>
      </div>
    </CollapsibleIntelCard>
  )
}

// ── Deal Intelligence Section ─────────────────────────────────────────────

const DealIntelligenceSection = ({ thread }: { thread: InboxWorkflowThread }) => {
  // Valuation
  const estimatedValue = get(thread, 'estimatedValue') || get(thread, 'estimated_value') || get(thread, 'zestimate')
  const assessedValue = get(thread, 'assessedValue') || get(thread, 'assessed_value') || get(thread, 'taxAssessedValue')
  const lastSalePrice = get(thread, 'lastSalePrice') || get(thread, 'last_sale_price')
  const equityAmount = get(thread, 'equityAmount') || get(thread, 'equity_amount') || get(thread, 'equity')
  const equityPercent = get(thread, 'equityPercent') || get(thread, 'equity_percent')

  // Condition
  const repairCost = get(thread, 'estimatedRepairCost') || get(thread, 'estimated_repair_cost') || get(thread, 'estimatedRepairs')
  const rehabLevel = get(thread, 'rehabLevel') || get(thread, 'rehab_level') || get(thread, 'rehab_scope')
  const buildingQuality = get(thread, 'buildingQuality') || get(thread, 'building_quality')
  const distressTags = get(thread, 'distressTags') || get(thread, 'distress_tags') || get(thread, 'distress_indicators')

  // Motivation
  const finalScore = thread.finalAcquisitionScore || get(thread, 'finalScore') || get(thread, 'final_acquisition_score')
  const motivationScore = get(thread, 'motivationScore') || get(thread, 'motivation_score') || get(thread, 'structured_motivation_score')
  const priorityTier = get(thread, 'priorityTier') || get(thread, 'priority_tier')
  const sentiment = thread.sentiment || get(thread, 'message_sentiment')
  const ownershipYears = get(thread, 'ownershipYears') || get(thread, 'ownership_years') || get(thread, 'years_owned')

  return (
    <CollapsibleIntelCard title="Deal Intelligence" icon="trending-up" accent="green">
      <GroupedRow label="Valuation">
        <DataRow label="Estimated Value" value={fmtCurrency(estimatedValue)} placeholder="Needs valuation" accent="blue" />
        <DataRow label="Assessed Value" value={fmtCurrency(assessedValue)} />
        <DataRow label="Last Sale Price" value={fmtCurrency(lastSalePrice)} />
        <DataRow label="Equity Amount" value={fmtCurrency(equityAmount)} accent="green" />
        <DataRow label="Equity %" value={fmtPercent(equityPercent)} />
      </GroupedRow>

      <GroupedRow label="Condition">
        <DataRow label="Repair Estimate" value={fmtCurrency(repairCost)} placeholder="Needs inspection" />
        <DataRow label="Rehab Level" value={getMissingDataLabel(rehabLevel, 'ask') as string} />
        <DataRow label="Building Quality" value={getMissingDataLabel(buildingQuality) as string} />
        <DataRow label="Distress Tags" value={getMissingDataLabel(distressTags) as string} />
      </GroupedRow>

      <GroupedRow label="Motivation">
        <DataRow 
          label="Final Score" 
          value={fmtScore(finalScore) || 'Not scored'}
          accent={finalScore && Number(String(finalScore).replace(/[^0-9.]/g, '')) >= 70 ? 'green' : 'amber'}
        />
        <DataRow label="Motivation Score" value={fmtScore(motivationScore) || asStr(motivationScore)} />
        <DataRow label="Priority Tier" value={getMissingDataLabel(priorityTier) as string} />
        <DataRow label="Sentiment" value={getMissingDataLabel(sentiment) as string} />
        <DataRow label="Ownership Years" value={getMissingDataLabel(ownershipYears) as string} />
      </GroupedRow>
    </CollapsibleIntelCard>
  )
}

// ── Seller / Contact Intelligence Section ─────────────────────────────────

const SellerContactSection = ({ thread }: { thread: InboxWorkflowThread }) => {
  const ownerName = thread.ownerDisplayName || thread.ownerName || normalizeText(get(thread, 'owner_display_name'))
  const phone = thread.phoneNumber || thread.canonicalE164 || normalizeText(get(thread, 'seller_phone'))
  const phoneFormatted = fmtPhone(phone)
  const phoneType = get(thread, 'phoneType') || get(thread, 'phone_type')
  const phoneConfidence = get(thread, 'phoneConfidence') || get(thread, 'phone_confidence')
  const language = get(thread, 'contactLanguage') || get(thread, 'language') || get(thread, 'seller_language') || get(thread, 'best_language')
  const ownerType = get(thread, 'ownerType') || get(thread, 'owner_type') || get(thread, 'owner_type_guess')
  const lastIntent = thread.uiIntent || normalizeText(get(thread, 'lastIntent')) || normalizeText(get(thread, 'last_intent'))
  const sellerPersona = get(thread, 'sellerPersona') || get(thread, 'seller_persona')
  const mailingCity = get(thread, 'mailingCity') || get(thread, 'mailing_city')
  const mailingState = get(thread, 'mailingState') || get(thread, 'mailing_state')
  const outOfState = get(thread, 'outOfStateOwner') || get(thread, 'out_of_state_owner')
  const occupation = get(thread, 'occupation')
  const ageFlag = get(thread, 'ageOrSeniorFlag') || get(thread, 'age_or_senior_flag') || get(thread, 'is_senior')
  const netAssetValue = get(thread, 'netAssetValue') || get(thread, 'net_asset_value')
  const smsEligible = get(thread, 'smsEligible') || get(thread, 'sms_eligible')
  const contactConfidence = get(thread, 'contactConfidence') || get(thread, 'contact_confidence')
  const lastReplyPreview = thread.latestMessageBody || thread.lastMessageBody
  const lastContactAt = thread.lastOutboundAt || thread.lastMessageAt

  const initials = ownerName ? ownerName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() : '?'
  const mailingLocation = [mailingCity, mailingState].filter(Boolean).join(', ') || 'Not available'

  return (
    <CollapsibleIntelCard title="Seller / Contact" icon="user" accent="blue">
      <div className="nx-contact-card">
        <div className="nx-contact-avatar">
          {initials}
        </div>
        <div className="nx-contact-info">
          <strong>{ownerName || 'Unknown Seller'}</strong>
          <div className="nx-contact-chips">
            {Boolean(ownerType) && !isMissingValue(ownerType) && <span className="nx-contact-type">{asStr(ownerType)}</span>}
            {Boolean(smsEligible) && <span className="nx-chip nx-chip--sms">SMS Eligible</span>}
            {Boolean(outOfState) && <span className="nx-chip nx-chip--out-of-state">Out of State</span>}
          </div>
        </div>
      </div>
      <div className="nx-contact-details">
        {Boolean(phoneFormatted) && (
          <div className="nx-contact-row">
            <small>Best Phone</small>
            <b>{phoneFormatted}</b>
          </div>
        )}
        {Boolean(phoneType) && !isMissingValue(phoneType) && (
          <div className="nx-contact-row">
            <small>Phone Type</small>
            <b>{asStr(phoneType)}</b>
          </div>
        )}
        {Boolean(contactConfidence) && !isMissingValue(contactConfidence) && (
          <div className="nx-contact-row">
            <small>Contact Confidence</small>
            <b>{asStr(contactConfidence)}</b>
          </div>
        )}
        {Boolean(phoneConfidence) && !isMissingValue(phoneConfidence) && (
          <div className="nx-contact-row">
            <small>Phone Confidence</small>
            <b>{asStr(phoneConfidence)}</b>
          </div>
        )}
        {Boolean(language) && !isMissingValue(language) && (
          <div className="nx-contact-row">
            <small>Language</small>
            <b>{asStr(language)}</b>
          </div>
        )}
        {Boolean(mailingLocation) && mailingLocation !== 'Not available' && (
          <div className="nx-contact-row">
            <small>Mailing Address</small>
            <b>{mailingLocation}</b>
          </div>
        )}
        {Boolean(occupation) && !isMissingValue(occupation) && (
          <div className="nx-contact-row">
            <small>Occupation</small>
            <b>{asStr(occupation)}</b>
          </div>
        )}
        {Boolean(ageFlag) && !isMissingValue(ageFlag) && (
          <div className="nx-contact-row">
            <small>Senior Flag</small>
            <b>{asStr(ageFlag)}</b>
          </div>
        )}
        {Boolean(netAssetValue) && !isMissingValue(netAssetValue) && (
          <div className="nx-contact-row">
            <small>Net Asset Value</small>
            <b>{fmtCurrency(netAssetValue) || asStr(netAssetValue)}</b>
          </div>
        )}
        {Boolean(lastIntent) && !isMissingValue(lastIntent) && (
          <div className="nx-contact-row">
            <small>Last Intent</small>
            <b>{asStr(lastIntent)}</b>
          </div>
        )}
        {Boolean(sellerPersona) && !isMissingValue(sellerPersona) && (
          <div className="nx-contact-row">
            <small>Seller Persona</small>
            <b>{asStr(sellerPersona)}</b>
          </div>
        )}
        {Boolean(lastReplyPreview) && (
          <div className="nx-contact-row nx-contact-row--preview">
            <small>Last Reply Preview</small>
            <b>"{lastReplyPreview.slice(0, 60)}{lastReplyPreview.length > 60 ? '…' : ''}"</b>
          </div>
        )}
        <div className="nx-contact-row">
          <small>Last Contact</small>
          <b>{formatRelativeTime(lastContactAt)}</b>
        </div>
      </div>
    </CollapsibleIntelCard>
  )
}

// ── Property Snapshot Section ─────────────────────────────────────────────

const PropertySnapshotSection = ({ thread }: { thread: InboxWorkflowThread }) => {
  const beds = get(thread, 'beds') || get(thread, 'bedrooms')
  const baths = get(thread, 'baths') || get(thread, 'bathrooms')
  const sqft = get(thread, 'sqft') || get(thread, 'livingAreaSqft') || get(thread, 'living_area_sqft')
  const yearBuilt = get(thread, 'yearBuilt') || get(thread, 'year_built')
  const effectiveYear = get(thread, 'effectiveYear') || get(thread, 'effective_year_built')
  const lotSize = get(thread, 'lotSize') || get(thread, 'lot_size_sqft') || get(thread, 'lotSizeSqft') || get(thread, 'lotSizeAcres')
  const propertyType = get(thread, 'propertyType') || get(thread, 'property_type')
  const occupancy = get(thread, 'occupancy')
  const category = detectPropertyCategory(thread)
  const isMulti = category === 'multifamily'

  // Structure fields
  const stories = get(thread, 'stories') || get(thread, 'num_stories') || get(thread, 'numStories')
  const garage = get(thread, 'garageOrParking') || get(thread, 'garage_or_parking') || get(thread, 'garage_spaces') || get(thread, 'parking_spaces')
  const basement = get(thread, 'basement') || get(thread, 'basement_type') || get(thread, 'has_basement')
  const constructionType = get(thread, 'constructionType') || get(thread, 'construction_type')
  const bldgQuality = get(thread, 'buildingQuality') || get(thread, 'building_quality')

  // Land / Parcel
  const county = get(thread, 'county') || get(thread, 'property_county') || get(thread, 'county_name')
  const apn = get(thread, 'apn') || get(thread, 'apn_parcel_id') || get(thread, 'parcel_id') || get(thread, 'parcel_number')
  const zoning = get(thread, 'zoning') || get(thread, 'zoning_code')

  // Tax / History
  const lastSaleDate = get(thread, 'lastSaleDate') || get(thread, 'last_sale_date')
  const lastSalePrice = get(thread, 'lastSalePrice') || get(thread, 'last_sale_price')
  const assessedValue = get(thread, 'assessedValue') || get(thread, 'assessed_value') || get(thread, 'tax_assessed_value')
  const annualTaxes = get(thread, 'annualTaxes') || get(thread, 'annual_taxes') || get(thread, 'tax_amount')
  const taxYear = get(thread, 'taxYear') || get(thread, 'tax_year')

  const toChip = (v: unknown): string | null => {
    if (v === null || v === undefined) return null
    const n = Number(String(v).replace(/[,$\s]/g, ''))
    if (Number.isFinite(n)) return String(n)
    return String(v).trim() || null
  }

  const fmtSaleDate = (v: unknown): string | null => {
    const raw = normalizeText(v)
    if (!raw) return null
    try {
      const d = new Date(raw)
      if (isNaN(d.getTime())) return raw
      return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    } catch { return raw }
  }

  return (
    <CollapsibleIntelCard title="Property Snapshot" icon="layers" accent="purple">
      {/* Structure */}
      <GroupedRow label="Structure">
        <div className="nx-stat-grid nx-stat-grid--compact">
          <StatChip label="Beds" value={toChip(beds)} color="blue" />
          <StatChip label="Baths" value={toChip(baths)} color="blue" />
          <StatChip label="Sqft" value={sqft ? `${Number(String(sqft).replace(/,/g, '')).toLocaleString()}` : null} color="blue" />
          <StatChip label="Year Built" value={toChip(yearBuilt)} />
          {Boolean(effectiveYear) && <StatChip label="Eff. Year" value={toChip(effectiveYear)} />}
          {Boolean(stories) && <StatChip label="Stories" value={toChip(stories)} />}
          {Boolean(garage) && <StatChip label="Garage/Parking" value={toChip(garage)} />}
          {Boolean(basement) && <StatChip label="Basement" value={toChip(basement)} />}
          {Boolean(constructionType) && !isMissingValue(constructionType) && <StatChip label="Construction" value={toChip(constructionType)} />}
          {Boolean(bldgQuality) && !isMissingValue(bldgQuality) && <StatChip label="Quality" value={toChip(bldgQuality)} />}
          {Boolean(propertyType) && !isMissingValue(propertyType) && <StatChip label="Type" value={toChip(propertyType)} />}
          {Boolean(occupancy) && !isMissingValue(occupancy) && <StatChip label="Occupancy" value={toChip(occupancy)} />}
        </div>
      </GroupedRow>

      {/* Land / Parcel */}
      <GroupedRow label="Land / Parcel">
        <div className="nx-stat-grid nx-stat-grid--compact">
          {Boolean(lotSize) && !isMissingValue(lotSize) && <StatChip label="Lot Size" value={toChip(lotSize)} />}
          {Boolean(county) && !isMissingValue(county) && <StatChip label="County" value={toChip(county)} />}
          {Boolean(apn) && !isMissingValue(apn) && <StatChip label="APN / Parcel" value={toChip(apn)} />}
          {Boolean(zoning) && !isMissingValue(zoning) && <StatChip label="Zoning" value={toChip(zoning)} />}
          {isMulti && <StatChip label="Units" value={toChip(get(thread, 'unitCount') || get(thread, 'unit_count') || get(thread, 'units'))} color="purple" />}
        </div>
      </GroupedRow>

      {/* Tax / History */}
      <GroupedRow label="Tax / History">
        <div className="nx-stat-grid nx-stat-grid--compact">
          <StatChip label="Last Sale" value={fmtSaleDate(lastSaleDate)} />
          <StatChip label="Sale Price" value={fmtCurrency(lastSalePrice)} />
          <StatChip label="Assessed Value" value={fmtCurrency(assessedValue)} />
          <StatChip label="Annual Taxes" value={fmtCurrency(annualTaxes)} />
          {Boolean(taxYear) && <StatChip label="Tax Year" value={toChip(taxYear)} />}
        </div>
      </GroupedRow>

      {/* Distress indicators */}
      <div className="nx-distress-indicators">
        {thread.isAbsentee && <span className="nx-distress-tag">Absentee Owner</span>}
        {thread.isVacant && <span className="nx-distress-tag">Vacant</span>}
        {thread.hasLien && <span className="nx-distress-tag nx-distress-tag--warn">Active Lien</span>}
        {thread.isProbate && <span className="nx-distress-tag">Probate</span>}
        {thread.isTaxDelinquent && <span className="nx-distress-tag nx-distress-tag--warn">Tax Delinquent</span>}
      </div>
    </CollapsibleIntelCard>
  )
}

// ── Automation Timeline Section ───────────────────────────────────────────

const AutomationTimelineSection = ({ thread }: { thread: InboxWorkflowThread }) => {
  const firstTouchAt = normalizeText(get(thread, 'firstTouchAt') || get(thread, 'first_touch_at') || thread.updatedAt)
  const sellerRepliedAt = normalizeText(get(thread, 'sellerRepliedAt') || get(thread, 'seller_replied_at') || thread.lastInboundAt)
  const stageVisual = getSellerStageVisual(thread.conversationStage)
  const autoVisual = automationStateVisuals[thread.automationState]
  const queueStatus = thread.queueStatus
  const lastOutboundAt = thread.lastOutboundAt
  const lastInboundAt = thread.lastInboundAt
  const nextTouch = get(thread, 'nextTouchUseCase') || get(thread, 'next_touch_use_case')
  const nextEligible = get(thread, 'nextEligibleAt') || get(thread, 'next_eligible_at')
  const pendingPrior = get(thread, 'pendingPriorTouch') || get(thread, 'pending_prior_touch')
  const automationReason = get(thread, 'automationReason') || get(thread, 'automation_reason')

  const timelineItems = [
    { label: 'First Touch Sent', time: firstTouchAt, done: Boolean(firstTouchAt), icon: 'send' },
    { label: 'Seller Replied', time: sellerRepliedAt, done: Boolean(sellerRepliedAt), icon: 'message' },
    { label: 'Current Stage', time: '', done: true, active: true, icon: 'layers', label_extra: stageVisual.label },
    { label: 'Automation', time: '', done: true, icon: 'bolt', label_extra: autoVisual.label },
    { label: 'Queue Status', time: '', done: Boolean(queueStatus), icon: 'clock', label_extra: asStr(queueStatus) || 'Healthy' },
    { label: 'Last Outbound', time: lastOutboundAt || '', done: Boolean(lastOutboundAt), icon: 'arrow-up' },
    { label: 'Last Inbound', time: lastInboundAt || '', done: Boolean(lastInboundAt), icon: 'arrow-down' },
    ...(Boolean(nextTouch) ? [{ label: 'Next Touch', time: '', done: false, icon: 'next', label_extra: asStr(nextTouch) }] : []),
    ...(Boolean(nextEligible) ? [{ label: 'Next Eligible', time: asStr(nextEligible), done: false, icon: 'calendar' }] : []),
    ...(Boolean(pendingPrior) ? [{ label: 'Pending Prior Touch', time: '', done: false, icon: 'alert', label_extra: asStr(pendingPrior) }] : []),
  ]

  return (
    <CollapsibleIntelCard title="Automation Timeline" icon="activity" defaultExpanded={false}>
      <div className="nx-timeline">
        {timelineItems.map((item, idx) => (
          <div key={idx} className={cls('nx-timeline-item', item.done && 'is-done', item.active && 'is-active')}>
            <div className="nx-timeline-dot" />
            <div className="nx-timeline-content">
              <div className="nx-timeline-label">
                <span>{item.label}</span>
                {item.label_extra && <span className="nx-timeline-extra">{item.label_extra}</span>}
              </div>
              {item.time && <small>{formatRelativeTime(item.time)}</small>}
            </div>
          </div>
        ))}
      </div>
      {Boolean(automationReason) && (
        <div className="nx-automation-reason">
          <small>Automation Reason</small>
          <p>{asStr(automationReason)}</p>
        </div>
      )}
    </CollapsibleIntelCard>
  )
}

// ── Main Intelligence Panel ───────────────────────────────────────────────

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
  onStatusChange: (status: InboxStatus) => void
  onStageChange: (stage: SellerStage) => void
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
    onStatusChange,
    onStageChange,
  } = props

  useEffect(() => {
    if (thread) logIntelligencePanelData(thread)
  }, [thread?.id])

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
      </header>

      <div className="nx-intel-scroll-body">
        <WorkflowControlCard 
          thread={thread} 
          onStatusChange={onStatusChange} 
          onStageChange={onStageChange} 
        />
        <PropertyHeroCard thread={thread} intelligence={intelligence} />
        <NextBestActionSection thread={thread} isSuppressed={isSuppressed} />
        <OfferIntelligenceSection thread={thread} />
        <DealIntelligenceSection thread={thread} />
        <SellerContactSection thread={thread} />
        <PropertySnapshotSection thread={thread} />
        <AutomationTimelineSection thread={thread} />

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
