import { useState, useEffect, useCallback, useMemo } from 'react'
import type { ThreadContext, ThreadIntelligenceRecord, ThreadMessage } from '../../../lib/data/inboxData'
import type { InboxStatus, SellerStage, InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import type { PanelMode } from '../inbox-layout-state'
import {
  normalizePropertySnapshot,
  buildPropertyExternalLinks,
  buildAerialViewUrl,
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

const DossierShell = ({ children }: { children: React.ReactNode }) => (
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

const DealCommandHeader = ({ thread }: { thread: InboxWorkflowThread }) => {
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

const WorkflowControl = ({
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

const PropertySnapshotCard = ({ thread, intelligence }: { thread: InboxWorkflowThread; intelligence: ThreadIntelligenceRecord | null }) => {
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

const AIActionCard = ({ thread, isSuppressed }: { thread: InboxWorkflowThread; isSuppressed: boolean }) => {
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

const OfferMemoCard = ({ thread }: { thread: InboxWorkflowThread }) => {
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

const PropertyIntelligenceTabs = ({
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

const SellerOwnerCard = ({ thread }: { thread: InboxWorkflowThread }) => {
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

const LinkedRecordsCard = ({ thread }: { thread: InboxWorkflowThread }) => {
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

  const handleCollapse = useCallback((e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); onCollapse() }, [onCollapse])
  const handleOpenMap = useCallback((e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); onOpenMap() }, [onOpenMap])
  const handleOpenDossier = useCallback((e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); onOpenDossier() }, [onOpenDossier])
  const handleOpenAi = useCallback((e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); onOpenAi() }, [onOpenAi])

  if (!thread) return (
    <aside className="nx-intelligence-panel">
      <div className="nx-inbox__workspace-empty">
        <Icon name="inbox" />
        <h3>Select a thread</h3>
        <p>Choose a conversation to view intelligence.</p>
      </div>
    </aside>
  )

  return (
    <aside className={cls('nx-intelligence-panel', `is-mode-${panelMode}`)}>
      <header className="nx-intel-header">
        <span className="nx-section-label">DEAL COMMAND DOSSIER</span>
        <button type="button" className="nx-intel-collapse" onClick={handleCollapse} title="Collapse panel">
          <Icon name="close" />
        </button>
      </header>

      <div className="nx-intel-scroll-body">
        <DossierShell>
          <DealCommandHeader thread={thread} />
          <WorkflowControl thread={thread} onStatusChange={onStatusChange} onStageChange={onStageChange} />

          <div className="nx-dossier-workspace">
            <PropertySnapshotCard thread={thread} intelligence={intelligence} />
            <AIActionCard thread={thread} isSuppressed={isSuppressed} />
            <OfferMemoCard thread={thread} />
            <SellerOwnerCard thread={thread} />
            <PropertyIntelligenceTabs thread={thread} intelligence={intelligence} />
            <TimelineCard thread={thread} />
            <LinkedRecordsCard thread={thread} />
          </div>

          <div className="nx-intel-action-rail">
            <button type="button" className="nx-intel-action-btn" onClick={handleOpenMap}><Icon name="map" /> Map</button>
            <button type="button" className="nx-intel-action-btn" onClick={handleOpenDossier}><Icon name="briefing" /> Dossier</button>
            <div className="nx-intel-orb-trigger" onClick={handleOpenAi}>
              <CopilotOrbTrigger 
                size="md" 
                isReady={!!thread.aiDraft} 
                onClick={handleOpenAi} 
              />
              <span className="nx-intel-orb-label">AI ASSIST</span>
            </div>

          </div>
        </DossierShell>
      </div>
    </aside>
  )
}
