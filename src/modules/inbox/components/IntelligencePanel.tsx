import { useMemo } from 'react'
import type { ThreadContext, ThreadIntelligenceRecord } from '../../../lib/data/inboxData'
import type { InboxWorkflowThread, SellerStage, InboxStatus } from '../../../lib/data/inboxWorkflowData'

import type { PanelMode } from '../inbox-layout-state'
import {
  normalizePropertySnapshot,
  buildPropertyExternalLinks
} from '../inbox-normalization'
import { Icon } from '../../../shared/icons'

const cls = (...tokens: Array<string | false | null | undefined>) => tokens.filter(Boolean).join(' ')

// ── Helper Utilities ──────────────────────────────────────────────────────

const normalizeText = (value: unknown): string => String(value ?? '').trim()

const isPresent = (value: unknown): boolean => {
  const text = normalizeText(value).toLowerCase()
  return Boolean(text) && text !== 'unknown' && text !== 'n/a' && text !== 'null' && text !== 'undefined' && text !== 'none' && text !== '-' && text !== '0'
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

const roundVal = (value: unknown): string => {
  if (!isPresent(value)) return ''
  const num = Number(String(value).replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(num)) return String(value)
  return String(Math.round(num))
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
  threadContext?: ThreadContext | null
  intelligence: ThreadIntelligenceRecord | null
  mode?: PanelMode
  onStageChange?: (stage: SellerStage) => void
  onStatusChange?: (status: InboxStatus) => void
  full?: boolean
  onToggleFull?: () => void
  onClose?: () => void
}


export function IntelligencePanel({
  thread,
  intelligence,
}: IntelligencePanelProps) {
  const prop = useMemo(() => normalizePropertySnapshot(intelligence, thread), [intelligence, thread])
  const links = useMemo(() => buildPropertyExternalLinks(prop.fullAddress), [prop.fullAddress])
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
          <Icon name="database" />
          <span>OPERATOR DOSSIER</span>
        </div>
      </header>


      <div className="nx-intel-scroll-body">
        {/* Section 1: Seller Snapshot */}
        <DossierCard title="Seller Snapshot" icon="user">
          <MetricGrid>
            <DossierMetric label="Full Name" value={prop.ownerType === 'Individual' ? thread.ownerName : (intel.owner_name as string)} icon="user" />
            <DossierMetric label="Identity" value={intel.owner_type as string} icon="shield" />
            <DossierMetric label="Language" value={intel.seller_language as string || intel.detected_language as string} icon="globe" />
            <DossierMetric label="Marital" value={intel.marital_status as string} icon="heart" />
            <DossierMetric label="Occupation" value={intel.occupation as string} icon="briefcase" />
            <DossierMetric label="Net Worth" value={intel.net_worth_bracket as string} icon="trending-up" />
            <DossierMetric label="Income" value={intel.estimated_income_bracket as string} icon="dollar-sign" />
          </MetricGrid>
        </DossierCard>


        {/* Section 2: Property Snapshot */}
        <DossierCard title="Property Snapshot" icon="home">
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
            <DossierMetric label="Beds" value={roundVal(prop.beds)} />
            <DossierMetric label="Baths" value={roundVal(prop.baths)} />
            <DossierMetric label="Sqft" value={roundVal(prop.sqft)} />
            <DossierMetric label="Units" value={roundVal(prop.unitCount)} />
            <DossierMetric label="Built" value={prop.yearBuilt} />
            <DossierMetric label="Lot Size" value={prop.lotSizeAcres ? `${prop.lotSizeAcres} ac` : prop.lotSize} />
            <DossierMetric label="Zoning" value={prop.zoning} />
            <DossierMetric label="Flood" value={prop.floodZone} />
          </MetricGrid>
        </DossierCard>


        {/* Section 3: Deal Snapshot */}
        <DossierCard title="Deal Snapshot" icon="target">
          <MetricGrid>
            <DossierMetric label="Acq Score" value={roundVal(thread.finalAcquisitionScore)} accent="blue" />
            <DossierMetric label="Equity %" value={formatPercent(prop.equityPercent)} accent="green" />
            <DossierMetric label="Equity $" value={formatMoney(prop.equityAmount)} accent="green" />
            <DossierMetric label="Est Value" value={formatMoney(prop.estimatedValue)} />
            <DossierMetric label="Condition" value={intel.property_condition as string} />
            <DossierMetric label="Ownership" value={roundVal(prop.ownershipYears)} suffix=" yrs" />
            <DossierMetric label="Total Assessed" value={formatMoney(intel.assessed_total_value)} />
            <DossierMetric label="Tax Delinq" value={intel.is_tax_delinquent ? 'YES' : 'NO'} accent={intel.is_tax_delinquent ? 'red' : undefined} />
          </MetricGrid>
        </DossierCard>


        {/* Section 4: Automation / Timeline */}
        <DossierCard title="Automation / Timeline" icon="activity">
          <MetricGrid>
            <DossierMetric label="Status" value={thread.status} accent="purple" />
            <DossierMetric label="Workflow" value={thread.workflowStage} />
            <DossierMetric label="Intent" value={thread.uiIntent} />
            <DossierMetric label="Inbound" value={thread.messageCount} icon="arrow-down-left" />
            <DossierMetric label="Outbound" value={intel.outbound_count as number} icon="arrow-up-right" />
            <DossierMetric label="Delivered" value={intel.delivered_count as number} icon="check" accent="green" />
            <DossierMetric label="Failed" value={intel.failed_count as number} icon="alert-circle" accent="red" />
          </MetricGrid>
          <div className="nx-dossier-next-action">
            <SectionTitle icon="play">System Status</SectionTitle>
            <p>{(intel.next_suggested_action as string) || (intel.needs_human_review ? 'Needs Operator Review' : 'System idling.')}</p>
          </div>
        </DossierCard>


        {/* Section 5: Linked Apps */}
        <DossierCard title="Linked Apps" icon="link">
          <div className="nx-dossier-links">
            {links.zillow && (
              <a href={links.zillow} target="_blank" rel="noopener noreferrer" className="nx-app-link">
                <Icon name="external-link" /> Zillow
              </a>
            )}
            {links.realtor && (
              <a href={links.realtor} target="_blank" rel="noopener noreferrer" className="nx-app-link">
                <Icon name="external-link" /> Realtor.com
              </a>
            )}
            {links.googleSearch && (
              <a href={links.googleSearch} target="_blank" rel="noopener noreferrer" className="nx-app-link">
                <Icon name="search" /> Google Search
              </a>
            )}
            {intel.podio_item_id && (
              <a href={`https://podio.com/x/y/item/${intel.podio_item_id}`} target="_blank" rel="noopener noreferrer" className="nx-app-link podio">
                <Icon name="database" /> Podio Lead
              </a>
            )}
          </div>
        </DossierCard>

      </div>
    </div>
  )
}
