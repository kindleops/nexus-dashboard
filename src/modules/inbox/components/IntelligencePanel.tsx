import { useMemo, useState, type ReactNode } from 'react'
import type { ThreadContext } from '../../../lib/data/inboxData'
import type { ThreadMessage } from '../../../lib/data/inboxData'
import type { InboxStage, InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import type { PanelMode } from '../inbox-layout-state'
import { Icon } from '../../../shared/icons'
import type { IconName } from '../../../shared/icons'
import { formatRelativeTime } from '../../../shared/formatters'
import {
  buildPropertyHeroStats,
  buildRightPanelSections,
  getThreadActivityFeed,
} from '../inbox-ui-helpers'
import { ActivityFeedCard } from './activity/ActivityFeedCard'
import { shouldAutoExpandActivity } from './activity/activityDefaults'

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
  messages: ThreadMessage[]
  isSuppressed: boolean
  panelMode?: Exclude<PanelMode, 'hidden'>
  onCollapse: () => void
  onOpenMap: () => void
  onOpenDossier: () => void
  onOpenAi: () => void
  onStageChange?: (stage: InboxStage) => void
}

const fallback = (value: unknown, placeholder = 'Not available yet') => {
  const text = String(value ?? '').trim()
  return text || placeholder
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

const IntelRow = ({ label, value }: { label: string; value: string }) => (
  <div className="nx-intel-row">
    <span className="nx-intel-label">{label}</span>
    <span className={cls('nx-intel-value', isMissingValue(value) && 'is-missing')}>
      {missingLabel(value)}
    </span>
  </div>
)

const PropertyHeroCard = ({
  thread,
  context,
  mode,
}: {
  thread: InboxWorkflowThread
  context: ThreadContext | null
  mode: 'compact' | 'split' | 'workspace'
}) => {
  const address = fallback(context?.property?.address || thread.propertyAddress || thread.subject, 'Property Unknown')
  const stats = useMemo(() => buildPropertyHeroStats(thread, context), [thread, context])
  const get = (key: string) => (thread as unknown as Record<string, unknown>)[key]
  const mediaLabel = missingLabel(get('propertyType'), 'Property profile')
  const shownStats = mode === 'workspace' ? stats : mode === 'split' ? stats.slice(0, 6) : stats.slice(0, 4)

  return (
    <section className={cls('nx-property-hero-card', `is-${mode}`)}>
      <div className="nx-property-hero-media" aria-label="Street view snapshot">
        <span className="nx-property-hero-media__label">Property Snapshot</span>
        <div className="nx-property-hero-media__image" role="img" aria-label="Property media placeholder">
          <Icon name="map" />
          <span>{mediaLabel}</span>
        </div>
      </div>
      <div className="nx-property-hero-head">
        <strong>{address}</strong>
        <span>{missingLabel(context?.property?.market || thread.market || thread.marketId, 'Market pending')}</span>
      </div>
      <div className="nx-property-hero-strip">
        <span className={cls('nx-stage-pill', stageToneClass(thread.inboxStage))}>{thread.inboxStage.replace(/_/g, ' ')}</span>
        <span className={cls('nx-pri-pill', `is-${thread.priority || 'unknown'}`)}>
          Priority {missingLabel(thread.priority, 'pending')}
        </span>
        <span className="nx-property-hero-strip__time">Updated {formatRelativeTime(thread.lastMessageAt)}</span>
      </div>
      <div className="nx-property-hero-stats">
        {shownStats.map((item) => (
          <span key={item.label} className="nx-property-pill">
            <i>{item.icon}</i>
            <small>{item.label}</small>
            <b className={isMissingValue(item.value) ? 'is-missing' : undefined}>{missingLabel(item.value, '—')}</b>
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

const IntelligenceHero = ({
  thread,
  context,
  isSuppressed,
  onOpenMap,
  onOpenDossier,
  onOpenAi,
  onExpandAll,
  onCollapseAll,
}: {
  thread: InboxWorkflowThread
  context: ThreadContext | null
  isSuppressed: boolean
  onOpenMap: () => void
  onOpenDossier: () => void
  onOpenAi: () => void
  onExpandAll: () => void
  onCollapseAll: () => void
}) => {
  const get = (key: string) => (thread as unknown as Record<string, unknown>)[key]

  const summaryChips = [
    `AI ${missingLabel(get('aiScore'), '—')}`,
    `Sentiment ${missingLabel(thread.sentiment, 'pending')}`,
    `Stage ${thread.inboxStage.replace(/_/g, ' ')}`,
    `Motivation ${missingLabel(get('motivationFlagsCount'), '—')}`,
    `Buyer ${missingLabel(get('buyerMatchCount'), '0')} matches`,
    `Underwriting ${missingLabel(get('offerVerificationStatus'), 'pending')}`,
  ]

  return (
    <section className="nx-intel-hero">
      <div className="nx-intel-hero__left">
        <strong>{fallback(context?.property?.address || thread.propertyAddress || thread.subject, 'Deal workspace')}</strong>
        <span>
          {missingLabel(context?.seller?.name || thread.ownerName, 'Seller pending')} · {missingLabel(context?.property?.market || thread.market || thread.marketId, 'Market pending')} · {thread.id.slice(0, 8)}
        </span>
        <div className="nx-intel-hero__status-row">
          <span className={cls('nx-stage-pill', stageToneClass(thread.inboxStage))}>{thread.inboxStage.replace(/_/g, ' ')}</span>
          <span className={cls('nx-pri-pill', `is-${thread.priority || 'unknown'}`)}>{missingLabel(thread.priority, 'pending')} priority</span>
          {isSuppressed && <span className="nx-suppression-badge">suppressed</span>}
          <small>Last activity {formatRelativeTime(thread.lastMessageAt)}</small>
        </div>
      </div>

      <div className="nx-intel-hero__center">
        {summaryChips.map((chip) => (
          <span key={chip}>{chip}</span>
        ))}
      </div>

      <div className="nx-intel-hero__actions">
        <button type="button" onClick={onOpenMap}><Icon name="map" /> Open Map</button>
        <button type="button" onClick={onOpenDossier}><Icon name="briefing" /> Open Dossier</button>
        <button type="button" onClick={onOpenAi} disabled={isSuppressed}><Icon name="spark" /> AI Assist</button>
        <button type="button" onClick={onExpandAll}><Icon name="maximize" /> Expand All</button>
        <button type="button" onClick={onCollapseAll}><Icon name="layout-split" /> Collapse All</button>
      </div>
    </section>
  )
}

const IntelligenceActionRail = ({
  isSuppressed,
  onOpenMap,
  onOpenDossier,
  onOpenAi,
  onExpandAll,
  onCollapseAll,
  mode,
}: {
  isSuppressed: boolean
  onOpenMap: () => void
  onOpenDossier: () => void
  onOpenAi: () => void
  onExpandAll: () => void
  onCollapseAll: () => void
  mode: 'compact' | 'split' | 'workspace'
}) => (
  <div className={cls('nx-intel-action-rail', `is-${mode}`)}>
    <button type="button" onClick={onOpenMap}><Icon name="map" /><span>Map</span></button>
    <button type="button" onClick={onOpenDossier}><Icon name="briefing" /><span>Dossier</span></button>
    <button type="button" onClick={onOpenAi} disabled={isSuppressed}><Icon name="spark" /><span>AI Assist</span></button>
    {mode !== 'compact' && (
      <>
        <button type="button" onClick={onExpandAll}><Icon name="maximize" /><span>Expand All</span></button>
        <button type="button" onClick={onCollapseAll}><Icon name="layout-split" /><span>Collapse All</span></button>
      </>
    )}
  </div>
)

const resolvePanelLayoutMode = (panelMode: Exclude<PanelMode, 'hidden'>): 'compact' | 'split' | 'workspace' => {
  if (panelMode === 'half') return 'split'
  if (panelMode === 'full') return 'workspace'
  return 'compact'
}

export const IntelligencePanel = ({
  thread,
  context,
  messages,
  isSuppressed,
  panelMode = 'default',
  onCollapse,
  onOpenMap,
  onOpenDossier,
  onOpenAi,
  onStageChange,
}: IntelligencePanelProps) => {
  const [sectionStateByThread, setSectionStateByThread] = useState<Record<string, string[]>>({})
  const layoutMode = resolvePanelLayoutMode(panelMode)
  const sections = useMemo(() => (
    thread ? buildRightPanelSections(thread, context, isSuppressed) : []
  ), [thread, context, isSuppressed])
  const sectionById = useMemo(() => {
    const map = new Map<string, (typeof sections)[number]>()
    sections.forEach((section) => map.set(section.id, section))
    return map
  }, [sections])

  const modeScopeKey = thread ? `${thread.id}:${layoutMode}` : ''

  const activityEvents = useMemo(() => (
    thread ? getThreadActivityFeed(thread, context, messages) : []
  ), [thread, context, messages])
  const autoExpandActivity = useMemo(() => (
    thread ? shouldAutoExpandActivity(thread, messages, activityEvents) : false
  ), [thread, messages, activityEvents])

  if (!thread) return (
    <aside className="nx-intelligence-panel">
      <div className="nx-inbox__workspace-empty">
        <p>Select a thread to view intelligence.</p>
      </div>
    </aside>
  )

  const allSectionIds = sections.map((section) => section.id).concat('activity')
  const defaultOpenSectionIds = (() => {
    if (layoutMode === 'workspace') return autoExpandActivity ? ['deal_intelligence', 'underwriting_offer', 'activity'] : ['deal_intelligence', 'underwriting_offer']
    if (layoutMode === 'split') return autoExpandActivity ? ['deal_intelligence', 'activity'] : ['deal_intelligence', 'underwriting_offer']
    return autoExpandActivity ? ['deal_intelligence', 'activity'] : ['deal_intelligence']
  })()
  const openSectionIds = sectionStateByThread[modeScopeKey] ?? defaultOpenSectionIds

  const groupedIds = {
    dealCore: ['deal_intelligence', 'underwriting_offer', 'buyer_intelligence'],
    people: ['prospect', 'owner'],
    reference: ['activity', 'property_details', 'links_tools'],
    splitOrder: ['deal_intelligence', 'activity', 'prospect', 'owner', 'property_details', 'underwriting_offer', 'buyer_intelligence', 'links_tools'],
    compactOrder: ['deal_intelligence', 'activity', 'underwriting_offer', 'prospect', 'owner', 'property_details', 'buyer_intelligence', 'links_tools'],
  } as const

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
    if (id === 'activity') {
      const lastEvent = activityEvents[0]
      if (!lastEvent) return 'No timeline events yet'
      return `${formatRelativeTime(lastEvent.timestamp)} · ${activityEvents.length} events · ${trimSummary(lastEvent.summary, 64)}`
    }

    const enriched = rows
      .map((item) => `${item.label} ${missingLabel(item.value, '—')}`)
      .filter((text) => !isMissingValue(text.replace(/^[^ ]+\s*/, '')))
      .slice(0, 2)

    if (enriched.length > 0) return enriched.join(' • ')
    if (!isMissingValue(summary) && !summary.toLowerCase().includes('unknown')) return summary

    const fallbackBySection: Record<string, string> = {
      deal_intelligence: 'Score, sentiment, and stage are pending enrichment',
      underwriting_offer: 'MAO and offer strategy are pending',
      buyer_intelligence: 'No active buyer signals yet',
      prospect: 'Prospect profile has limited data',
      owner: 'Owner record is not enriched yet',
      property_details: 'Property data is still being enriched',
      links_tools: 'External sources and workflow shortcuts',
    }
    return fallbackBySection[id] ?? 'Pending enrichment'
  }

  const resolveSectionChips = (id: string, rows: Array<{ label: string; value: string }>): string[] => {
    if (id === 'activity') {
      return [
        `${activityEvents.length} events`,
        `${formatRelativeTime(thread.lastMessageAt)} update`,
      ]
    }
    if (id === 'deal_intelligence') {
      return [
        `AI ${missingLabel(valueByLabel(rows, 'AI Score'), '—')}`,
        missingLabel(valueByLabel(rows, 'Sentiment'), 'sentiment pending'),
        missingLabel(valueByLabel(rows, 'Priority'), 'priority pending'),
      ]
    }
    if (id === 'underwriting_offer') {
      return [
        missingLabel(valueByLabel(rows, 'MAO'), 'MAO pending'),
        missingLabel(valueByLabel(rows, 'Offer Strategy'), 'strategy pending'),
      ]
    }
    if (id === 'buyer_intelligence') {
      return [
        `${missingLabel(valueByLabel(rows, 'Buyer Match Count'), '0')} matches`,
        missingLabel(valueByLabel(rows, 'Best Buyer Type'), 'no buyer type'),
      ]
    }
    if (id === 'prospect') {
      return [
        missingLabel(valueByLabel(rows, 'Phone'), 'phone pending'),
        missingLabel(valueByLabel(rows, 'Language'), 'language pending'),
      ]
    }
    if (id === 'owner') {
      return [
        missingLabel(valueByLabel(rows, 'Owner Type'), 'owner type pending'),
        `Out-of-state ${missingLabel(valueByLabel(rows, 'Out of State Owner'), '—')}`,
      ]
    }
    if (id === 'property_details') {
      return [
        missingLabel(valueByLabel(rows, 'Sqft'), 'sqft pending'),
        missingLabel(valueByLabel(rows, 'Year Built'), 'year pending'),
      ]
    }
    return ['Tools']
  }

  const renderSectionBody = (section: { id: string; rows: Array<{ label: string; value: string }> }) => {
    if (section.id === 'activity') {
      return (
        <div className={cls('nx-activity-feed-shell', `is-${layoutMode}`)}>
          <ActivityFeedCard thread={thread} context={context} messages={messages} />
        </div>
      )
    }

    return (
      <div className="nx-intel-grid">
        {section.rows.map((item) => (
          <IntelRow key={`${section.id}-${item.label}`} label={item.label} value={item.value} />
        ))}
      </div>
    )
  }

  const renderSectionCard = (sectionId: string) => {
    if (sectionId === 'activity') {
      const expanded = openSectionIds.includes('activity')
      const summary = resolveSectionPreview('activity', '', [])
      const chips = resolveSectionChips('activity', [])
      return (
        <AccordionCard
          key="activity"
          title="Activity Feed"
          icon="activity"
          preview={summary}
          chips={chips}
          meta={`${activityEvents.length}`}
          expanded={expanded}
          onToggle={() => toggleSection('activity')}
        >
          {renderSectionBody({ id: 'activity', rows: [] })}
        </AccordionCard>
      )
    }

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

  const renderSectionGroup = (title: string, ids: string[]) => (
    <section className="nx-intel-group-zone" key={title}>
      <header>{title}</header>
      <div className="nx-intel-group-zone__stack">
        {ids.map((id) => renderSectionCard(id))}
      </div>
    </section>
  )

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
        {layoutMode === 'workspace' ? (
          <div className="nx-intel-workspace">
            <IntelligenceHero
              thread={thread}
              context={context}
              isSuppressed={isSuppressed}
              onOpenMap={onOpenMap}
              onOpenDossier={onOpenDossier}
              onOpenAi={onOpenAi}
              onExpandAll={() => setOpenSections(allSectionIds)}
              onCollapseAll={() => setOpenSections([])}
            />

            <div className="nx-intel-workspace-grid">
              <div className="nx-intel-workspace-col is-primary">
                <section className="nx-intel-group-zone">
                  <header>Property Snapshot</header>
                  <div className="nx-intel-group-zone__stack">
                    <PropertyHeroCard thread={thread} context={context} mode={layoutMode} />
                    <IntelligenceActionRail
                      mode={layoutMode}
                      isSuppressed={isSuppressed}
                      onOpenMap={onOpenMap}
                      onOpenDossier={onOpenDossier}
                      onOpenAi={onOpenAi}
                      onExpandAll={() => setOpenSections(allSectionIds)}
                      onCollapseAll={() => setOpenSections([])}
                    />
                  </div>
                </section>
                {renderSectionGroup('Deal Core', groupedIds.dealCore)}
                {renderSectionGroup('Reference / Evidence', ['activity'])}
              </div>
              <div className="nx-intel-workspace-col is-secondary">
                {renderSectionGroup('People', groupedIds.people)}
                {renderSectionGroup('Reference Data', ['property_details', 'links_tools'])}
              </div>
            </div>
          </div>
        ) : (
          <div className={cls('nx-intel-mode-stack', `is-${layoutMode}`)}>
            <section className="nx-intel-group-zone is-snapshot-zone">
              <header>{layoutMode === 'split' ? 'Snapshot' : 'Property Snapshot'}</header>
              <div className="nx-intel-group-zone__stack">
                <PropertyHeroCard thread={thread} context={context} mode={layoutMode} />
                <IntelligenceActionRail
                  mode={layoutMode}
                  isSuppressed={isSuppressed}
                  onOpenMap={onOpenMap}
                  onOpenDossier={onOpenDossier}
                  onOpenAi={onOpenAi}
                  onExpandAll={() => setOpenSections(allSectionIds)}
                  onCollapseAll={() => setOpenSections([])}
                />
              </div>
            </section>

            {layoutMode === 'split' ? (
              <>
                {renderSectionGroup('Deal Core', groupedIds.dealCore)}
                {renderSectionGroup('People', groupedIds.people)}
                {renderSectionGroup('Reference / Evidence', groupedIds.reference)}
              </>
            ) : (
              <div className="nx-intel-compact-stack">
                {groupedIds.compactOrder.map((sectionId) => renderSectionCard(sectionId))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
