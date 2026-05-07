import { useState, useMemo } from 'react'
import type { ThreadContext, ThreadIntelligenceRecord } from '../../../lib/data/inboxData'
import type { InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import type { PanelMode } from '../inbox-layout-state'
import {
  normalizePropertySnapshot,
} from '../inbox-normalization'
import { Icon } from '../../../shared/icons'

const cls = (...tokens: Array<string | false | null | undefined>) => tokens.filter(Boolean).join(' ')

// ── Helper Utilities ──────────────────────────────────────────────────────

const normalizeText = (value: unknown): string => String(value ?? '').trim()

const isPresent = (value: unknown): boolean => {
  const text = normalizeText(value).toLowerCase()
  return Boolean(text) && text !== 'unknown' && text !== 'n/a' && text !== 'null' && text !== 'undefined' && text !== 'none' && text !== '-'
}

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

const fmtPhone = (value: unknown): string | null => {
  const raw = normalizeText(value)
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  if (digits.length === 10) return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  return raw
}

// ── Reusable UI Components ────────────────────────────────────────────────

const DossierCard = ({ children, className, title, icon }: { children: React.ReactNode; className?: string; title?: string; icon?: string }) => (
  <div className={cls('nx-dossier-card', className)}>
    {(title || icon) && (
      <div className="nx-dossier-card__header">
        {icon && <Icon name={icon as any} />}
        {title && <h3>{title}</h3>}
      </div>
    )}
    <div className="nx-dossier-card__body">{children}</div>
  </div>
)

const DossierMetric = ({ 
  label, 
  value, 
  icon,
  accent,
  suffix,
  showWhenMissing = false,
}: { 
  label: string; 
  value: string | number | null; 
  icon?: string; 
  accent?: 'blue' | 'green' | 'amber' | 'purple' | 'red' | 'cyan';
  suffix?: string;
  showWhenMissing?: boolean;
}) => (
  !isPresent(value) && !showWhenMissing ? null : (
    <div className={cls('nx-dossier-metric', !value && 'is-empty', accent && `is-${accent}`)}>
      {icon && <div className="nx-dossier-metric__icon"><Icon name={icon as any} /></div>}
      <div className="nx-dossier-metric__content">
        <span className="nx-dossier-metric__label">{label}</span>
        <span className="nx-dossier-metric__value">
          {value || '—'}
          {suffix && value && <span className="nx-dossier-metric__suffix">{suffix}</span>}
        </span>
      </div>
    </div>
  )
)

const MetricGrid = ({ children }: { children: React.ReactNode }) => (
  <div className="nx-dossier-metric-grid">{children}</div>
)

const SectionTitle = ({ children, icon }: { children: React.ReactNode; icon?: string }) => (
  <div className="nx-dossier-section-title">
    {icon && <Icon name={icon as any} />}
    <span>{children}</span>
  </div>
)

// ── Main Component ────────────────────────────────────────────────────────

interface IntelligencePanelProps {
  thread: InboxWorkflowThread | null
  threadContext: ThreadContext | null
  intelligence: ThreadIntelligenceRecord | null
  mode?: PanelMode
}

export function IntelligencePanel({
  thread,
  intelligence,
}: IntelligencePanelProps) {
  const [activeTab, setActiveTab] = useState<'snapshot' | 'portfolio' | 'automation'>('snapshot')

  const prop = useMemo(() => normalizePropertySnapshot(intelligence, thread), [intelligence, thread])
  const intel = intelligence || {}

  if (!thread) {
    return (
      <div className="nx-intelligence-panel is-empty">
        <div className="nx-empty-state">
          <Icon name="Search" />
          <p>Select a thread to view dossier</p>
        </div>
      </div>
    )
  }

  return (
    <div className="nx-intelligence-panel">
      <header className="nx-intel-header">
        <div className="nx-section-label">
          <Icon name="Database" />
          <span>DOSSIER</span>
        </div>
        <div className="nx-dossier-tabs-mini">
          <button className={cls(activeTab === 'snapshot' && 'is-active')} onClick={() => setActiveTab('snapshot')}>SNAPSHOT</button>
          <button className={cls(activeTab === 'portfolio' && 'is-active')} onClick={() => setActiveTab('portfolio')}>PORTFOLIO</button>
          <button className={cls(activeTab === 'automation' && 'is-active')} onClick={() => setActiveTab('automation')}>AUTO</button>
        </div>
      </header>

      <div className="nx-intel-scroll-body">
        {activeTab === 'snapshot' && (
          <>
            <DossierCard title="Seller Identity" icon="User">
              <MetricGrid>
                <DossierMetric label="Full Name" value={prop.ownerType === 'Individual' ? thread.ownerName : (intel.owner_name as string)} icon="User" />
                <DossierMetric label="Identity" value={intel.owner_type as string} icon="Shield" />
                <DossierMetric label="Language" value={intel.seller_language as string || intel.detected_language as string} icon="Globe" />
                <DossierMetric label="Marital" value={intel.marital_status as string} icon="Heart" />
                <DossierMetric label="Gender" value={intel.gender as string} icon="Users" />
                <DossierMetric label="Occupation" value={intel.occupation as string} icon="Briefcase" />
                <DossierMetric label="Net Worth" value={intel.net_worth_bracket as string} icon="TrendingUp" />
                <DossierMetric label="Income" value={intel.estimated_income_bracket as string} icon="DollarSign" />
              </MetricGrid>
            </DossierCard>

            <DossierCard title="Property Assets" icon="Home">
              <div className="nx-dossier-aerial-view">
                {prop.aerialViewUrl && <img src={prop.aerialViewUrl} alt="Aerial View" />}
              </div>
              <div className="nx-dossier-address-block">
                <strong>{prop.fullAddress}</strong>
                <span>{prop.market || thread.marketName} • {prop.propertyType}</span>
              </div>
              <MetricGrid>
                <DossierMetric label="Class" value={prop.propertyClass} />
                <DossierMetric label="Style" value={prop.propertyStyle} />
                <DossierMetric label="Beds" value={prop.beds} />
                <DossierMetric label="Baths" value={prop.baths} />
                <DossierMetric label="Sqft" value={prop.sqft} />
                <DossierMetric label="Units" value={prop.unitCount} />
                <DossierMetric label="Built" value={prop.yearBuilt} />
                <DossierMetric label="Lot Size" value={prop.lotSizeAcres ? `${prop.lotSizeAcres} ac` : prop.lotSize} />
                <DossierMetric label="Zoning" value={prop.zoning} />
                <DossierMetric label="Flood" value={prop.floodZone} />
              </MetricGrid>
            </DossierCard>

            <DossierCard title="Deal Snapshot" icon="Target">
              <MetricGrid>
                <DossierMetric label="Acq Score" value={thread.finalAcquisitionScore} accent="blue" />
                <DossierMetric label="Equity %" value={formatPercent(prop.equityPercent)} accent="green" />
                <DossierMetric label="Equity $" value={formatMoney(prop.equityAmount)} accent="green" />
                <DossierMetric label="Est Value" value={formatMoney(prop.estimatedValue)} />
                <DossierMetric label="Condition" value={intel.property_condition as string} />
                <DossierMetric label="Ownership" value={prop.ownershipYears} suffix=" yrs" />
              </MetricGrid>
            </DossierCard>

            <DossierCard title="Land & Tax" icon="FileText">
              <MetricGrid>
                <DossierMetric label="Total Assessed" value={formatMoney(intel.assessed_total_value)} />
                <DossierMetric label="Land Value" value={formatMoney(intel.assessed_land_value)} />
                <DossierMetric label="Improv Value" value={formatMoney(intel.assessed_improvement_value)} />
                <DossierMetric label="Tax Amount" value={formatMoney(intel.tax_amount)} />
                <DossierMetric label="Tax Delinq" value={intel.is_tax_delinquent ? 'YES' : 'NO'} accent={intel.is_tax_delinquent ? 'red' : undefined} />
                <DossierMetric label="Sewer/Water" value={intel.sewer_type as string} />
              </MetricGrid>
            </DossierCard>
          </>
        )}

        {activeTab === 'portfolio' && (
          <DossierCard title="Portfolio Metrics" icon="Briefcase">
            <MetricGrid>
              <DossierMetric label="Prop Count" value={intel.portfolio_count as number} accent="blue" />
              <DossierMetric label="Total Units" value={intel.portfolio_total_units as number} />
              <DossierMetric label="Total Value" value={formatMoney(intel.portfolio_total_value)} />
              <DossierMetric label="Total Equity" value={formatMoney(intel.portfolio_total_equity)} accent="green" />
              <DossierMetric label="Total Debt" value={formatMoney(intel.portfolio_total_debt)} accent="red" />
              <DossierMetric label="Pressure" value={intel.portfolio_pressure_score as number} accent="amber" />
              <DossierMetric label="Urgency" value={intel.portfolio_urgency_count as number} accent="red" />
            </MetricGrid>
          </DossierCard>
        )}

        {activeTab === 'automation' && (
          <DossierCard title="System Intelligence" icon="Cpu">
            <MetricGrid>
              <DossierMetric label="Intent" value={thread.uiIntent} accent="purple" />
              <DossierMetric label="Confidence" value={formatPercent(intel.intent_confidence)} />
              <DossierMetric label="Needs Review" value={intel.needs_human_review ? 'YES' : 'NO'} accent={intel.needs_human_review ? 'amber' : 'green'} />
              <DossierMetric label="Template ID" value={intel.template_id as string} />
              <DossierMetric label="Use Case" value={intel.template_use_case as string} />
              <DossierMetric label="State" value={thread.status} />
            </MetricGrid>
            <div className="nx-dossier-next-action">
              <SectionTitle icon="Play">Next Action</SectionTitle>
              <p>{(intel.next_suggested_action as string) || 'No system action pending.'}</p>
            </div>
          </DossierCard>
        )}

        <DossierCard title="Timeline Stats" icon="Activity">
          <MetricGrid>
            <DossierMetric label="Inbound" value={thread.messageCount} icon="ArrowDownLeft" />
            <DossierMetric label="Outbound" value={intel.outbound_count as number} icon="ArrowUpRight" />
            <DossierMetric label="Delivered" value={intel.delivered_count as number} icon="Check" accent="green" />
            <DossierMetric label="Failed" value={intel.failed_count as number} icon="AlertCircle" accent="red" />
          </MetricGrid>
        </DossierCard>
      </div>
    </div>
  )
}
