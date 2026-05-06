import { useState, useEffect, useMemo } from 'react'
import type { ThreadContext, ThreadIntelligenceRecord, ThreadMessage } from '../../../lib/data/inboxData'
import type { InboxStatus, SellerStage, InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import type { PanelMode } from '../inbox-layout-state'
import {
  normalizePropertySnapshot,
  buildPropertyExternalLinks,
  buildAerialViewUrl,
} from '../inbox-normalization'
import { Icon, type IconName } from '../../../shared/icons'
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
const cls = (...tokens: Array<string | false | null | undefined>) => tokens.filter(Boolean).join(' ')

import { CopilotOrbTrigger } from '../copilot/AICopilotPanel'

// ── Helper Utilities ──────────────────────────────────────────────────────

const normalizeText = (value: unknown): string => String(value ?? '').trim()

const isPresent = (value: unknown): boolean => {
  const text = normalizeText(value).toLowerCase()
  return Boolean(text) && text !== 'unknown' && text !== 'n/a' && text !== 'null' && text !== 'undefined' && text !== 'none' && text !== '-'
}

const asStr = (value: unknown): string => normalizeText(value)

const formatMoney = (value: unknown): string | null => {
  const raw = String(value ?? '').replace(/[,$\s]/g, '')
  const num = Number(raw)
  if (!Number.isFinite(num) || num === 0) return null
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `$${Math.round(num / 1_000)}K`
  return `$${Math.round(num).toLocaleString()}`
}

const formatPercent = (value: unknown): string | null => {
  const raw = String(value ?? '').replace(/[%\s]/g, '')
  const num = Number(raw)
  if (!Number.isFinite(num)) return null
  return `${Math.round(num)}%`
}

const formatDate = (value: unknown): string | null => {
  if (!isPresent(value)) return null
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

const fmtPhone = (value: unknown): string | null => {
  const raw = normalizeText(value)
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  if (digits.length === 10) return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  return raw
}

const get = (thread: InboxWorkflowThread, key: string): unknown => {
  const row = thread as unknown as Record<string, unknown>
  return row[key] ?? row[key.replace(/_/g, '')] ?? row[key.charAt(0).toUpperCase() + key.slice(1)]
}

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

const SectionEmptyState = ({ text }: { text: string }) => (
  <div className="nx-dossier-empty">
    <Icon name="alert" />
    <span>{text}</span>
  </div>
)

// ── Property Category Detection ───────────────────────────────────────────

type PropertyCategory = 'sfh' | 'multifamily' | 'hotel' | 'storage' | 'retail' | 'office' | 'industrial' | 'land' | 'other'

const detectPropertyCategory = (thread: InboxWorkflowThread): PropertyCategory => {
  const pt = normalizeText(get(thread, 'propertyType') || get(thread, 'property_type')).toLowerCase()
  const units = Number(get(thread, 'unitCount') || get(thread, 'unit_count') || get(thread, 'units')) || 0
  if (units >= 5 || pt.includes('multifamily') || pt.includes('apartment')) return 'multifamily'
  if (pt.includes('hotel') || pt.includes('motel') || pt.includes('lodging') || pt.includes('hospitality')) return 'hotel'
  if (pt.includes('storage') || pt.includes('self-storage') || pt.includes('warehouse') && !pt.includes('industrial')) return 'storage'
  if (pt.includes('retail') || pt.includes('plaza') || pt.includes('strip') || pt.includes('shopping')) return 'retail'
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
  const hasArv = isPresent(get(thread, 'arv') || get(thread, 'afterRepairValue'))
  const hasRentRoll = isPresent(get(thread, 'rentRoll') || get(thread, 'rent_roll'))
  const hasCondition = isPresent(get(thread, 'estimatedRepairCost') || get(thread, 'estimated_repair_cost'))
  const lastReplyPreview = thread.latestMessageBody || thread.lastMessageBody || ''
  const sellerFirstName = thread.sellerFirstName || thread.ownerDisplayName?.split(' ')[0] || 'there'
  const motivationScore = Number(get(thread, 'motivationScore') || get(thread, 'motivation_score') || 0)
  const equityPercent = Number(String(get(thread, 'equityPercent') || get(thread, 'equity_percent') || 0).replace(/[^0-9.]/g, ''))

  if (inboxStatus === 'waiting' || inboxStatus === 'queued') {
    const nextTouch = get(thread, 'nextTouchUseCase') || get(thread, 'next_touch_use_case')
    if (nextTouch) return { title: `Waiting on seller — next: ${asStr(nextTouch)}`, reason: 'Follow-up will schedule when eligible.', urgency: 'low' }
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

  if (isMulti && !hasRentRoll && (stage === 'price_discovery' || stage === 'offer_reveal')) {
    return { title: 'Ask seller for rent roll and occupancy', reason: 'Multifamily requires rent roll before underwriting.', suggestedReply: `Hi ${sellerFirstName}, could you share the current rent roll and occupancy rate?`, urgency: 'high' }
  }

  if (!hasCondition && (stage === 'condition_details' || stage === 'offer_reveal')) {
    return { title: 'Gather property condition details', reason: 'Repair estimate needed before offer.', suggestedReply: `Hi ${sellerFirstName}, can you describe the current condition of the property?`, urgency: 'medium' }
  }

  if (thread.isSuppressed || thread.isOptOut) return { title: 'Thread suppressed', reason: 'No further action required.', urgency: 'low' }

  if (stage === 'ownership_check') return { title: 'Confirm ownership', reason: 'Verify seller is the legal owner.', suggestedReply: `Hi ${sellerFirstName}, can you confirm you're the owner?`, urgency: 'medium' }
  if (stage === 'interest_probe') return { title: 'Probe seller motivation', reason: 'Understand why they are considering selling.', suggestedReply: `Hi ${sellerFirstName}, what is motivating you to consider selling?`, urgency: 'medium' }
  if (stage === 'seller_response') return { title: 'Awaiting seller response', reason: 'Next follow-up pending.', urgency: 'low' }
  if (stage === 'negotiation') return { title: 'Active negotiation', reason: 'Review counter-offers and evaluate terms.', suggestedReply: equityPercent >= 60 ? `Hi ${sellerFirstName}, given the equity position, I think we can find common ground...` : undefined, urgency: 'high' }
  if (stage === 'contract_path') return { title: 'Move toward contract', reason: 'Terms aligned. Prepare contract.', suggestedReply: `Hi ${sellerFirstName}, I'd like to move forward with getting the property under contract...`, urgency: 'high' }

  return { title: thread.nextSystemAction || 'Review thread', reason: 'No specific action detected. Evaluate manually.', urgency: 'medium' }
}

// ── Diagnostics ───────────────────────────────────────────────────────────

const logIntelligencePanelData = (thread: InboxWorkflowThread) => {
  if (!DEV) return
  const threadObj = thread as unknown as Record<string, unknown>
  const fields = ['beds', 'baths', 'sqft', 'yearBuilt', 'ownerDisplayName', 'bestPhone', 'cashOffer', 'aiRecommendedOffer', 'queueStatus', 'conversationStage']
  const present = fields.filter((f) => threadObj[f] !== undefined && threadObj[f] !== null)
  console.log('[IntelligencePanelData]', {
    thread_id: thread.id.slice(-8),
    fields_present: present.length,
    missing: fields.filter((f) => !present.includes(f)).slice(0, 5),
  })
}

// ── 1. Deal Command Header ────────────────────────────────────────────────

export const DealCommandHeader = ({ thread }: { thread: InboxWorkflowThread }) => {
  const stageVisual = getSellerStageVisual(thread.conversationStage)
  const statusVisual = getStatusVisual(thread.inboxStatus)
  const finalScore = get(thread, 'finalAcquisitionScore') || get(thread, 'final_score')
  const lastReply = thread.latestMessageBody || thread.lastMessageBody
  const lastContact = thread.lastOutboundAt || thread.lastMessageAt
  const sellerName = thread.ownerDisplayName || thread.ownerName || asStr(get(thread, 'sellerName')) || 'Seller Unknown'
  const address = thread.propertyAddress || thread.subject || 'Property Unknown'
  const market = thread.market || thread.marketId || 'Market Unknown'
  const ownerType = asStr(get(thread, 'ownerType') || get(thread, 'owner_type'))
  const priorityScore = isPresent(finalScore) ? `${Math.round(Number(String(finalScore).replace(/[^0-9.]/g, '')))}/100` : null

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
  thread: InboxWorkflowThread
  onStatusChange: (status: InboxStatus) => void
  onStageChange: (stage: SellerStage) => void
}) => {
  const [statusOpen, setStatusOpen] = useState(false)
  const [stageOpen, setStageOpen] = useState(false)
  const statusVisual = getStatusVisual(thread.inboxStatus)
  const stageVisual = getSellerStageVisual(thread.conversationStage)
  const autoVisual = automationStateVisuals[thread.automationState]

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
        <span className="nx-workflow-pill" style={{ '--wp-color': autoVisual.color } as any}>{autoVisual.label}</span>
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

const PremiumPropertySnapshotCard = ({ thread, intelligence }: { thread: InboxWorkflowThread; intelligence: ThreadIntelligenceRecord | null }) => {
  const snapshot = normalizePropertySnapshot(intelligence, thread)
  const address = snapshot.fullAddress || thread.propertyAddress || thread.subject || 'Property Unknown'
  const streetViewUrl = snapshot.streetViewUrl
  const aerialViewUrl = snapshot.aerialViewUrl || buildAerialViewUrl(address)
  const [streetFailed, setStreetFailed] = useState(false)
  const [aerialFailed, setAerialFailed] = useState(false)
  const links = buildPropertyExternalLinks(address)
  const market = snapshot.market || thread.market || thread.marketId || 'Unknown Market'
  const propertyType = normalizeText(snapshot.propertyType || asStr(get(thread, 'propertyType')) || 'Residential')
  const category = detectPropertyCategory(thread)
  const estimatedValue = formatMoney(get(thread, 'estimatedValue') || get(thread, 'estimated_value') || get(thread, 'zestimate'))
  const equityPct = formatPercent(get(thread, 'equityPercent') || get(thread, 'equity_percent'))
  const repairCost = formatMoney(get(thread, 'estimatedRepairCost') || get(thread, 'estimated_repair_cost'))

  useEffect(() => {
    setStreetFailed(false)
    setAerialFailed(false)
  }, [streetViewUrl, aerialViewUrl])

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
          <div className="nx-property-snapshot__badges">
            {category === 'multifamily' && <span className="nx-badge nx-badge--multi">MULTIFAMILY</span>}
            {category === 'hotel' && <span className="nx-badge nx-badge--commercial">HOTEL</span>}
            {category === 'storage' && <span className="nx-badge nx-badge--commercial">STORAGE</span>}
            {category === 'retail' && <span className="nx-badge nx-badge--commercial">RETAIL</span>}
            {category === 'land' && <span className="nx-badge nx-badge--land">LAND</span>}
          </div>
        </div>
        
        <div className="nx-property-snapshot__metrics">
          {isPresent(snapshot.beds) && <QuietBadge label={`${snapshot.beds} Bed${snapshot.beds !== '1' ? 's' : ''}`} />}
          {isPresent(snapshot.baths) && <QuietBadge label={`${snapshot.baths} Bath${snapshot.baths !== '1' ? 's' : ''}`} />}
          {isPresent(snapshot.sqft) && <QuietBadge label={`${Number(snapshot.sqft).toLocaleString()} sqft`} />}
          {isPresent(snapshot.yearBuilt) && <QuietBadge label={`Built ${snapshot.yearBuilt}`} />}
          {isPresent(estimatedValue) && <QuietBadge label={estimatedValue || ''} tone="accent" />}
          {isPresent(equityPct) && <QuietBadge label={`${equityPct} equity`} />}
          {isPresent(repairCost) && <QuietBadge label={`${repairCost} repairs`} tone="warning" />}
        </div>
      </div>
    </div>
  )
}

// ── 4. Next Best Action ───────────────────────────────────────────────────

export const AIActionCard = ({ thread, isSuppressed }: { thread: InboxWorkflowThread; isSuppressed: boolean }) => {
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
              {thread.equityPercent && `, Equity = ${formatPercent(thread.equityPercent)}`}
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

const PremiumOfferMemoCard = ({ thread }: { thread: InboxWorkflowThread }) => {
  const category = detectPropertyCategory(thread)
  const isMulti = category === 'multifamily'
  const hasArv = isPresent(get(thread, 'arv') || get(thread, 'afterRepairValue'))
  const hasCondition = isPresent(get(thread, 'estimatedRepairCost') || get(thread, 'estimated_repair_cost'))
  const hasRentRoll = isPresent(get(thread, 'rentRoll') || get(thread, 'rent_roll'))

  const cashOffer = get(thread, 'cashOffer') || get(thread, 'cash_offer') || get(thread, 'mao')
  const aiOffer = get(thread, 'aiRecommendedOffer') || get(thread, 'ai_offer') || get(thread, 'ai_recommended_opening_offer')
  const targetContract = get(thread, 'targetContract') || get(thread, 'target_contract')
  const walkaway = get(thread, 'walkawayPrice') || get(thread, 'walkaway_price') || get(thread, 'walkaway_internal')
  const offerConfidence = get(thread, 'offerConfidence') || get(thread, 'offer_confidence') || get(thread, 'confidenceBand')
  const sellerAsk = get(thread, 'sellerAsk') || get(thread, 'seller_ask')
  const nextRequired = get(thread, 'nextRequiredInfo') || get(thread, 'next_required_info')

  const offerStatus = useMemo(() => {
    if (thread.isSuppressed || thread.isOptOut) return { label: 'Blocked', color: '#ff453a' }
    if (aiOffer && isPresent(aiOffer)) return { label: 'Ready', color: '#30d158' }
    if (!hasArv) return { label: 'Needs ARV', color: '#ff453a' }
    if (!hasCondition) return { label: 'Needs Repairs', color: '#ffd60a' }
    if (isMulti && !hasRentRoll) return { label: 'Needs Rent Roll', color: '#ff9f0a' }
    if (!isPresent(sellerAsk)) return { label: 'Needs Seller Ask', color: '#64d2ff' }
    return { label: 'Ready', color: '#30d158' }
  }, [aiOffer, hasArv, hasCondition, isMulti, hasRentRoll, sellerAsk, thread.isSuppressed, thread.isOptOut])

  let aiOfferDisplay: string
  if (aiOffer && isPresent(aiOffer)) {
    aiOfferDisplay = formatMoney(aiOffer) || normalizeText(aiOffer)
  } else if (isMulti && !hasRentRoll) {
    aiOfferDisplay = 'Needs rent roll'
  } else if (!hasArv) {
    aiOfferDisplay = 'Needs ARV'
  } else if (!hasCondition) {
    aiOfferDisplay = 'Needs condition'
  } else {
    aiOfferDisplay = 'Needs underwriting'
  }

  const hasAnyOfferField = [cashOffer, aiOffer, targetContract, walkaway].some((v) => isPresent(v))

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
          <MetricInline label="Legacy cash offer" value={formatMoney(cashOffer)} tone="accent" />
          <MetricInline label="AI recommended opening" value={aiOfferDisplay} tone="accent" />
          <MetricInline label="Target contract" value={formatMoney(targetContract)} />
          <MetricInline label="MAO" value={formatMoney(get(thread, 'mao') || get(thread, 'maxAllowableOffer') || get(thread, 'max_allowable_offer'))} />
          <MetricInline label="Walkaway internal" value={formatMoney(walkaway) || 'Needs underwriting'} tone="danger" />
        </div>
        <div className="nx-offer-memo-card__group">
          <MetricInline
            label="Missing underwriting info"
            value={isPresent(nextRequired) ? asStr(nextRequired) : !hasArv ? 'ARV verification' : !hasCondition ? 'Condition details' : isMulti && !hasRentRoll ? 'Rent roll' : !isPresent(sellerAsk) ? 'Seller ask' : 'None'}
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
  { id: 'overview', label: 'Overview', icon: 'layers' },
  { id: 'valuation', label: 'Valuation', icon: 'trending-up' },
  { id: 'condition', label: 'Condition', icon: 'alert' },
  { id: 'tax', label: 'Tax', icon: 'briefing' },
  { id: 'owner', label: 'Owner', icon: 'user' },
  { id: 'links', label: 'Links', icon: 'arrow-up-right' },
]

export const PropertyIntelligenceTabs = ({
  thread,
  intelligence,
}: {
  thread: InboxWorkflowThread
  intelligence: ThreadIntelligenceRecord | null
}) => {
  const [activeTab, setActiveTab] = useState('overview')

  const snapshot = normalizePropertySnapshot(intelligence, thread)
  const extLinks = buildPropertyExternalLinks(snapshot.fullAddress || thread.propertyAddress || thread.subject || null)

  const fields = useMemo(() => ({
    unitCount: snapshot.unitCount || get(thread, 'unitCount') || get(thread, 'unit_count') || get(thread, 'units'),
    yearBuilt: snapshot.yearBuilt || get(thread, 'yearBuilt') || get(thread, 'year_built'),
    effectiveYear: snapshot.effectiveYear || get(thread, 'effectiveYear') || get(thread, 'effective_year_built'),
    constructionType: get(thread, 'constructionType') || get(thread, 'construction_type'),
    exteriorWalls: get(thread, 'exteriorWalls') || get(thread, 'exterior_walls'),
    floorCover: get(thread, 'floorCover') || get(thread, 'floor_cover'),
    basement: get(thread, 'basement') || get(thread, 'basement_type'),
    hvacType: get(thread, 'hvacType') || get(thread, 'hvac_type') || get(thread, 'ac_heating'),
    roofCover: get(thread, 'roofCover') || get(thread, 'roof_cover'),
    beds: snapshot.beds || get(thread, 'beds') || get(thread, 'bedrooms'),
    baths: snapshot.baths || get(thread, 'baths') || get(thread, 'bathrooms'),
    sqft: snapshot.sqft || get(thread, 'sqft') || get(thread, 'livingAreaSqft'),
    stories: get(thread, 'stories') || get(thread, 'num_stories'),
    garage: get(thread, 'garageOrParking') || get(thread, 'garage_or_parking'),
    propertyType: snapshot.propertyType || get(thread, 'propertyType') || get(thread, 'property_type'),
    occupancy: snapshot.occupancy || get(thread, 'occupancy'),
    county: get(thread, 'county') || get(thread, 'property_county'),
    apn: get(thread, 'apn') || get(thread, 'apn_parcel_id'),
    zoning: get(thread, 'zoning') || get(thread, 'zoning_code'),
    lotSize: snapshot.lotSize || get(thread, 'lotSize') || get(thread, 'lot_size_sqft'),
  }), [thread, snapshot])

  const availableCount = getAvailableFields(fields).length

  const tabs = PROPERTY_TABS.map((t) => t.id === 'overview' ? { ...t, count: availableCount } : t)

  return (
    <DossierCard className="nx-property-tabs">
      <DossierTabGroup tabs={tabs} active={activeTab} onChange={setActiveTab} />
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
                <DossierMetric label="Est. Value" value={formatMoney(get(thread, 'estimatedValue') || get(thread, 'estimated_value') || get(thread, 'zestimate'))} icon="trending-up" accent="green" />
                <DossierMetric label="Assessed Value" value={formatMoney(get(thread, 'assessedValue') || get(thread, 'assessed_value'))} icon="stats" />
                <DossierMetric label="Last Sale Price" value={formatMoney(get(thread, 'lastSalePrice') || get(thread, 'last_sale_price'))} icon="arrow-up-right" />
                <DossierMetric label="Equity Amount" value={formatMoney(get(thread, 'equityAmount') || get(thread, 'equity_amount'))} icon="zap" accent="green" />
                <DossierMetric label="Equity %" value={formatPercent(get(thread, 'equityPercent') || get(thread, 'equity_percent'))} icon="activity" accent="green" />
              </div>
            </div>
            <MissingDataDisclosure fields={getMissingFields({
              estimatedValue: get(thread, 'estimatedValue'),
              assessedValue: get(thread, 'assessedValue'),
              lastSalePrice: get(thread, 'lastSalePrice'),
              equityAmount: get(thread, 'equityAmount'),
              equityPercent: get(thread, 'equityPercent'),
            })} />
          </>
        )}
        {activeTab === 'condition' && (
          <>
            <div className="nx-field-group">
              <div className="nx-field-group__title"><Icon name="alert" /><span>Condition</span></div>
              <div className="nx-data-grid">
                <DossierMetric label="Repair Cost" value={formatMoney(get(thread, 'estimatedRepairCost') || get(thread, 'estimated_repair_cost'))} icon="activity" accent="red" />
                <DossierMetric label="Rehab Level" value={toChip(get(thread, 'rehabLevel') || get(thread, 'rehab_level'))} icon="alert" accent="amber" />
                <DossierMetric label="Building Condition" value={toChip(get(thread, 'buildingCondition') || get(thread, 'building_condition'))} icon="eye" />
                <DossierMetric label="Building Quality" value={toChip(get(thread, 'buildingQuality') || get(thread, 'building_quality'))} icon="eye" />
                <DossierMetric label="Distress Tags" value={toChip(get(thread, 'distressTags') || get(thread, 'distress_tags'))} icon="alert" accent="amber" />
              </div>
            </div>
            <MissingDataDisclosure fields={getMissingFields({
              estimatedRepairCost: get(thread, 'estimatedRepairCost'),
              rehabLevel: get(thread, 'rehabLevel'),
              buildingCondition: get(thread, 'buildingCondition'),
              buildingQuality: get(thread, 'buildingQuality'),
              distressTags: get(thread, 'distressTags'),
            })} />
          </>
        )}
        {activeTab === 'tax' && (
          <>
            <div className="nx-field-group">
              <div className="nx-field-group__title"><Icon name="briefing" /><span>Tax & Assessment</span></div>
              <div className="nx-data-grid">
                <DossierMetric label="Annual Tax" value={formatMoney(get(thread, 'annualTaxes') || get(thread, 'tax_amount'))} icon="stats" accent="amber" />
                <DossierMetric label="Assessed Total" value={formatMoney(get(thread, 'assessedValue') || get(thread, 'assd_total_value'))} icon="stats" accent="blue" />
                <DossierMetric label="Assessed Land" value={formatMoney(get(thread, 'assdLandValue') || get(thread, 'assd_land_value'))} icon="map" accent="blue" />
                <DossierMetric label="Assessed Improvement" value={formatMoney(get(thread, 'assdImprovementValue') || get(thread, 'assd_improvement_value'))} icon="layers" accent="blue" />
                <DossierMetric label="Tax Year" value={toChip(get(thread, 'taxYear') || get(thread, 'tax_year'))} icon="calendar" />
                <DossierMetric label="Tax Delinquent" value={thread.isTaxDelinquent ? 'Yes' : null} icon="shield" accent="red" />
              </div>
            </div>
            <MissingDataDisclosure fields={getMissingFields({
              annualTaxes: get(thread, 'annualTaxes'),
              assessedValue: get(thread, 'assessedValue'),
              assdLandValue: get(thread, 'assdLandValue'),
              assdImprovementValue: get(thread, 'assdImprovementValue'),
              taxYear: get(thread, 'taxYear'),
            })} />
          </>
        )}
        {activeTab === 'owner' && (
          <>
            <div className="nx-field-group">
              <div className="nx-field-group__title"><Icon name="user" /><span>Ownership</span></div>
              <div className="nx-data-grid">
                <DossierMetric label="Owner Type" value={toChip(get(thread, 'ownerType') || get(thread, 'owner_type'))} icon="user" />
                <DossierMetric label="Absentee" value={thread.isAbsentee ? 'Yes' : null} icon="map" accent="amber" />
                <DossierMetric label="Owner Occupied" value={thread.isOwnerOccupied ? 'Yes' : null} icon="home" accent="green" />
                <DossierMetric label="Out of State" value={get(thread, 'outOfStateOwner') ? 'Yes' : null} icon="globe" />
                <DossierMetric label="Occupancy" value={toChip(get(thread, 'occupancy'))} icon="layers" />
              </div>
            </div>
            <MissingDataDisclosure fields={getMissingFields({
              ownerType: get(thread, 'ownerType'),
              occupancy: get(thread, 'occupancy'),
            })} />
          </>
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

export const SellerOwnerCard = ({ thread }: { thread: InboxWorkflowThread }) => {
  const ownerName = thread.ownerDisplayName || thread.ownerName || asStr(get(thread, 'sellerName')) || 'Unknown Seller'
  const phone = fmtPhone(thread.phoneNumber || thread.canonicalE164 || get(thread, 'seller_phone'))
  const phoneConfidence = get(thread, 'phoneConfidence') || get(thread, 'phone_confidence')
  const language = get(thread, 'contactLanguage') || get(thread, 'language') || get(thread, 'seller_language')
  const ownerType = get(thread, 'ownerType') || get(thread, 'owner_type')
  const mailingAddress = get(thread, 'mailingAddress') || get(thread, 'mailing_address')
  const mailingCity = get(thread, 'mailingCity') || get(thread, 'mailing_city')
  const mailingState = get(thread, 'mailingState') || get(thread, 'mailing_state')
  const mailingZip = get(thread, 'mailingZip') || get(thread, 'mailing_zip')
  const mailingLocation = [mailingAddress, mailingCity, mailingState, mailingZip].filter((v) => isPresent(v)).join(', ')
  const ownershipYears = get(thread, 'ownershipYears') || get(thread, 'years_owned')
  const motivationScore = get(thread, 'motivationScore') || get(thread, 'motivation_score')
  const lastIntent = thread.uiIntent || get(thread, 'lastIntent')
  const lastInbound = thread.lastInboundAt
  const lastOutbound = thread.lastOutboundAt
  const email = get(thread, 'ownerEmail') || get(thread, 'owner_email') || get(thread, 'email')
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
        <MetricInline label="Phone confidence" value={isPresent(phoneConfidence) ? asStr(phoneConfidence) : null} />
        <MetricInline label="Language" value={isPresent(language) ? asStr(language) : null} />
        <MetricInline label="Motivation score" value={isPresent(motivationScore) ? `${Math.round(Number(String(motivationScore).replace(/[^0-9.]/g, '')))}/100` : null} tone="warning" />
        <MetricInline label="Last intent" value={isPresent(lastIntent) ? asStr(lastIntent) : null} />
        <MetricInline label="Last inbound" value={lastInbound ? formatRelativeTime(lastInbound) : null} />
        <MetricInline label="Last outbound" value={lastOutbound ? formatRelativeTime(lastOutbound) : null} />
        <MetricInline label="Mailing address" value={isPresent(mailingLocation) ? mailingLocation : null} />
        <MetricInline label="Ownership years" value={isPresent(ownershipYears) ? `${toChip(ownershipYears)} yrs` : null} />
      </div>
      {!hasIdentityData && <SectionEmptyState text="Owner contact intelligence has not been enriched yet." />}
    </DossierCard>
  )
}

export const LinkedRecordsCard = ({ thread }: { thread: InboxWorkflowThread }) => {
  const baseUrl = 'https://app.realestateflow.ai'
  const offerId = asStr(get(thread, 'offerId') || get(thread, 'offer_id'))
  const underwritingId = asStr(get(thread, 'underwritingId') || get(thread, 'underwriting_id') || get(thread, 'underwritingRunId'))
  const contractId = asStr(get(thread, 'contractId') || get(thread, 'contract_id'))
  const titleId = asStr(get(thread, 'titleId') || get(thread, 'title_id') || get(thread, 'titleFileId'))
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

// ── 8. Automation Timeline ────────────────────────────────────────────────

const TimelineCard = ({ thread }: { thread: InboxWorkflowThread }) => {
  const stageVisual = getSellerStageVisual(thread.conversationStage)
  const autoVisual = automationStateVisuals[thread.automationState]

  const timedItems = [
    { label: 'First Touch', time: get(thread, 'firstTouchAt') || get(thread, 'first_touch_at') || thread.updatedAt, done: true },
    { label: 'Last Outbound', time: thread.lastOutboundAt, done: Boolean(thread.lastOutboundAt) },
    { label: 'Seller Replied', time: thread.lastInboundAt, done: Boolean(thread.lastInboundAt), active: thread.inboxStatus === 'new_reply' },
  ]
    .filter((item) => item.time)
    .sort((a, b) => new Date(String(a.time)).getTime() - new Date(String(b.time)).getTime())

  const statusItems = [
    { label: 'Current Stage', labelExtra: stageVisual.label, done: true, active: true },
    { label: 'Automation', labelExtra: autoVisual.label, done: true },
    { label: 'Queue', labelExtra: asStr(thread.queueStatus) || 'Healthy', done: Boolean(thread.queueStatus) },
  ]

  const items = [...timedItems, ...statusItems]

  const isCritical = thread.inboxStatus === 'new_reply' || thread.inboxStatus === 'ai_draft_ready' || thread.queueStatus === 'stuck'

  return (
    <DossierCard className="nx-force-card nx-timeline-card nx-timeline-workspace-card">
      <div className="nx-dossier-section__title" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="activity" />
          Automation Timeline
        </span>
        {isCritical ? <QuietBadge label="Critical" tone="accent" /> : null}
      </div>
      <div className="nx-timeline">
        {items.map((item, idx) => (
          <div key={idx} className={cls('nx-timeline-item', (item as any).done && 'is-done', (item as any).active && 'is-active')}>
            <div className="nx-timeline-dot" />
            <div className="nx-timeline-content">
              <div className="nx-timeline-label">
                <span>{(item as any).label}</span>
                {(item as any).labelExtra && <span className="nx-timeline-extra">{(item as any).labelExtra}</span>}
              </div>
              {(item as any).time && <small>{formatDate((item as any).time)}</small>}
            </div>
          </div>
        ))}
      </div>
    </DossierCard>
  )
}


// ── Tabbed Intelligence System ────────────────────────────────────────────

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
  { id: 'overview', label: 'Overview' },
  { id: 'prospect', label: 'Prospect' },
  { id: 'owner', label: 'Owner' },
  { id: 'property', label: 'Property Intel' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'financial', label: 'Financial' },
  { id: 'conversation', label: 'Conversation' },
  { id: 'automation', label: 'Automation' },
  { id: 'timeline', label: 'Timeline' },
]

const getFromRecord = (record: Record<string, unknown> | null | undefined, key: string): unknown => {
  if (!record) return null
  return record[key] ?? record[key.replace(/_/g, '')] ?? record[key.charAt(0).toUpperCase() + key.slice(1)]
}

const getAny = (
  thread: InboxWorkflowThread,
  intelligence: ThreadIntelligenceRecord | null,
  keys: string[],
): unknown => {
  for (const key of keys) {
    const threadValue = get(thread, key)
    if (isPresent(threadValue)) return threadValue
    const intelValue = getFromRecord(intelligence, key)
    if (isPresent(intelValue)) return intelValue
  }
  return null
}

const formatScore = (value: unknown): string | null => {
  if (!isPresent(value)) return null
  const num = Number(String(value).replace(/[^0-9.]/g, ''))
  return Number.isFinite(num) ? `${Math.round(num)}/100` : asStr(value)
}

const formatCount = (value: unknown): string | null => isPresent(value) ? Number(String(value).replace(/,/g, '')).toLocaleString() : null

const formatYesNo = (value: unknown): 'Yes' | 'No' => {
  const normalized = normalizeText(value).toLowerCase()
  if (['true', 'yes', 'y', '1', 'active'].includes(normalized)) return 'Yes'
  return value === true ? 'Yes' : 'No'
}

const FieldTile = ({ label, value, tone = 'default' }: { label: string; value: unknown; tone?: 'default' | 'good' | 'warn' | 'bad' | 'accent' }) => (
  <div className={cls('nx-intel-field', tone !== 'default' && `is-${tone}`)}>
    <span>{label}</span>
    <strong>{isPresent(value) ? asStr(value) : 'Not enriched'}</strong>
  </div>
)

const FieldGrid = ({ children, columns = 2 }: { children: React.ReactNode; columns?: 2 | 3 }) => (
  <div className={cls('nx-intel-field-grid', columns === 3 && 'is-3-col')}>{children}</div>
)

const PanelSection = ({ title, icon = 'grid', children }: { title: string; icon?: IconName; children: React.ReactNode }) => (
  <section className="nx-intel-section">
    <div className="nx-intel-section__title"><Icon name={icon} /><span>{title}</span></div>
    {children}
  </section>
)

const MatchBadge = ({ label, tone }: { label: string; tone: 'green' | 'yellow' | 'red' }) => (
  <span className={cls('nx-match-badge', `is-${tone}`)}>{label}</span>
)

const YesNoBadge = ({ label, yes }: { label: string; yes: boolean }) => (
  <span className={cls('nx-binary-badge', yes ? 'is-yes' : 'is-no')}>{label}: {yes ? 'Yes' : 'No'}</span>
)

const buildMatchBadges = (thread: InboxWorkflowThread, intelligence: ThreadIntelligenceRecord | null) => {
  const tags = String(getAny(thread, intelligence, ['contactMatchTags', 'contact_match_tags', 'match_tags']) || '')
    .split(/[;,|]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
  const ownerType = normalizeText(getAny(thread, intelligence, ['ownerType', 'owner_type'])).toLowerCase()
  const confidence = Number(getAny(thread, intelligence, ['matchingConfidence', 'match_confidence', 'phoneConfidence', 'phone_confidence']) || 0)
  const out = new Map<string, 'green' | 'yellow' | 'red'>()

  if (confidence >= 80 || thread.ownerId) out.set('Likely Owner', 'green')
  else if (confidence >= 45 || thread.prospectId) out.set('Potential Owner', 'yellow')
  if (ownerType.includes('llc') || ownerType.includes('corpor') || ownerType.includes('company')) out.set('Linked To Company', 'green')
  if (tags.some((tag) => /company|business|entity/i.test(tag))) out.set('Potential Company Link', 'yellow')
  if (tags.some((tag) => /family|relative/i.test(tag))) out.set('Family Match', 'yellow')
  if (tags.some((tag) => /resident|occupant/i.test(tag))) out.set('Resident Match', 'yellow')
  if (tags.some((tag) => /renter|tenant/i.test(tag))) out.set('Likely Renter', 'red')
  if (thread.isOptOut || confidence < 30) out.set('Wrong Contact Risk', 'red')
  if (!out.size) out.set('Potential Owner', 'yellow')
  return Array.from(out.entries()).map(([label, tone]) => ({ label, tone }))
}

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

export const OverviewPanel = ({ thread, intelligence, messages }: { thread: InboxWorkflowThread; intelligence: ThreadIntelligenceRecord | null; messages: ThreadMessage[] }) => {
  const action = getNextBestAction(thread)
  const latestInbound = messages.find((message) => message.direction === 'inbound')?.body || thread.latestMessageBody || thread.lastMessageBody
  return (
    <div className="nx-intel-panel-grid">
      <PanelSection title="Acquisition Command" icon="spark">
        <FieldGrid columns={3}>
          <FieldTile label="Acquisition Score" value={formatScore(getAny(thread, intelligence, ['finalAcquisitionScore', 'final_acquisition_score', 'acquisition_score', 'motivationScore']))} tone="good" />
          <FieldTile label="Deal Strength" value={getAny(thread, intelligence, ['dealStrength', 'deal_strength', 'priorityBucket']) || thread.priority} tone="accent" />
          <FieldTile label="Close Probability" value={formatPercent(getAny(thread, intelligence, ['closeProbability', 'estimatedCloseProbability', 'close_probability'])) || formatPercent(thread.motivationScore)} />
          <FieldTile label="Intent Classification" value={thread.uiIntent || getAny(thread, intelligence, ['intent_classification', 'seller_intent'])} />
          <FieldTile label="Lead Status" value={getStatusVisual(thread.inboxStatus).label} />
          <FieldTile label="Seller Responsiveness" value={getAny(thread, intelligence, ['sellerResponsiveness', 'seller_responsiveness']) || (thread.lastInboundAt ? 'Responsive' : 'Unproven')} />
        </FieldGrid>
      </PanelSection>
      <PanelSection title="AI Recommendation" icon="spark">
        <div className="nx-intel-copy-card">
          <strong>{action.title}</strong>
          <p>{action.reason}</p>
          <div className="nx-intel-badge-row">
            <QuietBadge label={`Next: ${thread.nextSystemAction || action.suggestedReply || 'Monitor thread'}`} tone="accent" />
            <QuietBadge label={`Automation ${automationStateVisuals[thread.automationState].label}`} />
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

export const ProspectPanel = ({ thread, intelligence }: { thread: InboxWorkflowThread; intelligence: ThreadIntelligenceRecord | null }) => {
  const badges = buildMatchBadges(thread, intelligence)
  return (
    <div className="nx-intel-panel-grid">
      <PanelSection title="Prospect Identity" icon="users">
        <div className="nx-match-badge-row">{badges.map((badge) => <MatchBadge key={badge.label} label={badge.label} tone={badge.tone} />)}</div>
        <FieldGrid>
          <FieldTile label="Prospect Name" value={getAny(thread, intelligence, ['prospectName', 'prospect_full_name', 'sellerName']) || thread.ownerDisplayName || thread.ownerName} tone="accent" />
          <FieldTile label="Matching Confidence" value={formatScore(getAny(thread, intelligence, ['matchingConfidence', 'match_confidence', 'phoneConfidence']))} />
          <FieldTile label="Contact Match Tags" value={getAny(thread, intelligence, ['contactMatchTags', 'contact_match_tags', 'matchedKeywords'])} />
          <FieldTile label="Age" value={getAny(thread, intelligence, ['age', 'prospect_age'])} />
          <FieldTile label="Marital Status" value={getAny(thread, intelligence, ['maritalStatus', 'marital_status'])} />
          <FieldTile label="Gender" value={getAny(thread, intelligence, ['gender'])} />
          <FieldTile label="Language" value={getAny(thread, intelligence, ['contactLanguage', 'language', 'seller_language'])} />
          <FieldTile label="Education" value={getAny(thread, intelligence, ['education'])} />
          <FieldTile label="Household Income" value={formatMoney(getAny(thread, intelligence, ['householdIncome', 'household_income']))} />
          <FieldTile label="Net Asset Value" value={formatMoney(getAny(thread, intelligence, ['netAssetValue', 'net_asset_value']))} />
          <FieldTile label="Occupation" value={getAny(thread, intelligence, ['occupation'])} />
          <FieldTile label="Occupation Group" value={getAny(thread, intelligence, ['occupationGroup', 'occupation_group'])} />
          <FieldTile label="Prospect Tags" value={getAny(thread, intelligence, ['prospectTags', 'prospect_tags', 'labels'])} />
          <FieldTile label="Phone Number" value={fmtPhone(thread.phoneNumber || thread.canonicalE164 || getAny(thread, intelligence, ['phone', 'phone_number']))} tone="good" />
          <FieldTile label="Phone Carrier" value={getAny(thread, intelligence, ['phoneCarrier', 'phone_carrier', 'carrier'])} />
          <FieldTile label="Email" value={getAny(thread, intelligence, ['email', 'ownerEmail', 'owner_email'])} />
          <FieldTile label="Contactability Score" value={formatScore(getAny(thread, intelligence, ['contactabilityScore', 'contactability_score', 'phoneConfidence']))} />
        </FieldGrid>
      </PanelSection>
    </div>
  )
}

export const OwnerPanel = ({ thread, intelligence }: { thread: InboxWorkflowThread; intelligence: ThreadIntelligenceRecord | null }) => (
  <div className="nx-intel-panel-grid">
    <PanelSection title="Owner Operations" icon="user">
      <FieldGrid>
        <FieldTile label="Priority Tier" value={thread.priority || getAny(thread, intelligence, ['priorityTier', 'priority_tier'])} tone="accent" />
        <FieldTile label="Priority Score" value={formatScore(getAny(thread, intelligence, ['priorityScore', 'priority_score', 'finalAcquisitionScore']))} />
        <FieldTile label="Best Contact Window" value={getAny(thread, intelligence, ['bestContactWindow', 'best_contact_window', 'bestContactTime']) || 'Afternoon'} />
        <FieldTile label="Ownership Years" value={getAny(thread, intelligence, ['ownershipYears', 'years_owned'])} />
        <FieldTile label="Owner Occupied" value={formatYesNo(thread.isOwnerOccupied || getAny(thread, intelligence, ['owner_occupied']))} tone={thread.isOwnerOccupied ? 'good' : 'bad'} />
        <FieldTile label="Absentee Status" value={formatYesNo(thread.isAbsentee || getAny(thread, intelligence, ['absentee', 'absentee_status']))} tone={thread.isAbsentee ? 'warn' : 'good'} />
        <FieldTile label="Corporate Flag" value={formatYesNo(getAny(thread, intelligence, ['corporateFlag', 'corporate_flag']))} />
        <FieldTile label="Trust Flag" value={formatYesNo(getAny(thread, intelligence, ['trustFlag', 'trust_flag']))} />
        <FieldTile label="LLC Flag" value={formatYesNo(String(getAny(thread, intelligence, ['ownerType', 'owner_type'])).toLowerCase().includes('llc'))} />
        <FieldTile label="Vacancy Risk" value={formatYesNo(thread.isVacant || getAny(thread, intelligence, ['vacancyRisk', 'vacancy_risk']))} tone={thread.isVacant ? 'warn' : 'good'} />
        <FieldTile label="Seller Persona" value={getAny(thread, intelligence, ['sellerPersona', 'seller_persona']) || getSellerStageVisual(thread.conversationStage).label} />
        <FieldTile label="Motivation Drivers" value={getAny(thread, intelligence, ['motivationDrivers', 'motivation_drivers', 'motivationSummary', 'distressTags'])} />
        <FieldTile label="Decision Maker Confidence" value={formatScore(getAny(thread, intelligence, ['decisionMakerConfidence', 'decision_maker_confidence', 'matchingConfidence']))} />
      </FieldGrid>
    </PanelSection>
  </div>
)

export const PropertyIntelPanel = ({ thread, intelligence }: { thread: InboxWorkflowThread; intelligence: ThreadIntelligenceRecord | null }) => {
  const snapshot = normalizePropertySnapshot(intelligence, thread)
  const address = snapshot.fullAddress || thread.propertyAddress || thread.subject || null
  const extLinks = buildPropertyExternalLinks(address)
  const value = getAny(thread, intelligence, ['estimatedValue', 'estimated_value', 'zestimate'])
  const equity = getAny(thread, intelligence, ['equityAmount', 'equity', 'equity_amount'])
  return (
    <div className="nx-intel-panel-grid">
      <PanelSection title="Asset Profile" icon="layers">
        <FieldGrid>
          <FieldTile label="Asset Type" value={snapshot.propertyType || getAny(thread, intelligence, ['propertyType', 'property_type'])} />
          <FieldTile label="Occupancy" value={snapshot.occupancy || getAny(thread, intelligence, ['occupancy'])} />
          <FieldTile label="Lot Size" value={snapshot.lotSize || getAny(thread, intelligence, ['lotSize', 'lot_size_sqft'])} />
          <FieldTile label="Zoning" value={getAny(thread, intelligence, ['zoning', 'zoning_code'])} />
          <FieldTile label="County" value={getAny(thread, intelligence, ['county', 'property_county'])} />
          <FieldTile label="Subdivision" value={getAny(thread, intelligence, ['subdivision'])} />
          <FieldTile label="School District" value={getAny(thread, intelligence, ['schoolDistrict', 'school_district'])} />
          <FieldTile label="Stories" value={getAny(thread, intelligence, ['stories', 'num_stories'])} />
          <FieldTile label="Garage" value={getAny(thread, intelligence, ['garageOrParking', 'garage_or_parking'])} />
          <FieldTile label="Roof" value={getAny(thread, intelligence, ['roofCover', 'roof_cover'])} />
          <FieldTile label="HVAC" value={getAny(thread, intelligence, ['hvacType', 'hvac_type', 'ac_heating'])} />
          <FieldTile label="Foundation" value={getAny(thread, intelligence, ['foundation', 'foundation_type'])} />
          <FieldTile label="Construction Type" value={getAny(thread, intelligence, ['constructionType', 'construction_type'])} />
        </FieldGrid>
      </PanelSection>
      <PanelSection title="Valuation" icon="trending-up">
        <FieldGrid>
          <FieldTile label="Estimated Value" value={formatMoney(value)} tone="good" />
          <FieldTile label="ARV" value={formatMoney(getAny(thread, intelligence, ['arv', 'afterRepairValue', 'after_repair_value']))} />
          <FieldTile label="Walkaway" value={formatMoney(getAny(thread, intelligence, ['walkawayPrice', 'walkaway_price', 'walkaway_internal']))} />
          <FieldTile label="Price Per Sqft" value={formatMoney(getAny(thread, intelligence, ['pricePerSqft', 'price_per_sqft']))} />
          <FieldTile label="AI Confidence" value={formatScore(getAny(thread, intelligence, ['aiConfidence', 'ai_confidence', 'offerConfidence']))} />
          <FieldTile label="Acquisition Score" value={formatScore(getAny(thread, intelligence, ['finalAcquisitionScore', 'acquisition_score']))} />
          <FieldTile label="Deal Strength" value={getAny(thread, intelligence, ['dealStrength', 'deal_strength']) || thread.priority} />
        </FieldGrid>
      </PanelSection>
      <PanelSection title="Distress" icon="alert">
        <FieldGrid>
          <FieldTile label="Tax Delinquent" value={formatYesNo(thread.isTaxDelinquent)} tone={thread.isTaxDelinquent ? 'warn' : 'good'} />
          <FieldTile label="Active Lien" value={formatYesNo(thread.hasLien || getAny(thread, intelligence, ['activeLien', 'active_lien']))} tone={thread.hasLien ? 'warn' : 'good'} />
          <FieldTile label="Distress Tags" value={getAny(thread, intelligence, ['distressTags', 'distress_tags', 'podioTags'])} />
          <FieldTile label="Foreclosure Indicators" value={formatYesNo(getAny(thread, intelligence, ['foreclosureIndicators', 'foreclosure_indicators']))} />
          <FieldTile label="Motivation Stack" value={getAny(thread, intelligence, ['motivationStack', 'motivation_stack', 'motivationSummary'])} />
        </FieldGrid>
      </PanelSection>
      <PanelSection title="Mortgage Stack" icon="stats">
        <FieldGrid>
          <FieldTile label="Loan Balance" value={formatMoney(getAny(thread, intelligence, ['loanBalance', 'loan_balance', 'mortgageBalance']))} />
          <FieldTile label="Equity" value={formatMoney(equity)} tone="good" />
          <FieldTile label="Equity %" value={formatPercent(getAny(thread, intelligence, ['equityPercent', 'equity_percent']))} />
          <FieldTile label="Estimated Payment" value={formatMoney(getAny(thread, intelligence, ['estimatedPayment', 'estimated_payment']))} />
          <FieldTile label="Position Count" value={formatCount(getAny(thread, intelligence, ['positionCount', 'position_count']))} />
        </FieldGrid>
      </PanelSection>
      <PanelSection title="External Links" icon="arrow-up-right">
        <div className="nx-links-grid is-command-links">
          <LinkedRecordButton label="Zillow" url={extLinks.zillow} icon="globe" />
          <LinkedRecordButton label="Redfin" url={`https://www.redfin.com/stingray/do/query-location?location=${encodeURIComponent(address || '')}`} icon="globe" />
          <LinkedRecordButton label="County" url={asStr(getAny(thread, intelligence, ['countyUrl', 'county_url'])) || undefined} icon="briefing" />
          <LinkedRecordButton label="Parcel Viewer" url={asStr(getAny(thread, intelligence, ['parcelViewerUrl', 'parcel_viewer_url'])) || undefined} icon="map" />
          <LinkedRecordButton label="Google Maps" url={extLinks.googleSearch} icon="map" />
          <LinkedRecordButton label="Street View" url={extLinks.streetView} icon="map" />
          <LinkedRecordButton label="Satellite" url={buildAerialViewUrl(address || '')} icon="map" />
        </div>
      </PanelSection>
    </div>
  )
}

export const PortfolioPanel = ({ thread, intelligence }: { thread: InboxWorkflowThread; intelligence: ThreadIntelligenceRecord | null }) => (
  <div className="nx-intel-panel-grid">
    <PanelSection title="Portfolio Exposure" icon="layers">
      <FieldGrid>
        <FieldTile label="Portfolio Property Count" value={formatCount(getAny(thread, intelligence, ['portfolioPropertyCount', 'portfolio_property_count', 'propertyCount']))} />
        <FieldTile label="Property Type Majority" value={getAny(thread, intelligence, ['propertyTypeMajority', 'property_type_majority']) || getAny(thread, intelligence, ['propertyType'])} />
        <FieldTile label="SFR Count" value={formatCount(getAny(thread, intelligence, ['sfrCount', 'sfr_count']))} />
        <FieldTile label="MF Count" value={formatCount(getAny(thread, intelligence, ['mfCount', 'mf_count']))} />
        <FieldTile label="Total Units" value={formatCount(getAny(thread, intelligence, ['totalUnits', 'total_units', 'unitCount']))} />
        <FieldTile label="Portfolio Value" value={formatMoney(getAny(thread, intelligence, ['portfolioValue', 'portfolio_value']))} tone="good" />
        <FieldTile label="Total Equity" value={formatMoney(getAny(thread, intelligence, ['totalEquity', 'total_equity', 'equityAmount']))} tone="good" />
        <FieldTile label="Total Debt" value={formatMoney(getAny(thread, intelligence, ['totalDebt', 'total_debt']))} />
        <FieldTile label="Estimated Monthly Debt Payment" value={formatMoney(getAny(thread, intelligence, ['estimatedMonthlyDebtPayment', 'estimated_monthly_debt_payment']))} />
        <FieldTile label="Portfolio Geography" value={getAny(thread, intelligence, ['portfolioGeography', 'portfolio_geography']) || thread.market} />
        <FieldTile label="Average Equity %" value={formatPercent(getAny(thread, intelligence, ['averageEquityPercent', 'average_equity_percent', 'equityPercent']))} />
        <FieldTile label="Avg Ownership Years" value={getAny(thread, intelligence, ['avgOwnershipYears', 'avg_ownership_years', 'ownershipYears'])} />
      </FieldGrid>
    </PanelSection>
  </div>
)

export const FinancialPanel = ({ thread, intelligence }: { thread: InboxWorkflowThread; intelligence: ThreadIntelligenceRecord | null }) => {
  const taxYes = thread.isTaxDelinquent || formatYesNo(getAny(thread, intelligence, ['portfolioTaxDelinquentCount', 'portfolio_tax_delinquent_count'])) === 'Yes'
  const lienYes = thread.hasLien || formatYesNo(getAny(thread, intelligence, ['portfolioLienCount', 'portfolio_lien_count', 'activeLien'])) === 'Yes'
  return (
    <div className="nx-intel-panel-grid">
      <PanelSection title="Financial Pressure" icon="stats">
        <div className="nx-binary-badge-row">
          <YesNoBadge label="Tax Delinquent" yes={Boolean(taxYes)} />
          <YesNoBadge label="Active Lien" yes={Boolean(lienYes)} />
        </div>
        <FieldGrid>
          <FieldTile label="Financial Pressure Score" value={formatScore(getAny(thread, intelligence, ['financialPressureScore', 'financial_pressure_score', 'motivationScore']))} tone="warn" />
          <FieldTile label="Urgency Count" value={formatCount(getAny(thread, intelligence, ['urgencyCount', 'urgency_count']))} />
          <FieldTile label="Portfolio Tax Delinquent Count" value={formatCount(getAny(thread, intelligence, ['portfolioTaxDelinquentCount', 'portfolio_tax_delinquent_count']))} />
          <FieldTile label="Portfolio Lien Count" value={formatCount(getAny(thread, intelligence, ['portfolioLienCount', 'portfolio_lien_count']))} />
          <FieldTile label="Oldest Tax Year" value={getAny(thread, intelligence, ['oldestTaxYear', 'oldest_tax_year'])} />
          <FieldTile label="Total Tax Amount" value={formatMoney(getAny(thread, intelligence, ['totalTaxAmount', 'total_tax_amount', 'tax_amount']))} />
          <FieldTile label="Estimated Cash Distress" value={formatMoney(getAny(thread, intelligence, ['estimatedCashDistress', 'estimated_cash_distress']))} />
          <FieldTile label="High Risk Flags" value={getAny(thread, intelligence, ['highRiskFlags', 'high_risk_flags', 'distressTags'])} tone="bad" />
        </FieldGrid>
      </PanelSection>
    </div>
  )
}

export const ConversationPanel = ({ thread, intelligence, messages }: { thread: InboxWorkflowThread; intelligence: ThreadIntelligenceRecord | null; messages: ThreadMessage[] }) => {
  const inbound = messages.find((message) => message.direction === 'inbound')
  const outbound = messages.find((message) => message.direction === 'outbound')
  return (
    <div className="nx-intel-panel-grid">
      <PanelSection title="Conversation Intelligence" icon="message">
        <FieldGrid>
          <FieldTile label="Latest Inbound" value={inbound?.body || thread.latestMessageBody || thread.lastMessageBody} tone="accent" />
          <FieldTile label="Latest Outbound" value={outbound?.body || getAny(thread, intelligence, ['latestOutbound', 'latest_outbound'])} />
          <FieldTile label="AI Classification" value={thread.uiIntent || getAny(thread, intelligence, ['aiClassification', 'ai_classification'])} />
          <FieldTile label="Seller Sentiment" value={thread.sentiment || getAny(thread, intelligence, ['sellerSentiment', 'seller_sentiment'])} />
          <FieldTile label="Objection Type" value={getAny(thread, intelligence, ['objectionType', 'objection_type'])} />
          <FieldTile label="Seller Intent" value={thread.uiIntent || getAny(thread, intelligence, ['sellerIntent', 'seller_intent'])} />
          <FieldTile label="Timeline" value={getAny(thread, intelligence, ['sellerTimeline', 'timeline']) || (thread.lastMessageAt ? formatRelativeTime(thread.lastMessageAt) : null)} />
          <FieldTile label="Thread State" value={getStatusVisual(thread.inboxStatus).label} />
          <FieldTile label="Current Stage" value={getSellerStageVisual(thread.conversationStage).label} />
          <FieldTile label="Queued Reply" value={thread.aiDraft || getAny(thread, intelligence, ['queuedReply', 'queued_reply'])} />
          <FieldTile label="Automation Confidence" value={formatScore(getAny(thread, intelligence, ['automationConfidence', 'automation_confidence', 'offerConfidence']))} />
          <FieldTile label="Escalation Flags" value={getAny(thread, intelligence, ['escalationFlags', 'escalation_flags']) || (thread.inboxStatus === 'needs_review' ? 'Needs review' : null)} />
        </FieldGrid>
      </PanelSection>
    </div>
  )
}

export const AutomationPanel = ({ thread, intelligence }: { thread: InboxWorkflowThread; intelligence: ThreadIntelligenceRecord | null }) => {
  const autoVisual = automationStateVisuals[thread.automationState]
  return (
    <div className="nx-intel-panel-grid">
      <PanelSection title="Automation Control" icon="bolt">
        <FieldGrid>
          <FieldTile label="Queue Health" value={thread.queueStatus || 'Healthy'} tone={thread.queueStatus === 'stuck' ? 'bad' : 'good'} />
          <FieldTile label="Automation Active" value={thread.automationState === 'active' ? 'Yes' : 'No'} tone={thread.automationState === 'active' ? 'good' : 'warn'} />
          <FieldTile label="Last Run" value={formatDate(getAny(thread, intelligence, ['lastRun', 'last_run', 'updatedAt']) || thread.updatedAt)} />
          <FieldTile label="Auto Reply Status" value={thread.autoReplyStatus || getAny(thread, intelligence, ['autoReplyStatus', 'auto_reply_status'])} />
          <FieldTile label="Send Eligibility" value={thread.isOptOut || thread.isSuppressed ? 'Suppressed' : 'Eligible'} tone={thread.isOptOut || thread.isSuppressed ? 'bad' : 'good'} />
          <FieldTile label="Suppression Status" value={thread.isOptOut || thread.isSuppressed ? 'Suppressed' : 'Clear'} />
          <FieldTile label="Retry State" value={getAny(thread, intelligence, ['retryState', 'retry_state']) || thread.deliveryStatus} />
          <FieldTile label="Fallback Mode" value={getAny(thread, intelligence, ['fallbackMode', 'fallback_mode']) || 'Operator review'} />
          <FieldTile label="Routing Market" value={thread.market || thread.marketId} />
          <FieldTile label="Assigned Number" value={fmtPhone(thread.ourNumber || getAny(thread, intelligence, ['assignedNumber', 'assigned_number']))} />
          <FieldTile label="AI Routing Reason" value={getAny(thread, intelligence, ['aiRoutingReason', 'ai_routing_reason']) || autoVisual.label} />
        </FieldGrid>
      </PanelSection>
      <PanelSection title="Automation Logs Preview" icon="activity">
        <MiniTimeline thread={thread} messages={[]} limit={3} />
      </PanelSection>
    </div>
  )
}

const MiniTimeline = ({ thread, messages, limit = 8 }: { thread: InboxWorkflowThread; messages: ThreadMessage[]; limit?: number }) => {
  const messageItems = messages.slice(0, limit).map((message) => ({
    label: message.direction === 'inbound' ? 'Seller replied' : 'Queue sent',
    time: message.timelineAt || message.createdAt,
    detail: message.body,
    done: true,
    active: message.direction === 'inbound' && thread.inboxStatus === 'new_reply',
  }))
  const syntheticItems = [
    { label: 'First touch', time: get(thread, 'firstTouchAt') || thread.updatedAt, detail: 'Initial contact sequence opened.', done: true },
    { label: 'AI classified', time: thread.lastMessageAt, detail: thread.uiIntent || getSellerStageVisual(thread.conversationStage).label, done: true },
    { label: 'Auto response queued', time: thread.aiDraft ? thread.updatedAt : null, detail: thread.aiDraft || 'No draft queued.', done: Boolean(thread.aiDraft) },
    { label: 'Delivered', time: thread.lastOutboundAt, detail: thread.deliveryStatus || 'Outbound delivery recorded.', done: Boolean(thread.lastOutboundAt) },
    { label: 'Escalation triggered', time: thread.inboxStatus === 'needs_review' ? thread.updatedAt : null, detail: 'Operator review required.', done: thread.inboxStatus === 'needs_review', active: thread.inboxStatus === 'needs_review' },
    { label: 'Offer generated', time: get(thread, 'offerGeneratedAt') || get(thread, 'offer_generated_at'), detail: formatMoney(thread.cashOffer) || 'Awaiting offer model.', done: isPresent(thread.cashOffer) },
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

export const TimelinePanel = ({ thread, messages }: { thread: InboxWorkflowThread; messages: ThreadMessage[] }) => (
  <div className="nx-intel-panel-grid">
    <PanelSection title="Cinematic Execution Timeline" icon="activity">
      <MiniTimeline thread={thread} messages={messages} limit={8} />
    </PanelSection>
  </div>
)

// ── 7. Contact & Ownership Intelligence ──────────────────────────────────

const formatDisplayValue = (value: unknown) => {
  if (!isPresent(value)) return 'Not enriched'
  return String(value)
}

const IntelField = ({ label, value }: { label: string; value: unknown }) => {
  const displayValue = formatDisplayValue(value)
  return (
    <div className={cls('nx-intel-field', displayValue === 'Not enriched' && 'is-empty')}>
      <span className="nx-intel-field__label">{label}</span>
      <span className="nx-intel-field__value">{displayValue}</span>
    </div>
  )
}

const SellerCommandCard = ({
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
  const sellerName = thread.ownerDisplayName || thread.ownerName || asStr(get(thread, 'sellerName')) || 'Unknown seller'
  const initials = sellerName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const ownerType = asStr(get(thread, 'ownerType') || get(thread, 'owner_type')) || 'Individual'
  const market = thread.market || thread.marketId || 'Unknown market'
  const finalScore = formatScore(get(thread, 'finalAcquisitionScore') || get(thread, 'final_score') || get(thread, 'priorityScore'))
  const lastContact = thread.lastInboundAt || thread.lastOutboundAt || thread.lastMessageAt
  const statusVisual = getStatusVisual(thread.inboxStatus)
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
                  onStatusChange(opt.value as InboxStatus)
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
        <QuietBadge label={`SCORE ${finalScore || 'Not enriched'}`} />
        <QuietBadge label={`LAST CONTACT ${lastContact ? formatRelativeTime(lastContact).toUpperCase() : 'NOT ENRICHED'}`} />
      </div>
    </DossierCard>
  )
}

export const PropertySnapshotCard = ({ thread, intelligence }: { thread: InboxWorkflowThread; intelligence: ThreadIntelligenceRecord | null }) => {
  const snapshot = normalizePropertySnapshot(intelligence, thread)
  const address = snapshot.fullAddress || thread.propertyAddress || thread.subject || 'No linked property'
  const market = snapshot.market || thread.market || thread.marketId || 'Unknown market'
  const propertyType = snapshot.propertyType || asStr(get(thread, 'propertyType') || get(thread, 'property_type')) || 'Not enriched'
  const streetViewUrl = snapshot.streetViewUrl
  const [imageFailed, setImageFailed] = useState(false)
  const links = buildPropertyExternalLinks(address)
  const chips = [
    snapshot.beds ? `${snapshot.beds} BEDS` : null,
    snapshot.baths ? `${snapshot.baths} BATHS` : null,
    snapshot.sqft ? `${Number(String(snapshot.sqft).replace(/,/g, '')).toLocaleString()} SQFT` : null,
    snapshot.yearBuilt ? `BUILT ${snapshot.yearBuilt}` : null,
    formatMoney(get(thread, 'estimatedValue') || get(thread, 'estimated_value') || get(thread, 'zestimate')),
    formatPercent(get(thread, 'equityPercent') || get(thread, 'equity_percent')) ? `${formatPercent(get(thread, 'equityPercent') || get(thread, 'equity_percent'))} EQUITY` : null,
    formatMoney(get(thread, 'estimatedRepairCost') || get(thread, 'estimated_repair_cost')) ? `${formatMoney(get(thread, 'estimatedRepairCost') || get(thread, 'estimated_repair_cost'))} REPAIRS` : null,
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
        <div className="nx-property-hero__location">{market} • {propertyType}</div>
        <div className="nx-property-hero__chips">
          {chips.map((chip) => <QuietBadge key={chip} label={chip} />)}
        </div>
      </div>
    </DossierCard>
  )
}

export const DealStateCard = ({ thread }: { thread: InboxWorkflowThread }) => {
  const hasArv = isPresent(get(thread, 'arv') || get(thread, 'afterRepairValue') || get(thread, 'after_repair_value'))
  const next = thread.nextSystemAction || 'Review thread for system recommended next steps.'
  const state = getStatusVisual(thread.inboxStatus).label.toUpperCase()
  return (
    <DossierCard className="nx-deal-state-card">
      <div className="nx-deal-state-card__row"><strong>DEAL STATE:</strong> <span>{state}</span></div>
      <div className="nx-deal-state-card__row"><strong>Missing:</strong> <span>{hasArv ? 'None' : 'ARV'}</span></div>
      <div className="nx-deal-state-card__row"><strong>Next:</strong> <span>{next}</span></div>
    </DossierCard>
  )
}

export const OfferMemoCard = ({ thread }: { thread: InboxWorkflowThread }) => {
  const hasArv = isPresent(get(thread, 'arv') || get(thread, 'afterRepairValue') || get(thread, 'after_repair_value'))
  const aiOffer = formatMoney(get(thread, 'aiRecommendedOffer') || get(thread, 'ai_recommended_opening_offer') || get(thread, 'ai_offer'))
  const cashOffer = formatMoney(get(thread, 'cashOffer') || get(thread, 'cash_offer') || get(thread, 'mao'))
  const walkaway = formatMoney(get(thread, 'walkawayPrice') || get(thread, 'walkaway_price') || get(thread, 'walkaway_internal'))
  const confidence = formatDisplayValue(get(thread, 'offerConfidence') || get(thread, 'offer_confidence') || (hasArv ? 'Review internally' : 'Hold internal'))
  const missing = !hasArv
    ? 'ARV verification'
    : formatDisplayValue(get(thread, 'nextRequiredInfo') || get(thread, 'next_required_info'))
  const aiOpening = aiOffer || (hasArv ? 'Needs underwriting' : 'Needs ARV')

  return (
    <DossierCard className="nx-offer-memo-card">
      <div className="nx-dossier-section__title nx-dossier-section__title--between">
        <span><Icon name="zap" /> Offer Intelligence</span>
        <QuietBadge label={hasArv ? 'READY' : 'NEEDS ARV'} tone={hasArv ? 'success' : 'warning'} />
      </div>
      <div className="nx-offer-memo-card__rows">
        <IntelField label="LEGACY CASH OFFER" value={cashOffer} />
        <IntelField label="AI RECOMMENDED OPENING" value={aiOpening} />
        <IntelField label="WALKAWAY INTERNAL" value={walkaway || 'Needs underwriting'} />
        <IntelField label="MISSING UNDERWRITING INFO" value={missing} />
        <IntelField label="CONFIDENCE / SAFE-TO-REVEAL" value={confidence} />
      </div>
    </DossierCard>
  )
}

const LinkedAppsCard = ({ thread }: { thread: InboxWorkflowThread }) => {
  const baseUrl = 'https://app.realestateflow.ai'
  const phone = thread.canonicalE164 || thread.phoneNumber

  return (
    <DossierCard className="nx-linked-apps-card">
      <div className="nx-dossier-section__title"><span>LINKED APPS</span></div>
      <div className="nx-linked-apps-card__stack">
        {thread.propertyId && <LinkedRecordButton label="Property App" url={`${baseUrl}/properties/${thread.propertyId}`} icon="layers" variant="internal" />}
        {thread.ownerId && <LinkedRecordButton label="Owner App" url={`${baseUrl}/owners/${thread.ownerId}`} icon="user" variant="internal" />}
        {phone && <LinkedRecordButton label="Phone App" url={`${baseUrl}/phones/${encodeURIComponent(phone)}`} icon="phone" variant="internal" />}
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
  thread: InboxWorkflowThread
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

const PropertyIntelFields = ({
  thread,
  intelligence,
  subTab,
}: {
  thread: InboxWorkflowThread
  intelligence: ThreadIntelligenceRecord | null
  subTab: 'overview' | 'location' | 'property' | 'equity' | 'tax'
}) => {
  const snapshot = normalizePropertySnapshot(intelligence, thread)
  const fullAddress = snapshot.fullAddress || thread.propertyAddress || thread.subject
  const propertyType = snapshot.propertyType || getAny(thread, intelligence, ['propertyType', 'property_type'])
  const market = snapshot.market || thread.market || thread.marketId

  const overviewRows: Array<[string, unknown]> = [
    ['FULL ADDRESS', fullAddress],
    ['PROPERTY TAGS', propertyType],
    ['PROPERTY TYPE', propertyType],
    ['BEDS', snapshot.beds || getAny(thread, intelligence, ['beds', 'bedrooms'])],
    ['BATHS', snapshot.baths || getAny(thread, intelligence, ['baths', 'bathrooms'])],
    ['SQFT', snapshot.sqft || getAny(thread, intelligence, ['sqft', 'livingAreaSqft'])],
    ['UNITS', snapshot.unitCount || getAny(thread, intelligence, ['unitCount', 'unit_count', 'units'])],
    ['YEAR BUILD', snapshot.yearBuilt || getAny(thread, intelligence, ['yearBuilt', 'year_built'])],
    ['EFFECTIVE YEAR BUILD', getAny(thread, intelligence, ['effectiveYearBuilt', 'effective_year_built'])],
    ['ESTIMATED VALUE', formatMoney(getAny(thread, intelligence, ['estimatedValue', 'estimated_value', 'zestimate']))],
    ['LAST SALE PRICE', formatMoney(getAny(thread, intelligence, ['lastSalePrice', 'last_sale_price']))],
    ['LAST SALE DATE', formatDate(getAny(thread, intelligence, ['lastSaleDate', 'last_sale_date']))],
    ['EQUITY PERCENT', formatPercent(getAny(thread, intelligence, ['equityPercent', 'equity_percent']))],
    ['OWNERSHIP YEARS', getAny(thread, intelligence, ['ownershipYears', 'years_owned'])],
    ['CONDITION', getAny(thread, intelligence, ['buildingCondition', 'building_condition'])],
    ['FINAL ACQUISITION SCORE', formatScore(getAny(thread, intelligence, ['finalAcquisitionScore', 'final_score', 'priorityScore']))],
  ]

  const locationRows: Array<[string, unknown]> = [
    ['MARKET', market],
    ['ADDRESS', fullAddress],
    ['CITY', getAny(thread, intelligence, ['property_city', 'city'])],
    ['STATE', getAny(thread, intelligence, ['property_state', 'state'])],
    ['ZIP CODE', getAny(thread, intelligence, ['property_zip', 'zip', 'postal_code'])],
    ['LATITUDE', getAny(thread, intelligence, ['lat', 'latitude'])],
    ['LONGITUDE', getAny(thread, intelligence, ['lng', 'longitude'])],
  ]

  const propertyRows: Array<[string, unknown]> = [
    ['PROPERTY CLASS', getAny(thread, intelligence, ['propertyClass', 'property_class'])],
    ['PROPERTY STYLE', getAny(thread, intelligence, ['propertyStyle', 'property_style'])],
    ['STORIES', getAny(thread, intelligence, ['stories', 'num_stories'])],
    ['NUMBER OF UNITS', getAny(thread, intelligence, ['unitCount', 'unit_count', 'units'])],
    ['NUMBER OF BUILDINGS', getAny(thread, intelligence, ['numberOfBuildings', 'number_of_buildings'])],
    ['AVG SQUARE FEET PER UNIT', getAny(thread, intelligence, ['avgSquareFeetPerUnit', 'avg_square_feet_per_unit'])],
    ['AVG BEDS PER UNIT', getAny(thread, intelligence, ['avgBedsPerUnit', 'avg_beds_per_unit'])],
    ['SQUARE FOOT RANGE', getAny(thread, intelligence, ['squareFootRange', 'square_foot_range'])],
    ['CONSTRUCTION TYPE', getAny(thread, intelligence, ['constructionType', 'construction_type'])],
    ['EXTERIOR WALLS', getAny(thread, intelligence, ['exteriorWalls', 'exterior_walls'])],
    ['FLOOR COVER', getAny(thread, intelligence, ['floorCover', 'floor_cover'])],
    ['BASEMENT', getAny(thread, intelligence, ['basement', 'basement_type'])],
    ['OTHER ROOMS', getAny(thread, intelligence, ['otherRooms', 'other_rooms'])],
    ['NUMBER OF FIREPLACES', getAny(thread, intelligence, ['numberOfFireplaces', 'number_of_fireplaces'])],
    ['PATIO', getAny(thread, intelligence, ['patio'])],
    ['PORCH', getAny(thread, intelligence, ['porch'])],
    ['DECK', getAny(thread, intelligence, ['deck'])],
    ['DRIVEWAY', getAny(thread, intelligence, ['driveway'])],
    ['GARAGE', getAny(thread, intelligence, ['garage', 'garage_or_parking'])],
    ['GARAGE SQUARE FEET', getAny(thread, intelligence, ['garageSquareFeet', 'garage_square_feet'])],
    ['AC', getAny(thread, intelligence, ['ac'])],
    ['HEATING TYPE', getAny(thread, intelligence, ['heatingType', 'heating_type'])],
    ['HEATING FUEL TYPE', getAny(thread, intelligence, ['heatingFuelType', 'heating_fuel_type'])],
    ['INTERIOR WALLS', getAny(thread, intelligence, ['interiorWalls', 'interior_walls'])],
    ['ROOF COVER', getAny(thread, intelligence, ['roofCover', 'roof_cover'])],
    ['ROOF TYPE', getAny(thread, intelligence, ['roofType', 'roof_type'])],
    ['POOL', getAny(thread, intelligence, ['pool'])],
  ]

  const equityRows: Array<[string, unknown]> = [
    ['LAST SALE DOCUMENT', getAny(thread, intelligence, ['lastSaleDocument', 'last_sale_document'])],
    ['ESTIMATED EQUITY AMOUNT', formatMoney(getAny(thread, intelligence, ['estimatedEquityAmount', 'equityAmount', 'equity_amount']))],
    ['LOAN AMOUNT', formatMoney(getAny(thread, intelligence, ['loanAmount', 'loan_amount']))],
    ['LOAN BALANCE', formatMoney(getAny(thread, intelligence, ['loanBalance', 'loan_balance']))],
    ['LOAN PAYMENT', formatMoney(getAny(thread, intelligence, ['loanPayment', 'loan_payment']))],
    ['ASSESSED TOTAL VALUE', formatMoney(getAny(thread, intelligence, ['assessedValue', 'assd_total_value']))],
    ['ASSESSED LAND VALUE', formatMoney(getAny(thread, intelligence, ['assdLandValue', 'assessed_land_value']))],
    ['ASSESSED IMPROVEMENT VALUE', formatMoney(getAny(thread, intelligence, ['assdImprovementValue', 'assessed_improvement_value']))],
    ['ESTIMATED REPAIR COST', formatMoney(getAny(thread, intelligence, ['estimatedRepairCost', 'estimated_repair_cost']))],
    ['REHAB LEVEL', getAny(thread, intelligence, ['rehabLevel', 'rehab_level'])],
    ['BUILDING QUALITY', getAny(thread, intelligence, ['buildingQuality', 'building_quality'])],
  ]

  const taxRows: Array<[string, unknown]> = [
    ['TAX DELINQUENT', thread.isTaxDelinquent ? 'Yes' : 'No'],
    ['TAX DELINQUENT YEAR', getAny(thread, intelligence, ['taxDelinquentYear', 'tax_delinquent_year'])],
    ['TAX AMOUNT', formatMoney(getAny(thread, intelligence, ['taxAmount', 'tax_amount']))],
    ['LOT SIZE ACRES', getAny(thread, intelligence, ['lotSizeAcres', 'lot_size_acres'])],
    ['LOT SIZE SQUARE FEET', getAny(thread, intelligence, ['lotSizeSqft', 'lot_size_sqft'])],
    ['SEWER', getAny(thread, intelligence, ['sewer'])],
    ['WATER', getAny(thread, intelligence, ['water'])],
    ['ZONING', getAny(thread, intelligence, ['zoning', 'zoning_code'])],
    ['FLOOD ZONE', getAny(thread, intelligence, ['floodZone', 'flood_zone'])],
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

const ContactIntelligenceCard = ({
  thread,
  intelligence,
}: {
  thread: InboxWorkflowThread
  intelligence: ThreadIntelligenceRecord | null
}) => {
  const [activeTab, setActiveTab] = useState<'prospect' | 'owner' | 'portfolio' | 'financial' | 'property'>('prospect')
  const [propertyTab, setPropertyTab] = useState<'overview' | 'location' | 'property' | 'equity' | 'tax'>('overview')

  const sellerName = thread.ownerDisplayName || thread.ownerName || asStr(get(thread, 'sellerName')) || 'Unknown seller'
  const initials = sellerName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const headlineAddress = normalizePropertySnapshot(intelligence, thread).fullAddress || thread.propertyAddress || thread.subject
  const propertyType = normalizePropertySnapshot(intelligence, thread).propertyType || getAny(thread, intelligence, ['propertyType', 'property_type'])

  const topTabs = [
    ['prospect', 'PROSPECT'],
    ['owner', 'OWNER'],
    ['portfolio', 'PORTFOLIO'],
    ['financial', 'FINANCIAL'],
    ['property', 'PROPERTY INTEL'],
  ] as const

  const prospectRows: Array<[string, unknown]> = [
    ['PROSPECT NAME', sellerName],
    ['CONTACT MATCHING BADGES', thread.phoneNumber ? 'Phone linked' : null],
    ['AGE', getAny(thread, intelligence, ['sellerAge', 'age'])],
    ['MARITAL STATUS', getAny(thread, intelligence, ['maritalStatus', 'marital_status'])],
    ['GENDER', getAny(thread, intelligence, ['gender'])],
    ['LANGUAGE', getAny(thread, intelligence, ['language', 'contactLanguage', 'seller_language'])],
    ['EDUCATION', getAny(thread, intelligence, ['education'])],
    ['HOUSEHOLD INCOME', formatMoney(getAny(thread, intelligence, ['householdIncome', 'household_income']))],
    ['NET ASSET VALUE', formatMoney(getAny(thread, intelligence, ['netAssetValue', 'net_asset_value']))],
    ['OCCUPATION', getAny(thread, intelligence, ['occupation'])],
    ['OCCUPATION GROUP', getAny(thread, intelligence, ['occupationGroup', 'occupation_group'])],
    ['PROSPECT TAGS', getAny(thread, intelligence, ['prospectTags', 'prospect_tags', 'distressTags'])],
    ['PHONE NUMBER', fmtPhone(thread.phoneNumber || thread.canonicalE164 || getAny(thread, intelligence, ['bestPhone', 'best_phone']))],
    ['PHONE CARRIER', getAny(thread, intelligence, ['phoneCarrier', 'phone_carrier'])],
  ]

  const ownerRows: Array<[string, unknown]> = [
    ['OWNER ADDRESS', getAny(thread, intelligence, ['mailingAddress', 'mailing_address'])],
    ['PRIORITY TIER', getAny(thread, intelligence, ['priorityTier', 'priority_tier', 'priority'])],
    ['PRIORITY SCORE /100', formatScore(getAny(thread, intelligence, ['priorityScore', 'finalAcquisitionScore', 'final_score']))],
    ['BEST CONTACT WINDOW', getAny(thread, intelligence, ['bestContactWindow', 'best_contact_window'])],
    ['LANGUAGE', getAny(thread, intelligence, ['language', 'contactLanguage', 'seller_language'])],
  ]

  const portfolioRows: Array<[string, unknown]> = [
    ['PORTFOLIO PROPERTY COUNT', getAny(thread, intelligence, ['portfolioPropertyCount', 'portfolio_property_count', 'portfolioCount'])],
    ['PROPERTY TYPE MAJORITY', getAny(thread, intelligence, ['propertyTypeMajority', 'property_type_majority'])],
    ['SFR COUNT', getAny(thread, intelligence, ['sfrCount', 'sfr_count'])],
    ['MF COUNT', getAny(thread, intelligence, ['mfCount', 'mf_count'])],
    ['TOTAL UNITS', getAny(thread, intelligence, ['totalUnits', 'total_units'])],
    ['PORTFOLIO VALUE', formatMoney(getAny(thread, intelligence, ['portfolioValue', 'portfolio_value']))],
    ['TOTAL EQUITY', formatMoney(getAny(thread, intelligence, ['totalEquity', 'total_equity']))],
    ['TOTAL DEBT', formatMoney(getAny(thread, intelligence, ['totalDebt', 'total_debt']))],
    ['TOTAL DEBT PAYMENT', formatMoney(getAny(thread, intelligence, ['totalDebtPayment', 'total_debt_payment', 'estimatedMonthlyDebtPayment']))],
  ]

  const financialRows: Array<[string, unknown]> = [
    ['FINANCIAL PRESSURE SCORE', formatScore(getAny(thread, intelligence, ['financialPressureScore', 'financial_pressure_score']))],
    ['URGENCY COUNT', getAny(thread, intelligence, ['urgencyCount', 'urgency_count'])],
    ['PORTFOLIO TAX DELINQUENT COUNT', getAny(thread, intelligence, ['portfolioTaxDelinquentCount', 'portfolio_tax_delinquent_count'])],
    ['TAX DELINQUENT BADGE', thread.isTaxDelinquent ? 'Yes' : null],
    ['PORTFOLIO LIEN COUNT', getAny(thread, intelligence, ['portfolioLienCount', 'portfolio_lien_count'])],
    ['ACTIVE LIEN BADGE', thread.hasLien ? 'Yes' : null],
    ['OLDEST TAX DELINQUENT YEAR', getAny(thread, intelligence, ['oldestTaxYear', 'oldest_tax_year'])],
    ['TOTAL TAX AMOUNT', formatMoney(getAny(thread, intelligence, ['totalTaxAmount', 'total_tax_amount', 'tax_amount']))],
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
          <div className="nx-contact-intel-card__identity-chips">
            {activeTab === 'property'
              ? <QuietBadge label={formatDisplayValue(propertyType).toUpperCase()} />
              : <QuietBadge label={asStr(get(thread, 'ownerType') || get(thread, 'owner_type') || 'Individual').toUpperCase()} />}
            {thread.isAbsentee && activeTab !== 'property' && <QuietBadge label="ABSENTEE" />}
          </div>
        </div>
      </div>

      {activeTab === 'property' ? (
        <>
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
          <PropertyIntelFields thread={thread} intelligence={intelligence} subTab={propertyTab} />
        </>
      ) : (
        <div className="nx-intel-grid">{activeRows.map(([label, value]) => <IntelField key={label} label={label} value={value} />)}</div>
      )}
    </DossierCard>
  )
}

// ── Main Intelligence Panel ───────────────────────────────────────────────

export interface IntelligencePanelProps {
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

export const IntelligencePanel = ({
  thread,
  context,
  intelligence,
  messages,
  isSuppressed,
  panelMode = 'default',
  onCollapse,
  onOpenMap,
  onOpenDossier,
  onOpenAi,
  onStatusChange,
  onStageChange,
}: IntelligencePanelProps) => {
  void context
  void messages
  void isSuppressed

  useEffect(() => {
    if (thread) logIntelligencePanelData(thread)
  }, [thread?.id])

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
        <button type="button" className="nx-intel-collapse" onClick={onCollapse} title="Collapse panel">
          <Icon name="close" />
        </button>
      </header>

      <div className="nx-intel-scroll-body">
        <SellerCommandCard thread={thread} onStatusChange={onStatusChange} onStageChange={onStageChange} />
        <PremiumPropertySnapshotCard thread={thread} intelligence={intelligence} />
        <PremiumOfferMemoCard thread={thread} />
        <ContactIntelligenceCard thread={thread} intelligence={intelligence} />
        <TimelineCard thread={thread} />
        <LinkedAppsCard thread={thread} />
        <ActionRailCard thread={thread} onOpenMap={onOpenMap} onOpenDossier={onOpenDossier} onOpenAi={onOpenAi} />
      </div>
    </aside>
  )
}
