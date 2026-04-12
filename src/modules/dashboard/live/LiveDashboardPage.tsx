import { useDeferredValue, useEffect, useEffectEvent, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  FilterOption,
  LiveAgent,
  LiveAlert,
  LiveDashboardModel,
  LiveLead,
  LiveMarket,
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

const mapBounds = {
  west: -113,
  east: -83,
  north: 46,
  south: 28,
}

const mapCanvas = {
  width: 1000,
  height: 560,
}

const classes = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

const includesQuery = (query: string, ...values: Array<string | null | undefined>) => {
  if (!query) {
    return true
  }

  return values.some((value) => value?.toLowerCase().includes(query))
}

const projectPoint = (lat: number, lng: number) => {
  const x = ((lng - mapBounds.west) / (mapBounds.east - mapBounds.west)) * mapCanvas.width
  const y = ((mapBounds.north - lat) / (mapBounds.north - mapBounds.south)) * mapCanvas.height
  return { x, y }
}

const buildLinkPath = (fromPoint: { x: number; y: number }, toPoint: { x: number; y: number }) => {
  const midpointX = (fromPoint.x + toPoint.x) / 2
  const midpointY = Math.min(fromPoint.y, toPoint.y) - Math.abs(toPoint.x - fromPoint.x) * 0.14 - 36
  return `M ${fromPoint.x} ${fromPoint.y} Q ${midpointX} ${midpointY} ${toPoint.x} ${toPoint.y}`
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

const marketStatusLabel: Record<LiveMarket['campaignStatus'], string> = {
  live: 'LIVE',
  warning: 'WATCH',
  paused: 'PAUSED',
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
    const target = event.target
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return
    }

    if (event.key === '[') {
      setLeftRailOpen((current) => !current)
    }

    if (event.key === ']') {
      setRightRailOpen((current) => !current)
    }

    if (event.key === 'Escape') {
      setActiveDrawer(null)
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

  const visibleLeadPins = visibleLeads.slice(0, 8)
  const selectedMarketLeads = data.leads.filter((lead) => lead.marketId === selectedMarket?.id).slice(0, 3)

  return (
    <div className="cc-shell" data-testid="dashboard-root">
      <DashboardHeader
        appName={data.appName}
        query={query}
        setQuery={setQuery}
        liveClock={clock}
        healthLabel={data.healthLabel}
        leftRailOpen={leftRailOpen}
        rightRailOpen={rightRailOpen}
        onToggleLeftRail={() => {
          setLeftRailOpen((current) => !current)
        }}
        onToggleRightRail={() => {
          setRightRailOpen((current) => !current)
        }}
      />

      <div className="cc-workspace">
        {leftRailOpen ? (
          <IntelligenceRail
            data={data}
            filtersOpen={filtersOpen}
            onToggleFilters={() => {
              setFiltersOpen((current) => !current)
            }}
            selectedMarketId={selectedMarket?.id ?? ''}
            selectedAgentId={selectedAgent?.id ?? ''}
            visibleMarkets={visibleMarkets}
            visibleAgents={visibleAgents}
            onSelectMarket={(marketId) => {
              setSelectedMarketId(marketId)
            }}
            onOpenMarket={(marketId) => {
              setSelectedMarketId(marketId)
              setActiveDrawer('market')
            }}
            onOpenAgent={(agentId) => {
              setSelectedAgentId(agentId)
              setActiveDrawer('agent')
            }}
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
        ) : null}

        <MapStage
          markets={visibleMarkets}
          leads={visibleLeadPins}
          selectedMarket={selectedMarket}
          selectedLead={selectedLead}
          selectedMarketLeads={selectedMarketLeads}
          mapLinks={data.mapLinks}
          metrics={data.summaryMetrics}
          metricsCollapsed={metricsCollapsed}
          onToggleMetrics={() => {
            setMetricsCollapsed((current) => !current)
          }}
          onSelectMarket={(marketId) => {
            setSelectedMarketId(marketId)
          }}
          onOpenMarket={(marketId) => {
            setSelectedMarketId(marketId)
            setActiveDrawer('market')
          }}
          onOpenLead={(leadId) => {
            setSelectedLeadId(leadId)
            setActiveDrawer('lead')
          }}
        />

        {rightRailOpen ? (
          <ActivityRail
            alerts={visibleAlerts}
            timeline={visibleTimeline}
            selectedLead={selectedLead}
            onAcknowledgeAlert={(alertId) => {
              setDismissedAlertIds((current) => [...current, alertId])
            }}
            onOpenLead={(leadId) => {
              setSelectedLeadId(leadId)
              setActiveDrawer('lead')
            }}
          />
        ) : null}

        <button
          className="cc-rail-toggle cc-rail-toggle--left"
          type="button"
          data-testid="toggle-left-rail"
          style={{ left: leftRailOpen ? '310px' : '8px' }}
          onClick={() => {
            setLeftRailOpen((current) => !current)
          }}
        >
          <Icon
            className={classes('cc-rail-toggle__icon', leftRailOpen && 'is-open')}
            name="chevron-right"
          />
        </button>

        <button
          className="cc-rail-toggle cc-rail-toggle--right"
          type="button"
          data-testid="toggle-right-rail"
          style={{ right: rightRailOpen ? '330px' : '8px' }}
          onClick={() => {
            setRightRailOpen((current) => !current)
          }}
        >
          <Icon
            className={classes('cc-rail-toggle__icon', rightRailOpen && 'is-open-right')}
            name="chevron-right"
          />
        </button>
      </div>

      <CommandHintBar activeDrawer={activeDrawer} />

      <DrawerOverlay
        activeDrawer={activeDrawer}
        onClose={() => {
          setActiveDrawer(null)
        }}
      >
        {activeDrawer === 'market' && selectedMarket ? (
          <MarketDrawer market={selectedMarket} />
        ) : null}
        {activeDrawer === 'lead' && selectedLead ? <LeadDrawer lead={selectedLead} /> : null}
        {activeDrawer === 'agent' && selectedAgent && selectedAgentLead ? (
          <AgentDrawer agent={selectedAgent} lead={selectedAgentLead} />
        ) : null}
      </DrawerOverlay>
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
  onToggleLeftRail,
  onToggleRightRail,
}: {
  appName: string
  query: string
  setQuery: (value: string) => void
  liveClock: Date
  healthLabel: string
  leftRailOpen: boolean
  rightRailOpen: boolean
  onToggleLeftRail: () => void
  onToggleRightRail: () => void
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
      <button
        className="cc-icon-button cc-icon-button--mobile"
        type="button"
        onClick={onToggleLeftRail}
      >
        {leftRailOpen ? 'Hide Intel' : 'Show Intel'}
      </button>
      <button
        className="cc-icon-button cc-icon-button--mobile"
        type="button"
        onClick={onToggleRightRail}
      >
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
  mapLinks,
  metrics,
  metricsCollapsed,
  onToggleMetrics,
  onSelectMarket,
  onOpenMarket,
  onOpenLead,
}: {
  markets: LiveMarket[]
  leads: LiveLead[]
  selectedMarket: LiveMarket | undefined
  selectedLead: LiveLead | undefined
  selectedMarketLeads: LiveLead[]
  mapLinks: LiveDashboardModel['mapLinks']
  metrics: LiveDashboardModel['summaryMetrics']
  metricsCollapsed: boolean
  onToggleMetrics: () => void
  onSelectMarket: (marketId: string) => void
  onOpenMarket: (marketId: string) => void
  onOpenLead: (leadId: string) => void
}) => {
  const marketPoints = Object.fromEntries(
    markets.map((market) => [market.id, projectPoint(market.lat, market.lng)]),
  )

  return (
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
        <svg className="cc-map__art" viewBox={`0 0 ${mapCanvas.width} ${mapCanvas.height}`}>
          <defs>
            <linearGradient id="map-grid-glow" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(72,213,255,0.18)" />
              <stop offset="100%" stopColor="rgba(72,213,255,0)" />
            </linearGradient>
            <linearGradient id="landmass-fill" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(10, 23, 36, 0.94)" />
              <stop offset="100%" stopColor="rgba(9, 15, 26, 0.68)" />
            </linearGradient>
          </defs>

          {Array.from({ length: 8 }).map((_, index) => (
            <line
              key={`vertical-${index}`}
              x1={120 + index * 100}
              y1="20"
              x2={120 + index * 100}
              y2={mapCanvas.height - 20}
              stroke="rgba(72, 213, 255, 0.06)"
              strokeDasharray="5 9"
            />
          ))}

          {Array.from({ length: 5 }).map((_, index) => (
            <line
              key={`horizontal-${index}`}
              x1="50"
              y1={90 + index * 86}
              x2={mapCanvas.width - 50}
              y2={90 + index * 86}
              stroke="rgba(72, 213, 255, 0.05)"
              strokeDasharray="5 9"
            />
          ))}

          <path
            d="M90 430 L110 350 L155 290 L190 215 L250 175 L335 130 L430 110 L560 120 L650 145 L760 155 L865 195 L925 248 L910 325 L888 375 L850 435 L780 470 L670 495 L520 500 L415 488 L295 470 L205 445 Z"
            fill="url(#landmass-fill)"
            stroke="rgba(94, 155, 199, 0.18)"
            strokeWidth="1.4"
          />

          {mapLinks.map((link) => {
            const fromPoint = marketPoints[link.fromMarketId]
            const toPoint = marketPoints[link.toMarketId]
            if (!fromPoint || !toPoint) {
              return null
            }

            return (
              <path
                key={link.id}
                d={buildLinkPath(fromPoint, toPoint)}
                className="cc-map__link"
                strokeWidth={1 + link.volume / 18}
              />
            )
          })}

          {leads.map((lead) => {
            const point = projectPoint(lead.lat, lead.lng)
            const isSelected = selectedLead?.id === lead.id

            return (
              <g
                key={lead.id}
                className={classes('cc-map__lead', isSelected && 'is-selected')}
                onClick={() => {
                  onOpenLead(lead.id)
                }}
              >
                <circle cx={point.x} cy={point.y} r={isSelected ? 6.5 : 4.4} />
                <circle cx={point.x} cy={point.y} r={isSelected ? 12 : 8.5} className="cc-map__lead-ring" />
              </g>
            )
          })}

          {markets.map((market) => {
            const point = marketPoints[market.id]
            const isSelected = market.id === selectedMarket?.id

            return (
              <g
                key={market.id}
                className={classes('cc-map__node', isSelected && 'is-selected')}
                onClick={() => {
                  onSelectMarket(market.id)
                }}
              >
                <circle cx={point.x} cy={point.y} r={isSelected ? 14 : 11} className="cc-map__node-glow" />
                <circle cx={point.x} cy={point.y} r={isSelected ? 7.5 : 5.5} className="cc-map__node-core" />
                <text x={point.x + 12} y={point.y - 12} className="cc-map__node-label">
                  {market.name}
                </text>
                <text x={point.x + 12} y={point.y + 6} className="cc-map__node-subtitle">
                  {market.scanLabel}
                </text>
              </g>
            )
          })}
        </svg>

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
                onClick={() => {
                  onOpenMarket(selectedMarket.id)
                }}
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
            onClick={() => {
              onOpenLead(selectedLead.id)
            }}
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
              onClick={() => {
                onOpenLead(lead.id)
              }}
            >
              <span className="cc-panel__eyebrow">{lead.marketLabel}</span>
              <strong>{lead.ownerName}</strong>
              <span>{lead.currentIntent}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

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
          <h3>Acknowledge</h3>
        </div>
      </div>
      <div className="cc-alert-list">
        {alerts.length > 0 ? (
          alerts.map((alert) => (
            <article key={alert.id} className={classes('cc-alert-card', alertClass[alert.severity])}>
              <div className="cc-alert-card__header">
                <div>
                  <span className="cc-alert-card__market">{alert.marketLabel}</span>
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
                <span>{formatRelativeTime(alert.timestampIso)}</span>
              </div>
            </article>
          ))
        ) : (
          <div className="cc-empty-state">No active alerts inside the current live scope.</div>
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
        </div>
        <p className="cc-spotlight-summary">{selectedLead.aiSummary}</p>
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
          Open lead dossier
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
      <SectionHeading label="AI Summary" />
      <div className="cc-ai-summary">
        <div className="cc-ai-summary__label">
          <Icon className="cc-ai-summary__icon" name="spark" />
          AI Analysis
        </div>
        <p>{lead.aiSummary}</p>
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

    <section className="cc-drawer-section">
      <SectionHeading label="Quick Actions" />
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

const CommandHintBar = ({ activeDrawer }: { activeDrawer: DrawerType }) => (
  <div className="cc-hint-bar">
    <span>[</span>
    <span>toggle intel</span>
    <span>]</span>
    <span>toggle activity</span>
    <span>ESC</span>
    <span>{activeDrawer ? 'close drawer' : 'dismiss focus'}</span>
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
