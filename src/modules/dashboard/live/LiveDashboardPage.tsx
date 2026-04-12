import { useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { NexusMap } from './NexusMap'
import type {
  FilterOption,
  LiveAgent,
  LiveAlert,
  LiveDashboardModel,
  LiveLead,
  LiveMarket,
  SystemHealthItem,
} from './live-dashboard.adapter'
import {
  formatClockTime,
  formatCompactNumber,
  formatCurrency,
  formatOwnerLabel,
  formatRelativeTime,
  formatShortDateTime,
  formatStageLabel,
} from '../../../shared/formatters'
import { Icon } from '../../../shared/icons'

type DrawerType = 'market' | 'lead' | 'agent' | null
type LayoutMode = 'split' | 'map' | 'list' | 'battlefield'
type MapMode = 'leads' | 'distress' | 'heat' | 'stage' | 'pressure' | 'closings'

interface CommandItem {
  id: string
  label: string
  hint?: string
  category: string
  action: () => void
}

const classes = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

const groupByCategory = <T extends { category: string }>(items: T[]) => {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const existing = map.get(item.category)
    if (existing) {
      existing.push(item)
    } else {
      map.set(item.category, [item])
    }
  }
  return Array.from(map.entries()).map(([category, groups]) => ({ category, items: groups }))
}

const includesQuery = (query: string, ...values: Array<string | null | undefined>) => {
  if (!query) {
    return true
  }

  return values.some((value) => value?.toLowerCase().includes(query))
}

const stageToneClass: Record<LiveLead['sentiment'], string> = {
  hot: 'is-hot',
  warm: 'is-warm',
  neutral: 'is-neutral',
  cold: 'is-cold',
}

const alertClass: Record<LiveAlert['severity'], string> = {
  critical: 'is-critical',
  warning: 'is-warning',
  info: 'is-info',
}

const alertPriorityLabel: Record<'P0' | 'P1' | 'P2' | 'P3', string> = {
  P0: 'IMMEDIATE',
  P1: 'URGENT',
  P2: 'ELEVATED',
  P3: 'MONITOR',
}

const marketStatusLabel: Record<LiveMarket['campaignStatus'], string> = {
  live: 'LIVE',
  warning: 'WATCH',
  paused: 'PAUSED',
}

const operationalRiskClass: Record<LiveMarket['operationalRisk'], string> = {
  elevated: 'is-elevated',
  moderate: 'is-moderate',
  nominal: 'is-nominal',
}

const operationalRiskLabel: Record<LiveMarket['operationalRisk'], string> = {
  elevated: 'RISK ELEVATED',
  moderate: 'RISK MODERATE',
  nominal: 'NOMINAL',
}

export const LiveDashboardPage = ({ data }: { data: LiveDashboardModel }) => {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const [marketScope, setMarketScope] = useState<string>('all')
  const [propertyType, setPropertyType] = useState<string>('all')
  const [sentiment, setSentiment] = useState<string>('all')
  const [stage, setStage] = useState<string>('all')
  const [ownerType, setOwnerType] = useState<string>('all')
  const [leftRailOpen, setLeftRailOpen] = useState(true)
  const [rightRailOpen, setRightRailOpen] = useState(true)
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [metricsCollapsed, setMetricsCollapsed] = useState(false)
  const [activeDrawer, setActiveDrawer] = useState<DrawerType>(null)
  const [selectedMarketId, setSelectedMarketId] = useState(data.defaults.marketId)
  const [selectedLeadId, setSelectedLeadId] = useState(data.defaults.leadId)
  const [selectedAgentId, setSelectedAgentId] = useState(data.defaults.agentId)
  const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>([])
  const [clock, setClock] = useState(() => new Date())
  // New — layout, map mode, command palette
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('split')
  const [mapMode, setMapMode] = useState<MapMode>('leads')
  const [cmdOpen, setCmdOpen] = useState(false)
  const [cmdQuery, setCmdQuery] = useState('')

  const visibleLeads = data.leads.filter((lead) => {
    const matchesMarket = marketScope === 'all' || lead.marketId === marketScope
    const matchesPropertyType = propertyType === 'all' || lead.propertyType === propertyType
    const matchesSentiment = sentiment === 'all' || lead.sentiment === sentiment
    const matchesStage = stage === 'all' || lead.pipelineStage === stage
    const matchesOwnerType = ownerType === 'all' || lead.ownerType === ownerType
    const matchesQuery = includesQuery(
      deferredQuery,
      lead.ownerName,
      lead.address,
      lead.city,
      lead.currentIntent,
      lead.marketLabel,
    )

    return (
      matchesMarket &&
      matchesPropertyType &&
      matchesSentiment &&
      matchesStage &&
      matchesOwnerType &&
      matchesQuery
    )
  })

  const visibleMarkets = data.markets.filter((market) => {
    const matchesScope = marketScope === 'all' || market.id === marketScope
    const matchesQuery = includesQuery(deferredQuery, market.name, market.label, market.scanLabel)
    const hasVisibleLead = visibleLeads.some((lead) => lead.marketId === market.id)
    return matchesScope && (matchesQuery || hasVisibleLead)
  })

  const visibleAgents = data.agents.filter((agent) => {
    const matchesMarket = marketScope === 'all' || agent.marketId === marketScope
    return (
      matchesMarket &&
      includesQuery(
        deferredQuery,
        agent.name,
        agent.specialty,
        agent.activityLabel,
        agent.marketLabel,
        agent.focusLeadLabel,
      )
    )
  })

  const visibleAlerts = data.alerts.filter((alert) => {
    const matchesMarket = marketScope === 'all' || alert.marketId === marketScope
    const isDismissed = dismissedAlertIds.includes(alert.id)
    return (
      matchesMarket &&
      !isDismissed &&
      includesQuery(deferredQuery, alert.title, alert.detail, alert.marketLabel)
    )
  })

  const visibleTimeline = data.timeline.filter((entry) => {
    const matchesMarket = marketScope === 'all' || entry.marketId === marketScope
    return (
      matchesMarket &&
      includesQuery(deferredQuery, entry.title, entry.detail, entry.marketLabel, entry.kind)
    )
  })

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClock(new Date())
    }, 30_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  const onKeyboardShortcut = useEffectEvent((event: KeyboardEvent) => {
    // Cmd/Ctrl + K — Command Palette (works from any context)
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault()
      setCmdOpen((curr) => !curr)
      return
    }

    // Cmd/Ctrl + M — Map Focus Mode toggle
    if ((event.metaKey || event.ctrlKey) && event.key === 'm') {
      event.preventDefault()
      setLayoutMode((curr) => (curr === 'map' ? 'split' : 'map'))
      return
    }

    // Cmd/Ctrl + B — Battlefield Mode toggle
    if ((event.metaKey || event.ctrlKey) && event.key === 'b') {
      event.preventDefault()
      setLayoutMode((curr) => (curr === 'battlefield' ? 'split' : 'battlefield'))
      return
    }

    const target = event.target
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      if (event.key === 'Escape' && cmdOpen) {
        setCmdOpen(false)
        setCmdQuery('')
      }
      return
    }

    if (event.key === '[') {
      setLeftRailOpen((current) => !current)
    }

    if (event.key === ']') {
      setRightRailOpen((current) => !current)
    }

    if (event.key === 'Escape') {
      if (cmdOpen) {
        setCmdOpen(false)
        setCmdQuery('')
        return
      }
      if (layoutMode === 'map' || layoutMode === 'battlefield') {
        setLayoutMode('split')
        return
      }
      if (activeDrawer) {
        setActiveDrawer(null)
        return
      }
    }
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      onKeyboardShortcut(event)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const resolvedSelectedMarketId = visibleMarkets.some((market) => market.id === selectedMarketId)
    ? selectedMarketId
    : visibleMarkets[0]?.id ?? data.defaults.marketId

  const selectedMarket = visibleMarkets.find((market) => market.id === resolvedSelectedMarketId) ??
    data.markets.find((market) => market.id === resolvedSelectedMarketId) ??
    visibleMarkets[0] ??
    data.markets[0]

  const preferredLeadPool = visibleLeads.filter((lead) => lead.marketId === selectedMarket?.id)
  const activeLeadPool = preferredLeadPool.length > 0 ? preferredLeadPool : visibleLeads

  const resolvedSelectedLeadId = activeLeadPool.some((lead) => lead.id === selectedLeadId)
    ? selectedLeadId
    : activeLeadPool[0]?.id ?? data.defaults.leadId

  const selectedLead = activeLeadPool.find((lead) => lead.id === resolvedSelectedLeadId) ??
    data.leads.find((lead) => lead.id === resolvedSelectedLeadId) ??
    activeLeadPool[0] ??
    data.leads[0]

  const preferredAgentPool = visibleAgents.filter((agent) => agent.marketId === selectedMarket?.id)
  const activeAgentPool = preferredAgentPool.length > 0 ? preferredAgentPool : visibleAgents

  const resolvedSelectedAgentId = activeAgentPool.some((agent) => agent.id === selectedAgentId)
    ? selectedAgentId
    : activeAgentPool[0]?.id ?? data.defaults.agentId

  const selectedAgent = activeAgentPool.find((agent) => agent.id === resolvedSelectedAgentId) ??
    data.agents.find((agent) => agent.id === resolvedSelectedAgentId) ??
    activeAgentPool[0] ??
    data.agents[0]

  const selectedAgentLead =
    data.leads.find((lead) => lead.id === selectedAgent?.focusLeadId) ?? selectedLead

  const selectedMarketLeads = data.leads
    .filter((lead) => lead.marketId === selectedMarket?.id)
    .slice(0, 3)

  // Effective open states account for layout mode
  const leftEffOpen = leftRailOpen && layoutMode !== 'map' && layoutMode !== 'battlefield'
  const rightEffOpen = rightRailOpen && layoutMode !== 'map' && layoutMode !== 'battlefield'

  // Command palette commands
  const commands = useMemo<CommandItem[]>(
    () => [
      { id: 'view-intel', label: 'Toggle Intel Panel', hint: '[', category: 'View', action: () => setLeftRailOpen((c) => !c) },
      { id: 'view-activity', label: 'Toggle Activity Panel', hint: ']', category: 'View', action: () => setRightRailOpen((c) => !c) },
      { id: 'view-filters', label: 'Toggle Filters', category: 'View', action: () => setFiltersOpen((c) => !c) },
      { id: 'view-kpi', label: 'Toggle KPI Bar', category: 'View', action: () => setMetricsCollapsed((c) => !c) },
      { id: 'layout-split', label: 'Split View', hint: 'default', category: 'Layout', action: () => setLayoutMode('split') },
      { id: 'layout-map', label: 'Map Focus Mode', hint: '⌘M', category: 'Layout', action: () => setLayoutMode('map') },
      { id: 'layout-list', label: 'List View', category: 'Layout', action: () => setLayoutMode('list') },
      { id: 'layout-battlefield', label: 'Battlefield Mode', hint: '⌘B', category: 'Layout', action: () => setLayoutMode('battlefield') },
      { id: 'map-leads', label: 'Map: Leads', category: 'Map', action: () => setMapMode('leads') },
      { id: 'map-distress', label: 'Map: Distress Layer', category: 'Map', action: () => setMapMode('distress') },
      { id: 'map-heat', label: 'Map: Urgency Heat', category: 'Map', action: () => setMapMode('heat') },
      { id: 'map-stage', label: 'Map: Pipeline Stage', category: 'Map', action: () => setMapMode('stage') },
      { id: 'map-pressure', label: 'Map: Outbound Pressure', category: 'Map', action: () => setMapMode('pressure') },
      { id: 'map-closings', label: 'Map: Closings Only', category: 'Map', action: () => setMapMode('closings') },
      { id: 'filter-all', label: 'Clear All Filters', hint: 'reset', category: 'Filter', action: () => { setSentiment('all'); setPropertyType('all'); setStage('all'); setMarketScope('all') } },
      { id: 'filter-hot', label: 'Filter: Hot Leads', hint: 'sentiment', category: 'Filter', action: () => setSentiment('hot') },
      { id: 'filter-warm', label: 'Filter: Warm Leads', hint: 'sentiment', category: 'Filter', action: () => setSentiment('warm') },
      { id: 'filter-cold', label: 'Filter: Cold Leads', hint: 'sentiment', category: 'Filter', action: () => setSentiment('cold') },
      ...data.markets.map((market) => ({
        id: `market-${market.id}`,
        label: `Market: ${market.name}`,
        hint: market.scanLabel,
        category: 'Markets',
        action: () => { setSelectedMarketId(market.id); setActiveDrawer('market') },
      })),
      ...visibleLeads.slice(0, 10).map((lead) => ({
        id: `lead-${lead.id}`,
        label: `Lead: ${lead.ownerName}`,
        hint: lead.sentiment,
        category: 'Leads',
        action: () => { setSelectedLeadId(lead.id); setActiveDrawer('lead') },
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.markets, visibleLeads],
  )

  return (
    <div
      className={classes(
        'cc-shell',
        layoutMode === 'map' && 'cc-shell--map-focus',
        layoutMode !== 'split' && `cc-shell--layout-${layoutMode}`,
      )}
      data-testid="dashboard-root"
    >
      <DashboardHeader
        appName={data.appName}
        query={query}
        setQuery={setQuery}
        liveClock={clock}
        healthLabel={data.healthLabel}
        leftRailOpen={leftEffOpen}
        rightRailOpen={rightEffOpen}
        layoutMode={layoutMode}
        onToggleLeftRail={() => { setLeftRailOpen((current) => !current) }}
        onToggleRightRail={() => { setRightRailOpen((current) => !current) }}
        onSetLayoutMode={setLayoutMode}
        onOpenCmd={() => { setCmdOpen(true) }}
      />

      {data.degraded ? (
        <div className="cc-degraded-banner" role="alert">
          <span className="cc-degraded-banner__label">DEGRADED</span>
          <span className="cc-degraded-banner__reason">{data.degraded.reason}</span>
        </div>
      ) : data.dataSource === 'mock' ? (
        <div className="cc-mock-banner" role="status">
          <span className="cc-mock-banner__label">MOCK DATA</span>
          <span className="cc-mock-banner__detail">Set <code>VITE_NEXUS_API_URL</code> to connect to live operations.</span>
        </div>
      ) : null}

      <HealthStrip items={data.systemHealth} />

      <div className="cc-workspace">
        {/* Left rail wrap — always rendered, CSS-animated collapse */}
        <div
          className={classes('cc-rail-wrap cc-rail-wrap--left', !leftEffOpen && 'is-collapsed')}
          aria-hidden={!leftEffOpen}
        >
          <IntelligenceRail
            data={data}
            filtersOpen={filtersOpen}
            onToggleFilters={() => { setFiltersOpen((current) => !current) }}
            selectedMarketId={selectedMarket?.id ?? ''}
            selectedAgentId={selectedAgent?.id ?? ''}
            visibleMarkets={visibleMarkets}
            visibleAgents={visibleAgents}
            onSelectMarket={(marketId) => { setSelectedMarketId(marketId) }}
            onOpenMarket={(marketId) => { setSelectedMarketId(marketId); setActiveDrawer('market') }}
            onOpenAgent={(agentId) => { setSelectedAgentId(agentId); setActiveDrawer('agent') }}
            marketScope={marketScope}
            propertyType={propertyType}
            sentiment={sentiment}
            stage={stage}
            ownerType={ownerType}
            setMarketScope={setMarketScope}
            setPropertyType={setPropertyType}
            setSentiment={setSentiment}
            setStage={setStage}
            setOwnerType={setOwnerType}
          />
        </div>

        {layoutMode === 'list' ? (
          <LeadListTable
            leads={visibleLeads}
            selectedLeadId={resolvedSelectedLeadId}
            onOpenLead={(leadId) => { setSelectedLeadId(leadId); setActiveDrawer('lead') }}
          />
        ) : layoutMode === 'battlefield' ? (
          <BattlefieldView
            leads={visibleLeads}
            selectedLeadId={resolvedSelectedLeadId}
            onOpenLead={(leadId) => { setSelectedLeadId(leadId); setActiveDrawer('lead') }}
          />
        ) : (
          <MapStage
            markets={visibleMarkets}
            leads={visibleLeads}
            selectedMarket={selectedMarket}
            selectedLead={selectedLead}
            selectedMarketLeads={selectedMarketLeads}
            metrics={data.summaryMetrics}
            metricsCollapsed={metricsCollapsed}
            activeDrawer={activeDrawer}
            mapMode={mapMode}
            onToggleMetrics={() => { setMetricsCollapsed((current) => !current) }}
            onSelectMarket={(marketId) => { setSelectedMarketId(marketId) }}
            onOpenMarket={(marketId) => { setSelectedMarketId(marketId); setActiveDrawer('market') }}
            onOpenLead={(leadId) => { setSelectedLeadId(leadId); setActiveDrawer('lead') }}
            onSetMapMode={setMapMode}
          />
        )}

        {/* Right rail wrap — always rendered, CSS-animated collapse */}
        <div
          className={classes('cc-rail-wrap cc-rail-wrap--right', !rightEffOpen && 'is-collapsed')}
          aria-hidden={!rightEffOpen}
        >
          <ActivityRail
            alerts={visibleAlerts}
            timeline={visibleTimeline}
            selectedLead={selectedLead}
            onAcknowledgeAlert={(alertId) => { setDismissedAlertIds((current) => [...current, alertId]) }}
            onOpenLead={(leadId) => { setSelectedLeadId(leadId); setActiveDrawer('lead') }}
          />
        </div>

        <button
          className={classes('cc-rail-toggle cc-rail-toggle--left', !leftEffOpen && 'is-closed')}
          type="button"
          data-testid="toggle-left-rail"
          onClick={() => { setLeftRailOpen((current) => !current) }}
        >
          <Icon
            className={classes('cc-rail-toggle__icon', leftEffOpen && 'is-open')}
            name="chevron-right"
          />
        </button>

        <button
          className={classes('cc-rail-toggle cc-rail-toggle--right', !rightEffOpen && 'is-closed')}
          type="button"
          data-testid="toggle-right-rail"
          onClick={() => { setRightRailOpen((current) => !current) }}
        >
          <Icon
            className={classes('cc-rail-toggle__icon', rightEffOpen && 'is-open-right')}
            name="chevron-right"
          />
        </button>
      </div>

      <CommandHintBar activeDrawer={activeDrawer} layoutMode={layoutMode} />

      <DrawerOverlay
        activeDrawer={activeDrawer}
        onClose={() => { setActiveDrawer(null) }}
      >
        {activeDrawer === 'market' && selectedMarket ? (
          <MarketDrawer market={selectedMarket} />
        ) : null}
        {activeDrawer === 'lead' && selectedLead ? <LeadDrawer lead={selectedLead} /> : null}
        {activeDrawer === 'agent' && selectedAgent && selectedAgentLead ? (
          <AgentDrawer agent={selectedAgent} lead={selectedAgentLead} />
        ) : null}
      </DrawerOverlay>

      {cmdOpen ? (
        <CommandPalette
          query={cmdQuery}
          onQueryChange={setCmdQuery}
          commands={commands}
          onClose={() => { setCmdOpen(false); setCmdQuery('') }}
        />
      ) : null}
    </div>
  )
}

const DashboardHeader = ({
  appName,
  query,
  setQuery,
  liveClock,
  healthLabel,
  leftRailOpen,
  rightRailOpen,
  layoutMode,
  onToggleLeftRail,
  onToggleRightRail,
  onSetLayoutMode,
  onOpenCmd,
}: {
  appName: string
  query: string
  setQuery: (value: string) => void
  liveClock: Date
  healthLabel: string
  leftRailOpen: boolean
  rightRailOpen: boolean
  layoutMode: LayoutMode
  onToggleLeftRail: () => void
  onToggleRightRail: () => void
  onSetLayoutMode: (mode: LayoutMode) => void
  onOpenCmd: () => void
}) => (
  <header className="cc-header">
    <div className="cc-header__brand">
      <div className="cc-brand-mark">
        <Icon className="cc-brand-mark__icon" name="radar" />
      </div>
      <div className="cc-brand-copy">
        <span className="cc-eyebrow" data-testid="text-app-name">
          {appName}
        </span>
        <div className="cc-status-row">
          <span className="cc-live-pill" data-testid="status-live-indicator">
            <span className="cc-live-pill__dot" />
            LIVE
          </span>
          <span className="cc-health-pill" data-testid="status-system-health">
            <Icon className="cc-health-pill__icon" name="shield" />
            {healthLabel}
          </span>
        </div>
      </div>
    </div>

    <div className="cc-header__search">
      <Icon className="cc-header__search-icon" name="search" />
      <input
        className="cc-header__input"
        type="search"
        placeholder="Search markets, leads, alerts, agents"
        value={query}
        data-testid="input-command-search"
        onChange={(event) => {
          setQuery(event.target.value)
        }}
      />
    </div>

    <div className="cc-header__actions">
      <div className="cc-clock" data-testid="text-live-clock">
        <Icon className="cc-clock__icon" name="clock" />
        {formatClockTime(liveClock)} CT
      </div>

      {/* Layout mode toggles */}
      <button
        className={classes('cc-icon-button', layoutMode === 'split' && 'is-active')}
        type="button"
        title="Split View"
        onClick={() => onSetLayoutMode('split')}
      >
        <Icon className="cc-icon-button__icon" name="layout-split" />
      </button>
      <button
        className={classes('cc-icon-button', layoutMode === 'map' && 'is-active')}
        type="button"
        title="Map Focus (⌘M)"
        onClick={() => onSetLayoutMode(layoutMode === 'map' ? 'split' : 'map')}
      >
        <Icon className="cc-icon-button__icon" name="maximize" />
      </button>
      <button
        className={classes('cc-icon-button', layoutMode === 'list' && 'is-active')}
        type="button"
        title="List View"
        onClick={() => onSetLayoutMode(layoutMode === 'list' ? 'split' : 'list')}
      >
        <Icon className="cc-icon-button__icon" name="list" />
      </button>

      {/* Command palette shortcut */}
      <button className="cc-cmd-trigger" type="button" title="Command Palette (⌘K)" onClick={onOpenCmd}>
        <Icon className="cc-cmd-trigger__icon" name="command" />
        <span>⌘K</span>
      </button>

      {/* Mobile toggles */}
      <button className="cc-icon-button cc-icon-button--mobile" type="button" onClick={onToggleLeftRail}>
        {leftRailOpen ? 'Hide Intel' : 'Show Intel'}
      </button>
      <button className="cc-icon-button cc-icon-button--mobile" type="button" onClick={onToggleRightRail}>
        {rightRailOpen ? 'Hide Activity' : 'Show Activity'}
      </button>

      <button className="cc-icon-button" type="button" data-testid="button-alerts">
        <Icon className="cc-icon-button__icon" name="bell" />
      </button>
      <button className="cc-icon-button" type="button" data-testid="button-settings">
        <Icon className="cc-icon-button__icon" name="settings" />
      </button>
    </div>
  </header>
)

const IntelligenceRail = ({
  data,
  filtersOpen,
  onToggleFilters,
  selectedMarketId,
  selectedAgentId,
  visibleMarkets,
  visibleAgents,
  onSelectMarket,
  onOpenMarket,
  onOpenAgent,
  marketScope,
  propertyType,
  sentiment,
  stage,
  ownerType,
  setMarketScope,
  setPropertyType,
  setSentiment,
  setStage,
  setOwnerType,
}: {
  data: LiveDashboardModel
  filtersOpen: boolean
  onToggleFilters: () => void
  selectedMarketId: string
  selectedAgentId: string
  visibleMarkets: LiveMarket[]
  visibleAgents: LiveAgent[]
  onSelectMarket: (marketId: string) => void
  onOpenMarket: (marketId: string) => void
  onOpenAgent: (agentId: string) => void
  marketScope: string
  propertyType: string
  sentiment: string
  stage: string
  ownerType: string
  setMarketScope: (value: string) => void
  setPropertyType: (value: string) => void
  setSentiment: (value: string) => void
  setStage: (value: string) => void
  setOwnerType: (value: string) => void
}) => (
  <aside className="cc-rail cc-rail--left" data-testid="intelligence-rail">
    <div className="cc-rail__header">
      <div>
        <span className="cc-eyebrow">NEXUS</span>
        <h2>Intelligence</h2>
      </div>
      <span className="cc-rail__badge">{visibleMarkets.length} MKTS</span>
    </div>

    <section className="cc-panel cc-panel--hero">
      <div className="cc-panel__header">
        <span className="cc-panel__eyebrow">HOME BASE</span>
        <span className="cc-status-chip">ACTIVE</span>
      </div>
      <div className="cc-home-grid">
        <MetricReadout label="Pipeline Value" value={data.summaryMetrics[6]?.value ?? '$0'} />
        <MetricReadout label="Health" value={data.healthLabel.split('•')[0]?.trim() ?? 'Nominal'} />
        <MetricReadout label="MKTS" value={`${data.markets.length}`} />
        <MetricReadout label="ARCS" value={`${data.mapLinks.length}`} />
      </div>
    </section>

    <section className="cc-panel">
      <div className="cc-panel__header">
        <div>
          <span className="cc-panel__eyebrow">Filters</span>
          <h3>Live Scope</h3>
        </div>
        <button
          className="cc-inline-button"
          type="button"
          data-testid="button-collapse-filters"
          onClick={onToggleFilters}
        >
          {filtersOpen ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {filtersOpen ? (
        <div className="cc-filter-stack" data-testid="filter-chips">
          <FilterGroup
            label="Market"
            value={marketScope}
            options={[
              { value: 'all', label: 'All Markets' },
              ...data.markets.map((market) => ({ value: market.id, label: market.label })),
            ]}
            onSelect={setMarketScope}
          />
          <FilterGroup
            label="Property Type"
            value={propertyType}
            options={[{ value: 'all', label: 'All Types' }, ...data.filters.propertyTypes]}
            onSelect={setPropertyType}
          />
          <FilterGroup
            label="Sentiment"
            value={sentiment}
            options={[{ value: 'all', label: 'All Sentiment' }, ...data.filters.sentiments]}
            onSelect={setSentiment}
          />
          <FilterGroup
            label="Pipeline Stage"
            value={stage}
            options={[{ value: 'all', label: 'All Stages' }, ...data.filters.pipelineStages]}
            onSelect={setStage}
          />
          <FilterGroup
            label="Owner Type"
            value={ownerType}
            options={[{ value: 'all', label: 'All Owners' }, ...data.filters.ownerTypes]}
            onSelect={setOwnerType}
          />
        </div>
      ) : null}
    </section>

    <section className="cc-panel">
      <div className="cc-panel__header">
        <div>
          <span className="cc-panel__eyebrow">Active Markets</span>
          <h3>Pipeline</h3>
        </div>
      </div>
        <div className="cc-market-list">
        {visibleMarkets.map((market) => (
          <article
            key={market.id}
            className={classes(
              'cc-market-card',
              selectedMarketId === market.id && 'is-selected',
              market.campaignStatus === 'paused' && 'is-muted',
            )}
            role="button"
            tabIndex={0}
            onClick={() => {
              onSelectMarket(market.id)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelectMarket(market.id)
              }
            }}
          >
            <div className="cc-market-card__header">
              <div>
                <div className="cc-market-card__title">
                  <span>{market.name}</span>
                  <span className={classes('cc-market-card__status', `is-${market.campaignStatus}`)}>
                    {marketStatusLabel[market.campaignStatus]}
                  </span>
                </div>
                <span className="cc-market-card__subtitle">{market.scanLabel}</span>
              </div>
                <button
                  className="cc-inline-button"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                  onOpenMarket(market.id)
                }}
              >
                View
              </button>
            </div>
            <div className="cc-market-card__metrics">
              <span>MKT {formatCompactNumber(market.activeProperties)}</span>
              <span>SENT {formatCompactNumber(market.outboundToday)}</span>
              <span>HEAT {market.heat.toUpperCase()}</span>
            </div>
            <div className="cc-market-card__trend">
              <Sparkline values={market.hourlyOutbound} />
            </div>
            <div className="cc-market-card__footer">
              <span>{formatCurrency(market.pipelineValue)}</span>
              <span className={classes('cc-op-badge', operationalRiskClass[market.operationalRisk])}>
                {operationalRiskLabel[market.operationalRisk]}
              </span>
              <span>{market.alertCount} alerts</span>
            </div>
          </article>
        ))}
      </div>
    </section>

    <section className="cc-panel">
      <div className="cc-panel__header">
        <div>
          <span className="cc-panel__eyebrow">AI Agents</span>
          <h3>Handled</h3>
        </div>
      </div>
      <div className="cc-agent-list">
        {visibleAgents.map((agent) => (
          <button
            key={agent.id}
            className={classes('cc-agent-card', selectedAgentId === agent.id && 'is-selected')}
            type="button"
            onClick={() => {
              onOpenAgent(agent.id)
            }}
          >
            <div className="cc-agent-card__header">
              <div>
                <span className="cc-agent-card__name">{agent.name}</span>
                <span className="cc-agent-card__specialty">{agent.specialty}</span>
              </div>
              <span className={classes('cc-status-chip', `is-${agent.status}`)}>{agent.status}</span>
            </div>
            <p className="cc-agent-card__activity">{agent.activityLabel}</p>
            <div className="cc-agent-card__metrics">
              <span>Handled {agent.handledToday}</span>
              <span>Avg resp. {agent.avgResponseMinutes}m</span>
              <span>Success {agent.successRate}%</span>
            </div>
            <div className="cc-load-bar">
              <div className="cc-load-bar__fill" style={{ width: `${agent.load}%` }} />
            </div>
          </button>
        ))}
      </div>
    </section>
  </aside>
)

const MapStage = ({
  markets,
  leads,
  selectedMarket,
  selectedLead,
  selectedMarketLeads,
  metrics,
  metricsCollapsed,
  activeDrawer,
  mapMode,
  onToggleMetrics,
  onSelectMarket,
  onOpenMarket,
  onOpenLead,
  onSetMapMode,
}: {
  markets: LiveMarket[]
  leads: LiveLead[]
  selectedMarket: LiveMarket | undefined
  selectedLead: LiveLead | undefined
  selectedMarketLeads: LiveLead[]
  metrics: LiveDashboardModel['summaryMetrics']
  metricsCollapsed: boolean
  activeDrawer: DrawerType
  mapMode: MapMode
  onToggleMetrics: () => void
  onSelectMarket: (marketId: string) => void
  onOpenMarket: (marketId: string) => void
  onOpenLead: (leadId: string) => void
  onSetMapMode: (mode: MapMode) => void
}) => (
    <section className="cc-map-stage" data-testid="map-canvas">
      <div className="cc-map-stage__controls">
        <span className="cc-live-pill">
          <span className="cc-live-pill__dot" />
          LIVE
        </span>
        <button
          className="cc-inline-button"
          type="button"
          data-testid="button-collapse-kpi"
          onClick={onToggleMetrics}
        >
          {metricsCollapsed ? 'Show KPI' : 'Hide KPI'}
        </button>
        <div className="cc-map-mode-selector" role="group" aria-label="Map intelligence mode">
          {(['leads', 'distress', 'heat', 'stage', 'pressure', 'closings'] as MapMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={classes('cc-map-mode-pill', mapMode === mode && 'is-active')}
              onClick={() => onSetMapMode(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {!metricsCollapsed ? (
        <div className="cc-metric-strip">
          {metrics.map((metric) => (
            <article key={metric.id} className={classes('cc-kpi-card', `is-${metric.tone}`)}>
              <span className="cc-kpi-card__label">{metric.label}</span>
              <strong className="cc-kpi-card__value">{metric.value}</strong>
              <span className="cc-kpi-card__detail">{metric.detail}</span>
            </article>
          ))}
        </div>
      ) : null}

      <div className="cc-map">
        {/* ── Real MapLibre geographic property map ───────────────────────── */}
        <NexusMap
          leads={leads}
          markets={markets}
          selectedLeadId={selectedLead?.id}
          selectedMarketId={selectedMarket?.id}
          mapMode={mapMode}
          activeDrawer={activeDrawer}
          onOpenLead={onOpenLead}
          onSelectMarket={onSelectMarket}
        />

        {selectedMarket ? (
          <div className="cc-map__market-card">
            <div className="cc-map__market-card-header">
              <div>
                <span className="cc-panel__eyebrow">{selectedMarket.label}</span>
                <h3>{selectedMarket.scanLabel}</h3>
              </div>
              <button
                className="cc-inline-button"
                type="button"
                onClick={() => { onOpenMarket(selectedMarket.id) }}
              >
                Open
              </button>
            </div>
            <div className="cc-map__market-card-grid">
              <MetricReadout label="Outbound" value={formatCompactNumber(selectedMarket.outboundToday)} />
              <MetricReadout label="Replies" value={formatCompactNumber(selectedMarket.repliesToday)} />
              <MetricReadout label="Health" value={`${selectedMarket.healthScore}`} />
              <MetricReadout label="Value" value={formatCurrency(selectedMarket.pipelineValue)} />
            </div>
          </div>
        ) : null}

        {selectedLead ? (
          <button
            className="cc-map__lead-card"
            type="button"
            onClick={() => { onOpenLead(selectedLead.id) }}
          >
            <div className="cc-map__lead-card-header">
              <span className={classes('cc-sentiment-pill', stageToneClass[selectedLead.sentiment])}>
                {selectedLead.sentiment.toUpperCase()}
              </span>
              <span className="cc-map__lead-card-intent">{selectedLead.currentIntent}</span>
            </div>
            <strong>{selectedLead.ownerName}</strong>
            <p>{selectedLead.address}</p>
            <div className="cc-map__lead-card-metrics">
              <span>{formatCurrency(selectedLead.offerAmount)} offer</span>
              <span>{selectedLead.pipelineDays}d in pipeline</span>
            </div>
          </button>
        ) : null}

        <div className="cc-map__spotlights">
          {selectedMarketLeads.map((lead) => (
            <button
              key={lead.id}
              className="cc-spotlight-card"
              type="button"
              onClick={() => { onOpenLead(lead.id) }}
            >
              <div className="cc-spotlight-card__header">
                <span className={classes('cc-sentiment-pill', stageToneClass[lead.sentiment])}>
                  {lead.sentiment.toUpperCase()}
                </span>
                <span className="cc-spotlight-card__urgency">
                  <span className="cc-spotlight-card__urg-label">URG</span>
                  {lead.urgencyScore}
                </span>
              </div>
              <strong>{lead.ownerName}</strong>
              <span>{lead.currentIntent}</span>
              {lead.heatFactors[0] ? (
                <span className="cc-spotlight-card__signal">{lead.heatFactors[0]}</span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Attribution — CARTO/OSM compliance */}
        <div className="cc-map__attribution">
          <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">© CARTO</a>
          {' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OSM</a>
          {' · '}NEXUS Intelligence Map
        </div>
      </div>
    </section>
  )

const ActivityRail = ({
  alerts,
  timeline,
  selectedLead,
  onAcknowledgeAlert,
  onOpenLead,
}: {
  alerts: LiveAlert[]
  timeline: LiveDashboardModel['timeline']
  selectedLead: LiveLead | undefined
  onAcknowledgeAlert: (alertId: string) => void
  onOpenLead: (leadId: string) => void
}) => (
  <aside className="cc-rail cc-rail--right" data-testid="activity-rail">
    <div className="cc-rail__header">
      <div>
        <span className="cc-eyebrow">Activity</span>
        <h2>Timeline</h2>
      </div>
      <span className="cc-rail__badge">LIVE</span>
    </div>

    <section className="cc-panel">
      <div className="cc-panel__header">
        <div>
          <span className="cc-panel__eyebrow">Alerts</span>
          <h3>Active</h3>
        </div>
      </div>
      <div className="cc-alert-list">
        {alerts.length > 0 ? (
          alerts.map((alert) => (
            <article key={alert.id} className={classes('cc-alert-card', alertClass[alert.severity])}>
              <div className="cc-alert-card__header">
                <div>
                  <div className="cc-alert-card__meta">
                    <span className={classes('cc-priority-badge', `is-${alert.priority.toLowerCase()}`)}>{alert.priority}</span>
                    <span className="cc-alert-card__market">{alert.marketLabel}</span>
                  </div>
                  <strong>{alert.title}</strong>
                </div>
                <button
                  className="cc-inline-button"
                  type="button"
                  onClick={() => {
                    onAcknowledgeAlert(alert.id)
                  }}
                >
                  Acknowledge
                </button>
              </div>
              <p>{alert.detail}</p>
              <div className="cc-alert-card__footer">
                <span>
                  {alert.metricLabel}: {alert.metricValue}
                </span>
                <span>{alertPriorityLabel[alert.priority]}</span>
                <span>{formatRelativeTime(alert.timestampIso)}</span>
              </div>
            </article>
          ))
        ) : (
          <div className="cc-empty-state cc-empty-state--ok">All clear — no active alerts.</div>
        )}
      </div>
    </section>

    <section className="cc-panel">
      <div className="cc-panel__header">
        <div>
          <span className="cc-panel__eyebrow">Event</span>
          <h3>Timeline</h3>
        </div>
      </div>
      <div className="cc-timeline">
        {timeline.map((entry) => (
          <article key={entry.id} className={classes('cc-timeline__item', alertClass[entry.severity])}>
            <div className="cc-timeline__marker" />
            <div className="cc-timeline__content">
              <div className="cc-timeline__header">
                <strong>{entry.title}</strong>
                <span>{formatRelativeTime(entry.timestampIso)}</span>
              </div>
              <span className="cc-timeline__market">{entry.marketLabel}</span>
              <p>{entry.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>

    {selectedLead ? (
      <section className="cc-panel cc-panel--spotlight">
        <div className="cc-panel__header">
          <div>
            <span className="cc-panel__eyebrow">Lead Spotlight</span>
            <h3>{selectedLead.ownerName}</h3>
          </div>
          <span className={classes('cc-sentiment-pill', stageToneClass[selectedLead.sentiment])}>
            {selectedLead.sentiment.toUpperCase()}
          </span>
        </div>
        <UrgencyBar score={selectedLead.urgencyScore} />
        <HeatFactors factors={selectedLead.heatFactors} />
        <p className="cc-spotlight-summary">{selectedLead.aiSummary}</p>
        <NBACard action={selectedLead.recommendedAction} />
        <div className="cc-spotlight-metrics">
          <span>{formatCurrency(selectedLead.estimatedValue)} est. value</span>
          <span>{formatStageLabel(selectedLead.pipelineStage)}</span>
        </div>
        <button
          className="cc-primary-button"
          type="button"
          onClick={() => {
            onOpenLead(selectedLead.id)
          }}
        >
          Full Dossier
          <Icon className="cc-primary-button__icon" name="arrow-up-right" />
        </button>
      </section>
    ) : null}
  </aside>
)

const DrawerOverlay = ({
  activeDrawer,
  children,
  onClose,
}: {
  activeDrawer: DrawerType
  children: ReactNode
  onClose: () => void
}) => {
  if (!activeDrawer) {
    return null
  }

  return (
    <div className="cc-drawer">
      <button className="cc-drawer__scrim" type="button" onClick={onClose} />
      <section className="cc-drawer__panel">
        <button
          className="cc-drawer__close"
          type="button"
          data-testid="button-close-drawer"
          onClick={onClose}
        >
          <Icon className="cc-drawer__close-icon" name="close" />
        </button>
        {children}
      </section>
    </div>
  )
}

const MarketDrawer = ({ market }: { market: LiveMarket }) => (
  <div className="cc-drawer__content">
    <div className="cc-drawer__hero">
      <span className="cc-eyebrow">{market.label}</span>
      <h2>{market.scanLabel}</h2>
      <p>{market.activeProperties.toLocaleString()} active properties</p>
    </div>

    <section className="cc-drawer-section">
      <SectionHeading label="Today's Performance" />
      <div className="cc-stat-grid">
        <DrawerStat label="Outbound" value={formatCompactNumber(market.outboundToday)} />
        <DrawerStat label="Replies" value={formatCompactNumber(market.repliesToday)} />
        <DrawerStat label="Hot Leads" value={`${market.hotLeads}`} />
        <DrawerStat label="Health" value={`${market.healthScore}`} />
      </div>
    </section>

    <section className="cc-drawer-section">
      <SectionHeading label="24-Hour Outbound Volume" />
      <div className="cc-chart-card">
        <Sparkline values={market.hourlyOutbound} />
      </div>
    </section>

    <section className="cc-drawer-section">
      <SectionHeading label="Reply Rate — Last 8 Hours" />
      <div className="cc-chart-card">
        <BarStrip values={market.recentReplyRate} />
      </div>
    </section>

    <section className="cc-drawer-section">
      <SectionHeading label="Pipeline Breakdown" />
      <div className="cc-segment-bar">
        {market.pipelineSegments.map((segment) => (
          <div
            key={segment.label}
            className="cc-segment-bar__item"
            style={{
              width: `${segment.value}%`,
              background: segment.color,
            }}
          />
        ))}
      </div>
      <div className="cc-segment-legend">
        {market.pipelineSegments.map((segment) => (
          <span key={segment.label}>
            <i style={{ background: segment.color }} />
            {segment.label} {segment.value}%
          </span>
        ))}
      </div>
    </section>

    <section className="cc-drawer-section">
      <SectionHeading label="Top ZIP Codes" />
      <div className="cc-table-card">
        <table>
          <thead>
            <tr>
              <th>ZIP</th>
              <th>Outbound</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {market.topZips.map((row) => (
              <tr key={row.zip}>
                <td>{row.zip}</td>
                <td>{formatCompactNumber(row.outbound)}</td>
                <td>{row.trend}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>

    <section className="cc-drawer-section">
      <div className="cc-inline-stats">
        <DrawerInlineStat label="Active Conversations" value={`${Math.round(market.repliesToday * 0.3)} open`} />
        <DrawerInlineStat label="Total Pipeline Value" value={formatCurrency(market.pipelineValue)} />
      </div>
      <p className="cc-drawer__timestamp">Last sweep {formatShortDateTime(market.lastSweepIso)}</p>
    </section>
  </div>
)

const LeadDrawer = ({ lead }: { lead: LiveLead }) => (
  <div className="cc-drawer__content">
    <div className="cc-drawer__hero">
      <span className="cc-eyebrow">{lead.marketLabel}</span>
      <h2>{lead.address}</h2>
      <p>
        {lead.ownerName} • {lead.city}, {lead.stateCode} {lead.zip}
      </p>
    </div>

    <div className="cc-drawer__tags">
      <span className={classes('cc-sentiment-pill', stageToneClass[lead.sentiment])}>
        {lead.sentiment.toUpperCase()}
      </span>
      <span className="cc-chip">{formatOwnerLabel(lead.ownerType)}</span>
      <span className="cc-chip">{lead.propertyType}</span>
      <span className="cc-chip">{formatStageLabel(lead.pipelineStage)}</span>
    </div>

    <section className="cc-drawer-section">
      <SectionHeading label="Signal Profile" />
      <UrgencyBar score={lead.urgencyScore} />
      <HeatFactors factors={lead.heatFactors} />
    </section>

    <section className="cc-drawer-section">
      <SectionHeading label="AI Intelligence" />
      <div className="cc-ai-summary">
        <div className="cc-ai-summary__label">
          <Icon className="cc-ai-summary__icon" name="spark" />
          AI Analysis
        </div>
        <p>{lead.aiSummary}</p>
      </div>
    </section>

    <section className="cc-drawer-section">
      <SectionHeading label="Property Stats" />
      <div className="cc-stat-grid">
        <DrawerStat label="Outbound Attempts" value={`${lead.outboundAttempts}`} />
        <DrawerStat label="Last Outbound" value={formatRelativeTime(lead.lastOutboundIso)} />
        <DrawerStat
          label="Last Inbound"
          value={lead.lastInboundIso ? formatRelativeTime(lead.lastInboundIso) : '—'}
        />
        <DrawerStat label="Est. Value" value={formatCurrency(lead.estimatedValue)} />
        <DrawerStat label="Offer Amount" value={formatCurrency(lead.offerAmount)} />
        <DrawerStat label="Days in Pipeline" value={`${lead.pipelineDays}`} />
      </div>
    </section>

    <section className="cc-drawer-section">
      <SectionHeading label="Recent Conversation" />
      <div className="cc-message-stack">
        {lead.messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>
    </section>

    {lead.riskFlags.length > 0 ? (
      <section className="cc-drawer-section">
        <SectionHeading label="Risk Flags" />
        <RiskFlags flags={lead.riskFlags} />
      </section>
    ) : null}

    <section className="cc-drawer-section">
      <SectionHeading label="Next Best Action" />
      <NBACard action={lead.recommendedAction} />
      <div className="cc-action-row">
        <button className="cc-primary-button" type="button" data-testid="button-send-followup">
          <Icon className="cc-primary-button__icon" name="send" />
          Send Follow-up
        </button>
        <button className="cc-secondary-button" type="button" data-testid="button-make-offer">
          <Icon className="cc-primary-button__icon" name="target" />
          Make Offer
        </button>
        <button className="cc-neutral-button" type="button" data-testid="button-schedule-call">
          <Icon className="cc-primary-button__icon" name="calendar" />
          Schedule Call
        </button>
      </div>
    </section>
  </div>
)

const AgentDrawer = ({ agent, lead }: { agent: LiveAgent; lead: LiveLead }) => (
  <div className="cc-drawer__content">
    <div className="cc-drawer__hero">
      <span className="cc-eyebrow">{agent.marketLabel}</span>
      <h2>{agent.name}</h2>
      <p>
        {agent.specialty} • {lead.ownerName}
      </p>
    </div>

    <div className="cc-drawer__tags">
      <span className={classes('cc-status-chip', `is-${agent.status}`)}>{agent.status}</span>
      <span className="cc-chip">{lead.currentIntent}</span>
      <span className="cc-chip">{formatStageLabel(lead.pipelineStage)}</span>
    </div>

    <section className="cc-drawer-section">
      <SectionHeading label="Intent Score" />
      <div className="cc-intent-meter">
        <div className="cc-intent-meter__bar" style={{ width: `${Math.min(98, agent.load + 30)}%` }} />
      </div>
      <div className="cc-intent-meter__label">
        <span>Load {agent.load}%</span>
        <strong>{Math.min(98, agent.load + 30)} / 100</strong>
      </div>
    </section>

    <section className="cc-drawer-section">
      <SectionHeading label="AI Summary" />
      <div className="cc-ai-summary">
        <div className="cc-ai-summary__label">
          <Icon className="cc-ai-summary__icon" name="spark" />
          AI Analysis
        </div>
        <p>{agent.aiSummary}</p>
      </div>
    </section>

    <section className="cc-drawer-section">
      <SectionHeading label="Objections Detected" />
      <div className="cc-tag-cloud">
        {lead.objectionsDetected.map((objection) => (
          <span key={objection} className="cc-tag-cloud__item">
            {objection}
          </span>
        ))}
      </div>
    </section>

    <section className="cc-drawer-section">
      <SectionHeading label="Recommended Action" />
      <div className="cc-recommendation-card">{lead.recommendedAction}</div>
    </section>

    <section className="cc-drawer-section">
      <SectionHeading label="Conversation Thread" />
      <div className="cc-message-stack">
        {lead.messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>
    </section>

    <section className="cc-drawer-section">
      <SectionHeading label="Draft Response" />
      <div className="cc-draft-card">
        <textarea
          rows={4}
          data-testid="input-response-draft"
          defaultValue={`Hi ${lead.ownerName.split(' ')[0]}, based on what you shared, the next best step is a fast comp-backed review so you can make a confident decision without listing friction.`}
        />
        <div className="cc-draft-card__actions">
          <button className="cc-neutral-button" type="button" data-testid="button-ai-generate">
            <Icon className="cc-primary-button__icon" name="spark" />
            AI Generate
          </button>
          <button className="cc-primary-button" type="button" data-testid="button-send-response">
            <Icon className="cc-primary-button__icon" name="send" />
            Send
          </button>
        </div>
      </div>
    </section>
  </div>
)

const LeadListTable = ({
  leads,
  selectedLeadId,
  onOpenLead,
}: {
  leads: LiveLead[]
  selectedLeadId: string | null
  onOpenLead: (leadId: string) => void
}) => (
  <section className="cc-list-stage">
    <div className="cc-list-stage__header">
      <span className="cc-panel__eyebrow">ALL LEADS</span>
      <span className="cc-panel__eyebrow">{leads.length} results</span>
    </div>
    <div className="cc-table-card cc-lead-table">
      <table>
        <thead>
          <tr>
            <th>Sentiment</th>
            <th>Owner / Market</th>
            <th>Address</th>
            <th>Stage</th>
            <th>Value</th>
            <th>Intent</th>
            <th>Days</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr
              key={lead.id}
              className={classes('cc-lead-table__row', lead.id === selectedLeadId && 'is-selected')}
            >
              <td>
                <span className={classes('cc-sentiment-pill', stageToneClass[lead.sentiment])}>
                  {lead.sentiment.toUpperCase()}
                </span>
              </td>
              <td>
                <strong>{lead.ownerName}</strong>
                <br />
                <span className="cc-muted">{lead.marketLabel}</span>
              </td>
              <td className="cc-muted">{lead.address}</td>
              <td>{formatStageLabel(lead.pipelineStage)}</td>
              <td>{formatCurrency(lead.offerAmount)}</td>
              <td className="cc-muted">{lead.currentIntent}</td>
              <td className="cc-muted">{lead.pipelineDays}d</td>
              <td>
                <button
                  className="cc-inline-button"
                  type="button"
                  onClick={() => { onOpenLead(lead.id) }}
                >
                  Open
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
)

const CommandPalette = ({
  query,
  onQueryChange,
  commands,
  onClose,
}: {
  query: string
  onQueryChange: (q: string) => void
  commands: CommandItem[]
  onClose: () => void
}) => {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = query.trim()
    ? commands.filter(
        (c) =>
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.hint?.toLowerCase().includes(query.toLowerCase()),
      )
    : commands

  const grouped = groupByCategory(filtered)

  return (
    /* eslint-disable-next-line jsx-a11y/click-events-have-key-events */
    <div className="cc-cmd" role="dialog" aria-modal aria-label="Command palette" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cc-cmd__panel">
        <div className="cc-cmd__search">
          <Icon name="command" className="cc-cmd__search-icon" />
          <input
            ref={inputRef}
            className="cc-cmd__input"
            type="text"
            placeholder="Search commands…"
            value={query}
            onChange={(e) => { onQueryChange(e.target.value) }}
          />
          <kbd className="cc-cmd__esc-badge">ESC</kbd>
        </div>
        <div className="cc-cmd__results" role="listbox">
          {grouped.length === 0 ? (
            <div className="cc-cmd__empty">No commands match "{query}"</div>
          ) : (
            grouped.map(({ category, items }) => (
              <div key={category} className="cc-cmd__group">
                <span className="cc-cmd__group-label">{category}</span>
                {items.map((item) => (
                  <button
                    key={item.id}
                    className="cc-cmd__item"
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => { item.action(); onClose() }}
                  >
                    <span className="cc-cmd__item-label">{item.label}</span>
                    {item.hint ? <span className="cc-cmd__hint">{item.hint}</span> : null}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

const CommandHintBar = ({
  activeDrawer,
  layoutMode,
}: {
  activeDrawer: DrawerType
  layoutMode: LayoutMode
}) => (
  <div className="cc-hint-bar">
    <span>⌘K</span>
    <span>commands</span>
    <span>⌘M</span>
    <span>{layoutMode === 'map' ? 'exit map' : 'map focus'}</span>
    <span>⌘B</span>
    <span>{layoutMode === 'battlefield' ? 'exit battlefield' : 'battlefield'}</span>
    <span>[</span>
    <span>intel</span>
    <span>]</span>
    <span>activity</span>
    <span>ESC</span>
    <span>{activeDrawer ? 'close drawer' : layoutMode !== 'split' ? 'exit mode' : 'dismiss'}</span>
    <span>/dashboard/live</span>
  </div>
)

const MetricReadout = ({ label, value }: { label: string; value: string }) => (
  <div className="cc-metric-readout">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
)

const FilterGroup = ({
  label,
  value,
  options,
  onSelect,
}: {
  label: string
  value: string
  options: FilterOption[]
  onSelect: (value: string) => void
}) => (
  <div className="cc-filter-group">
    <span className="cc-filter-group__label">{label}</span>
    <div className="cc-filter-group__chips">
      {options.map((option) => (
        <button
          key={option.value}
          className={classes('cc-filter-chip', value === option.value && 'is-active')}
          type="button"
          onClick={() => {
            onSelect(option.value)
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  </div>
)

const DrawerStat = ({ label, value }: { label: string; value: string }) => (
  <article className="cc-drawer-stat">
    <span>{label}</span>
    <strong>{value}</strong>
  </article>
)

const DrawerInlineStat = ({ label, value }: { label: string; value: string }) => (
  <div className="cc-inline-stat">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
)

const SectionHeading = ({ label }: { label: string }) => (
  <div className="cc-section-heading">
    <span className="cc-panel__eyebrow">{label}</span>
  </div>
)

const MessageBubble = ({
  message,
}: {
  message: LiveLead['messages'][number]
}) => (
  <div className={classes('cc-message', message.direction === 'outbound' && 'is-outbound')}>
    <div className="cc-message__bubble">{message.message}</div>
    <div className="cc-message__meta">
      <span>{formatRelativeTime(message.timestampIso)}</span>
      {message.aiGenerated ? <span>AI</span> : null}
    </div>
  </div>
)

const Sparkline = ({ values }: { values: number[] }) => {
  const maxValue = Math.max(...values)
  const minValue = Math.min(...values)
  const range = Math.max(1, maxValue - minValue)
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100
      const y = 100 - ((value - minValue) / range) * 76 - 12
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg className="cc-sparkline" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline points={points} />
    </svg>
  )
}

const BarStrip = ({ values }: { values: number[] }) => {
  const maxValue = Math.max(...values)

  return (
    <div className="cc-bar-strip">
      {values.map((value, index) => (
        <span
          key={`${value}-${index}`}
          className="cc-bar-strip__bar"
          style={{ height: `${Math.max(18, (value / Math.max(1, maxValue)) * 100)}%` }}
        />
      ))}
    </div>
  )
}

const UrgencyBar = ({ score }: { score: number }) => {
  const tone = score >= 80 ? 'critical' : score >= 60 ? 'warning' : 'nominal'
  return (
    <div className={classes('cc-urgency-bar', `is-${tone}`)}>
      <div className="cc-urgency-bar__header">
        <span className="cc-urgency-bar__label">URGENCY</span>
        <strong className="cc-urgency-bar__score">{score}</strong>
      </div>
      <div className="cc-urgency-bar__track">
        <div className="cc-urgency-bar__fill" style={{ width: `${score}%` }} />
      </div>
    </div>
  )
}

const HeatFactors = ({ factors }: { factors: string[] }) => (
  <ul className="cc-heat-factors">
    {factors.map((factor) => (
      <li key={factor} className="cc-heat-factors__item">
        <span className="cc-heat-factors__dot" />
        <span>{factor}</span>
      </li>
    ))}
  </ul>
)

const NBACard = ({ action, confidence }: { action: string; confidence?: number }) => (
  <div className="cc-nba-card">
    <div className="cc-nba-card__header">
      <span className="cc-eyebrow">NEXT ACTION</span>
      {confidence !== undefined ? (
        <span className={classes('cc-nba-badge', confidence >= 80 ? 'is-high' : 'is-medium')}>
          {confidence}% confidence
        </span>
      ) : null}
    </div>
    <p className="cc-nba-card__text">{action}</p>
  </div>
)

const RiskFlags = ({ flags }: { flags: string[] }) => (
  <ul className="cc-risk-flags">
    {flags.map((flag) => (
      <li key={flag} className="cc-risk-flags__item">
        <Icon className="cc-risk-flags__icon" name="alert" />
        <span>{flag}</span>
      </li>
    ))}
  </ul>
)

const HealthStrip = ({ items }: { items: SystemHealthItem[] }) => (
  <div className="cc-health-strip" role="status" aria-label="System health">
    {items.map((item) => (
      <div key={item.id} className={classes('cc-health-node', `is-${item.status}`)}>
        <span className="cc-health-node__dot" />
        <span className="cc-health-node__label">{item.label}</span>
        {item.value ? <span className="cc-health-node__value">{item.value}</span> : null}
      </div>
    ))}
  </div>
)

const BattlefieldView = ({
  leads,
  selectedLeadId,
  onOpenLead,
}: {
  leads: LiveLead[]
  selectedLeadId: string
  onOpenLead: (leadId: string) => void
}) => {
  const priorityLeads = leads
    .filter((lead) => lead.urgencyScore >= 40 || lead.sentiment === 'hot')
    .sort((a, b) => b.urgencyScore - a.urgencyScore)
    .slice(0, 12)

  return (
    <section className="cc-battlefield" data-testid="battlefield-view">
      <div className="cc-battlefield__header">
        <span className="cc-eyebrow">PRIORITY BATTLEFIELD</span>
        <span className="cc-battlefield__count">{priorityLeads.length} leads in play</span>
      </div>
      <div className="cc-battlefield__grid">
        {priorityLeads.map((lead) => (
          <button
            key={lead.id}
            type="button"
            className={classes(
              'cc-battlefield-card',
              `is-${lead.sentiment}`,
              lead.id === selectedLeadId && 'is-selected',
            )}
            onClick={() => onOpenLead(lead.id)}
          >
            <div className="cc-battlefield-card__header">
              <span className={classes('cc-sentiment-pill', stageToneClass[lead.sentiment])}>
                {lead.sentiment.toUpperCase()}
              </span>
              <strong className="cc-battlefield-card__score">{lead.urgencyScore}</strong>
            </div>
            <div className="cc-battlefield-card__name">{lead.ownerName}</div>
            <div className="cc-battlefield-card__address">{lead.address}</div>
            {lead.heatFactors[0] ? (
              <div className="cc-battlefield-card__why">{lead.heatFactors[0]}</div>
            ) : null}
            <div className="cc-battlefield-card__meta">
              <span>{formatStageLabel(lead.pipelineStage)}</span>
              <span>{formatCurrency(lead.offerAmount)}</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}
