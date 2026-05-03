import { useState } from 'react'
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

const cls = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

// ── Helpers ───────────────────────────────────────────────────────────────

const normalizeText = (value: unknown): string => String(value ?? '').trim()

const isMissingValue = (value: unknown): boolean => {
  const text = normalizeText(value).toLowerCase()
  return !text || text === 'unknown' || text === 'n/a' || text === 'null' || text === 'undefined' || text === 'none' || text === '-'
}

const asStr = (value: unknown): string => normalizeText(value)

const missingLabel = (value: unknown, placeholder = '—'): string => (
  isMissingValue(value) ? placeholder : normalizeText(value)
)

const fmtCurrency = (value: unknown): string | null => {
  const raw = String(value ?? '').replace(/[,$\s]/g, '')
  const num = Number(raw)
  if (!Number.isFinite(num) || num === 0) return null
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `$${Math.round(num / 1_000)}K`
  return `$${Math.round(num).toLocaleString()}`
}

const fmtScore = (value: unknown): string | null => {
  const raw = String(value ?? '').replace(/[^0-9.]/g, '')
  const num = Number(raw)
  if (!Number.isFinite(num)) return null
  return `${Math.round(num)}/100`
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

// ── Workflow Control Card (unchanged) ─────────────────────────────────────

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
  const DEV = Boolean(import.meta.env.DEV)

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
        <b>{missingLabel(value)}</b>
      </div>
    </div>
  )
}

// ── Hero Value Row ────────────────────────────────────────────────────────

const HeroValueRow = ({ label, value, accent }: { label: string; value: string; accent?: 'green' | 'red' | 'amber' | 'blue' }) => (
  <div className={cls('nx-hero-row', accent && `is-${accent}`)}>
    <small>{label}</small>
    <b>{value}</b>
  </div>
)

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

// ── Property Snapshot Section ─────────────────────────────────────────────

const PropertySnapshotSection = ({ thread }: { thread: InboxWorkflowThread }) => {
  const beds = get(thread, 'beds') || get(thread, 'bedrooms')
  const baths = get(thread, 'baths') || get(thread, 'bathrooms')
  const sqft = get(thread, 'sqft') || get(thread, 'livingAreaSqft')
  const yearBuilt = get(thread, 'yearBuilt') || get(thread, 'year_built')
  const lotSize = get(thread, 'lotSize') || get(thread, 'lot_size_sqft') || get(thread, 'lotSizeSqft') || get(thread, 'lotSizeAcres')
  const propertyType = get(thread, 'propertyType') || get(thread, 'property_type')
  const occupancy = get(thread, 'occupancy')
  const ownerType = get(thread, 'ownerType') || get(thread, 'owner_type')
  const category = detectPropertyCategory(thread)
  const isMulti = category === 'multifamily'

  const toChip = (v: unknown): string | null => {
    if (v === null || v === undefined) return null
    const n = Number(String(v).replace(/[,$\s]/g, ''))
    if (Number.isFinite(n)) return String(n)
    return String(v).trim() || null
  }

  return (
    <section className="nx-intel-card nx-section-card">
      <header className="nx-section-header">
        <Icon name="layers" />
        <span>Property Snapshot</span>
      </header>
      <div className="nx-stat-grid">
        <StatChip label="Beds" value={toChip(beds)} color="blue" />
        <StatChip label="Baths" value={toChip(baths)} color="blue" />
        <StatChip label="Sqft" value={sqft ? `${Number(String(sqft).replace(/,/g, '')).toLocaleString()}` : null} color="blue" />
        <StatChip label="Year Built" value={toChip(yearBuilt)} />
        {Boolean(lotSize) && !isMissingValue(lotSize) && <StatChip label="Lot Size" value={toChip(lotSize)} />}
        {Boolean(propertyType) && !isMissingValue(propertyType) && <StatChip label="Property Type" value={toChip(propertyType)} />}
        {Boolean(occupancy) && !isMissingValue(occupancy) && <StatChip label="Occupancy" value={toChip(occupancy)} />}
        {Boolean(ownerType) && !isMissingValue(ownerType) && <StatChip label="Owner Type" value={toChip(ownerType)} />}
        {isMulti && (
          <>
            <StatChip label="Units" value={toChip(get(thread, 'unitCount') || get(thread, 'unit_count') || get(thread, 'units'))} color="purple" />
            <StatChip label="Rent Roll" value="Needs rent roll" color="amber" />
            <StatChip label="NOI" value="Needs occupancy" color="amber" />
            <StatChip label="Cap Rate" value="Needs NOI" color="amber" />
          </>
        )}
      </div>
    </section>
  )
}

// ── Deal Intelligence Section ─────────────────────────────────────────────

const DealIntelligenceSection = ({ thread }: { thread: InboxWorkflowThread }) => {
  const estimatedValue = get(thread, 'estimatedValue') || get(thread, 'estimated_value') || get(thread, 'zestimate')
  const repairCost = get(thread, 'estimatedRepairCost') || get(thread, 'estimated_repair_cost') || get(thread, 'estimatedRepairs')
  const finalScore = thread.finalAcquisitionScore || get(thread, 'finalScore') || get(thread, 'final_acquisition_score')
  const equity = get(thread, 'equityAmount') || get(thread, 'equity_amount') || get(thread, 'equity')
  const motivationScore = get(thread, 'motivationScore') || get(thread, 'motivation_score')
  const riskLevel = get(thread, 'riskLevel') || get(thread, 'risk_level')
  const sentiment = thread.sentiment

  return (
    <CollapsibleIntelCard title="Deal Intelligence" icon="trending-up" accent="green">
      <div className="nx-hero-values">
        <HeroValueRow 
          label="Estimated Value" 
          value={fmtCurrency(estimatedValue) || 'Needs valuation'} 
          accent="blue"
        />
        <HeroValueRow 
          label="Repair Estimate" 
          value={fmtCurrency(repairCost) || 'Needs inspection'} 
        />
        <HeroValueRow 
          label="Final Score" 
          value={fmtScore(finalScore) || 'Not scored'} 
          accent={finalScore && Number(String(finalScore).replace(/[^0-9.]/g, '')) >= 70 ? 'green' : 'amber'}
        />
        {Boolean(equity) && !isMissingValue(equity) && (
          <HeroValueRow 
            label="Equity" 
            value={fmtCurrency(equity) || asStr(equity)} 
            accent="green"
          />
        )}
        {Boolean(motivationScore) && !isMissingValue(motivationScore) && (
          <HeroValueRow 
            label="Motivation Score" 
            value={fmtScore(motivationScore) || asStr(motivationScore)} 
          />
        )}
        {Boolean(riskLevel) && !isMissingValue(riskLevel) && (
          <HeroValueRow 
            label="Risk Level" 
            value={asStr(riskLevel)} 
            accent={asStr(riskLevel).toLowerCase().includes('high') ? 'red' : 'amber'}
          />
        )}
        {sentiment && !isMissingValue(sentiment) && (
          <HeroValueRow 
            label="Sentiment" 
            value={asStr(sentiment)} 
          />
        )}
      </div>
    </CollapsibleIntelCard>
  )
}

// ── Offer Intelligence Section ────────────────────────────────────────────

const OfferIntelligenceSection = ({ thread }: { thread: InboxWorkflowThread }) => {
  const cashOffer = get(thread, 'cashOffer') || get(thread, 'cash_offer') || get(thread, 'mao')
  const arv = get(thread, 'arv') || get(thread, 'afterRepairValue')
  const aiOffer = get(thread, 'aiRecommendedOffer') || get(thread, 'ai_offer') || get(thread, 'ai_recommended_opening_offer')
  const targetContract = get(thread, 'targetContract') || get(thread, 'target_contract')
  const walkaway = get(thread, 'walkawayPrice') || get(thread, 'walkaway_price') || get(thread, 'walkaway')
  const offerConfidence = get(thread, 'offerConfidence') || get(thread, 'offer_confidence') || get(thread, 'confidenceBand')
  const nextRequired = get(thread, 'nextRequiredInfo') || get(thread, 'next_required_info')

  const category = detectPropertyCategory(thread)
  const isMulti = category === 'multifamily'
  const rentRoll = get(thread, 'rentRoll') || get(thread, 'rent_roll')

  let aiOfferDisplay = 'Needs Underwriting'
  if (aiOffer && !isMissingValue(aiOffer)) {
    aiOfferDisplay = fmtCurrency(aiOffer) || normalizeText(aiOffer)
  } else if (isMulti && (!rentRoll || isMissingValue(rentRoll))) {
    aiOfferDisplay = 'Needs rent roll'
  } else if (!arv || isMissingValue(arv)) {
    aiOfferDisplay = 'Needs ARV'
  } else if (!cashOffer || isMissingValue(cashOffer)) {
    aiOfferDisplay = 'Needs condition'
  }

  let nextRequiredDisplay = 'Awaiting underwriting'
  if (nextRequired && !isMissingValue(nextRequired)) {
    nextRequiredDisplay = asStr(nextRequired)
  } else if (isMulti && (!rentRoll || isMissingValue(rentRoll))) {
    nextRequiredDisplay = 'Need rent roll / occupancy'
  } else if (!arv || isMissingValue(arv)) {
    nextRequiredDisplay = 'Need ARV verification'
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

// ── Seller / Contact Intelligence Section ─────────────────────────────────

const SellerContactSection = ({ thread }: { thread: InboxWorkflowThread }) => {
  const ownerName = thread.ownerDisplayName || thread.ownerName || normalizeText(get(thread, 'owner_display_name'))
  const phone = thread.phoneNumber || thread.canonicalE164 || normalizeText(get(thread, 'seller_phone'))
  const phoneType = get(thread, 'phoneType') || get(thread, 'phone_type')
  const phoneConfidence = get(thread, 'phoneConfidence') || get(thread, 'phone_confidence')
  const language = get(thread, 'contactLanguage') || get(thread, 'language') || get(thread, 'seller_language')
  const lastIntent = thread.uiIntent || normalizeText(get(thread, 'lastIntent')) || normalizeText(get(thread, 'last_intent'))
  const sellerPersona = get(thread, 'sellerPersona') || get(thread, 'seller_persona')
  const ownerType = get(thread, 'ownerType') || get(thread, 'owner_type')

  const initials = ownerName ? ownerName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() : '?'

  return (
    <CollapsibleIntelCard title="Seller / Contact" icon="user" accent="blue">
      <div className="nx-contact-card">
        <div className="nx-contact-avatar">
          {initials}
        </div>
        <div className="nx-contact-info">
          <strong>{ownerName || 'Unknown Seller'}</strong>
          {Boolean(ownerType) && !isMissingValue(ownerType) && <span className="nx-contact-type">{asStr(ownerType)}</span>}
        </div>
      </div>
      <div className="nx-contact-details">
        {Boolean(phone) && <div className="nx-contact-row"><small>Best Phone</small><b>{phone}</b></div>}
        {Boolean(phoneType) && !isMissingValue(phoneType) && <div className="nx-contact-row"><small>Phone Type</small><b>{asStr(phoneType)}</b></div>}
        {Boolean(phoneConfidence) && !isMissingValue(phoneConfidence) && <div className="nx-contact-row"><small>Contact Confidence</small><b>{asStr(phoneConfidence)}</b></div>}
        {Boolean(language) && !isMissingValue(language) && <div className="nx-contact-row"><small>Language</small><b>{asStr(language)}</b></div>}
        {Boolean(lastIntent) && !isMissingValue(lastIntent) && <div className="nx-contact-row"><small>Last Intent</small><b>{asStr(lastIntent)}</b></div>}
        {Boolean(sellerPersona) && !isMissingValue(sellerPersona) && <div className="nx-contact-row"><small>Seller Persona</small><b>{asStr(sellerPersona)}</b></div>}
        <div className="nx-contact-row"><small>Last Contact</small><b>{formatRelativeTime(thread.lastOutboundAt || thread.lastMessageAt)}</b></div>
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

  const timelineItems = [
    { label: 'First Touch Sent', time: firstTouchAt, done: Boolean(firstTouchAt), icon: 'send' },
    { label: 'Seller Replied', time: sellerRepliedAt, done: Boolean(sellerRepliedAt), icon: 'message' },
    { label: 'Current Stage', time: '', done: true, active: true, icon: 'layers', label_extra: stageVisual.label },
    { label: 'Automation', time: '', done: true, icon: 'bolt', label_extra: autoVisual.label },
    { label: 'Queue Status', time: '', done: Boolean(queueStatus), icon: 'clock', label_extra: asStr(queueStatus) || 'Healthy' },
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
    </CollapsibleIntelCard>
  )
}

// ── Next Best Action Section ──────────────────────────────────────────────

const NextBestActionSection = ({ thread, isSuppressed }: { thread: InboxWorkflowThread; isSuppressed: boolean }) => {
  const nextAction = thread.nextSystemAction || 'Review thread and determine next step'
  const aiDraft = thread.aiDraft

  return (
    <section className="nx-intel-card nx-next-best-card">
      <header className="nx-section-header">
        <Icon name="spark" />
        <span>Next Best Action</span>
      </header>
      <p className="nx-next-best__text">{nextAction}</p>
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
        <PropertySnapshotSection thread={thread} />
        <DealIntelligenceSection thread={thread} />
        <OfferIntelligenceSection thread={thread} />
        <SellerContactSection thread={thread} />
        <AutomationTimelineSection thread={thread} />
        <NextBestActionSection thread={thread} isSuppressed={isSuppressed} />

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
