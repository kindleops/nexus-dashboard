import React, { useMemo, useState, useEffect } from 'react'
import type { ThreadIntelligenceRecord, ThreadMessage, ThreadContext } from '../../../lib/data/inboxData'
import type { InboxStatus, SellerStage, InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import type { PanelMode } from '../inbox-layout-state'
import {
  normalizePropertySnapshot,
  buildPropertyExternalLinks,
  buildAerialViewUrl,
} from '../inbox-normalization'
import { Icon, type IconName } from '../../../shared/icons'
import { 
  formatCurrency, 
  formatPercent, 
  formatScore, 
  formatDate, 
  formatPhone, 
  formatInteger, 
  formatBoolean, 
  formatRelativeTime 
} from '../../../shared/formatters'

import {
  automationStateVisuals,
  getSellerStageVisual,
  getStatusVisual,
  inboxStatusOptions,
  sellerStageOptions,
  statusStyleVars,
} from '../status-visuals'
import { CopilotOrbTrigger } from '../../copilot/components/CopilotOrbTrigger'

const cls = (...tokens: Array<string | false | null | undefined>) => tokens.filter(Boolean).join(' ')

import { detectPropertyCategory } from '../helpers/propertyHelpers'

const formatMoney = formatCurrency
const fmtPhone = formatPhone
const standardFormatDisplayValue = (v: any) => String(v ?? 'Not enriched')

type WorkflowThread = InboxWorkflowThread & Partial<{
  age: number
  phone_carrier: string
  property_type_majority: string
  sfr_count: number
  mf_count: number
  urgency_count: number
  is_corporate_owner: boolean
  person_flags_json: any
  marital_status: string
  gender: string
  education_model: string
  est_household_income: string
  net_asset_value: string
  occupation: string
  occupation_group: string
  primary_owner_address: string
  mailing_address: string
  sellerFirstName: string
  motivationScore: number
  equityPercent: number
  equityAmount: number
  isTaxDelinquent: boolean
  isAbsentee: boolean
  isOwnerOccupied: boolean
  isVacant: boolean
  hasLien: boolean
  cashOffer: number | string
  estimatedValue: number | null
  estimatedRepairCost: number
  arv: number
  mao: number
  ai_recommended_opening_offer: number
  ai_offer: number
  walkaway_price: number
  walkaway_internal: number
  offer_confidence: string
  confidenceBand: string
  nextRequiredInfo: string
  assd_total_value: number
  sale_price: number
  portfolio_total_value: number
  portfolio_total_equity: number
  portfolio_total_loan_balance: number
  portfolio_total_loan_payment: number
  tax_amt: number
  past_due_amount: number
  total_loan_balance: number
  total_loan_payment: number
  detected_intent: string
  displayName: string
  contactLanguage: string
  updatedAt: string
  prospect_full_name: string
  language_preference: string
  owner_priority_score: number
  owner_priority_tier: string
  tax_delinquent_count: number
  active_lien_count: number
  oldest_tax_delinquent_year: number
  property_tax_delinquent: boolean
  firstTouchAt?: string
  first_touch_at?: string
  follow_up_at?: string
  property_active_lien: boolean
  portfolio_total_units: number
  property_count: number
  agent_persona: string
  agent_family: string
  displayMarket: string
  displayPhone: string
  prospect_best_phone: string
  prospect_best_email: string
  prospect_phone_score: number
  prospect_contact_score: number
  best_email_1: string
  best_language: string
  contactability_score: number
  financial_pressure_score: number
  urgency_score: number
  follow_up_cadence: string
  offerId: string
  underwritingId: string
  contractId: string
  titleId: string
  latitude: number
  longitude: number
  style: string
  sum_buildings_nbr: number
  avg_sqft_per_unit: number
  beds_per_unit: number
  sqft_range: string
  construction_type: string
  exterior_walls: string
  floor_cover: string
  basement: string
  other_rooms: string
  num_of_fireplaces: number
  patio: string
  porch: string
  deck: string
  driveway: string
  garage: string
  sum_garage_sqft: number
  air_conditioning: string
  heating_type: string
  heating_fuel_type: string
  interior_walls: string
  roof_cover: string
  roof_type: string
  pool: string
  property_tax_delinquent_year: number
  lot_acreage: number
  lot_square_feet: number
  sewer: string
  water: string
  zoning: string
  flood_zone: string
  last_sale_doc_type: string
  total_loan_amt: number
  assd_land_value: number
  assd_improvement_value: number
  rehab_level: string
  building_quality: string
  effective_year_built: number
  total_bedrooms: number
  total_baths: number
  building_square_feet: number
  building_condition: string
  property_county_name: string
  streetview_image: string
  satellite_image: string
  lastMessageBody: string
}>

// ── Helper Utilities ──────────────────────────────────────────────────────

const normalizeText = (value: unknown): string => String(value ?? '').trim()

const isPresent = (value: unknown): boolean => {
  if (value === null || value === undefined) return false
  if (typeof value === 'number' && Number.isNaN(value)) return false
  const text = normalizeText(value).toLowerCase()
  return Boolean(text) && 
    text !== 'unknown' && 
    text !== 'n/a' && 
    text !== 'null' && 
    text !== 'undefined' && 
    text !== 'none' && 
    text !== '-' &&
    text !== 'not enriched' &&
    text !== 'nan' &&
    text !== 'no address'
}

const asStr = (value: unknown): string => normalizeText(value)


const getAvailableFields = (group: Record<string, unknown>): string[] =>
  Object.entries(group).filter(([, v]) => isPresent(v)).map(([k]) => k)

const getMissingFields = (group: Record<string, unknown>): Array<{ key: string; label: string }> =>
  Object.entries(group).filter(([, v]) => !isPresent(v)).map(([k]) => ({ key: k, label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }))

const toChip = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const n = Number(String(v).replace(/[,$\s]/g, ''))
  if (Number.isFinite(n)) return String(n)
  return String(v).trim() || null
}

// ── Reusable UI Components ────────────────────────────────────────────────

const DossierCard = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cls('nx-dossier-card', className)} style={{ display: 'block', visibility: 'visible', opacity: 1 }}>{children}</div>
)

export const DossierShell = ({ children }: { children: React.ReactNode }) => (
  <div className="nx-dossier-shell">{children}</div>
)

const QuietBadge = ({
  label,
  tone = 'default',
}: {
  label: string
  tone?: 'default' | 'accent' | 'warning' | 'danger' | 'success'
}) => <span className={cls('nx-quiet-badge', tone !== 'default' && `is-${tone}`)}>{label}</span>

const MetricInline = ({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string | null
  tone?: 'default' | 'accent' | 'warning' | 'danger' | 'success'
}) => {
  if (!isPresent(value)) return null

  return (
    <div className={cls('nx-metric-inline', tone !== 'default' && `is-${tone}`)}>
      <span className="nx-metric-inline__label">{label}</span>
      <strong className="nx-metric-inline__value">{value}</strong>
    </div>
  )
}
const ActionButton = ({
  label,
  icon,
  tone = 'default',
  disabled,
}: {
  label: string
  icon: string
  tone?: 'default' | 'accent' | 'warning' | 'danger'
  disabled?: boolean
}) => (
  <button type="button" className={cls('nx-action-button', tone !== 'default' && `is-${tone}`)} disabled={disabled}>
    <Icon name={icon as any} />
    <span>{label}</span>
  </button>
)

const DossierMetric = ({ 
  label, 
  value, 
  icon,
  accent,
  suffix,
  internal,
  showWhenMissing = false,
}: { 
  label: string; 
  value: string | null; 
  icon: string; 
  accent?: 'blue' | 'green' | 'amber' | 'purple' | 'red' | 'cyan';
  suffix?: string;
  internal?: boolean;
  showWhenMissing?: boolean;
}) => (
  !isPresent(value) && !showWhenMissing ? null : <div className={cls('nx-dossier-metric', !value && 'is-empty', accent && `is-${accent}`, internal && 'is-internal')}>
    <div className="nx-dossier-metric__icon"><Icon name={icon as any} /></div>
    <div className="nx-dossier-metric__content">
      <span className="nx-dossier-metric__label">{label}</span>
      <span className="nx-dossier-metric__value">
        {value || '—'}
        {suffix && value && <span className="nx-dossier-metric__suffix">{suffix}</span>}
      </span>
      {internal && <span className="nx-dossier-metric__internal-tag">INTERNAL</span>}
    </div>
  </div>
)

const DossierTabGroup = ({ 
  tabs, 
  active, 
  onChange, 
}: { 
  tabs: Array<{ id: string; label: string; icon: string; count?: number }>; 
  active: string; 
  onChange: (id: string) => void;
}) => (
  <div className="nx-dossier-tabs">
    {tabs.map((t) => (
      <button
        key={t.id}
        type="button"
        className={cls('nx-dossier-tab', t.id === active && 'is-active')}
        onClick={() => onChange(t.id)}
      >
        <Icon name={t.icon as any} />
        <span>{t.label}</span>
        {t.count !== undefined && t.count > 0 && <span className="nx-dossier-tab__count">{t.count}</span>}
      </button>
    ))}
  </div>
)

const MissingDataDisclosure = ({ fields }: { fields: Array<{ key: string; label: string }> }) => {
  const [open, setOpen] = useState(false)
  if (fields.length === 0) return null
  return (
    <div className="nx-missing-disclosure">
      <button type="button" className="nx-missing-disclosure__trigger" onClick={() => setOpen(!open)}>
        <Icon name="alert" />
        <span>{fields.length} missing {fields.length === 1 ? 'field' : 'fields'}</span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} />
      </button>
      {open && (
        <div className="nx-missing-disclosure__list">
          {fields.map((f) => (
            <span key={f.key} className="nx-missing-disclosure__item">{f.label}</span>
          ))}
        </div>
      )}
    </div>
  )
}

const LinkedRecordButton = ({ 
  label, 
  url, 
  icon,
  variant = 'default',
}: { 
  label: string; 
  url?: string | null; 
  icon: string;
  variant?: 'default' | 'primary' | 'internal';
}) => {
  if (!url) return null
  const isExternal = url.startsWith('http') || url.startsWith('https')
  return (
    <a
      href={url}
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer' : undefined}
      className={cls('nx-dossier-link', variant !== 'default' && `is-${variant}`)}
    >
      <Icon name={icon as any} />
      <span>{label}</span>
    </a>
  )
}

const StatusPill = ({ label, color }: { label: string; color: string }) => (
  <span className="nx-dossier-status-pill" style={{ background: `${color}22`, color, borderColor: `${color}44` }}>
    <i className="nx-dossier-status-pill__dot" style={{ background: color }} />
    {label}
  </span>
)

const IntelField = ({ label, value, render }: { label: string; value: unknown; render?: React.ReactNode }) => (
  <div className="nx-intel-field">
    <span>{label}</span>
    <strong>{render ? render : isPresent(value) ? asStr(value) : 'Not enriched'}</strong>
  </div>
)

const SectionEmptyState = ({ text }: { text: string }) => (
  <div className="nx-section-empty">
    <Icon name="alert" />
    <p>{text}</p>
  </div>
)

// ── Next Best Action Logic ────────────────────────────────────────────────

interface NextActionResult {
  title: string
  reason: string
  suggestedReply?: string
  urgency: 'high' | 'medium' | 'low'
}

const getNextBestAction = (thread: WorkflowThread): NextActionResult => {
  const stage = thread.conversationStage
  const inboxStatus = thread.inboxStatus
  const hasArv = isPresent(thread.estimatedValue)
  const hasCondition = isPresent(thread.estimatedRepairCost)
  const lastReplyPreview = thread.latestMessageBody || thread.lastMessageBody || ''
  const sellerFirstName = thread.ownerDisplayName?.split(' ')[0] || 'there'
  const motivationScore = Number(thread.motivationScore || thread.priorityScore || 0)
  const equityPercent = Number(thread.equityPercent || 0)

  if (inboxStatus === 'waiting' || inboxStatus === 'queued') {
    return { title: 'Waiting on seller response', reason: 'Next follow-up will schedule when eligible.', urgency: 'low' }
  }

  if (inboxStatus === 'new_reply') {
    const intent = thread.uiIntent || ''
    if (intent === 'info_request' || intent === 'language_switch') {
      return { title: 'Review seller question', reason: 'Seller is asking for information. Respond promptly.', suggestedReply: `Hi ${sellerFirstName}, thanks for reaching out. I can help with that...`, urgency: 'high' }
    }
    if (intent === 'potential_interest' || intent === 'price_anchor') {
      return { title: 'Seller showing interest', reason: motivationScore >= 70 ? 'High motivation detected — move to offer discussion.' : 'Continue discovery.', suggestedReply: equityPercent >= 50 ? `Hi ${sellerFirstName}, based on the property's equity position, we may be able to present a competitive offer...` : undefined, urgency: 'high' }
    }
    return { title: 'Review new seller reply', reason: 'Classify intent and advance workflow.', suggestedReply: lastReplyPreview ? `Last message: "${lastReplyPreview.slice(0, 80)}..."` : undefined, urgency: 'high' }
  }

  if (inboxStatus === 'ai_draft_ready') {
    return { title: 'Review AI draft reply', reason: 'AI has prepared a response. Review and approve before sending.', suggestedReply: thread.aiDraft ? `Draft: "${thread.aiDraft.slice(0, 100)}${thread.aiDraft.length > 100 ? '...' : ''}"` : undefined, urgency: 'high' }
  }

  if (!hasArv && (stage === 'price_discovery' || stage === 'offer_reveal' || stage === 'negotiation')) {
    return { title: 'Verify ARV before revealing offer', reason: 'Cannot generate confident offer without ARV verification.', suggestedReply: `Hi ${sellerFirstName}, to give you the most accurate offer, I need to verify some property details...`, urgency: 'high' }
  }

  if (!hasCondition && (stage === 'condition_details' || stage === 'offer_reveal')) {
    return { title: 'Gather property condition details', reason: 'Repair estimate needed before offer.', suggestedReply: `Hi ${sellerFirstName}, can you describe the current condition of the property?`, urgency: 'medium' }
  }

  if (thread.isSuppressed) return { title: 'Thread suppressed', reason: 'No further action required.', urgency: 'low' }

  if (stage === 'ownership_check') return { title: 'Confirm ownership', reason: 'Verify seller is the legal owner.', suggestedReply: `Hi ${sellerFirstName}, can you confirm you're the owner?`, urgency: 'medium' }
  if (stage === 'interest_probe') return { title: 'Probe seller motivation', reason: 'Understand why they are considering selling.', suggestedReply: `Hi ${sellerFirstName}, what is motivating you to consider selling?`, urgency: 'medium' }
  if (stage === 'seller_response') return { title: 'Awaiting seller response', reason: 'Next follow-up pending.', urgency: 'low' }
  if (stage === 'negotiation') return { title: 'Active negotiation', reason: 'Review counter-offers and evaluate terms.', suggestedReply: equityPercent >= 60 ? `Hi ${sellerFirstName}, given the equity position, I think we can find common ground...` : undefined, urgency: 'high' }
  if (stage === 'contract_path') return { title: 'Move toward contract', reason: 'Terms aligned. Prepare contract.', suggestedReply: `Hi ${sellerFirstName}, I'd like to move forward with getting the property under contract...`, urgency: 'high' }

  return { title: thread.nextSystemAction || 'Review thread', reason: 'No specific action detected. Evaluate manually.', urgency: 'medium' }
}

// ── 1. Deal Command Header ────────────────────────────────────────────────

export const DealCommandHeader = ({ thread }: { thread: WorkflowThread }) => {
  const stageVisual = getSellerStageVisual(thread.conversationStage)
  const statusVisual = getStatusVisual(thread.inboxStatus)
  const finalScore = thread.finalAcquisitionScore || (thread as any).ai_score || thread.motivationScore
  const lastReply = thread.latestMessageBody || thread.lastMessageBody
  const lastContact = thread.lastOutboundAt || thread.lastMessageAt
  const sellerName = thread.displayName || 'Seller Unknown'
  const address = thread.displayAddress || 'Property Unknown'
  const market = thread.displayMarket || 'Market Unknown'
  const ownerType = asStr(thread.ownerType || thread.owner_type_guess)
  const priorityScore = formatScore(finalScore)

  return (
    <div className="nx-dossier-header">
      <div className="nx-dossier-header__executive">
        <div className="nx-dossier-header__identity">
          <div className="nx-dossier-header__avatar">
            {sellerName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div className="nx-dossier-header__info">
            <div className="nx-dossier-header__identity-row">
              <strong className="nx-dossier-header__name">{sellerName}</strong>
              {isPresent(ownerType) && <QuietBadge label={ownerType} />}
            </div>
            <span className="nx-dossier-header__address">{address}</span>
            <span className="nx-dossier-header__market">{market}</span>
          </div>
        </div>

        <div className="nx-dossier-header__message">
          <span className="nx-dossier-header__message-label">Latest seller signal</span>
          <div className="nx-dossier-header__preview">
            <Icon name="message" />
            <span>{lastReply ? `"${lastReply.slice(0, 180)}${lastReply.length > 180 ? '...' : ''}"` : 'No recent seller reply captured.'}</span>
          </div>
        </div>

        <div className="nx-dossier-header__status-stack">
          <div className="nx-dossier-header__status-row">
            <span className="nx-dossier-header__status-label">Inbox Status</span>
            <StatusPill label={statusVisual.label} color={statusVisual.color} />
          </div>
          <div className="nx-dossier-header__status-row">
            <span className="nx-dossier-header__status-label">Seller Stage</span>
            <StatusPill label={stageVisual.label} color={stageVisual.color} />
          </div>
          <div className="nx-dossier-header__status-row">
            <span className="nx-dossier-header__status-label">Priority Score</span>
            <span className="nx-dossier-score">{priorityScore || 'Unscored'}</span>
          </div>
          <div className="nx-dossier-header__status-row">
            <span className="nx-dossier-header__status-label">Last Contact</span>
            <span className="nx-dossier-header__status-value">{lastContact ? formatRelativeTime(lastContact) : 'No contact'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 2. Workflow Control ───────────────────────────────────────────────────

export const WorkflowControl = ({
  thread,
  onStatusChange,
  onStageChange,
}: {
  thread: WorkflowThread
  onStatusChange: (status: InboxStatus | 'sent_message') => void
  onStageChange: (stage: SellerStage) => void
}) => {
  const [statusOpen, setStatusOpen] = useState(false)
  const [stageOpen, setStageOpen] = useState(false)
  const statusVisual = getStatusVisual(thread.inboxStatus)
  const stageVisual = getSellerStageVisual(thread.conversationStage)
  const autoVisual = automationStateVisuals[thread.automationState || 'manual']

  const handleStatusChange = (status: InboxStatus) => { onStatusChange(status); setStatusOpen(false) }
  const handleStageChange = (stage: SellerStage) => { onStageChange(stage); setStageOpen(false) }

  return (
    <DossierCard className="nx-workflow-control">
      <div className="nx-workflow-control__row">
        <span className="nx-workflow-control__label">Status</span>
        <div className="nx-workflow-control__dropdown">
          <button type="button" className="nx-workflow-btn" style={statusStyleVars(statusVisual)} onClick={() => setStatusOpen(!statusOpen)}>
            <i className="nx-workflow-dot" style={{ background: statusVisual.color }} />
            {statusVisual.label}
            <Icon name="chevron-down" />
          </button>
          {statusOpen && (
            <div className="nx-workflow-menu nx-liquid-panel">
              {inboxStatusOptions.map((opt) => (
                <button key={opt.value} type="button" className={cls('nx-workflow-menu-item', opt.value === thread.inboxStatus && 'is-selected')} style={statusStyleVars(opt)} onClick={() => handleStatusChange(opt.value as InboxStatus)}>
                  <i className="nx-workflow-dot" style={{ background: opt.color }} />
                  <div><strong>{opt.label}</strong><small>{opt.description}</small></div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="nx-workflow-control__row">
        <span className="nx-workflow-control__label">Stage</span>
        <div className="nx-workflow-control__dropdown">
          <button type="button" className="nx-workflow-btn" style={statusStyleVars(stageVisual)} onClick={() => setStageOpen(!stageOpen)}>
            <i className="nx-workflow-dot" style={{ background: stageVisual.color }} />
            {stageVisual.label}
            <Icon name="chevron-down" />
          </button>
          {stageOpen && (
            <div className="nx-workflow-menu nx-liquid-panel">
              {sellerStageOptions.map((opt) => (
                <button key={opt.value} type="button" className={cls('nx-workflow-menu-item', opt.value === thread.conversationStage && 'is-selected')} style={statusStyleVars(opt)} onClick={() => handleStageChange(opt.value as SellerStage)}>
                  <i className="nx-workflow-dot" style={{ background: opt.color }} />
                  <div><strong>{opt.label}</strong><small>{opt.description}</small></div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="nx-workflow-control__row">
        <span className="nx-workflow-control__label">Automation</span>
        <span className="nx-workflow-pill" style={{ '--wp-color': autoVisual?.color || '#a0aec0' } as any}>{autoVisual?.label || 'Manual'}</span>
      </div>
      {thread.queueStatus && (
        <div className="nx-workflow-control__row">
          <span className="nx-workflow-control__label">Queue</span>
          <span className="nx-workflow-pill">{asStr(thread.queueStatus)}</span>
        </div>
      )}
      {thread.nextSystemAction && (
        <div className="nx-workflow-control__row nx-workflow-next">
          <Icon name="spark" />
          <span>{thread.nextSystemAction}</span>
        </div>
      )}
    </DossierCard>
  )
}

// ── 3. Property Hero Card ─────────────────────────────────────────────────

const PremiumPropertySnapshotCard = ({ thread }: { thread: WorkflowThread; intelligence: ThreadIntelligenceRecord | null }) => {
  const address = thread.displayAddress || 'Property Unknown'
  const streetViewUrl = thread.streetview_image
  const aerialViewUrl = thread.satellite_image || buildAerialViewUrl(address)
  const [streetFailed, setStreetFailed] = useState(false)
  const [aerialFailed, setAerialFailed] = useState(false)
  const links = buildPropertyExternalLinks(address)
  const market = thread.displayMarket || 'Unknown Market'
  const propertyType = normalizeText(thread.propertyType || 'Residential')
  const estimatedValue = formatMoney(Number(thread.estimatedValue || 0))
  const equityPct = formatPercent(Number(thread.equityPercent || 0))
  const repairCost = formatMoney(Number(thread.estimatedRepairCost || 0))

  return (
    <div className="nx-dossier-card nx-property-snapshot-card">
      <div className="nx-property-snapshot__media">
        <div className="nx-property-snapshot__pane">
          {streetViewUrl && !streetFailed ? (
            <img src={streetViewUrl} alt="Street View" onError={() => setStreetFailed(true)} />
          ) : (
            <div className="nx-property-hero__fallback">
              <Icon name="map" />
              <span>Street View</span>
              <strong>{address}</strong>
            </div>
          )}
          <span className="nx-property-snapshot__eyebrow">Street</span>
        </div>
        <div className="nx-property-snapshot__pane">
          {aerialViewUrl && !aerialFailed ? (
            <img src={aerialViewUrl} alt="Aerial View" onError={() => setAerialFailed(true)} />
          ) : (
            <div className="nx-property-hero__fallback">
            <Icon name="map" />
              <span>Aerial</span>
            <strong>{address}</strong>
          </div>
          )}
          <span className="nx-property-snapshot__eyebrow">Aerial</span>
        </div>
        
        <div className="nx-property-snapshot__hover-actions">
          <div className="nx-property-hero__hover-grid">
            <LinkedRecordButton label="Zillow" url={links.zillow} icon="globe" />
            <LinkedRecordButton label="Realtor" url={links.realtor} icon="globe" />
            <LinkedRecordButton label="Google Search" url={links.googleSearch} icon="search" />
            <LinkedRecordButton label="Maps" url={links.streetView} icon="map" />
          </div>
        </div>
      </div>
      
      <div className="nx-property-snapshot__metadata">
        <div className="nx-property-snapshot__identity-row">
          <div className="nx-property-snapshot__identity">
            <strong>{address}</strong>
            <span>{market} • {propertyType}</span>
          </div>
        </div>
        
        <div className="nx-property-snapshot__metrics">
          {isPresent(thread.total_bedrooms || thread.beds) && <QuietBadge label={`${thread.total_bedrooms || thread.beds} Bed${(thread.total_bedrooms || thread.beds) !== 1 ? 's' : ''}`} />}
          {isPresent(thread.total_baths || thread.baths) && <QuietBadge label={`${thread.total_baths || thread.baths} Bath${(thread.total_baths || thread.baths) !== 1 ? 's' : ''}`} />}
          {isPresent(thread.building_square_feet || thread.sqft) && <QuietBadge label={`${formatInteger(Number(thread.building_square_feet || thread.sqft))} sqft`} />}
          {isPresent(thread.year_built || (thread as any).yearBuilt) && <QuietBadge label={`Built ${thread.year_built || (thread as any).yearBuilt}`} />}
          {isPresent(estimatedValue) && <QuietBadge label={estimatedValue || ''} tone="accent" />}
          {isPresent(equityPct) && <QuietBadge label={`${equityPct} equity`} />}
          {isPresent(repairCost) && <QuietBadge label={`${repairCost} repairs`} tone="warning" />}
        </div>
      </div>
    </div>
  )
}

// ── 4. Next Best Action ───────────────────────────────────────────────────

export const AIActionCard = ({ thread, isSuppressed }: { thread: WorkflowThread; isSuppressed: boolean }) => {
  const action = getNextBestAction(thread)
  const [showReason, setShowReason] = useState(false)
  const lastReply = thread.latestMessageBody || thread.lastMessageBody

  return (
    <DossierCard className={cls('nx-next-action', `is-${action.urgency}`, 'nx-ai-action-card')}>
      <div className="nx-next-action__header">
        <Icon name="spark" />
        <span>AI Recommended Action</span>
        <QuietBadge
          label={action.urgency === 'high' ? 'Needs operator' : action.urgency === 'medium' ? 'Recommended' : 'Monitor'}
          tone={action.urgency === 'high' ? 'warning' : action.urgency === 'medium' ? 'accent' : 'default'}
        />
      </div>
      <div className="nx-next-action__body">
        <p className="nx-next-action__title">{action.title}</p>
        <p className="nx-next-action__reason">{action.reason}</p>
        {lastReply && <div className="nx-next-action__signal">Latest reply: {lastReply.slice(0, 140)}{lastReply.length > 140 ? '...' : ''}</div>}
        <button type="button" className="nx-next-action__why" onClick={() => setShowReason(!showReason)}>
          <Icon name={showReason ? 'chevron-down' : 'chevron-right'} />
          Why this action?
        </button>
        {showReason && (
          <div className="nx-next-action__explanation">
            <p>Based on: Stage = {thread.conversationStage}, Status = {thread.inboxStatus}
              {thread.motivationScore && `, Motivation = ${Math.round(Number(thread.motivationScore))}/100`}
              {thread.equityPercent && `, Equity = ${formatPercent(Number(thread.equityPercent || 0))}`}
            </p>
          </div>
        )}
      </div>
      {(thread.aiDraft || action.suggestedReply) && !isSuppressed && (
        <div className="nx-next-action__draft">
          <small>Suggested reply preview</small>
          <p>{thread.aiDraft || action.suggestedReply}</p>
        </div>
      )}
      <div className="nx-next-action__actions">
        <ActionButton label="Queue Reply" icon="clock" tone="accent" disabled={isSuppressed} />
        <ActionButton label="Edit" icon="file-text" />
        <ActionButton label="Review" icon="alert" tone="warning" />
        <ActionButton label="Suppress" icon="shield" tone="danger" disabled={isSuppressed} />
      </div>
    </DossierCard>
  )
}

// ── 5. Offer Intelligence ─────────────────────────────────────────────────

const PremiumOfferMemoCard = ({ thread }: { thread: WorkflowThread }) => {
  const hasArv = isPresent(thread.estimatedValue)
  const hasCondition = isPresent(thread.estimatedRepairCost)

  const cashOffer = thread.cashOffer || thread.mao
  const aiOffer = thread.ai_recommended_opening_offer || thread.ai_offer
  const walkaway = thread.walkaway_price || thread.walkaway_internal
  const offerConfidence = thread.offer_confidence || thread.confidenceBand
  const nextRequired = thread.nextRequiredInfo

  const offerStatus = useMemo(() => {
    if (thread.isSuppressed || (thread as any).isOptOut) return { label: 'Blocked', color: '#ff453a' }
    if (aiOffer && isPresent(aiOffer)) return { label: 'Ready', color: '#30d158' }
    if (!hasArv) return { label: 'Needs ARV', color: '#ff453a' }
    if (!hasCondition) return { label: 'Needs Repairs', color: '#ffd60a' }
    return { label: 'Ready', color: '#30d158' }
  }, [aiOffer, hasArv, hasCondition, thread.isSuppressed])

  let aiOfferDisplay: string
  if (aiOffer && isPresent(aiOffer)) {
    aiOfferDisplay = formatMoney(Number(aiOffer)) || normalizeText(aiOffer)
  } else if (!hasArv) {
    aiOfferDisplay = 'Needs ARV'
  } else if (!hasCondition) {
    aiOfferDisplay = 'Needs condition'
  } else {
    aiOfferDisplay = 'Needs underwriting'
  }

  const hasAnyOfferField = [cashOffer, aiOffer, walkaway].some((v) => isPresent(v))

  return (
    <DossierCard className="nx-force-card nx-offer-card nx-offer-memo-card">
      <div className="nx-dossier-section__title" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="zap" />
          Offer Intelligence
        </span>
        <QuietBadge
          label={offerStatus.label}
          tone={offerStatus.label === 'Ready' ? 'success' : offerStatus.label === 'Blocked' ? 'danger' : 'warning'}
        />
      </div>
      <div className="nx-offer-memo-card__body">
        <div className="nx-offer-memo-card__group">
          <MetricInline label="Legacy cash offer" value={formatMoney(Number(cashOffer || 0))} tone="accent" />
          <MetricInline label="AI recommended opening" value={aiOfferDisplay} tone="accent" />
          <MetricInline label="MAO" value={formatMoney(Number(thread.mao || 0))} />
          <MetricInline label="Walkaway internal" value={formatMoney(Number(walkaway || 0)) || 'Needs underwriting'} tone="danger" />
        </div>
        <div className="nx-offer-memo-card__group">
          <MetricInline
            label="Missing underwriting info"
            value={isPresent(nextRequired) ? asStr(nextRequired) : !hasArv ? 'ARV verification' : !hasCondition ? 'Condition details' : 'None'}
            tone={!hasAnyOfferField || !hasArv || !hasCondition ? 'warning' : 'default'}
          />
          <MetricInline
            label="Confidence / safe-to-reveal"
            value={isPresent(offerConfidence) ? asStr(offerConfidence) : hasArv && hasCondition ? 'Reasonable to review internally' : 'Hold internal'}
          />
        </div>
      </div>
      {!hasAnyOfferField && <SectionEmptyState text="No offer figures yet. Underwriting inputs needed." />}
    </DossierCard>
  )
}

// ── 6. Property Intelligence Tabs ─────────────────────────────────────────

const PROPERTY_TABS = [
  { id: 'overview', label: 'OVERVIEW', icon: 'layers' },
  { id: 'location', label: 'LOCATION', icon: 'map' },
  { id: 'property', label: 'PROPERTY', icon: 'grid' },
  { id: 'valuation', label: 'EQUITY / VALUATION', icon: 'trending-up' },
  { id: 'tax', label: 'LAND / TAX', icon: 'briefing' },
]

const FieldTile = ({ label, value, tone = 'default' }: { label: string; value: unknown; tone?: 'default' | 'good' | 'warn' | 'bad' | 'accent' }) => {
  if (!isPresent(value)) return null
  return (
    <div className={cls('nx-intel-field', tone !== 'default' && `is-${tone}`)}>
      <span>{label}</span>
      <strong>{asStr(value)}</strong>
    </div>
  )
}

const FieldGrid = ({ children, columns = 2 }: { children: React.ReactNode; columns?: 2 | 3 }) => (
  <div className={cls('nx-intel-field-grid', columns === 3 && 'is-3-col')}>{children}</div>
)

const PanelSection = ({ title, icon = 'grid', children }: { title: string; icon?: IconName; children: React.ReactNode }) => (
  <section className="nx-intel-section">
    <div className="nx-intel-section__title"><Icon name={icon} /><span>{title}</span></div>
    {children}
  </section>
)

const PropertyIntelFields = ({
  thread,
  subTab,
}: {
  thread: WorkflowThread
  subTab: 'overview' | 'location' | 'property' | 'equity' | 'tax'
}) => {
  const address = thread.displayAddress || 'Property Unknown'
  const propertyType = thread.propertyType || 'Residential'
  const market = thread.displayMarket || 'Unknown Market'

  const overviewRows: Array<[string, unknown]> = [
    ['FULL ADDRESS', address],
    ['PROPERTY TYPE', propertyType],
    ['BEDS', thread.total_bedrooms || thread.beds],
    ['BATHS', thread.total_baths || thread.baths],
    ['SQFT', thread.building_square_feet || thread.sqft],
    ['UNITS', thread.units_count],
    ['YEAR BUILT', thread.year_built],
    ['EFFECTIVE YEAR BUILT', thread.effective_year_built],
    ['ESTIMATED VALUE', formatMoney(Number(thread.estimatedValue || 0))],
    ['LAST SALE PRICE', formatMoney(Number(thread.sale_price || 0))],
    ['LAST SALE DATE', formatDate(thread.sale_date)],
    ['EQUITY PERCENT', formatPercent(Number(thread.equityPercent || 0))],
    ['OWNERSHIP YEARS', thread.ownership_years],
    ['CONDITION', thread.building_condition],
    ['FINAL ACQUISITION SCORE', formatScore(thread.finalAcquisitionScore)],
  ]

  const locationRows: Array<[string, unknown]> = [
    ['MARKET', market],
    ['ADDRESS', address],
    ['CITY', thread.property_address_city],
    ['STATE', thread.property_address_state],
    ['ZIP CODE', thread.property_address_zip],
    ['LATITUDE', thread.latitude],
    ['LONGITUDE', thread.longitude],
  ]

  const propertyRows: Array<[string, unknown]> = [
    ['PROPERTY CLASS', thread.property_class],
    ['PROPERTY STYLE', thread.style],
    ['STORIES', thread.stories],
    ['NUMBER OF UNITS', thread.units_count],
    ['NUMBER OF BUILDINGS', thread.sum_buildings_nbr],
    ['AVG SQUARE FEET PER UNIT', thread.avg_sqft_per_unit],
    ['AVG BEDS PER UNIT', thread.beds_per_unit],
    ['SQUARE FOOT RANGE', thread.sqft_range],
    ['CONSTRUCTION TYPE', thread.construction_type],
    ['EXTERIOR WALLS', thread.exterior_walls],
    ['FLOOR COVER', thread.floor_cover],
    ['BASEMENT', thread.basement],
    ['OTHER ROOMS', thread.other_rooms],
    ['NUMBER OF FIREPLACES', thread.num_of_fireplaces],
    ['PATIO', thread.patio],
    ['PORCH', thread.porch],
    ['DECK', thread.deck],
    ['DRIVEWAY', thread.driveway],
    ['GARAGE', thread.garage],
    ['GARAGE SQUARE FEET', thread.sum_garage_sqft],
    ['AC', thread.air_conditioning],
    ['HEATING TYPE', thread.heating_type],
    ['HEATING FUEL TYPE', thread.heating_fuel_type],
    ['INTERIOR WALLS', thread.interior_walls],
    ['ROOF COVER', thread.roof_cover],
    ['ROOF TYPE', thread.roof_type],
    ['POOL', thread.pool],
  ]

  const equityRows: Array<[string, unknown]> = [
    ['LAST SALE DOCUMENT', thread.last_sale_doc_type],
    ['ESTIMATED EQUITY AMOUNT', formatMoney(Number(thread.equityAmount || 0))],
    ['LOAN AMOUNT', formatMoney(Number((thread as any).total_loan_amt || 0))],
    ['LOAN BALANCE', formatMoney(Number(thread.total_loan_balance || 0))],
    ['LOAN PAYMENT', formatMoney(Number(thread.total_loan_payment || 0))],
    ['ASSESSED TOTAL VALUE', formatMoney(Number(thread.assd_total_value || 0))],
    ['ASSESSED LAND VALUE', formatMoney(Number((thread as any).assd_land_value || 0))],
    ['ASSESSED IMPROVEMENT VALUE', formatMoney(Number((thread as any).assd_improvement_value || 0))],
    ['ESTIMATED REPAIR COST', formatMoney(Number(thread.estimatedRepairCost || 0))],
    ['REHAB LEVEL', thread.rehab_level],
    ['BUILDING QUALITY', (thread as any).building_quality],
  ]

  const taxRows: Array<[string, unknown]> = [
    ['TAX DELINQUENT', formatBoolean(thread.property_tax_delinquent)],
    ['TAX DELINQUENT YEAR', thread.property_tax_delinquent_year],
    ['TAX AMOUNT', formatMoney(Number(thread.tax_amt || 0))],
    ['LOT SIZE ACRES', thread.lot_acreage],
    ['LOT SIZE SQUARE FEET', (thread as any).lot_square_feet],
    ['SEWER', (thread as any).sewer],
    ['WATER', (thread as any).water],
    ['ZONING', thread.zoning],
    ['FLOOD ZONE', (thread as any).flood_zone],
  ]

  const rows = subTab === 'overview'
    ? overviewRows
    : subTab === 'location'
      ? locationRows
      : subTab === 'property'
        ? propertyRows
        : subTab === 'equity'
          ? equityRows
          : taxRows

  return <div className="nx-intel-grid">{rows.map(([label, value]) => <IntelField key={label} label={label} value={value} />)}</div>
}

export const PropertyIntelligenceTabs = ({
  thread,
}: {
  thread: WorkflowThread
  intelligence: ThreadIntelligenceRecord | null
}) => {
  const [activeTab, setActiveTab] = useState('overview')
  const address = thread.displayAddress || 'Property Unknown'
  const extLinks = buildPropertyExternalLinks(address)

  const fields = useMemo(() => ({
    unitCount: thread.units_count,
    yearBuilt: thread.year_built,
    effectiveYear: thread.effective_year_built,
    constructionType: thread.construction_type,
    exteriorWalls: thread.exterior_walls,
    floorCover: thread.floor_cover,
    basement: thread.basement,
    hvacType: thread.air_conditioning || thread.heating_type,
    roofCover: thread.roof_cover,
    beds: thread.total_bedrooms || thread.beds,
    baths: thread.total_baths || thread.baths,
    sqft: thread.building_square_feet || thread.sqft,
    stories: thread.stories,
    garage: thread.garage,
    propertyType: thread.propertyType,
    occupancy: thread.building_condition,
    county: thread.property_county_name,
    apn: thread.propertyId,
    zoning: thread.zoning,
    lotSize: thread.lot_acreage,
  }), [thread])

  const availableCount = getAvailableFields(fields).length
  const tabs = PROPERTY_TABS.map((t) => t.id === 'overview' ? { ...t, count: availableCount } : t)

  return (
    <DossierCard className="nx-property-tabs">
      <DossierTabGroup tabs={tabs} active={activeTab} onChange={(id) => setActiveTab(id as any)} />
      <div className="nx-property-tabs__content">
        {activeTab === 'overview' && (
          <>
            <div className="nx-field-group">
              <div className="nx-field-group__title"><Icon name="grid" /><span>Structure</span></div>
              <div className="nx-data-grid">
                <DossierMetric label="Units" value={toChip(fields.unitCount)} icon="grid" accent="blue" />
                <DossierMetric label="Beds" value={toChip(fields.beds)} icon="eye" accent="blue" />
                <DossierMetric label="Baths" value={toChip(fields.baths)} icon="eye" accent="blue" />
                <DossierMetric label="Sq Ft" value={fields.sqft ? Number(String(fields.sqft).replace(/,/g, '')).toLocaleString() : null} icon="maximize" accent="blue" />
                <DossierMetric label="Stories" value={toChip(fields.stories)} icon="layers" />
                <DossierMetric label="Garage" value={toChip(fields.garage)} icon="grid" />
              </div>
            </div>
            <div className="nx-field-group">
              <div className="nx-field-group__title"><Icon name="calendar" /><span>Age & Construction</span></div>
              <div className="nx-data-grid">
                <DossierMetric label="Year Built" value={toChip(fields.yearBuilt)} icon="calendar" accent="cyan" />
                <DossierMetric label="Effective Year" value={toChip(fields.effectiveYear)} icon="calendar" accent="cyan" />
                <DossierMetric label="Construction" value={toChip(fields.constructionType)} icon="layers" />
                <DossierMetric label="Exterior Walls" value={toChip(fields.exteriorWalls)} icon="layers" />
                <DossierMetric label="Basement" value={toChip(fields.basement)} icon="layers" />
              </div>
            </div>
            <div className="nx-field-group">
              <div className="nx-field-group__title"><Icon name="settings" /><span>Systems & Finishes</span></div>
              <div className="nx-data-grid">
                <DossierMetric label="AC / Heating" value={toChip(fields.hvacType)} icon="bolt" accent="amber" />
                <DossierMetric label="Floor Cover" value={toChip(fields.floorCover)} icon="grid" />
                <DossierMetric label="Roof Cover" value={toChip(fields.roofCover)} icon="bolt" accent="amber" />
              </div>
            </div>
            <MissingDataDisclosure fields={getMissingFields(fields)} />
          </>
        )}
        {activeTab === 'valuation' && (
          <>
            <div className="nx-field-group">
              <div className="nx-field-group__title"><Icon name="trending-up" /><span>Valuation</span></div>
              <div className="nx-data-grid">
                <DossierMetric label="Est. Value" value={formatMoney(Number(thread.estimatedValue || 0))} icon="trending-up" accent="green" />
                <DossierMetric label="Assessed Value" value={formatMoney(Number(thread.assd_total_value || 0))} icon="stats" />
                <DossierMetric label="Last Sale Price" value={formatMoney(Number(thread.sale_price || 0))} icon="arrow-up-right" />
                <DossierMetric label="Equity Amount" value={formatMoney(Number(thread.equityAmount || 0))} icon="zap" accent="green" />
                <DossierMetric label="Equity %" value={formatPercent(Number(thread.equityPercent || 0))} icon="activity" accent="green" />
              </div>
            </div>
            <MissingDataDisclosure fields={getMissingFields({
              estimatedValue: thread.estimatedValue,
              assessedValue: thread.assd_total_value,
              lastSalePrice: thread.sale_price,
              equityAmount: thread.equityAmount,
              equityPercent: thread.equityPercent,
            })} />
          </>
        )}
        {activeTab === 'property' && (
          <PropertyIntelFields thread={thread} subTab="property" />
        )}
        {activeTab === 'location' && (
          <PropertyIntelFields thread={thread} subTab="location" />
        )}
        {activeTab === 'tax' && (
          <PropertyIntelFields thread={thread} subTab="tax" />
        )}
        {activeTab === 'links' && (
          <div className="nx-links-grid">
            <LinkedRecordButton label="Zillow" url={extLinks?.zillow} icon="globe" />
            <LinkedRecordButton label="Realtor" url={extLinks?.realtor} icon="globe" />
            <LinkedRecordButton label="Google Maps" url={extLinks?.googleSearch} icon="map" />
            <LinkedRecordButton label="Street View" url={extLinks?.streetView} icon="map" />
          </div>
        )}
      </div>
    </DossierCard>
  )
}

// ── 7. Seller / Owner Intelligence ────────────────────────────────────────

export const SellerOwnerCard = ({ thread }: { thread: WorkflowThread }) => {
  const ownerName = thread.displayName || 'Unknown Seller'
  const phone = formatPhone(thread.phoneNumber || thread.canonicalE164 || thread.displayPhone)
  const phoneConfidence = thread.prospect_phone_score
  const language = thread.contactLanguage || thread.best_language
  const ownerType = thread.ownerType || thread.owner_type_guess
  const mailingLocation = thread.primary_owner_address
  const ownershipYears = thread.ownership_years
  const motivationScore = thread.motivationScore || thread.priorityScore
  const lastIntent = thread.uiIntent || thread.detected_intent
  const lastInbound = thread.lastInboundAt
  const lastOutbound = thread.lastOutboundAt
  const email = thread.prospect_best_email || (thread as any).best_email_1
  const initials = ownerName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
  const hasIdentityData = [phone, phoneConfidence, language, email, mailingLocation, ownershipYears, motivationScore, lastIntent, lastInbound, lastOutbound].some((v) => isPresent(v))

  return (
    <DossierCard className="nx-force-card nx-seller-card nx-seller-owner-card">
      <div className="nx-dossier-section__title" style={{ marginBottom: 10 }}>
        <Icon name="user" />
        <span>Seller / Owner Intelligence</span>
      </div>
      <div className="nx-seller-header">
        <div className="nx-seller-avatar">{initials}</div>
        <div className="nx-seller-info">
          <strong>{ownerName}</strong>
          <div className="nx-seller-chips">
            {isPresent(ownerType) && <QuietBadge label={asStr(ownerType)} />}
            {thread.isAbsentee && <QuietBadge label="Absentee" tone="warning" />}
            {thread.isOwnerOccupied && <QuietBadge label="Owner occupied" tone="success" />}
          </div>
        </div>
      </div>
      <div className="nx-seller-owner-card__meta">
        <MetricInline label="Best phone" value={phone} tone="accent" />
        <MetricInline label="Phone score" value={formatScore(phoneConfidence)} />
        <MetricInline label="Language" value={isPresent(language) ? asStr(language) : null} />
        <MetricInline label="Motivation score" value={formatScore(motivationScore)} tone="warning" />
        <MetricInline label="Last intent" value={isPresent(lastIntent) ? asStr(lastIntent) : null} />
        <MetricInline label="Last inbound" value={lastInbound ? formatRelativeTime(lastInbound) : null} />
        <MetricInline label="Last outbound" value={lastOutbound ? formatRelativeTime(lastOutbound) : null} />
        <MetricInline label="Mailing address" value={isPresent(mailingLocation) ? asStr(mailingLocation) : null} />
        <MetricInline label="Ownership years" value={isPresent(ownershipYears) ? `${toChip(ownershipYears)} yrs` : null} />
      </div>
      {!hasIdentityData && <SectionEmptyState text="Owner contact intelligence has not been enriched yet." />}
    </DossierCard>
  )
}

export const LinkedRecordsCard = ({ thread }: { thread: WorkflowThread }) => {
  const baseUrl = 'https://app.realestateflow.ai'
  const offerId = asStr((thread as any).offerId)
  const underwritingId = asStr((thread as any).underwritingId)
  const contractId = asStr((thread as any).contractId)
  const titleId = asStr((thread as any).titleId)
  const hasAnyLink = Boolean(
    thread.propertyId ||
    thread.ownerId ||
    thread.prospectId ||
    thread.canonicalE164 ||
    offerId ||
    underwritingId ||
    contractId ||
    titleId
  )

  if (!hasAnyLink) return null

  return (
    <DossierCard className="nx-bottom-app-links nx-linked-records-card">
      <div className="nx-bottom-app-links__title">Linked Apps</div>
      <div className="nx-bottom-app-links__grid">
        {thread.propertyId && <LinkedRecordButton label="Property App" url={`${baseUrl}/properties/${thread.propertyId}`} icon="layers" variant="internal" />}
        {thread.ownerId && <LinkedRecordButton label="Owner App" url={`${baseUrl}/owners/${thread.ownerId}`} icon="user" variant="internal" />}
        {thread.prospectId && <LinkedRecordButton label="Prospect App" url={`${baseUrl}/prospects/${thread.prospectId}`} icon="users" variant="internal" />}
        {thread.canonicalE164 && <LinkedRecordButton label="Phone App" url={`${baseUrl}/phones/${encodeURIComponent(thread.canonicalE164)}`} icon="phone" variant="internal" />}
        {offerId && <LinkedRecordButton label="Offer App" url={`${baseUrl}/offers/${offerId}`} icon="zap" variant="internal" />}
        {underwritingId && <LinkedRecordButton label="Underwriting App" url={`${baseUrl}/underwriting/${underwritingId}`} icon="stats" variant="internal" />}
        {contractId && <LinkedRecordButton label="Contract App" url={`${baseUrl}/contracts/${contractId}`} icon="briefing" variant="internal" />}
        {titleId && <LinkedRecordButton label="Title App" url={`${baseUrl}/title/${titleId}`} icon="briefing" variant="internal" />}
      </div>
    </DossierCard>
  )
}

const ActionRailCard = ({
  thread,
  onOpenMap,
  onOpenDossier,
  onOpenAi,
}: {
  thread: WorkflowThread
  onOpenMap: () => void
  onOpenDossier: () => void
  onOpenAi: () => void
}) => (
  <div className="nx-intel-action-rail nx-intel-action-rail--premium">
    <button type="button" className="nx-intel-action-btn" onClick={onOpenMap}><Icon name="map" /> Map</button>
    <button type="button" className="nx-intel-action-btn" onClick={onOpenDossier}><Icon name="briefing" /> Dossier</button>
    <button type="button" className="nx-ai-assist-card" onClick={onOpenAi}>
      <CopilotOrbTrigger size="md" isReady={Boolean(thread.aiDraft)} onClick={onOpenAi} />
      <span>AI ASSIST</span>
    </button>
  </div>
)

const MatchBadge = ({ label, tone }: { label: string; tone: 'green' | 'yellow' | 'red' }) => (
  <span className={cls('nx-match-badge', `is-${tone}`)}>{label}</span>
)

const YesNoBadge = ({ label, yes }: { label: string; yes: boolean }) => (
  <span className={cls('nx-binary-badge', yes ? 'is-yes' : 'is-no')}>{label}: {yes ? 'Yes' : 'No'}</span>
)

const buildMatchBadges = (thread: WorkflowThread, limit = 3) => {
  const tags = String((thread as any).matching_flags || (thread as any).person_flags_text || '')
    .split(/[;,|]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
  const ownerType = normalizeText(thread.ownerType || thread.owner_type_guess).toLowerCase()
  const confidence = Number(thread.prospect_phone_score || thread.prospect_contact_score || 0)
  const out = new Map<string, 'green' | 'yellow' | 'red'>()

  if (confidence >= 80 || thread.ownerId) out.set('Likely Owner', 'green')
  else if (confidence >= 45 || thread.prospectId) out.set('Potential Owner', 'yellow')
  if (ownerType.includes('llc') || ownerType.includes('corpor') || ownerType.includes('company')) out.set('Linked To Company', 'green')
  if (tags.some((tag) => /company|business|entity/i.test(tag))) out.set('Potentially Linked To Company', 'yellow')
  if (tags.some((tag) => /family|relative/i.test(tag))) out.set('Family', 'yellow')
  if (tags.some((tag) => /resident|occupant/i.test(tag))) out.set('Resident', 'yellow')
  if (tags.some((tag) => /renter|tenant/i.test(tag))) out.set('Likely Renting', 'red')
  if (!out.size) out.set('Potential Owner', 'yellow')
  return Array.from(out.entries()).map(([label, tone]) => ({ label, tone })).slice(0, limit)
}

const buildProspectTagBadges = (thread: WorkflowThread, limit = 10) => {
  const tagsText = String((thread as any).matching_flags || (thread as any).person_flags_text || (thread as any).seller_tags_text || '')
  const jsonTags = Array.isArray((thread as any).person_flags_json) ? (thread as any).person_flags_json : []
  const tags = tagsText.split(/[;,|]/).map((tag) => tag.trim()).filter(Boolean)
  const combined = Array.from(new Set([...tags, ...jsonTags])).slice(0, limit)
  
  return combined.map((tag: string) => {
    let tone: 'green' | 'yellow' | 'red' = 'green'
    if (/renter|tenant|do not call|dnc|suppressed|dead/i.test(tag)) tone = 'red'
    else if (/probate|foreclosure|divorce|lien|tax/i.test(tag)) tone = 'yellow'
    return { label: tag, tone }
  })
}

const buildPropertyTagBadges = (thread: WorkflowThread, limit = 12) => {
  const tagsText = String((thread as any).property_flags_text || (thread as any).podio_tags || '')
  const jsonTags = Array.isArray((thread as any).property_flags_json) ? (thread as any).property_flags_json : []
  const tags = tagsText.split(/[;,|]/).map((tag) => tag.trim()).filter(Boolean)
  const combined = Array.from(new Set([...tags, ...jsonTags])).slice(0, limit)
  
  return combined.map((tag: string) => {
    let tone: 'green' | 'yellow' | 'red' = 'green'
    if (/vacant|boarded|condemned|fire/i.test(tag)) tone = 'red'
    else if (/probate|foreclosure|divorce|lien|tax|delinquent/i.test(tag)) tone = 'yellow'
    return { label: tag, tone }
  })
}

const MiniTimeline = ({ thread, messages, limit = 8 }: { thread: WorkflowThread; messages: ThreadMessage[]; limit?: number }) => {
  const messageItems = messages.slice(0, limit).map((message) => ({
    label: message.direction === 'inbound' ? 'Seller replied' : 'Queue sent',
    time: message.timelineAt || message.createdAt,
    detail: message.body,
    done: true,
    active: message.direction === 'inbound' && thread.inboxStatus === 'new_reply',
  }))
  const syntheticItems = [
    { label: 'First touch', time: thread.updatedAt, detail: 'Initial contact sequence opened.', done: true },
    { label: 'AI classified', time: thread.lastMessageAt, detail: thread.uiIntent || getSellerStageVisual(thread.conversationStage).label, done: true },
    { label: 'Auto response queued', time: thread.aiDraft ? thread.updatedAt : null, detail: thread.aiDraft || 'No draft queued.', done: Boolean(thread.aiDraft) },
    { label: 'Delivered', time: thread.lastOutboundAt, detail: (thread as any).deliveryStatus || 'Outbound delivery recorded.', done: Boolean(thread.lastOutboundAt) },
    { label: 'Escalation triggered', time: thread.inboxStatus === 'needs_review' ? thread.updatedAt : null, detail: 'Operator review required.', done: thread.inboxStatus === 'needs_review', active: thread.inboxStatus === 'needs_review' },
    { label: 'Offer generated', time: thread.updatedAt, detail: formatMoney(Number(thread.cashOffer || 0)) || 'Awaiting offer model.', done: isPresent(thread.cashOffer) },
  ]
  const items = (messageItems.length ? messageItems : syntheticItems).slice(0, limit)
  return (
    <div className="nx-war-room-timeline">
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} className={cls('nx-war-room-timeline__item', item.done && 'is-done', item.active && 'is-active')}>
          <div className="nx-war-room-timeline__node" />
          <div className="nx-war-room-timeline__content">
            <strong>{item.label}</strong>
            <span>{item.time ? formatDate(item.time) : 'Pending'}</span>
            <p>{item.detail}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

type IntelligenceTabId =
  | 'overview'
  | 'prospect'
  | 'owner'
  | 'property'
  | 'portfolio'
  | 'financial'
  | 'conversation'
  | 'automation'
  | 'timeline'

const INTELLIGENCE_TABS: Array<{ id: IntelligenceTabId; label: string }> = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'prospect', label: 'PROSPECT' },
  { id: 'owner', label: 'OWNER' },
  { id: 'property', label: 'PROPERTY INTEL' },
  { id: 'portfolio', label: 'PORTFOLIO' },
  { id: 'financial', label: 'FINANCIAL' },
  { id: 'conversation', label: 'CONVERSATION' },
  { id: 'automation', label: 'AUTOMATION' },
  { id: 'timeline', label: 'TIMELINE' },
]

export const DossierTabNav = ({ active, onChange }: { active: IntelligenceTabId; onChange: (tab: IntelligenceTabId) => void }) => (
  <nav className="nx-intelligence-tabs" aria-label="Deal intelligence tabs">
    {INTELLIGENCE_TABS.map((tab) => (
      <button
        key={tab.id}
        type="button"
        className={cls('nx-intelligence-tab', active === tab.id && 'is-active')}
        onClick={() => onChange(tab.id)}
      >
        <span>{tab.label}</span>
      </button>
    ))}
  </nav>
)

export const OverviewPanel = ({ thread, messages }: { thread: WorkflowThread; messages: ThreadMessage[] }) => {
  const action = getNextBestAction(thread)
  const latestInbound = messages.find((message) => message.direction === 'inbound')?.body || thread.latestMessageBody || thread.lastMessageBody
  return (
    <div className="nx-intel-panel-grid">
      <PanelSection title="Acquisition Command" icon="spark">
        <FieldGrid columns={3}>
          <FieldTile label="Acquisition Score" value={formatScore(thread.finalAcquisitionScore || (thread as any).ai_score)} tone="good" />
          <FieldTile label="Deal Strength" value={thread.priority || thread.priorityBucket} tone="accent" />
          <FieldTile label="Close Probability" value={formatPercent(Number(thread.motivationScore || 0))} />
          <FieldTile label="Intent" value={thread.uiIntent || thread.detected_intent} />
          <FieldTile label="Lead Status" value={getStatusVisual(thread.inboxStatus).label} />
          <FieldTile label="Responsiveness" value={thread.lastInboundAt ? 'Responsive' : 'N/A'} />
        </FieldGrid>
      </PanelSection>
      <PanelSection title="AI Recommendation" icon="spark">
        <div className="nx-intel-copy-card">
          <strong>{action.title}</strong>
          <p>{action.reason}</p>
          <div className="nx-intel-badge-row">
            <QuietBadge label={`Next: ${thread.nextSystemAction || action.suggestedReply || 'Monitor thread'}`} tone="accent" />
            <QuietBadge label={`Automation ${automationStateVisuals[thread.automationState || 'manual']?.label || 'Manual'}`} />
            <QuietBadge label={`Health ${thread.queueStatus || 'Healthy'}`} tone={thread.queueStatus === 'stuck' ? 'warning' : 'success'} />
          </div>
        </div>
      </PanelSection>
      <PanelSection title="Latest Inbound Summary" icon="message">
        <p className="nx-intel-body-copy">{latestInbound || 'No inbound message has been captured for this thread yet.'}</p>
      </PanelSection>
      <PanelSection title="Recent Activity Preview" icon="activity">
        <MiniTimeline thread={thread} messages={messages} limit={4} />
      </PanelSection>
    </div>
  )
}

export const ProspectPanel = ({ thread }: { thread: WorkflowThread; intelligence: ThreadIntelligenceRecord | null }) => {

  const badges = buildMatchBadges(thread)
  return (
    <div className="nx-intel-panel-grid">
      <PanelSection title="Prospect Identity" icon="users">
        <div className="nx-match-badge-row">{badges.map((badge) => <MatchBadge key={badge.label} label={badge.label} tone={badge.tone} />)}</div>
        <FieldGrid>
          <FieldTile label="Prospect Name" value={thread.prospect_full_name || thread.displayName} tone="accent" />
          <FieldTile label="Matching Confidence" value={formatScore(thread.prospect_contact_score || thread.prospect_phone_score)} />
          <FieldTile label="Contact Match Tags" value={(thread as any).matching_flags || (thread as any).person_flags_text} />
          <FieldTile label="Age" value={(thread as any).prospect_age} />
          <FieldTile label="Marital Status" value={(thread as any).marital_status} />
          <FieldTile label="Gender" value={(thread as any).gender} />
          <FieldTile label="Language" value={thread.language_preference || thread.contactLanguage} />
          <FieldTile label="Education" value={(thread as any).education_model} />
          <FieldTile label="Household Income" value={(thread as any).est_household_income} />
          <FieldTile label="Net Asset Value" value={(thread as any).net_asset_value} />
          <FieldTile label="Buying Power" value={(thread as any).buying_power} />
          <FieldTile label="Phone Carrier" value={(thread as any).phone_carrier} />
          <FieldTile label="Occupation" value={(thread as any).occupation} />
          <FieldTile label="Occupation Group" value={(thread as any).occupation_group} />
          <FieldTile label="Phone Number" value={formatPhone(thread.prospect_best_phone || thread.phoneNumber)} tone="good" />
          <FieldTile label="Email" value={thread.prospect_best_email} />
          <FieldTile label="SMS Eligible" value={formatBoolean((thread as any).sms_eligible)} />
          <FieldTile label="Email Eligible" value={formatBoolean((thread as any).email_eligible)} />
        </FieldGrid>
      </PanelSection>
    </div>
  )
}

export const OwnerPanel = ({ thread }: { thread: WorkflowThread; intelligence: ThreadIntelligenceRecord | null }) => {

  return (
  <div className="nx-intel-panel-grid">
    <PanelSection title="Owner Operations" icon="user">
      <FieldGrid>
        <FieldTile label="Owner Name" value={thread.ownerDisplayName || thread.ownerName} tone="accent" />
        <FieldTile label="Language" value={(thread as any).best_language} />
        <FieldTile label="Priority Tier" value={thread.owner_priority_tier || thread.priority} tone="accent" />
        <FieldTile label="Priority Score" value={formatScore(thread.owner_priority_score || thread.finalAcquisitionScore)} />
        <FieldTile label="Best Contact Window" value={thread.best_contact_window || 'Afternoon'} />
        <FieldTile label="Ownership Years" value={thread.ownership_years} />
        <FieldTile label="Owner Occupied" value={formatBoolean(thread.isOwnerOccupied)} tone={thread.isOwnerOccupied ? 'good' : 'bad'} />
        <FieldTile label="Absentee Status" value={formatBoolean(thread.isAbsentee)} tone={thread.isAbsentee ? 'warn' : 'good'} />
        <FieldTile label="Corporate Flag" value={formatBoolean((thread as any).is_corporate_owner)} />
        <FieldTile label="Owner Type" value={thread.owner_type_guess} />
        <FieldTile label="Contactability Score" value={formatScore(thread.contactability_score)} />
        <FieldTile label="Financial Pressure" value={formatScore(thread.financial_pressure_score)} />
        <FieldTile label="Urgency Score" value={formatScore(thread.urgency_score)} />
        <FieldTile label="Follow-up Cadence" value={thread.follow_up_cadence} />
      </FieldGrid>
    </PanelSection>
  </div>
  )
}

export const PortfolioPanel = ({ thread }: { thread: WorkflowThread; intelligence: ThreadIntelligenceRecord | null }) => (
  <div className="nx-intel-panel-grid">
    <PanelSection title="Portfolio Exposure" icon="layers">
      <FieldGrid>
        <FieldTile label="Portfolio Property Count" value={formatInteger(thread.property_count || 0)} />
        <FieldTile label="SFR Count" value={formatInteger((thread as any).sfr_count || 0)} />
        <FieldTile label="MF Count" value={formatInteger((thread as any).mf_count || 0)} />
        <FieldTile label="Total Units" value={formatInteger(thread.portfolio_total_units || 0)} />
        <FieldTile label="Portfolio Value" value={formatMoney(Number(thread.portfolio_total_value || 0))} tone="good" />
        <FieldTile label="Total Equity" value={formatMoney(Number(thread.portfolio_total_equity || 0))} tone="good" />
        <FieldTile label="Total Debt" value={formatMoney(Number(thread.portfolio_total_loan_balance || 0))} />
        <FieldTile label="Monthly Debt Pmt" value={formatMoney(Number(thread.portfolio_total_loan_payment || 0))} />
        <FieldTile label="Tax Delinquent Count" value={formatInteger(thread.tax_delinquent_count || 0)} tone={thread.tax_delinquent_count ? 'warn' : 'default'} />
        <FieldTile label="Active Lien Count" value={formatInteger(thread.active_lien_count || 0)} tone={thread.active_lien_count ? 'warn' : 'default'} />
      </FieldGrid>
    </PanelSection>
  </div>
)

export const FinancialPanel = ({ thread }: { thread: WorkflowThread; intelligence: ThreadIntelligenceRecord | null }) => (
  <div className="nx-intel-panel-grid">
    <PanelSection title="Financial Pressure" icon="stats">
      <div className="nx-binary-badge-row">
        <YesNoBadge label="Tax Delinquent" yes={Boolean(thread.property_tax_delinquent)} />
        <YesNoBadge label="Active Lien" yes={Boolean(thread.property_active_lien)} />
      </div>
      <FieldGrid>
        <FieldTile label="Financial Pressure Score" value={formatScore(thread.financial_pressure_score)} tone="warn" />
        <FieldTile label="Urgency Score" value={formatScore(thread.urgency_score)} tone="warn" />
        <FieldTile label="Tax Amount" value={formatMoney(Number(thread.tax_amt || 0))} />
        <FieldTile label="Oldest Tax Year" value={(thread as any).oldest_tax_delinquent_year} />
        <FieldTile label="Past Due Amount" value={formatMoney(Number(thread.past_due_amount || 0))} tone="bad" />
        <FieldTile label="Loan Balance" value={formatMoney(Number(thread.total_loan_balance || 0))} />
        <FieldTile label="Loan Payment" value={formatMoney(Number(thread.total_loan_payment || 0))} />
      </FieldGrid>
    </PanelSection>
  </div>
)

export const ConversationPanel = ({ thread, messages }: { thread: WorkflowThread; messages: ThreadMessage[] }) => {
  const inbound = messages.find((message) => message.direction === 'inbound')
  const outbound = messages.find((message) => message.direction === 'outbound')
  return (
    <div className="nx-intel-panel-grid">
      <PanelSection title="Conversation Intelligence" icon="message">
        <FieldGrid>
          <FieldTile label="Latest Inbound" value={inbound?.body || thread.latestMessageBody || thread.lastMessageBody} tone="accent" />
          <FieldTile label="Latest Outbound" value={outbound?.body} />
          <FieldTile label="AI Classification" value={thread.uiIntent || thread.detected_intent} />
          <FieldTile label="Seller Sentiment" value={thread.sentiment} />
          <FieldTile label="Timeline" value={thread.lastMessageAt ? formatRelativeTime(thread.lastMessageAt) : null} />
          <FieldTile label="Thread State" value={getStatusVisual(thread.inboxStatus).label} />
          <FieldTile label="Current Stage" value={getSellerStageVisual(thread.conversationStage).label} />
          <FieldTile label="Queued Reply" value={thread.aiDraft} />
        </FieldGrid>
      </PanelSection>
    </div>
  )
}

export const AutomationPanel = ({ thread }: { thread: WorkflowThread; intelligence: ThreadIntelligenceRecord | null }) => {
  return (
    <div className="nx-intel-panel-grid">
      <PanelSection title="Automation Control" icon="bolt">
        <FieldGrid>
          <FieldTile label="Queue Health" value={thread.queueStatus || 'Healthy'} tone={thread.queueStatus === 'stuck' ? 'bad' : 'good'} />
          <FieldTile label="Automation Active" value={thread.automationState === 'active' ? 'Yes' : 'No'} tone={thread.automationState === 'active' ? 'good' : 'warn'} />
          <FieldTile label="Last Run" value={formatDate(thread.updatedAt)} />
          <FieldTile label="Auto Reply Status" value={thread.autoReplyStatus} />
          <FieldTile label="Send Eligibility" value={(thread as any).isOptOut || thread.isSuppressed ? 'Suppressed' : 'Eligible'} tone={(thread as any).isOptOut || thread.isSuppressed ? 'bad' : 'good'} />
          <FieldTile label="Routing Market" value={thread.displayMarket || thread.market} />
          <FieldTile label="Assigned Number" value={formatPhone(thread.ourNumber)} />
          <FieldTile label="Agent Persona" value={thread.agent_persona} />
          <FieldTile label="Agent Family" value={thread.agent_family} />
        </FieldGrid>
      </PanelSection>
    </div>
  )
}


// ── Improved Automation Timeline ──────────────────────────────────────────

const TimelineEvent = ({ 
  label, 
  time, 
  state = 'neutral', 
  subtext, 
  badge
}: { 
  label: string; 
  time: string; 
  state?: 'neutral' | 'positive' | 'negative' | 'active'; 
  subtext?: string;
  badge?: { label: string; tone: 'accent' | 'success' | 'danger' | 'neutral' }
}) => {
  const stateColor = {
    neutral: '#0a84ff',
    positive: '#30d158',
    negative: '#ff453a',
    active: '#bf5af2'
  }[state] || '#0a84ff'

  return (
    <div className={`nx-timeline-item is-${state}`}>
      <div className="nx-timeline-connector" />
      <div 
        className="nx-timeline-dot" 
        style={{ backgroundColor: stateColor, borderColor: 'rgba(0,0,0,0.4)' }}
      />
      <div className="nx-timeline-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
          <div className="nx-timeline-label-group">
            <div className="nx-timeline-label">{label}</div>
            <div className="nx-timeline-time">
              {new Date(time).toLocaleDateString()} , {new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            {subtext && <div className="nx-timeline-subtext">{subtext}</div>}
          </div>
          {badge && (
            <div className={`nx-timeline-item-badge is-${badge.tone || 'neutral'}`}>
              {badge.label}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export const TimelinePanel = ({ thread, messages }: { thread: WorkflowThread; messages: ThreadMessage[] }) => {
  const events = useMemo(() => {
    const rawEvents: Array<{ label: string; time: string | Date; state: 'neutral' | 'positive' | 'negative' | 'active'; subtext?: string; badge?: any; priority: number }> = []

    // Exhaustive classification based on user-provided script
    const classifyMessage = (body: string) => {
      const text = body.toLowerCase().trim()
      
      // Negative / Compliance / Objections (Red)
      const isNegative = [
        'stop', 'unsubscribe', 'remove', 'cancel', 'quit', 'end', 'para', 'basta', 'detente', // Compliance
        'wrong number', 'not the owner', 'already sold', 'not interested', 'no interest', 'pass', 'nah', 'nope', // Objections
        'too low', 'lowball', 'scam', 'shady', 'sketchy', 'sus', 'fake', 'cap', // Trust
        'too much work', 'condition is bad', 'mold', 'fire damage', 'gut job', 'trashed', 'wreck', // Condition
        'listed', 'realtor', 'agent', 'mls', 'zillow', 'another offer', 'realtor.com', // Market
        'divorce', 'probate', 'inheritance', 'passed away', 'foreclosure', 'bankruptcy', 'behind on payments', // Distress
        'buzz off', 'leave me alone', 'get lost', 'get out', 'stfu', 'wtf', 'wth', 'annoying', 'harassment', 'harassing' // Aggressive
      ].some(p => text.includes(p))
      
      if (isNegative) return { label: 'Negative Intent', state: 'negative' }
      
      // Positive / Motivation / Signal (Green)
      const isPositive = [
        'interested', 'how much', 'price', 'offer', 'ready', 'motivated', 'vacant', 'empty',
        'yes', 'yeah', 'yup', 'sure', 'ok', 'let\'s talk', 'call me', 'email me', 'send offer',
        'affirmative', 'correct', 'that is correct', 'i am the owner', 'soy el dueño',
        'quick close', 'fast close', 'asap', 'need to sell', 'want to sell'
      ].some(p => text.includes(p))
      
      if (isPositive) return { label: 'Positive Intent', state: 'positive' }
      
      // Neutral / Curious / Questions (Blue)
      const isCurious = ['how does it work', 'process', 'info', 'details', 'who is this', 'who are you', 'how did you get my number'].some(p => text.includes(p))
      if (isCurious) return { label: 'Neutral Intent (Curious)', state: 'neutral' }
      
      return { label: 'Neutral Intent', state: 'neutral' }
    }

    // 1. Initial Lead Entry (If firstTouchAt exists and is before messages)
    const firstTouchAt = thread.firstTouchAt || thread.first_touch_at
    if (firstTouchAt && (!messages || messages.length === 0)) {
      rawEvents.push({ label: 'Lead Entered Pipeline', time: firstTouchAt, state: 'neutral', priority: 0 })
    }

    // 2. Messages & Detailed Classification
    const safeMessages = [...(messages || [])].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    let firstOutboundFound = false
    
    safeMessages.forEach(m => {
      const isSeller = m.direction === 'inbound'
      const timestamp = m.timelineAt || m.createdAt
      const body = m.body || ''
      
      if (isSeller) {
        rawEvents.push({ label: 'Seller Replied', time: timestamp, state: 'neutral', priority: 1 })
        
        const classification = classifyMessage(body)
        rawEvents.push({ 
          label: `Intent Classified: ${classification.label}`, 
          time: timestamp, 
          state: classification.state as any,
          subtext: body.length > 40 ? body.substring(0, 40) + '...' : body,
          priority: 2 
        })

        // Specific Milestones
        if (body.toLowerCase().includes('$') || body.toLowerCase().includes('price')) {
          rawEvents.push({ label: 'Asking Price Given', time: timestamp, state: 'positive', priority: 3 })
        }
      } else {
        const templateName = (m as any).template_name || (m as any).templateName || (m.metadata as any)?.template_name
        let label = 'Response Sent'
        
        if (!firstOutboundFound) {
          label = 'First Touch'
          firstOutboundFound = true
        } else if (templateName) {
          label = `Next Template Sent: ${templateName}`
        }

        rawEvents.push({ 
          label, 
          time: timestamp, 
          state: 'neutral',
          priority: 1
        })
      }
    })

    // 3. System States (Excluding "Automation Active" as requested)
    if (thread.estimatedValue) {
      rawEvents.push({ 
        label: 'AI Underwrite Complete', 
        time: thread.updatedAt, 
        state: 'positive',
        subtext: `ARV: ${formatMoney(thread.estimatedValue)}`,
        priority: 5
      })
    }

    if (thread.conversationStage) {
      const stageVisual = getSellerStageVisual(thread.conversationStage)
      rawEvents.push({ 
        label: `Stage: ${stageVisual.label || thread.conversationStage}`, 
        time: thread.updatedAt, 
        state: 'neutral',
        priority: 6
      })
    }

    // 4. Final Processing: Sort Chronologically and Apply Active State to LAST event
    const sorted = rawEvents.sort((a, b) => {
      const timeA = new Date(a.time).getTime()
      const timeB = new Date(b.time).getTime()
      if (timeA !== timeB) return timeA - timeB
      return a.priority - b.priority
    })

    // Tag the very last event as "active" (purple pulse)
    if (sorted.length > 0) {
      const lastIdx = sorted.length - 1
      sorted[lastIdx] = { ...sorted[lastIdx], state: 'active' }
    }

    // Return in REVERSE for UI display (latest on top)
    return [...sorted].reverse()
  }, [thread, messages])

  const isCritical = thread.inboxStatus === 'new_reply' || thread.priority === 'urgent'

  return (
    <div className="nx-intel-panel-grid">

      <DossierCard className="nx-force-card nx-timeline-card nx-timeline-workspace-card">
        <div className="nx-dossier-section__title" style={{ justifyContent: 'space-between', marginBottom: 20 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 }}>
            <Icon name="activity" />
            Automation Timeline
          </span>
          {isCritical && <QuietBadge label="CRITICAL" tone="danger" />}
        </div>

        <div className="nx-timeline-v2">
          {events.map((ev, idx) => (
            <TimelineEvent key={idx} {...ev} time={typeof ev.time === 'string' ? ev.time : ev.time.toISOString()} />
          ))}
        </div>
      </DossierCard>
    </div>
  )
}


const PropertySnapshotCard = ({ thread, intelligence }: { thread: WorkflowThread; intelligence: ThreadIntelligenceRecord | null }) => {
  const snapshot = normalizePropertySnapshot(intelligence, thread)
  const address = snapshot.fullAddress || thread.displayAddress || thread.propertyAddress || thread.subject || 'No linked property'
  const market = snapshot.market || thread.displayMarket || thread.market || thread.marketId || 'Unknown market'
  const propertyTypeRaw = snapshot.propertyType || (thread as any).propertyType || thread.property_type_majority || 'Not enriched'
  const isMultifamily = propertyTypeRaw.toLowerCase().includes('multi') || propertyTypeRaw.toLowerCase().includes('apartment') || (thread.mf_count && Number(thread.mf_count) > 1)
  const unitCount = thread.mf_count || (thread as any).mfCount || (thread as any).unitCount
  
  const displayType = isMultifamily 
    ? `Multi Family • ${unitCount || 2} Units`
    : 'Single Family'
  const streetViewUrl = snapshot.streetViewUrl || thread.streetview_image
  const [imageFailed, setImageFailed] = useState(false)
  const links = buildPropertyExternalLinks(address)
  const chips = [
    snapshot.beds || thread.total_bedrooms || thread.beds ? `${snapshot.beds || thread.total_bedrooms || thread.beds} BEDS` : null,
    snapshot.baths || thread.total_baths || thread.baths ? `${snapshot.baths || thread.total_baths || thread.baths} BATHS` : null,
    snapshot.sqft || thread.building_square_feet || thread.sqft
      ? `${formatInteger(Number(snapshot.sqft || thread.building_square_feet || thread.sqft))} SQFT`
      : null,
    snapshot.yearBuilt || thread.year_built ? `BUILT ${snapshot.yearBuilt || thread.year_built}` : null,
    formatMoney(thread.estimatedValue),
    formatPercent(thread.equityPercent) ? `${formatPercent(thread.equityPercent)} EQUITY` : null,
    formatMoney(thread.estimatedRepairCost) ? `${formatMoney(thread.estimatedRepairCost)} REPAIRS` : null,
  ].filter(Boolean) as string[]

  useEffect(() => {
    setImageFailed(false)
  }, [streetViewUrl, address])

  return (
    <DossierCard className="nx-property-hero-shell">
      <div className="nx-property-hero__media">
        {streetViewUrl && !imageFailed ? (
          <img src={streetViewUrl} alt={address} onError={() => setImageFailed(true)} />
        ) : (
          <div className="nx-property-hero__fallback">
            <Icon name="map" />
            <span>Property hero unavailable</span>
            <strong>{address}</strong>
          </div>
        )}

        <div className="nx-property-hero__hover-actions">
          <div className="nx-property-hero__hover-grid">
            <LinkedRecordButton label="Zillow" url={links.zillow} icon="globe" />
            <LinkedRecordButton label="Google Maps" url={links.streetView} icon="map" />
            <LinkedRecordButton label="Search" url={links.googleSearch} icon="search" />
            <LinkedRecordButton label="Realtor" url={links.realtor} icon="globe" />
          </div>
        </div>
      </div>

      <div className="nx-property-hero__info">
        <div className="nx-property-hero__address">
          <strong>{address}</strong>
        </div>
        <div className="nx-property-hero__location">{market} • {displayType}</div>
        <div className="nx-property-hero__chips">
          {chips.map((chip) => <QuietBadge key={chip} label={chip} />)}
        </div>
      </div>
    </DossierCard>
  )
}


const ContactIntelligenceCard = ({
  thread,
}: {
  thread: WorkflowThread
  intelligence: ThreadIntelligenceRecord | null
}) => {
  const [activeTab, setActiveTab] = useState<'prospect' | 'owner' | 'portfolio' | 'financial' | 'property'>('prospect')
  const [propertyTab, setPropertyTab] = useState<'overview' | 'location' | 'property' | 'equity' | 'tax'>('overview')

  const sellerName = thread.displayName || thread.ownerDisplayName || thread.ownerName || 'Unknown seller'
  const initials = sellerName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const headlineAddress = thread.displayAddress || thread.propertyAddress || thread.subject
  const propertyType = thread.propertyType || 'Not enriched'
  const prospectMatchBadges = useMemo(() => buildMatchBadges(thread), [thread])
  const propertyTagBadges = useMemo(() => buildPropertyTagBadges(thread), [thread])
  const ownerIdentityBadge = [asStr(thread.ownerType || thread.owner_type_guess || 'Individual').toUpperCase(), thread.isAbsentee ? 'ABSENTEE' : null]
    .filter(Boolean)
    .join(' | ')

  const topTabs = [
    ['prospect', 'PROSPECT'],
    ['owner', 'OWNER'],
    ['portfolio', 'PORTFOLIO'],
    ['financial', 'FINANCIAL'],
    ['property', 'PROPERTY INTEL'],
  ] as const

  const prospectTagBadges = useMemo(() => buildProspectTagBadges(thread), [thread])

  const prospectRows: Array<{ label: string; value?: unknown; render?: React.ReactNode }> = [
    { label: 'PROSPECT NAME', value: thread.prospect_full_name || thread.displayName },
    { label: 'AGE', value: (thread as any).prospect_age },
    { label: 'MARITAL STATUS', value: thread.marital_status },
    { label: 'GENDER', value: thread.gender },
    { label: 'LANGUAGE', value: thread.language_preference || thread.contactLanguage },
    { label: 'EDUCATION', value: thread.education_model },
    { label: 'HOUSEHOLD INCOME', value: thread.est_household_income },
    { label: 'NET ASSET VALUE', value: thread.net_asset_value },
    { label: 'BUYING POWER', value: (thread as any).buying_power },
    { label: 'OCCUPATION', value: thread.occupation },
    { label: 'OCCUPATION GROUP', value: thread.occupation_group },
    { 
      label: 'PROSPECT TAGS', 
      value: prospectTagBadges.length ? 'has_tags' : null,
      render: prospectTagBadges.length > 0 ? (
        <div className="nx-contact-intel-card__match-badges" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {prospectTagBadges.map((badge, i) => <MatchBadge key={i} label={badge.label} tone={badge.tone} />)}
        </div>
      ) : null
    },
    { label: 'PHONE NUMBER', value: fmtPhone(thread.prospect_best_phone || thread.phoneNumber || thread.canonicalE164) },
    { label: 'PHONE CARRIER', value: (thread as any).phone_carrier },
  ]

  const ownerRows: Array<{ label: string; value?: unknown; render?: React.ReactNode }> = [
    { label: 'OWNER ADDRESS', value: thread.primary_owner_address || thread.mailing_address },
    { label: 'PRIORITY TIER', value: thread.owner_priority_tier || thread.priority },
    { label: 'PRIORITY SCORE /100', value: formatScore(thread.owner_priority_score || thread.finalAcquisitionScore) },
    { label: 'BEST CONTACT WINDOW', value: (thread as any).best_contact_window },
    { label: 'LANGUAGE', value: thread.language_preference || thread.contactLanguage },
  ]

  const portfolioRows: Array<{ label: string; value?: unknown; render?: React.ReactNode }> = [
    { label: 'PORTFOLIO PROPERTY COUNT', value: thread.property_count },
    { label: 'PROPERTY TYPE MAJORITY', value: thread.property_type_majority || thread.propertyType },
    { label: 'SFR COUNT', value: (thread as any).sfr_count },
    { label: 'MF COUNT', value: (thread as any).mf_count },
    { label: 'TOTAL UNITS', value: thread.portfolio_total_units },
    { label: 'PORTFOLIO VALUE', value: formatMoney(Number(thread.portfolio_total_value || 0)) },
    { label: 'TOTAL EQUITY', value: formatMoney(Number(thread.portfolio_total_equity || 0)) },
    { label: 'TOTAL DEBT', value: formatMoney(Number(thread.portfolio_total_loan_balance || 0)) },
    { label: 'TOTAL DEBT PAYMENT', value: formatMoney(Number(thread.portfolio_total_loan_payment || 0)) },
  ]

  const financialRows: Array<{ label: string; value?: unknown; render?: React.ReactNode }> = [
    { label: 'FINANCIAL PRESSURE SCORE', value: formatScore(thread.financial_pressure_score) },
    { label: 'URGENCY COUNT', value: thread.urgency_count || formatScore(thread.urgency_score) },
    { label: 'PORTFOLIO TAX DELINQUENT COUNT', value: thread.tax_delinquent_count },
    { label: 'TAX DELINQUENT BADGE', value: formatBoolean(thread.property_tax_delinquent) },
    { label: 'PORTFOLIO LIEN COUNT', value: thread.active_lien_count },
    { label: 'ACTIVE LIEN BADGE', value: formatBoolean(thread.property_active_lien) },
    { label: 'OLDEST TAX DELINQUENT YEAR', value: thread.oldest_tax_delinquent_year },
    { label: 'TOTAL TAX AMOUNT', value: formatMoney(Number(thread.tax_amt || thread.past_due_amount || 0)) },
  ]

  const activeRows = activeTab === 'prospect'
    ? prospectRows
    : activeTab === 'owner'
      ? ownerRows
      : activeTab === 'portfolio'
        ? portfolioRows
        : financialRows

  return (
    <DossierCard className="nx-contact-intel-card">
      <div className="nx-dossier-section__title"><Icon name="user" /> <span>Contact &amp; Ownership Intelligence</span></div>

      <div className="nx-intel-internal-tabs">
        {topTabs.map(([id, label]) => (
          <button key={id} type="button" className={cls('nx-intel-internal-tab', activeTab === id && 'is-active')} onClick={() => setActiveTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="nx-contact-intel-card__identity">
        <div className="nx-dossier-header__avatar">{activeTab === 'property' ? '8M' : initials}</div>
        <div className="nx-contact-intel-card__identity-copy">
          <strong>{activeTab === 'property' ? headlineAddress || 'No linked property' : sellerName}</strong>
          {activeTab === 'prospect' ? (
            <div className="nx-contact-intel-card__match-badges">
              {prospectMatchBadges.map((badge) => <MatchBadge key={badge.label} label={badge.label} tone={badge.tone} />)}
            </div>
          ) : (
            <div className="nx-contact-intel-card__identity-chips">
              {activeTab === 'property'
                ? <QuietBadge label={standardFormatDisplayValue(propertyType).toUpperCase()} />
                : <QuietBadge label={ownerIdentityBadge} />}
            </div>
          )}
        </div>
      </div>

      {activeTab === 'property' ? (
        <>
          <div className="nx-intel-grid" style={{ marginBottom: 16 }}>
            <IntelField 
              label="PROPERTY FLAGS" 
              value={propertyTagBadges.length ? 'has_tags' : null} 
              render={propertyTagBadges.length > 0 ? (
                <div className="nx-contact-intel-card__match-badges" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {propertyTagBadges.map((badge, i) => <MatchBadge key={i} label={badge.label} tone={badge.tone as any} />)}
                </div>
              ) : null}
            />
          </div>
          <div className="nx-intel-subtabs">
            {[
              ['overview', 'OVERVIEW'],
              ['location', 'LOCATION'],
              ['property', 'PROPERTY'],
              ['equity', 'EQUITY / VALUATION'],
              ['tax', 'LAND / TAX'],
            ].map(([id, label]) => (
              <button key={id} type="button" className={cls('nx-intel-internal-tab', propertyTab === id && 'is-active')} onClick={() => setPropertyTab(id as 'overview' | 'location' | 'property' | 'equity' | 'tax')}>
                {label}
              </button>
            ))}
          </div>
          <PropertyIntelFields thread={thread} subTab={propertyTab} />
        </>
      ) : (
        <div className="nx-intel-grid">{activeRows.map(({ label, value, render }) => <IntelField key={label} label={label} value={value} render={render} />)}</div>
      )}
    </DossierCard>
  )
}

const SellerCommandCard = ({
  thread,
  onStatusChange,
  onStageChange,
}: {
  thread: WorkflowThread
  onStatusChange: (status: InboxStatus | 'sent_message') => void
  onStageChange: (stage: SellerStage) => void
}) => {
  const [statusOpen, setStatusOpen] = useState(false)
  const [stageOpen, setStageOpen] = useState(false)
  const sellerName = thread.displayName || thread.ownerDisplayName || thread.ownerName || 'Unknown seller'
  const initials = sellerName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const ownerType = asStr(thread.ownerType || thread.owner_type_guess) || 'Individual'
  const market = thread.displayMarket || thread.market || thread.marketId || 'Unknown market'
  const finalScore = formatScore(thread.finalAcquisitionScore || thread.priorityScore || thread.motivationScore)
  const lastContact = thread.lastInboundAt || thread.lastOutboundAt || thread.lastMessageAt
  const statusVisual = getStatusVisual(thread.inboxStatus, {
    latestDirection: thread.latestDirection || thread.directionUsed || null,
    lastOutboundAt: thread.lastOutboundAt ?? null,
    lastInboundAt: thread.lastInboundAt ?? null,
  })
  const stageVisual = getSellerStageVisual(thread.conversationStage)
  const automationLabel = thread.automationState === 'active' ? 'AUTOMATION ACTIVE' : 'AUTOMATION READY'

  return (
    <DossierCard className="nx-seller-command-card">
      <div className="nx-seller-command-card__identity">
        <div className="nx-dossier-header__avatar">{initials}</div>
        <div className="nx-seller-command-card__info">
          <strong>{sellerName}</strong>
          <span>{[ownerType, thread.isAbsentee ? 'ABSENTEE' : null, market].filter(Boolean).join(' • ')}</span>
        </div>
      </div>

      <div className="nx-seller-command-card__controls">
        <div className="nx-seller-command-card__select">
          <button type="button" className="nx-workflow-btn" style={statusStyleVars(statusVisual)} onClick={() => setStatusOpen((open) => !open)}>
            <i className="nx-workflow-dot" style={{ background: statusVisual.color }} />
            {statusVisual.label}
            <Icon name="chevron-down" />
          </button>
          {statusOpen && (
            <div className="nx-workflow-menu nx-liquid-panel">
              {inboxStatusOptions.map((opt) => (
                <button key={opt.value} type="button" className={cls('nx-workflow-menu-item', opt.value === thread.inboxStatus && 'is-selected')} style={statusStyleVars(opt)} onClick={() => {
                  onStatusChange(opt.value as InboxStatus | 'sent_message')
                  setStatusOpen(false)
                }}>
                  <i className="nx-workflow-dot" style={{ background: opt.color }} />
                  <div><strong>{opt.label}</strong><small>{opt.description}</small></div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="nx-seller-command-card__select">
          <button type="button" className="nx-workflow-btn" style={statusStyleVars(stageVisual)} onClick={() => setStageOpen((open) => !open)}>
            <i className="nx-workflow-dot" style={{ background: stageVisual.color }} />
            {stageVisual.label}
            <Icon name="chevron-down" />
          </button>
          {stageOpen && (
            <div className="nx-workflow-menu nx-liquid-panel">
              {sellerStageOptions.map((opt) => (
                <button key={opt.value} type="button" className={cls('nx-workflow-menu-item', opt.value === thread.conversationStage && 'is-selected')} style={statusStyleVars(opt)} onClick={() => {
                  onStageChange(opt.value as SellerStage)
                  setStageOpen(false)
                }}>
                  <i className="nx-workflow-dot" style={{ background: opt.color }} />
                  <div><strong>{opt.label}</strong><small>{opt.description}</small></div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="nx-seller-command-card__chips">
        <QuietBadge label={automationLabel} tone="accent" />
        {isPresent(finalScore) && <QuietBadge label={`SCORE ${finalScore}`} />}
        {lastContact && <QuietBadge label={`LAST CONTACT ${formatRelativeTime(lastContact).toUpperCase()}`} />}
      </div>
    </DossierCard>
  )
}

export interface IntelligencePanelProps {
  thread: WorkflowThread | null
  threadContext?: ThreadContext | null
  intelligence?: ThreadIntelligenceRecord | null
  panelMode?: Exclude<PanelMode, 'hidden'>
  isSuppressed?: boolean
  onCollapse?: () => void
  onOpenMap?: () => void
  onOpenDossier?: () => void
  onOpenAi?: () => void
  onStatusChange: (status: InboxStatus | 'sent_message') => void
  onStageChange: (stage: SellerStage) => void
  messages: ThreadMessage[]
}

export const IntelligencePanel = ({
  thread,
  threadContext,
  intelligence = null,
  isSuppressed = false,
  panelMode = 'default',
  onCollapse,
  onOpenMap = () => undefined,
  onOpenDossier = () => undefined,
  onOpenAi = () => undefined,
  onStatusChange,
  onStageChange,
  messages,
}: IntelligencePanelProps) => {
  void threadContext
  void isSuppressed

  if (!thread) {
    return (
      <aside className="nx-intelligence-panel">
        <div className="nx-inbox-loading-state">
          <Icon name="inbox" />
          <p>Select a thread to view intelligence</p>
        </div>
      </aside>
    )
  }

  return (
    <aside className={cls('nx-intelligence-panel', `is-mode-${panelMode}`)}>
      <header className="nx-intel-header">
        <span className="nx-section-label">DEAL COMMAND DOSSIER</span>
        {onCollapse ? (
          <button type="button" className="nx-intel-collapse" onClick={onCollapse} title="Collapse panel">
            <Icon name="close" />
          </button>
        ) : null}
      </header>

      <div className="nx-intel-scroll-body">
        <SellerCommandCard thread={thread} onStatusChange={onStatusChange} onStageChange={onStageChange} />
        <PropertySnapshotCard thread={thread} intelligence={intelligence} />
        <OfferMemoCard thread={thread} />
        <ContactIntelligenceCard thread={thread} intelligence={intelligence} />
        <TimelinePanel thread={thread} messages={messages} />
        <LinkedRecordsCard thread={thread} />
        <ActionRailCard thread={thread} onOpenMap={onOpenMap} onOpenDossier={onOpenDossier} onOpenAi={onOpenAi} />
      </div>
    </aside>
  )
}

void PremiumPropertySnapshotCard
void PremiumOfferMemoCard

export const OfferMemoCard = ({ thread }: { thread: WorkflowThread }) => {
  const [isUnderwriting, setIsUnderwriting] = useState(false)
  const [underwritingData, setUnderwritingData] = useState<any>(null)
  
  const hasArv = isPresent(thread.estimatedValue)
  const aiOffer = formatMoney(Number(thread.ai_recommended_opening_offer || thread.ai_offer || 0))
  const cashOffer = formatMoney(Number(thread.cashOffer || thread.mao || 0))
  const walkaway = formatMoney(Number(thread.walkaway_price || thread.walkaway_internal || 0))
  const confidence = standardFormatDisplayValue(thread.offer_confidence || (hasArv ? 'Review internally' : 'Hold internal'))
  const missing = !hasArv ? 'ARV verification' : standardFormatDisplayValue(thread.nextRequiredInfo)
  const aiOpening = aiOffer || (hasArv ? 'Needs underwriting' : 'Needs ARV')

  const handleUnderwrite = async () => {
    setIsUnderwriting(true)
    try {
      const res = await fetch('/api/internal/offers/underwrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          address: thread.propertyAddress || thread.subject, 
          propertyType: detectPropertyCategory(thread) 
        })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setUnderwritingData(data)
    } catch (err) {
      console.error('Underwriting failed:', err)
      alert('Underwriting failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setIsUnderwriting(false)
    }
  }

  return (
    <DossierCard className="nx-offer-memo-card">
      <div className="nx-dossier-section__title nx-dossier-section__title--between">
        <span><Icon name="zap" /> Offer Intelligence</span>
        <QuietBadge label={hasArv ? 'READY' : 'NEEDS ARV'} tone={hasArv ? 'success' : 'warning'} />
      </div>
      <div className="nx-offer-memo-card__rows">
        <IntelField label="LEGACY CASH OFFER" value={cashOffer} />
        <IntelField label="AI RECOMMENDED OPENING" value={underwritingData ? formatMoney(underwritingData.valuation.mao) : aiOpening} />
        <IntelField label="WALKAWAY INTERNAL" value={underwritingData ? formatMoney(underwritingData.valuation.maoCeiling) : (walkaway || 'Needs underwriting')} />
        <IntelField label="MISSING UNDERWRITING INFO" value={underwritingData ? 'None (AI Fresh)' : missing} />
        <IntelField label="CONFIDENCE / SAFE-TO-REVEAL" value={underwritingData ? `${underwritingData.valuation.score}/100 - ${underwritingData.valuation.verdict.toUpperCase()}` : confidence} />
      </div>
      
      {underwritingData && (
        <div className="nx-underwrite-results">
          <div className="nx-underwrite-results__title">AI Research Snapshot</div>
          <div className="nx-underwrite-results__grid">
            <div className="nx-underwrite-results__item">
              <span>ARV Estimate</span>
              <strong>{formatMoney(underwritingData.valuation.arv_estimate)}</strong>
            </div>
            <div className="nx-underwrite-results__item">
              <span>Repair Estimate</span>
              <strong>{formatMoney(underwritingData.valuation.repair_estimate)}</strong>
            </div>
          </div>
          <div className="nx-underwrite-results__comps">
            {underwritingData.comps?.slice(0, 3).map((comp: any, i: number) => (
              <a key={i} href={comp.source_url} target="_blank" rel="noreferrer" className="nx-underwrite-comp-link">
                <Icon name="globe" /> {comp.address} - {formatMoney(comp.price)}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="nx-offer-memo-card__actions" style={{ marginTop: 12 }}>
        <button 
          type="button" 
          className={cls('nx-intel-action-btn', isUnderwriting && 'is-loading')}
          onClick={handleUnderwrite}
          disabled={isUnderwriting}
          style={{ width: '100%', justifyContent: 'center', background: 'var(--nx-accent-bg)', color: 'var(--nx-accent-text)' }}
        >
          <Icon name="spark" />
          {isUnderwriting ? 'Analyzing Deal...' : 'Run AI Comps & Underwrite'}
        </button>
      </div>
    </DossierCard>
  )
}
