import type { FormEvent } from 'react'
import type { ThreadMessage } from '../../../lib/data/inboxData'
import { buildStreetViewUrl } from '../inbox-normalization'

type SellerRecord = Record<string, unknown>
type DensityMode = 'compact' | 'balanced' | 'expanded' | 'full'
type PillTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral'

type SellerStatusPill = {
  label: string
  tone: PillTone
}

type SellerIntelligenceCardProps = {
  record: SellerRecord | null
  layoutMode?: 'compact' | 'medium' | 'expanded' | 'full'
  variant?: 'hover' | 'selected'
  messages?: ThreadMessage[]
  loading?: boolean
  draftText?: string
  disabled?: boolean
  onDraftChange?: (value: string) => void
  onSend?: () => void
  onClose?: () => void
  onOpenDealIntelligence?: () => void
  onOpenConversation?: () => void
}

const cls = (...tokens: Array<string | false | null | undefined>) => tokens.filter(Boolean).join(' ')
const normalize = (value: unknown): string => String(value ?? '').trim()
const lower = (value: unknown): string => normalize(value).toLowerCase()

const firstDefined = (record: SellerRecord, keys: string[]): unknown => {
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && normalize(value) !== '') return value
  }
  return undefined
}

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const cleaned = normalize(value).replace(/[^0-9.-]/g, '')
  if (!cleaned) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

const asBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value
  const normalized = lower(value)
  if (!normalized) return null
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true
  if (['false', '0', 'no', 'n'].includes(normalized)) return false
  return null
}

const titleize = (value: string): string =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())

const parseTagValues = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap((entry) => parseTagValues(entry))
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap((entry) => parseTagValues(entry))
  const raw = normalize(value)
  if (!raw) return []
  if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('{') && raw.endsWith('}'))) {
    try {
      return parseTagValues(JSON.parse(raw))
    } catch {
      return raw.split(/[;,|]/).map((entry) => entry.trim()).filter(Boolean)
    }
  }
  return raw.split(/[;,|]/).map((entry) => entry.trim()).filter(Boolean)
}

const formatNumber = (value: unknown): string => {
  const numeric = asNumber(value)
  return numeric === null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(numeric)
}

const formatCurrencyCompact = (value: unknown): string => {
  const numeric = asNumber(value)
  if (numeric === null) return '—'
  if (numeric >= 1000000) return `$${(numeric / 1000000).toFixed(1).replace(/\.0$/, '')}M`
  if (numeric >= 1000) return `$${Math.round(numeric / 1000)}k`
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(numeric)
}

const formatPercent = (value: unknown): string => {
  const numeric = asNumber(value)
  if (numeric === null) return '—'
  return `${Math.round(numeric)}%`
}

const formatDate = (value: unknown): string => {
  const raw = normalize(value)
  if (!raw) return '—'
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }).format(parsed)
}

const formatRelativeTime = (value: unknown): string => {
  const raw = normalize(value)
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return ''
  const diffMs = Date.now() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60000)
  if (diffMinutes < 1) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`
  return formatDate(raw)
}

const resolveDensityMode = (layoutMode: SellerIntelligenceCardProps['layoutMode']): DensityMode => {
  if (layoutMode === 'compact') return 'compact'
  if (layoutMode === 'medium') return 'balanced'
  if (layoutMode === 'expanded') return 'expanded'
  return 'full'
}

const resolveOwnerType = (record: SellerRecord): string => {
  const raw = lower(firstDefined(record, ['owner_type', 'ownerType', 'owner_type_label']))
  if (raw.includes('hedge fund') || raw.includes('institutional')) return 'Hedge Fund'
  if (raw.includes('trust') || raw.includes('estate')) return 'Trust / Estate'
  if (raw.includes('bank') || raw.includes('lender')) return 'Bank / Lender'
  if (raw.includes('government')) return 'Government'
  if (raw.includes('corporate') || raw.includes('llc') || raw.includes('corp') || raw.includes('company')) return 'Corporate'
  if (raw.includes('individual')) return 'Individual'
  if (asBoolean(firstDefined(record, ['is_corporate_owner', 'corporate_owner'])) === true) return 'Corporate'
  if (asBoolean(firstDefined(record, ['is_corporate_owner', 'corporate_owner'])) === false) return 'Individual'
  return 'Needs Review'
}

const hasReply = (record: SellerRecord, messages: ThreadMessage[]): boolean => {
  const lastReply = normalize(firstDefined(record, ['last_reply_at', 'lastReplyAt', 'last_inbound_at', 'lastInboundAt']))
  if (lastReply) return true
  const replyStatus = lower(firstDefined(record, ['reply_status', 'replyStatus', 'inbox_bucket']))
  if (replyStatus.includes('replied') || replyStatus.includes('new_reply')) return true
  return messages.some((message) => message.direction === 'inbound' && normalize(message.body))
}

const hasOwnershipConfirmation = (record: SellerRecord, messages: ThreadMessage[]): boolean => {
  if (!hasReply(record, messages)) return false
  const blob = lower([
    firstDefined(record, ['reply_status', 'replyStatus']),
    firstDefined(record, ['last_intent', 'lastIntent']),
    firstDefined(record, ['latest_message_body', 'latestMessageBody', 'last_message', 'lastMessageBody']),
    ...messages.filter((message) => message.direction === 'inbound').map((message) => message.body),
  ].filter(Boolean).join(' '))
  return /\byes\b|\bi own\b|\bowner\b|\bstill mine\b|\bmy property\b/.test(blob)
}

const resolveStatusPills = (record: SellerRecord, messages: ThreadMessage[]): SellerStatusPill[] => {
  const pills: SellerStatusPill[] = []
  const contactStatus = lower(firstDefined(record, ['contact_status', 'suppression_status', 'suppressionStatus', 'status']))
  const automation = lower(firstDefined(record, ['automation_status', 'automationStatus', 'automationState']))
  const stage = lower(firstDefined(record, ['seller_stage', 'pipeline_stage', 'conversation_stage', 'conversationStage', 'stage']))
  const replied = hasReply(record, messages)

  if (contactStatus.includes('suppressed')) return [{ label: 'Suppressed', tone: 'danger' }]
  if (contactStatus.includes('opt') && contactStatus.includes('out')) return [{ label: 'Opt-Out', tone: 'danger' }]
  if (contactStatus.includes('dnc')) return [{ label: 'DNC', tone: 'danger' }]

  if (replied) pills.push({ label: 'New Reply', tone: 'accent' })
  else if (stage.includes('ownership')) pills.push({ label: 'Ownership Check Sent', tone: 'warning' })
  else if (normalize(firstDefined(record, ['last_outbound_at', 'lastOutboundAt', 'last_contact_at', 'lastContactAt']))) pills.push({ label: 'SMS Sent', tone: 'accent' })
  else pills.push({ label: 'No Reply Yet', tone: 'neutral' })

  if (hasOwnershipConfirmation(record, messages)) pills.push({ label: 'Ownership Confirmed', tone: 'success' })
  else if (!replied) pills.push({ label: 'Waiting on Seller', tone: 'neutral' })

  if (replied) {
    const lastReplyAt = firstDefined(record, ['last_reply_at', 'lastReplyAt', 'last_inbound_at', 'lastInboundAt'])
    const relative = formatRelativeTime(lastReplyAt)
    if (relative) pills.push({ label: `Last Reply ${relative}`, tone: 'accent' })
  }

  if (automation.includes('block')) pills.push({ label: 'Auto Blocked', tone: 'danger' })
  else if (automation.includes('pause')) pills.push({ label: 'Paused', tone: 'warning' })
  else if (automation.includes('active')) pills.push({ label: 'Automation Active', tone: 'success' })

  return pills.slice(0, 4)
}

const TAG_PRIORITY = [
  'High Equity',
  'Tax Delinquent',
  'Absentee Owner',
  'Tired Landlord',
  'Likely To Move',
  'Heavily Dated',
  'Vacant',
  'Active Lien',
  'Out Of State Owner',
]

const resolveTags = (record: SellerRecord): string[] => {
  const rawTags = [
    ...parseTagValues(firstDefined(record, ['property_flags_json'])),
    ...parseTagValues(firstDefined(record, ['property_flags_text'])),
    ...parseTagValues(firstDefined(record, ['seller_tags_text'])),
    ...parseTagValues(firstDefined(record, ['seller_tags_json'])),
    ...parseTagValues(firstDefined(record, ['podio_tags'])),
  ].map(titleize)

  const derived = new Set(rawTags)
  const equity = asNumber(firstDefined(record, ['equity_percent', 'equityPercent'])) ?? 0
  if (equity >= 65) derived.add('High Equity')
  if (asBoolean(firstDefined(record, ['tax_delinquent'])) === true) derived.add('Tax Delinquent')
  if (asBoolean(firstDefined(record, ['absentee_owner'])) === true) derived.add('Absentee Owner')
  if (asBoolean(firstDefined(record, ['active_lien'])) === true) derived.add('Active Lien')
  if (asBoolean(firstDefined(record, ['out_of_state_owner'])) === true) derived.add('Out Of State Owner')
  const propertyType = lower(firstDefined(record, ['property_type', 'propertyType', 'property_class']))
  if (propertyType.includes('single')) derived.add('Single Family')
  const language = lower(firstDefined(record, ['language', 'seller_language', 'best_language']))
  if (language.includes('spanish') || language === 'es') derived.add('Spanish Outreach')

  const priorityMap = new Map(TAG_PRIORITY.map((tag, index) => [tag.toLowerCase(), index]))
  return Array.from(derived).sort((left, right) => {
    const leftPriority = priorityMap.get(left.toLowerCase())
    const rightPriority = priorityMap.get(right.toLowerCase())
    if (leftPriority !== undefined || rightPriority !== undefined) return (leftPriority ?? 999) - (rightPriority ?? 999)
    return left.localeCompare(right)
  })
}

const resolveMotivation = (record: SellerRecord): { score: number; label: string } => {
  const supplied = asNumber(firstDefined(record, ['motivation_score', 'motivationScore', 'final_acquisition_score', 'finalAcquisitionScore', 'priority_score', 'priorityScore']))
  const score = Math.max(0, Math.min(100, Math.round(supplied ?? 52)))
  if (score >= 80) return { score, label: 'High Motivation' }
  if (score >= 60) return { score, label: 'Moderate Motivation' }
  if (score >= 40) return { score, label: 'Watchlist' }
  return { score, label: 'Low Signal' }
}

const resolveImage = (record: SellerRecord, address: string): string | null =>
  normalize(firstDefined(record, ['streetview_image'])) ||
  (address && address !== 'Property Unknown' ? buildStreetViewUrl(address) : '') ||
  normalize(firstDefined(record, ['map_image', 'satellite_image'])) ||
  null

const metricItems = (record: SellerRecord) => [
  { label: 'Beds', value: formatNumber(firstDefined(record, ['total_bedrooms', 'beds', 'bedrooms'])) },
  { label: 'Baths', value: formatNumber(firstDefined(record, ['total_baths', 'baths', 'bathrooms'])) },
  { label: 'Sqft', value: formatNumber(firstDefined(record, ['building_square_feet', 'sqft', 'livingAreaSqft'])) },
  { label: 'Units', value: formatNumber(firstDefined(record, ['units_count', 'units', 'unit_count'])) },
  { label: 'Value', value: formatCurrencyCompact(firstDefined(record, ['estimated_value', 'estimatedValue'])) },
  { label: 'Repairs', value: formatCurrencyCompact(firstDefined(record, ['estimated_repair_cost', 'estimatedRepairCost', 'repair_estimate'])) },
  { label: 'Equity', value: formatPercent(firstDefined(record, ['equity_percent', 'equityPercent'])) },
  { label: 'Stage', value: titleize(normalize(firstDefined(record, ['seller_stage', 'pipeline_stage', 'conversation_stage', 'conversationStage', 'stage'])) || 'Needs Review') },
]

const MetricCard = ({ label, value }: { label: string; value: string }) => (
  <div className="nx-sic__metric">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
)

const StatusPill = ({ pill }: { pill: SellerStatusPill }) => (
  <span className={cls('nx-sic__pill', `is-${pill.tone}`)}>{pill.label}</span>
)

export function SellerIntelligenceCard({
  record,
  layoutMode = 'full',
  variant = 'hover',
  messages = [],
  loading = false,
  draftText = '',
  disabled = false,
  onDraftChange,
  onSend,
  onClose,
  onOpenDealIntelligence,
  onOpenConversation,
}: SellerIntelligenceCardProps) {
  if (!record) return null

  const densityMode = resolveDensityMode(layoutMode)
  const sellerName = normalize(firstDefined(record, ['owner_display_name', 'ownerDisplayName', 'owner_full_name', 'owner_name', 'ownerName', 'seller_name', 'sellerName', 'display_name', 'displayName', 'prospect_name', 'contact_name'])) || 'Unknown Seller'
  const address = normalize(firstDefined(record, ['property_address_full', 'propertyAddressFull', 'property_address', 'propertyAddress', 'address', 'situs_address'])) || 'Property Unknown'
  const ownerType = resolveOwnerType(record)
  const propertyType = titleize(normalize(firstDefined(record, ['property_type', 'propertyType', 'property_class', 'propertyClass'])) || 'Residential')
  const imageUrl = resolveImage(record, address)
  const pills = resolveStatusPills(record, messages)
  const metrics = metricItems(record)
  const motivation = resolveMotivation(record)
  const facts = [
    { label: 'Owned', value: `${formatNumber(firstDefined(record, ['ownership_years', 'ownershipYears']))}+ yrs` },
    { label: 'Last Sale', value: formatDate(firstDefined(record, ['last_sale_date', 'lastSaleDate', 'sale_date', 'saleDate'])) },
    { label: 'Language', value: titleize(normalize(firstDefined(record, ['language', 'seller_language', 'best_language'])) || 'English') },
    { label: 'Automation', value: titleize(normalize(firstDefined(record, ['automation_status', 'automationStatus', 'automationState'])) || 'Manual') },
  ]
  const allTags = resolveTags(record)
  const tagLimit = densityMode === 'compact' ? 4 : densityMode === 'balanced' ? 6 : densityMode === 'expanded' ? 8 : 12
  const visibleTags = allTags.slice(0, tagLimit)
  const hiddenTagCount = Math.max(0, allTags.length - visibleTags.length)
  const latestMessage = messages.length > 0 ? messages[messages.length - 1] : null
  const messageBody = latestMessage?.body || normalize(firstDefined(record, ['last_outreach_message', 'latest_message_body', 'latestMessageBody', 'last_message', 'lastMessageBody', 'preview'])) || 'No recent outreach captured.'
  const messageTime = latestMessage?.createdAt || latestMessage?.timelineAt || firstDefined(record, ['last_contact_at', 'lastContactAt', 'last_outbound_at', 'lastOutboundAt', 'last_activity_at', 'lastActivityAt'])

  return (
    <article className={cls('nx-sic', `is-${variant}`, `seller-card--${densityMode}`)}>
      <div className="nx-sic__hero">
        {imageUrl ? <img src={imageUrl} alt={address} loading="lazy" /> : <div className="nx-sic__placeholder"><strong>SV</strong><span>No image</span></div>}
        <div className="nx-sic__hero-overlay" />
        <div className="nx-sic__hero-bottom">
          <div className="nx-sic__pill-row">
            {pills.map((pill) => <StatusPill key={pill.label} pill={pill} />)}
          </div>
        </div>
        {variant === 'selected' && onClose ? (
          <button type="button" className="nx-sic__close" onClick={onClose} aria-label="Close seller intelligence card">×</button>
        ) : null}
      </div>

      <div className="nx-sic__body">
        <header className="nx-sic__header">
          <div className="nx-sic__identity">
            <h3>{sellerName}</h3>
            <p>{address}</p>
          </div>
          <div className="nx-sic__identity-meta">
            <span className="nx-sic__owner-type">{ownerType}</span>
            <small>{propertyType}</small>
          </div>
        </header>

        <section className="nx-sic__metrics">
          {metrics.map((item) => <MetricCard key={item.label} label={item.label} value={item.value} />)}
        </section>

        <section className="nx-sic__panel">
          <div className="nx-sic__panel-head">
            <strong>Seller Intelligence</strong>
          </div>
          <div className="nx-sic__intelligence-compact">
            <div className="nx-sic__bar-wrap">
              <div className="nx-sic__bar-head">
                <strong>Motivation {motivation.score}/100</strong>
                <small>{motivation.label}</small>
              </div>
              <div className="nx-sic__bar-track">
                <span className="nx-sic__bar-fill" style={{ width: `${motivation.score}%` }} />
              </div>
            </div>
            <div className="nx-sic__fact-inline">
              {facts.map((fact) => (
                <span key={fact.label} className="nx-sic__fact-chip">
                  <strong>{fact.value}</strong>
                  <small>{fact.label}</small>
                </span>
              ))}
            </div>
          </div>
        </section>

        {visibleTags.length > 0 ? (
          <section className="nx-sic__panel">
            <div className="nx-sic__panel-head">
              <strong>Property Tags</strong>
            </div>
            <div className="nx-sic__tag-row">
              {visibleTags.map((tag) => <span key={tag} className="nx-sic__tag">{tag}</span>)}
              {hiddenTagCount > 0 ? <span className="nx-sic__tag is-more">+{hiddenTagCount} more</span> : null}
            </div>
          </section>
        ) : null}

        <section className="nx-sic__panel">
          <div className="nx-sic__message-head">
            <strong>Last Outreach</strong>
            <small>{formatRelativeTime(messageTime) || '—'}</small>
          </div>
          <p className="nx-sic__message-body">{messageBody}</p>
        </section>

        {variant === 'selected' ? (
          <section className="nx-sic__panel nx-sic__actions-panel">
            <div className="nx-sic__actions">
              {onOpenConversation ? <button type="button" className="nx-sic__action is-primary" onClick={onOpenConversation}>Open Conversation</button> : null}
              {onOpenDealIntelligence ? <button type="button" className="nx-sic__action" onClick={onOpenDealIntelligence}>Comp Intelligence</button> : null}
              {onClose ? <button type="button" className="nx-sic__action is-quiet" onClick={onClose}>Back to Map</button> : null}
            </div>
            {(onDraftChange && onSend) ? (
              <form
                className="nx-sic__composer"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault()
                  if (!draftText.trim() || disabled) return
                  onSend()
                }}
              >
                <input
                  value={draftText}
                  onChange={(event) => onDraftChange(event.target.value)}
                  placeholder={disabled ? 'Messaging disabled' : 'Quick reply to seller…'}
                  disabled={disabled}
                />
                <button type="submit" disabled={!draftText.trim() || disabled}>Send</button>
              </form>
            ) : null}
            <div className="nx-sic__conversation">
              <div className="nx-sic__panel-head">
                <strong>Conversation Pulse</strong>
                <small>{loading ? 'Syncing…' : `${messages.length} msgs`}</small>
              </div>
              {loading ? <div className="nx-sic__conversation-empty">Syncing conversation…</div> : null}
            </div>
          </section>
        ) : null}
      </div>
    </article>
  )
}
