import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ViewLayoutMode } from '../view-layout'
import {
  loadKpiDashboardSummary,
  loadKpiTimeSeries,
  loadStatePerformance,
  loadMarketPerformance,
  loadAgentPerformance,
  loadTemplatePerformance,
  loadChannelPerformance,
  loadSpendPerformance,
  loadFunnelPerformance,
  loadDataQualityMetrics,
  loadBuyerDemandMetrics,
  loadOfferContractMetrics,
  loadTextgridNumberHealth,
  loadCarrierPerformance,
  loadKpiAlerts,
  STATE_NAMES,
  type KpiFilters,
  type KpiTimeRange,
  type KpiSummary,
  type TimeSeriesPoint,
  type StatePerformance,
  type MarketPerformance,
  type AgentPerformance,
  type TemplatePerformance,
  type ChannelPerformance,
  type SpendPerformance,
  type FunnelStage,
  type DataQualityMetrics,
  type BuyerDemandMetrics,
  type OfferContractMetrics,
  type TextgridNumberHealth,
  type CarrierPerformance,
  type KpiAlert,
} from '../../../lib/data/kpiDashboardData'
import { USA_STATE_PATHS } from '../../../lib/data/usaStatePaths'
import './kpi-dashboard.css'

// ── Utility ───────────────────────────────────────────────────────────────────

const cls = (...t: Array<string | false | null | undefined>) => t.filter(Boolean).join(' ')

const fmt = {
  int: (n: number | null | undefined) =>
    n == null ? '—' : n.toLocaleString(),
  pct: (n: number | null | undefined, suffix = '%') =>
    n == null ? '—' : `${n}${suffix}`,
  usd: (n: number | null | undefined) =>
    n == null
      ? '—'
      : `$${
          n < 1000
            ? n.toFixed(2)
            : n >= 1_000_000
            ? `${(n / 1_000_000).toFixed(1)}M`
            : `${(n / 1000).toFixed(1)}K`
        }`,
  rel: (n: number, prev: number) =>
    prev === 0
      ? ('neutral' as const)
      : n > prev
      ? ('up' as const)
      : n < prev
      ? ('down' as const)
      : ('neutral' as const),
}

const TIME_RANGE_LABELS: Record<KpiTimeRange, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 Days',
  last_30_days: 'Last 30 Days',
  last_40_days: 'Last 40 Days',
  custom: 'Custom Range',
}

// State fill colors by status
const STATE_STATUS_FILL: Record<StatePerformance['status'], string> = {
  quiet:       'rgba(40, 52, 78, 0.75)',
  active:      'rgba(72, 138, 236, 0.55)',
  strong:      'rgba(52, 211, 153, 0.65)',
  warning:     'rgba(251, 191, 36, 0.65)',
  blocked:     'rgba(248, 113, 113, 0.65)',
  contracting: 'rgba(168, 85, 247, 0.65)',
}
const STATE_STATUS_DEFAULT = 'rgba(28, 36, 56, 0.7)'

// ── MiniLineChart ─────────────────────────────────────────────────────────────

interface MiniLineChartProps {
  data: number[]
  color?: string
  width?: number
  height?: number
  filled?: boolean
}

function MiniLineChart({
  data,
  color = 'rgba(72,138,236,0.85)',
  width = 80,
  height = 28,
  filled = false,
}: MiniLineChartProps) {
  if (!data.length || data.every(v => v === 0)) {
    return (
      <div
        style={{
          width,
          height,
          opacity: 0.12,
          background: 'rgba(255,255,255,0.06)',
          borderRadius: 3,
        }}
      />
    )
  }
  const max = Math.max(...data, 0.001)
  const min = Math.min(...data)
  const range = max - min || 0.001
  const pad = 2

  const pts = data.map((v, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * (width - pad * 2) + pad
    const y = height - pad - ((v - min) / range) * (height - pad * 2)
    return [x, y] as [number, number]
  })

  const pointsStr = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')

  let fillPath = ''
  if (filled && pts.length >= 2) {
    const first = pts[0]
    const last = pts[pts.length - 1]
    fillPath = `M${first[0].toFixed(1)},${height} ${pts.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} L${last[0].toFixed(1)},${height} Z`
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block' }}
    >
      {filled && fillPath && (
        <path
          d={fillPath}
          fill={color.replace(/[\d.]+\)$/, '0.12)')}
          stroke="none"
        />
      )}
      <polyline
        points={pointsStr}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── TrendBadge ────────────────────────────────────────────────────────────────

function TrendBadge({ current, prev, invert = false }: {
  current: number
  prev: number
  invert?: boolean
}) {
  if (prev === 0 || current === prev) return null
  const up = current > prev
  const good = invert ? !up : up
  const pctChng = Math.abs(Math.round(((current - prev) / prev) * 100))
  return (
    <span className={cls('kpi-trend', good ? 'kpi-trend--good' : 'kpi-trend--bad')}>
      {up ? '▲' : '▼'} {pctChng}%
    </span>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton({ width = '100%', height = 18, radius = 4 }: {
  width?: string | number
  height?: number
  radius?: number
}) {
  return (
    <span
      className="kpi-skeleton"
      style={{ width, height, borderRadius: radius, display: 'block' }}
    />
  )
}

// ── HealthBar ─────────────────────────────────────────────────────────────────

function HealthBar({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' }) {
  const color =
    score > 75
      ? 'rgba(52,211,153,0.8)'
      : score > 50
      ? 'rgba(251,191,36,0.8)'
      : 'rgba(248,113,113,0.8)'
  return (
    <div className={cls('kpi-health-bar', size === 'sm' && 'kpi-health-bar--sm')}>
      <div
        className="kpi-health-bar__fill"
        style={{ width: `${score}%`, background: color }}
      />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ExecStrip — Big KPI numbers
// ══════════════════════════════════════════════════════════════════════════════

function ExecStrip({ summary, timeSeries, loading, compact }: {
  summary: KpiSummary | null
  timeSeries: TimeSeriesPoint[]
  loading: boolean
  compact: boolean
}) {
  const sentSeries = timeSeries.map(p => p.sent)
  const repliedSeries = timeSeries.map(p => p.replied)
  const positiveSeries = timeSeries.map(p => p.positive)

  const cards = summary
    ? [
        {
          label: 'Sent',
          value: fmt.int(summary.sentCount),
          sub: null as string | null,
          series: sentSeries,
          color: 'rgba(72,138,236,0.88)',
          tone: '' as string,
          trendCurrent: summary.sentCount,
          trendPrev: summary.prevSentCount,
        },
        {
          label: 'Delivered',
          value: fmt.int(summary.deliveredCount),
          sub: fmt.pct(summary.deliveryRate),
          series: sentSeries,
          color: 'rgba(72,138,236,0.6)',
          tone: '',
          trendCurrent: 0,
          trendPrev: 0,
        },
        {
          label: 'Replies',
          value: fmt.int(summary.repliedCount),
          sub: null,
          series: repliedSeries,
          color: 'rgba(34,211,238,0.88)',
          tone: 'cyan',
          trendCurrent: summary.repliedCount,
          trendPrev: summary.prevRepliedCount,
        },
        {
          label: 'Positive',
          value: fmt.int(summary.positiveReplies),
          sub: fmt.pct(summary.positiveRate),
          series: positiveSeries,
          color: 'rgba(52,211,153,0.88)',
          tone: 'green',
          trendCurrent: summary.positiveReplies,
          trendPrev: summary.prevPositiveReplies,
        },
        {
          label: 'Opt-Out Rate',
          value: fmt.pct(summary.optOutRate),
          sub: fmt.int(summary.optOutCount),
          series: [] as number[],
          color: 'rgba(251,191,36,0.85)',
          tone: summary.optOutRate > 2 ? 'amber' : '',
          trendCurrent: 0,
          trendPrev: 0,
        },
        {
          label: 'Delivery Rate',
          value: fmt.pct(summary.deliveryRate),
          sub: null,
          series: [] as number[],
          color: 'rgba(72,138,236,0.55)',
          tone: '',
          trendCurrent: 0,
          trendPrev: 0,
        },
        {
          label: 'Cost / Period',
          value: fmt.usd(summary.spendPeriod),
          sub: null,
          series: [] as number[],
          color: 'rgba(130,155,200,0.65)',
          tone: '',
          trendCurrent: 0,
          trendPrev: 0,
        },
        {
          label: 'Cost / Reply',
          value: fmt.usd(summary.costPerReply),
          sub: null,
          series: [] as number[],
          color: 'rgba(251,146,60,0.75)',
          tone: '',
          trendCurrent: 0,
          trendPrev: 0,
        },
        {
          label: 'Cost / Positive',
          value: fmt.usd(summary.costPerPositive),
          sub: null,
          series: [] as number[],
          color: 'rgba(251,191,36,0.75)',
          tone: '',
          trendCurrent: 0,
          trendPrev: 0,
        },
        {
          label: 'Queue Health',
          value:
            summary.queueHealth === 'good'
              ? 'Good'
              : summary.queueHealth === 'warning'
              ? 'Warning'
              : 'Critical',
          sub: null,
          series: [] as number[],
          color:
            summary.queueHealth === 'good'
              ? 'rgba(52,211,153,0.88)'
              : summary.queueHealth === 'warning'
              ? 'rgba(251,191,36,0.88)'
              : 'rgba(248,113,113,0.88)',
          tone:
            summary.queueHealth === 'critical'
              ? 'red'
              : summary.queueHealth === 'warning'
              ? 'amber'
              : 'green',
          trendCurrent: 0,
          trendPrev: 0,
        },
        {
          label: 'Auto Health',
          value: String(summary.automationHealthScore),
          sub: '/100',
          series: [] as number[],
          color: 'rgba(34,211,238,0.75)',
          tone: '',
          trendCurrent: 0,
          trendPrev: 0,
        },
        {
          label: 'Buyer Demand',
          value: summary.buyerDemandScore > 0 ? String(summary.buyerDemandScore) : '—',
          sub: null,
          series: [] as number[],
          color: 'rgba(168,85,247,0.75)',
          tone: '',
          trendCurrent: 0,
          trendPrev: 0,
        },
      ]
    : null

  const stripClass = cls('kpi-exec-strip', compact && 'kpi-exec-strip--compact')

  if (compact) {
    return (
      <div className={stripClass}>
        {loading || !cards
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="kpi-exec-card kpi-exec-card--compact">
                <Skeleton height={10} width={60} />
                <Skeleton height={20} width={44} />
              </div>
            ))
          : cards.slice(0, 6).map(c => (
              <div
                key={c.label}
                className={cls('kpi-exec-card kpi-exec-card--compact', c.tone && `is-${c.tone}`)}
              >
                <span className="kpi-exec-card__label">{c.label}</span>
                <strong className="kpi-exec-card__value" style={{ color: c.color }}>
                  {c.value}
                </strong>
                {c.sub && <span className="kpi-exec-card__sub">{c.sub}</span>}
              </div>
            ))}
      </div>
    )
  }

  return (
    <div className={stripClass}>
      {loading || !cards
        ? Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="kpi-exec-card">
              <Skeleton height={10} width={72} />
              <Skeleton height={32} width={56} />
              <Skeleton height={20} width={80} />
            </div>
          ))
        : cards.map(c => (
            <div
              key={c.label}
              className={cls('kpi-exec-card', c.tone && `is-${c.tone}`)}
            >
              <span className="kpi-exec-card__label">{c.label}</span>
              <strong className="kpi-exec-card__value" style={{ color: c.color }}>
                {c.value}
              </strong>
              {c.sub && <span className="kpi-exec-card__sub">{c.sub}</span>}
              {c.series.length > 1 && (
                <div className="kpi-exec-card__chart">
                  <MiniLineChart data={c.series} color={c.color} width={88} height={26} filled />
                </div>
              )}
              {c.trendPrev > 0 && (
                <TrendBadge current={c.trendCurrent} prev={c.trendPrev} />
              )}
            </div>
          ))}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// UsaMap — real SVG geographic paths
// ══════════════════════════════════════════════════════════════════════════════

interface UsaMapProps {
  states: StatePerformance[]
  selectedState: string | null
  onStateClick: (abbr: string) => void
  loading: boolean
}

function UsaMap({ states, selectedState, onStateClick, loading }: UsaMapProps) {
  const [hoveredState, setHoveredState] = useState<string | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const stateMap = useMemo(() => new Map(states.map(s => [s.state, s])), [states])
  const hoveredData = hoveredState ? stateMap.get(hoveredState) : null

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [])

  if (loading) {
    return (
      <div className="kpi-map kpi-map--loading">
        <Skeleton height={260} radius={6} />
      </div>
    )
  }

  return (
    <div className="kpi-map">
      <div className="kpi-map__header">
        <span className="kpi-map__title">Nationwide Performance</span>
        {selectedState && (
          <button type="button" className="kpi-map__clear" onClick={() => onStateClick('')}>
            {selectedState} ✕
          </button>
        )}
      </div>

      <div className="kpi-map__svg-wrap">
        <svg
          ref={svgRef}
          viewBox="0 0 960 600"
          className="kpi-map__svg"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => { setHoveredState(null); setTooltipPos(null) }}
        >
          {Object.entries(USA_STATE_PATHS).map(([abbr, sp]) => {
            const data = stateMap.get(abbr)
            const fill = data ? STATE_STATUS_FILL[data.status] : STATE_STATUS_DEFAULT
            const isSelected = selectedState === abbr
            const isHovered = hoveredState === abbr

            return (
              <g key={abbr}>
                <path
                  d={sp.path}
                  fill={fill}
                  className={cls(
                    'kpi-map__state',
                    isSelected && 'kpi-map__state--selected',
                  )}
                  style={{
                    opacity: isHovered ? 0.8 : 1,
                    stroke: isSelected
                      ? 'rgba(255,255,255,0.9)'
                      : isHovered
                      ? 'rgba(255,255,255,0.4)'
                      : 'rgba(0,0,0,0.55)',
                    strokeWidth: isSelected ? 2 : isHovered ? 1.2 : 0.8,
                  }}
                  onClick={() => onStateClick(isSelected ? '' : abbr)}
                  onMouseEnter={() => setHoveredState(abbr)}
                />
                {abbr !== 'HI' && (
                  <text
                    x={sp.cx}
                    y={sp.cy}
                    className="kpi-map__state-label"
                    style={{ fontSize: abbr === 'DC' ? 5 : 8 }}
                  >
                    {abbr}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {hoveredData && tooltipPos && (
          <div
            className="kpi-map__tooltip"
            style={{
              left: Math.min(tooltipPos.x + 12, 560),
              top: Math.max(tooltipPos.y - 80, 8),
              position: 'absolute',
            }}
          >
            <strong>{STATE_NAMES[hoveredData.state] ?? hoveredData.state}</strong>
            <div className="kpi-map__tooltip-grid">
              <span>Sent</span><span>{hoveredData.sent.toLocaleString()}</span>
              <span>Replied</span><span>{hoveredData.replied.toLocaleString()}</span>
              <span>Positive</span><span>{hoveredData.positive}</span>
              <span>Opt-Out</span><span>{hoveredData.optOutRate}%</span>
              <span>Top Market</span><span>{hoveredData.topMarket}</span>
              <span>Action</span>
              <span className={cls(
                'kpi-rec',
                hoveredData.recommendation === 'Scale' ? 'kpi-rec--scale' :
                hoveredData.recommendation === 'Pause' || hoveredData.recommendation === 'Investigate' ? 'kpi-rec--pause' : ''
              )}>
                {hoveredData.recommendation}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="kpi-map__legend">
        {(
          [
            ['quiet', 'No Data'],
            ['active', 'Active'],
            ['strong', 'Strong'],
            ['warning', 'Warning'],
            ['blocked', 'Blocked'],
            ['contracting', 'Contract'],
          ] as const
        ).map(([status, label]) => (
          <span key={status} className="kpi-map__legend-item">
            <i style={{ background: STATE_STATUS_FILL[status] }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// AcquisitionFunnel
// ══════════════════════════════════════════════════════════════════════════════

function AcquisitionFunnel({ stages, loading }: {
  stages: FunnelStage[]
  loading: boolean
}) {
  const maxCount = useMemo(() => Math.max(...stages.map(s => s.count), 1), [stages])

  if (loading) {
    return (
      <div className="kpi-funnel">
        <div className="kpi-section-title">Acquisition Funnel</div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="kpi-funnel__stage">
            <Skeleton height={10} width={90} />
            <Skeleton height={5} width="100%" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="kpi-funnel">
      <div className="kpi-section-title">Acquisition Funnel</div>
      {stages.map((stage, i) => {
        const widthPct = maxCount > 0 ? Math.max(2, Math.round((stage.count / maxCount) * 100)) : 2
        const barColor =
          i < 4
            ? 'rgba(72,138,236,0.65)'
            : i < 6
            ? 'rgba(52,211,153,0.65)'
            : 'rgba(168,85,247,0.65)'
        return (
          <div key={stage.id} className="kpi-funnel__stage">
            <div className="kpi-funnel__stage-header">
              <span className="kpi-funnel__label">{stage.label}</span>
              <span className="kpi-funnel__count">
                {stage.count.toLocaleString()}
                {stage.isEstimate && <em> ~</em>}
              </span>
              {stage.conversionRate !== null && i > 0 && (
                <span className={cls('kpi-funnel__rate', stage.conversionRate < 50 ? 'is-amber' : '')}>
                  {stage.conversionRate}%
                </span>
              )}
            </div>
            <div className="kpi-funnel__track">
              <div className="kpi-funnel__bar" style={{ width: `${widthPct}%`, background: barColor }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TimeSeriesPanel
// ══════════════════════════════════════════════════════════════════════════════

function TimeSeriesPanel({ timeSeries, loading }: {
  timeSeries: TimeSeriesPoint[]
  loading: boolean
}) {
  const charts = [
    { key: 'sent' as const,     label: 'Sent',     color: 'rgba(72,138,236,0.88)' },
    { key: 'replied' as const,  label: 'Replies',  color: 'rgba(34,211,238,0.88)' },
    { key: 'positive' as const, label: 'Positive', color: 'rgba(52,211,153,0.88)' },
    { key: 'optOut' as const,   label: 'Opt-Outs', color: 'rgba(248,113,113,0.82)' },
    { key: 'failed' as const,   label: 'Failed',   color: 'rgba(251,191,36,0.82)' },
    { key: 'spend' as const,    label: 'Spend $',  color: 'rgba(130,155,200,0.75)' },
  ]

  if (loading) {
    return (
      <div className="kpi-charts-grid">
        {charts.map(c => (
          <div key={c.key} className="kpi-chart-card">
            <Skeleton height={11} width={60} />
            <Skeleton height={44} width="100%" />
          </div>
        ))}
      </div>
    )
  }

  if (!timeSeries.length) {
    return (
      <div className="kpi-chart-card">
        <div className="kpi-empty">
          <span className="kpi-empty__icon">◌</span>
          <span>No time-series data for this period.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="kpi-charts-grid">
      {charts.map(c => {
        const values = timeSeries.map(p => p[c.key] as number)
        const total = values.reduce((a, b) => a + b, 0)
        return (
          <div key={c.key} className="kpi-chart-card">
            <div className="kpi-chart-card__header">
              <span className="kpi-chart-card__label">{c.label}</span>
              <strong className="kpi-chart-card__total" style={{ color: c.color }}>
                {c.key === 'spend' ? fmt.usd(total) : fmt.int(total)}
              </strong>
            </div>
            <MiniLineChart data={values} color={c.color} width={200} height={44} filled />
            <div className="kpi-chart-card__dates">
              {timeSeries[0]?.date && <span>{timeSeries[0].date.slice(5)}</span>}
              {timeSeries[timeSeries.length - 1]?.date && (
                <span>{timeSeries[timeSeries.length - 1].date.slice(5)}</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// State Leaderboard
// ══════════════════════════════════════════════════════════════════════════════

function StateLeaderboard({ states, selectedState, onSelect, compact, loading }: {
  states: StatePerformance[]
  selectedState: string | null
  onSelect: (s: string) => void
  compact: boolean
  loading: boolean
}) {
  const visible = compact ? states.slice(0, 8) : states.slice(0, 20)

  return (
    <div className="kpi-leaderboard">
      <div className="kpi-section-title">State Leaderboard</div>
      {loading ? (
        Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="kpi-lb-row">
            <Skeleton height={14} />
          </div>
        ))
      ) : !states.length ? (
        <div className="kpi-empty">
          <span>No state performance data for this period.</span>
        </div>
      ) : (
        <div className="kpi-lb-table">
          <div className="kpi-lb-header">
            <span>State</span>
            <span>Sent</span>
            <span>Reply%</span>
            <span>Pos%</span>
            <span>Opt%</span>
            {!compact && <span>Action</span>}
          </div>
          {visible.map(s => (
            <button
              key={s.state}
              type="button"
              className={cls('kpi-lb-row', s.state === selectedState && 'is-selected')}
              onClick={() => onSelect(s.state === selectedState ? '' : s.state)}
            >
              <span className="kpi-lb-state">
                <span className={cls('kpi-lb-dot', `is-${s.status}`)} />
                {s.state}
              </span>
              <span>{fmt.int(s.sent)}</span>
              <span>{fmt.pct(s.replyRate)}</span>
              <span className={cls(s.positiveRate > 20 ? 'is-green' : '')}>
                {fmt.pct(s.positiveRate)}
              </span>
              <span className={cls(s.optOutRate > 2 ? 'is-red' : '')}>
                {fmt.pct(s.optOutRate)}
              </span>
              {!compact && (
                <span
                  className={cls(
                    'kpi-rec',
                    s.recommendation === 'Scale' ? 'kpi-rec--scale' :
                    s.recommendation === 'Pause' || s.recommendation === 'Investigate' ? 'kpi-rec--pause' : ''
                  )}
                >
                  {s.recommendation}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Market Leaderboard
// ══════════════════════════════════════════════════════════════════════════════

function MarketLeaderboard({ markets, compact, loading }: {
  markets: MarketPerformance[]
  compact: boolean
  loading: boolean
}) {
  const visible = compact ? markets.slice(0, 8) : markets.slice(0, 20)

  return (
    <div className="kpi-leaderboard">
      <div className="kpi-section-title">Market Leaderboard</div>
      {loading ? (
        Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="kpi-lb-row">
            <Skeleton height={14} />
          </div>
        ))
      ) : !markets.length ? (
        <div className="kpi-empty">
          <span>No market performance data for this period.</span>
        </div>
      ) : (
        <div className="kpi-lb-table">
          <div className="kpi-lb-header">
            <span>Market</span>
            <span>State</span>
            <span>Sent</span>
            <span>Reply%</span>
            <span>Pos%</span>
            {!compact && <span>Opt%</span>}
            {!compact && <span>Action</span>}
          </div>
          {visible.map((m, i) => (
            <div key={m.market} className="kpi-lb-row">
              <span className="kpi-lb-rank">{i + 1}</span>
              <span className="kpi-lb-name">{m.market}</span>
              <span>{m.state}</span>
              <span>{fmt.int(m.sent)}</span>
              <span>{fmt.pct(m.replyRate)}</span>
              <span className={cls(m.positiveRate > 20 ? 'is-green' : '')}>
                {fmt.pct(m.positiveRate)}
              </span>
              {!compact && (
                <span className={cls(m.optOutRate > 2 ? 'is-red' : '')}>
                  {fmt.pct(m.optOutRate)}
                </span>
              )}
              {!compact && (
                <span
                  className={cls(
                    'kpi-rec',
                    m.recommendation === 'Scale' ? 'kpi-rec--scale' :
                    m.recommendation === 'Pause' || m.recommendation === 'Investigate' ? 'kpi-rec--pause' : ''
                  )}
                >
                  {m.recommendation}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Agent Leaderboard
// ══════════════════════════════════════════════════════════════════════════════

function AgentLeaderboard({ agents, compact, loading }: {
  agents: AgentPerformance[]
  compact: boolean
  loading: boolean
}) {
  return (
    <div className="kpi-leaderboard">
      <div className="kpi-section-title">Agent Leaderboard</div>
      {loading ? (
        Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="kpi-lb-row">
            <Skeleton height={14} />
          </div>
        ))
      ) : !agents.length ? (
        <div className="kpi-empty">
          <span>No agent-level data. Ensure sender_name is tracked in message_events.</span>
        </div>
      ) : (
        <div className="kpi-lb-table">
          <div className="kpi-lb-header">
            <span>Agent</span>
            <span>Sent</span>
            <span>Reply%</span>
            {!compact && <span>Pos%</span>}
            {!compact && <span>Opt%</span>}
            <span>Top Mkt</span>
          </div>
          {agents.slice(0, compact ? 6 : 12).map((a, i) => (
            <div key={a.agentId} className="kpi-lb-row">
              <span className="kpi-lb-rank">{i + 1}</span>
              <span className="kpi-lb-name">{a.agentName}</span>
              <span>{fmt.int(a.sent)}</span>
              <span className={cls(a.replyRate > 6 ? 'is-cyan' : '')}>
                {fmt.pct(a.replyRate)}
              </span>
              {!compact && (
                <span className={cls(a.positiveRate > 20 ? 'is-green' : '')}>
                  {fmt.pct(a.positiveRate)}
                </span>
              )}
              {!compact && (
                <span className={cls(a.optOutRate > 2 ? 'is-red' : '')}>
                  {fmt.pct(a.optOutRate)}
                </span>
              )}
              <span className="kpi-lb-dim">{a.bestMarket}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Template Leaderboard
// ══════════════════════════════════════════════════════════════════════════════

function TemplateLeaderboard({ templates, compact, loading }: {
  templates: TemplatePerformance[]
  compact: boolean
  loading: boolean
}) {
  return (
    <div className="kpi-leaderboard">
      <div className="kpi-section-title">Template Leaderboard</div>
      {loading ? (
        Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="kpi-lb-row">
            <Skeleton height={14} />
          </div>
        ))
      ) : !templates.length ? (
        <div className="kpi-empty">
          <span>No template performance data. Ensure template_id is tracked in message_events.</span>
        </div>
      ) : (
        <div className="kpi-lb-table">
          <div className="kpi-lb-header">
            <span>Template</span>
            <span>Sent</span>
            <span>Reply%</span>
            <span>Stop%</span>
            {!compact && <span>Flags</span>}
            <span>Action</span>
          </div>
          {templates.slice(0, compact ? 6 : 15).map((t, i) => (
            <div key={t.templateId} className="kpi-lb-row">
              <span className="kpi-lb-rank">{i + 1}</span>
              <span className="kpi-lb-name kpi-lb-template-id">{t.templateId}</span>
              <span>{fmt.int(t.sent)}</span>
              <span className={cls(t.replyRate > 6 ? 'is-cyan' : '')}>
                {fmt.pct(t.replyRate)}
              </span>
              <span className={cls(t.stopRate > 2 ? 'is-red' : t.stopRate > 1 ? 'is-amber' : '')}>
                {fmt.pct(t.stopRate)}
              </span>
              {!compact && (
                <span className="kpi-lb-flags">
                  {t.flags.slice(0, 2).map(f => (
                    <span key={f} className="kpi-flag">{f}</span>
                  ))}
                </span>
              )}
              <span
                className={cls(
                  'kpi-rec',
                  t.recommendation === 'Scale' ? 'kpi-rec--scale' :
                  t.recommendation === 'Kill' || t.recommendation === 'Pause' ? 'kpi-rec--pause' : ''
                )}
              >
                {t.recommendation}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Channel Performance
// ══════════════════════════════════════════════════════════════════════════════

function ChannelPerf({ channels, loading }: {
  channels: ChannelPerformance[]
  loading: boolean
}) {
  const sms = channels.find(c => c.channel === 'sms')
  const email = channels.find(c => c.channel === 'email')

  return (
    <div className="kpi-channels">
      <div className="kpi-section-title">Channel Performance</div>
      <div className="kpi-channels__grid">
        <div className="kpi-channel-card">
          <div className="kpi-channel-card__header">
            <span className="kpi-channel-card__icon">✉</span>
            <span className="kpi-channel-card__name">SMS</span>
          </div>
          {loading ? (
            <Skeleton height={80} />
          ) : sms ? (
            <div className="kpi-channel-card__metrics">
              <div className="kpi-ch-row"><span>Sent</span><strong>{fmt.int(sms.sent)}</strong></div>
              <div className="kpi-ch-row"><span>Delivered</span><strong>{fmt.int(sms.delivered)} <em>{fmt.pct(sms.deliveryRate)}</em></strong></div>
              <div className="kpi-ch-row"><span>Replies</span><strong className="is-cyan">{fmt.int(sms.replied)}</strong></div>
              <div className="kpi-ch-row"><span>Positive</span><strong className="is-green">{fmt.int(sms.positive)} <em>{fmt.pct(sms.positiveRate)}</em></strong></div>
              <div className="kpi-ch-row"><span>Opt-Outs</span><strong className={cls(sms.optOut > 0 ? 'is-amber' : '')}>{fmt.int(sms.optOut)}</strong></div>
              <div className="kpi-ch-row"><span>Spend</span><strong>{fmt.usd(sms.spend)}</strong></div>
              <div className="kpi-ch-row"><span>Cost/Reply</span><strong>{fmt.usd(sms.costPerReply)}</strong></div>
              <div className="kpi-ch-row"><span>Cost/Positive</span><strong>{fmt.usd(sms.costPerPositive)}</strong></div>
            </div>
          ) : (
            <div className="kpi-empty"><span>No SMS data for this period.</span></div>
          )}
        </div>

        <div className="kpi-channel-card">
          <div className="kpi-channel-card__header">
            <span className="kpi-channel-card__icon">@</span>
            <span className="kpi-channel-card__name">Email</span>
          </div>
          {loading ? (
            <Skeleton height={80} />
          ) : email?.isWired ? (
            <div className="kpi-channel-card__metrics">
              <div className="kpi-ch-row"><span>Sent</span><strong>{fmt.int(email.sent)}</strong></div>
              <div className="kpi-ch-row"><span>Delivered</span><strong>{fmt.int(email.delivered)}</strong></div>
              <div className="kpi-ch-row"><span>Replies</span><strong className="is-cyan">{fmt.int(email.replied)}</strong></div>
              <div className="kpi-ch-row"><span>Opt-Outs</span><strong>{fmt.int(email.optOut)}</strong></div>
              <div className="kpi-ch-row"><span>Bounced</span><strong>{fmt.int(email.bounced)}</strong></div>
            </div>
          ) : (
            <div className="kpi-empty kpi-empty--wired">
              <span className="kpi-empty__icon">@</span>
              <strong>Email tracking not wired yet</strong>
              <span>Wire email channel tracking in message_events to see performance here.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Offer / Contract Panel
// ══════════════════════════════════════════════════════════════════════════════

function OfferContractPanel({ metrics, loading }: {
  metrics: OfferContractMetrics | null
  loading: boolean
}) {
  if (loading) return <div className="kpi-panel"><Skeleton height={120} /></div>

  if (!metrics?.isWired) {
    return (
      <div className="kpi-panel">
        <div className="kpi-section-title">Offers / Contracts / Closings</div>
        <div className="kpi-empty kpi-empty--wired">
          <span className="kpi-empty__icon">📋</span>
          <strong>Offer &amp; Contract data not wired yet</strong>
          <span>Connect offers, contracts, and closings tables to track deal lifecycle and revenue.</span>
        </div>
      </div>
    )
  }

  const stages = [
    ['Offers Created',  metrics.offersCreated,   'blue'],
    ['Offers Sent',     metrics.offersSent,       'blue'],
    ['Accepted',        metrics.offersAccepted,   'green'],
    ['Contracts Sent',  metrics.contractsSent,    'green'],
    ['Seller Signed',   metrics.sellerSigned,     'green'],
    ['Fully Executed',  metrics.fullyExecuted,    'cyan'],
    ['Sent to Title',   metrics.sentToTitle,      'cyan'],
    ['Closed',          metrics.closed,           'purple'],
  ] as const

  return (
    <div className="kpi-panel">
      <div className="kpi-section-title">Offers / Contracts / Closings</div>
      <div className="kpi-pipeline-stages">
        {stages.map(([label, count, tone]) => (
          <div key={label} className={cls('kpi-pipeline-stage', `is-${tone}`)}>
            <strong>{fmt.int(count)}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Buyer Demand Panel
// ══════════════════════════════════════════════════════════════════════════════

function BuyerDemandPanel({ metrics, loading }: {
  metrics: BuyerDemandMetrics | null
  loading: boolean
}) {
  if (loading) return <div className="kpi-panel"><Skeleton height={80} /></div>

  if (!metrics?.isWired) {
    return (
      <div className="kpi-panel">
        <div className="kpi-section-title">Buyer Demand</div>
        <div className="kpi-empty kpi-empty--wired">
          <span className="kpi-empty__icon">🏠</span>
          <strong>Buyer demand metrics not wired yet</strong>
          <span>Connect buyer_match table to surface buyer demand by market and asset class.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="kpi-panel">
      <div className="kpi-section-title">Buyer Demand</div>
      <div className="kpi-stats-row">
        <div className="kpi-stat">
          <strong>{fmt.int(metrics.totalMatches)}</strong>
          <span>Total Matches</span>
        </div>
        <div className="kpi-stat">
          <strong>{fmt.pct(metrics.avgConfidence)}</strong>
          <span>Avg Confidence</span>
        </div>
        <div className="kpi-stat">
          <strong>{fmt.int(metrics.assignedCount)}</strong>
          <span>Assigned</span>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Spend / ROI Panel
// ══════════════════════════════════════════════════════════════════════════════

function SpendPanel({ spend, loading }: {
  spend: SpendPerformance | null
  loading: boolean
}) {
  if (loading) return <div className="kpi-panel"><Skeleton height={120} /></div>

  return (
    <div className="kpi-panel">
      <div className="kpi-section-title">Spend + ROI</div>
      {spend ? (
        <>
          <div className="kpi-stats-row">
            <div className="kpi-stat"><strong>{fmt.usd(spend.smsSend)}</strong><span>SMS Spend</span></div>
            <div className="kpi-stat"><strong>{fmt.usd(spend.costPerSent)}</strong><span>Cost/Sent</span></div>
            <div className="kpi-stat"><strong>{fmt.usd(spend.costPerReply)}</strong><span>Cost/Reply</span></div>
            <div className="kpi-stat"><strong>{fmt.usd(spend.costPerPositive)}</strong><span>Cost/Positive</span></div>
          </div>
          <div className="kpi-section-subtitle">Revenue Forecast (Assumptions)</div>
          <div className="kpi-forecast">
            {[
              { label: 'Conservative', data: spend.conservative, color: 'rgba(130,155,200,0.75)' },
              { label: 'Base Case',    data: spend.base,         color: 'rgba(72,138,236,0.88)' },
              { label: 'Aggressive',   data: spend.aggressive,   color: 'rgba(52,211,153,0.88)' },
            ].map(f => (
              <div key={f.label} className="kpi-forecast-row">
                <span className="kpi-forecast-label" style={{ color: f.color }}>{f.label}</span>
                <span>{f.data.contracts} contract{f.data.contracts !== 1 ? 's' : ''} × {fmt.usd(f.data.avgRevenue)}</span>
                <strong style={{ color: f.color }}>{fmt.usd(f.data.totalRevenue)}</strong>
              </div>
            ))}
          </div>
          <div className="kpi-note">Revenue assumptions are configurable projections, not actual revenue.</div>
        </>
      ) : (
        <div className="kpi-empty"><span>Spend data unavailable.</span></div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Data Quality Panel
// ══════════════════════════════════════════════════════════════════════════════

function DataQualityPanel({ quality, loading }: {
  quality: DataQualityMetrics | null
  loading: boolean
}) {
  if (loading) return <div className="kpi-panel"><Skeleton height={120} /></div>

  return (
    <div className="kpi-panel">
      <div className="kpi-section-title">Data Quality + Automation Health</div>
      {quality ? (
        <>
          <div className="kpi-health-summary">
            <div className="kpi-health-score">
              <strong
                style={{
                  color:
                    quality.healthScore > 75
                      ? 'rgba(52,211,153,0.92)'
                      : quality.healthScore > 50
                      ? 'rgba(251,191,36,0.92)'
                      : 'rgba(248,113,113,0.92)',
                }}
              >
                {quality.healthScore}
              </strong>
              <span>Health Score</span>
            </div>
            <HealthBar score={quality.healthScore} />
          </div>
          <div className="kpi-quality-grid">
            {[
              { label: 'Failed Queue',    value: quality.failedQueueRows,   warn: quality.failedQueueRows > 10 },
              { label: 'Blank Messages',  value: quality.blankBody,         warn: quality.blankBody > 0 },
              { label: 'Routing Blocked', value: quality.routingBlocked,    warn: quality.routingBlocked > 0 },
              { label: 'Wrong Numbers',   value: quality.wrongNumber,       warn: quality.wrongNumber > 10 },
              { label: 'Auto Blocked',    value: quality.autoReplyBlocked,  warn: quality.autoReplyBlocked > 20 },
              { label: 'Manual Review',   value: quality.manualReviewCount, warn: quality.manualReviewCount > 0 },
              { label: 'Missing Phone',   value: quality.missingPhone,      warn: quality.missingPhone > 0 },
              { label: 'DNC Count',       value: quality.dncCount,          warn: false },
            ].map(({ label, value, warn }) => (
              <div key={label} className={cls('kpi-quality-item', warn && value > 0 ? 'is-warn' : '')}>
                <span className="kpi-quality-item__label">{label}</span>
                <strong className="kpi-quality-item__value">{fmt.int(value)}</strong>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="kpi-empty"><span>Data quality metrics unavailable.</span></div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Numbers Health Panel
// ══════════════════════════════════════════════════════════════════════════════

function NumbersHealthPanel({ numbers, carriers, compact, loading }: {
  numbers: TextgridNumberHealth[]
  carriers: CarrierPerformance[]
  compact: boolean
  loading: boolean
}) {
  const avgHealth = numbers.length
    ? Math.round(numbers.reduce((s, n) => s + n.healthScore, 0) / numbers.length)
    : 0
  const atRisk  = numbers.filter(n => n.healthScore < 60).length
  const nearCap = numbers.filter(n => n.dailyCapUsedPct > 80).length

  return (
    <div className="kpi-panel">
      <div className="kpi-section-title">TextGrid Numbers Health</div>

      {loading ? (
        <Skeleton height={120} />
      ) : !numbers.length ? (
        <div className="kpi-empty kpi-empty--wired">
          <span className="kpi-empty__icon">📡</span>
          <strong>No TextGrid number data found</strong>
          <span>Ensure textgrid_numbers table exists and from_number is tracked in message_events.</span>
        </div>
      ) : (
        <>
          <div className="kpi-stats-row">
            <div className="kpi-stat"><strong>{numbers.length}</strong><span>Active Numbers</span></div>
            <div className="kpi-stat">
              <strong style={{ color: avgHealth > 75 ? 'rgba(52,211,153,0.92)' : avgHealth > 50 ? 'rgba(251,191,36,0.92)' : 'rgba(248,113,113,0.92)' }}>
                {avgHealth}
              </strong>
              <span>Avg Health</span>
            </div>
            <div className="kpi-stat"><strong className={cls(atRisk > 0 ? 'is-red' : '')}>{atRisk}</strong><span>At Risk</span></div>
            <div className="kpi-stat"><strong className={cls(nearCap > 0 ? 'is-amber' : '')}>{nearCap}</strong><span>Near Cap</span></div>
          </div>

          <div className="kpi-lb-table">
            <div className="kpi-lb-header">
              <span>Number</span>
              <span>Market</span>
              <span>Sent</span>
              <span>Delivered%</span>
              {!compact && <span>Reply%</span>}
              {!compact && <span>Opt-Out%</span>}
              <span>Health</span>
              <span>Status</span>
            </div>
            {numbers.slice(0, compact ? 5 : 12).map(n => (
              <div
                key={n.numberId}
                className={cls(
                  'kpi-lb-row',
                  (n.recommendation === 'Pause' || n.recommendation === 'Replace') && 'is-warn-row'
                )}
              >
                <span className="kpi-lb-phone">
                  {n.phoneNumber.replace(/(\+1)(\d{3})(\d{3})(\d{4})/, '$1 ($2) $3-$4')}
                </span>
                <span className="kpi-lb-dim">{n.market}</span>
                <span>{fmt.int(n.sentToday)}</span>
                <span className={cls(n.deliveryRate < 85 ? 'is-red' : n.deliveryRate < 92 ? 'is-amber' : 'is-green')}>
                  {fmt.pct(n.deliveryRate)}
                </span>
                {!compact && <span>{fmt.pct(n.replyRate)}</span>}
                {!compact && (
                  <span className={cls(n.optOutRate > 2 ? 'is-red' : '')}>
                    {fmt.pct(n.optOutRate)}
                  </span>
                )}
                <span><HealthBar score={n.healthScore} size="sm" /></span>
                <span
                  className={cls(
                    'kpi-rec',
                    n.recommendation === 'Healthy' ? 'kpi-rec--scale' :
                    n.recommendation === 'Pause' || n.recommendation === 'Replace' ? 'kpi-rec--pause' :
                    n.recommendation === 'Throttle' || n.recommendation === 'Watch' ? 'kpi-rec--watch' : ''
                  )}
                >
                  {n.recommendation}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="kpi-section-subtitle" style={{ marginTop: 20 }}>Carrier Intelligence</div>
      {loading ? (
        <Skeleton height={60} />
      ) : !carriers.length ? (
        <div className="kpi-empty">
          <span>Carrier-level tracking not wired. Add carrier_name and line_type to message_events.</span>
        </div>
      ) : (
        <div className="kpi-lb-table">
          <div className="kpi-lb-header">
            <span>Carrier</span>
            <span>Type</span>
            <span>Sent</span>
            <span>Delivered%</span>
            <span>Reply%</span>
            <span>Opt-Out%</span>
          </div>
          {carriers.slice(0, 8).map(c => (
            <div key={c.carrier} className="kpi-lb-row">
              <span className="kpi-lb-name">{c.carrier}</span>
              <span className="kpi-lb-dim">{c.lineType}</span>
              <span>{fmt.int(c.sent)}</span>
              <span className={cls(c.deliveryRate < 85 ? 'is-red' : 'is-green')}>{fmt.pct(c.deliveryRate)}</span>
              <span>{fmt.pct(c.replyRate)}</span>
              <span className={cls(c.optOutRate > 2 ? 'is-red' : '')}>{fmt.pct(c.optOutRate)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Alerts Panel
// ══════════════════════════════════════════════════════════════════════════════

function AlertsPanel({ alerts, loading }: {
  alerts: KpiAlert[]
  loading: boolean
}) {
  const severityOrder: Record<KpiAlert['severity'], number> = {
    critical: 0, warning: 1, opportunity: 2, info: 3,
  }
  const sorted = [...alerts].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  )

  return (
    <div className="kpi-alerts">
      <div className="kpi-section-title">Intelligence + Alerts</div>
      {loading ? (
        Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="kpi-alert">
            <Skeleton height={40} />
          </div>
        ))
      ) : !sorted.length ? (
        <div className="kpi-empty">
          <span>No alerts — system operating normally.</span>
        </div>
      ) : (
        sorted.map(alert => (
          <div key={alert.id} className={cls('kpi-alert', `kpi-alert--${alert.severity}`)}>
            <div className="kpi-alert__header">
              <span className={cls('kpi-alert__dot', `kpi-alert__dot--${alert.severity}`)} />
              <span className="kpi-alert__category">{alert.category}</span>
              <span className="kpi-alert__sev">{alert.severity.toUpperCase()}</span>
            </div>
            <p className="kpi-alert__msg">{alert.message}</p>
            {alert.suggestedAction && (
              <div className="kpi-alert__action">→ {alert.suggestedAction}</div>
            )}
          </div>
        ))
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Filter Bar
// ══════════════════════════════════════════════════════════════════════════════

function FilterBar({ filters, onChange, loading, selectedState, onClearState }: {
  filters: KpiFilters
  onChange: (patch: Partial<KpiFilters>) => void
  loading: boolean
  selectedState: string | null
  onClearState: () => void
}) {
  return (
    <div className="kpi-filter-bar">
      <div className="kpi-filter-bar__left">
        <select
          className="kpi-select"
          value={filters.timeRange}
          onChange={e => onChange({ timeRange: e.target.value as KpiTimeRange })}
        >
          {(Object.entries(TIME_RANGE_LABELS) as Array<[KpiTimeRange, string]>).map(
            ([v, l]) => (
              <option key={v} value={v}>{l}</option>
            )
          )}
        </select>

        {selectedState && (
          <button
            type="button"
            className="kpi-filter-chip kpi-filter-chip--active"
            onClick={onClearState}
          >
            {STATE_NAMES[selectedState] ?? selectedState} ✕
          </button>
        )}
        {filters.market && (
          <button
            type="button"
            className="kpi-filter-chip kpi-filter-chip--active"
            onClick={() => onChange({ market: undefined })}
          >
            {filters.market} ✕
          </button>
        )}
      </div>

      <div className="kpi-filter-bar__right">
        <span
          className={cls('kpi-live-dot', loading && 'kpi-live-dot--loading')}
          title={loading ? 'Loading…' : 'Live data'}
        />
        <span className="kpi-filter-bar__label">{loading ? 'Loading' : 'Live'}</span>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// KPI Rail — compact 25% sidebar
// ══════════════════════════════════════════════════════════════════════════════

function KpiRail({ summary, alerts, states, loading }: {
  summary: KpiSummary | null
  alerts: KpiAlert[]
  states: StatePerformance[]
  loading: boolean
}) {
  const topState = states[0]
  const criticalAlerts = alerts
    .filter(a => a.severity === 'critical' || a.severity === 'warning')
    .slice(0, 3)

  const railItems: Array<[string, string, string]> = summary
    ? [
        ['Sent',        fmt.int(summary.sentCount),              ''],
        ['Delivered',   fmt.pct(summary.deliveryRate),           ''],
        ['Replies',     fmt.int(summary.repliedCount),           'cyan'],
        ['Positive',    fmt.int(summary.positiveReplies),        'green'],
        ['Opt-Out',     fmt.pct(summary.optOutRate),             summary.optOutRate > 2 ? 'amber' : ''],
        ['Spend',       fmt.usd(summary.spendPeriod),            ''],
        ['Cost/Reply',  fmt.usd(summary.costPerReply),           ''],
        ['Auto Health', String(summary.automationHealthScore),   summary.automationHealthScore < 70 ? 'amber' : 'green'],
      ]
    : []

  return (
    <div className="kpi-rail">
      <div className="kpi-rail__header">KPI Command</div>
      {loading ? (
        Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="kpi-rail__item">
            <Skeleton height={9} width={60} />
            <Skeleton height={18} width={40} />
          </div>
        ))
      ) : (
        <>
          {railItems.map(([label, val, tone]) => (
            <div key={label} className="kpi-rail__item">
              <span className="kpi-rail__label">{label}</span>
              <strong className={cls('kpi-rail__value', tone && `is-${tone}`)}>{val}</strong>
            </div>
          ))}

          {topState && (
            <div className="kpi-rail__item kpi-rail__item--highlight">
              <span className="kpi-rail__label">Top State</span>
              <strong className="kpi-rail__value is-blue">{topState.state}</strong>
              <span className="kpi-rail__sub">{fmt.int(topState.sent)} sent</span>
            </div>
          )}

          {criticalAlerts.length > 0 && (
            <div className="kpi-rail__alerts">
              <span className="kpi-rail__label">Alerts</span>
              {criticalAlerts.map(a => (
                <div key={a.id} className={cls('kpi-rail__alert', `kpi-rail__alert--${a.severity}`)}>
                  {a.message.slice(0, 60)}
                  {a.message.length > 60 && '…'}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Main component
// ══════════════════════════════════════════════════════════════════════════════

interface InboxKpiDashboardProps {
  layoutMode: ViewLayoutMode
}

export function InboxKpiDashboard({ layoutMode }: InboxKpiDashboardProps) {
  const [filters, setFilters] = useState<KpiFilters>({ timeRange: 'last_7_days', channel: 'all' })
  const [selectedState, setSelectedState] = useState<string | null>(null)
  const [refreshTick] = useState(0)

  // Data state
  const [summary,      setSummary]      = useState<KpiSummary | null>(null)
  const [timeSeries,   setTimeSeries]   = useState<TimeSeriesPoint[]>([])
  const [statePerf,    setStatePerf]    = useState<StatePerformance[]>([])
  const [marketPerf,   setMarketPerf]   = useState<MarketPerformance[]>([])
  const [agentPerf,    setAgentPerf]    = useState<AgentPerformance[]>([])
  const [templatePerf, setTemplatePerf] = useState<TemplatePerformance[]>([])
  const [channelPerf,  setChannelPerf]  = useState<ChannelPerformance[]>([])
  const [spend,        setSpend]        = useState<SpendPerformance | null>(null)
  const [funnel,       setFunnel]       = useState<FunnelStage[]>([])
  const [dataQuality,  setDataQuality]  = useState<DataQualityMetrics | null>(null)
  const [buyerMetrics, setBuyerMetrics] = useState<BuyerDemandMetrics | null>(null)
  const [offerMetrics, setOfferMetrics] = useState<OfferContractMetrics | null>(null)
  const [numberHealth, setNumberHealth] = useState<TextgridNumberHealth[]>([])
  const [carrierPerf,  setCarrierPerf]  = useState<CarrierPerformance[]>([])
  const [alerts,       setAlerts]       = useState<KpiAlert[]>([])
  const [loading,      setLoading]      = useState(true)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeFilters: KpiFilters = useMemo(
    () => ({ ...filters, state: selectedState ?? undefined }),
    [filters, selectedState]
  )

  const loadAll = useCallback(async (f: KpiFilters) => {
    setLoading(true)
    try {
      // Wave 1: critical path — summary + time-series + state map
      const [sumRes, tsRes, stateRes] = await Promise.all([
        loadKpiDashboardSummary(f),
        loadKpiTimeSeries(f),
        loadStatePerformance(f),
      ])
      setSummary(sumRes)
      setTimeSeries(tsRes)
      setStatePerf(stateRes)
      setLoading(false)

      // Wave 2: everything else (secondary panels)
      const [
        mktRes, agentRes, tplRes, chRes, spendRes,
        funnelRes, qualRes, buyerRes, offerRes,
        numRes, carrierRes, alertRes,
      ] = await Promise.all([
        loadMarketPerformance(f),
        loadAgentPerformance(f),
        loadTemplatePerformance(f),
        loadChannelPerformance(f),
        loadSpendPerformance(f),
        loadFunnelPerformance(f),
        loadDataQualityMetrics(f),
        loadBuyerDemandMetrics(f),
        loadOfferContractMetrics(f),
        loadTextgridNumberHealth(f),
        loadCarrierPerformance(f),
        loadKpiAlerts(f),
      ])
      setMarketPerf(mktRes)
      setAgentPerf(agentRes)
      setTemplatePerf(tplRes)
      setChannelPerf(chRes)
      setSpend(spendRes)
      setFunnel(funnelRes)
      setDataQuality(qualRes)
      setBuyerMetrics(buyerRes)
      setOfferMetrics(offerRes)
      setNumberHealth(numRes)
      setCarrierPerf(carrierRes)
      setAlerts(alertRes)
    } catch {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      loadAll(activeFilters)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilters.timeRange, activeFilters.state, activeFilters.market, refreshTick])

  const handleFilterChange = useCallback((patch: Partial<KpiFilters>) => {
    setFilters(prev => ({ ...prev, ...patch }))
  }, [])

  const handleStateClick = useCallback((abbr: string) => {
    setSelectedState(abbr || null)
  }, [])

  const clearState = useCallback(() => setSelectedState(null), [])

  // ── 25% — Rail ─────────────────────────────────────────────────────────────
  if (layoutMode === 'compact') {
    return (
      <div className="kpi kpi--rail">
        <KpiRail
          summary={summary}
          alerts={alerts}
          states={statePerf}
          loading={loading}
        />
      </div>
    )
  }

  // ── 50% — Analyst ──────────────────────────────────────────────────────────
  if (layoutMode === 'medium') {
    return (
      <div className="kpi kpi--analyst">
        <FilterBar
          filters={filters}
          onChange={handleFilterChange}
          loading={loading}
          selectedState={selectedState}
          onClearState={clearState}
        />
        <div className="kpi-scroll">
          <ExecStrip summary={summary} timeSeries={timeSeries} loading={loading} compact />
          <div className="kpi-two-col">
            <AcquisitionFunnel stages={funnel} loading={loading} />
            <StateLeaderboard
              states={statePerf}
              selectedState={selectedState}
              onSelect={handleStateClick}
              compact
              loading={loading}
            />
          </div>
          <div className="kpi-two-col">
            <TemplateLeaderboard templates={templatePerf} compact loading={loading} />
            <AgentLeaderboard agents={agentPerf} compact loading={loading} />
          </div>
          <AlertsPanel alerts={alerts} loading={loading} />
          <DataQualityPanel quality={dataQuality} loading={loading} />
        </div>
      </div>
    )
  }

  // ── 75% — Performance Command ──────────────────────────────────────────────
  if (layoutMode === 'expanded') {
    return (
      <div className="kpi kpi--command">
        <FilterBar
          filters={filters}
          onChange={handleFilterChange}
          loading={loading}
          selectedState={selectedState}
          onClearState={clearState}
        />
        <div className="kpi-scroll">
          <ExecStrip summary={summary} timeSeries={timeSeries} loading={loading} compact={false} />
          <div className="kpi-two-col kpi-two-col--weighted">
            <UsaMap
              states={statePerf}
              selectedState={selectedState}
              onStateClick={handleStateClick}
              loading={loading}
            />
            <AcquisitionFunnel stages={funnel} loading={loading} />
          </div>
          <TimeSeriesPanel timeSeries={timeSeries} loading={loading} />
          <div className="kpi-two-col">
            <StateLeaderboard
              states={statePerf}
              selectedState={selectedState}
              onSelect={handleStateClick}
              compact={false}
              loading={loading}
            />
            <MarketLeaderboard markets={marketPerf} compact loading={loading} />
          </div>
          <div className="kpi-two-col">
            <AgentLeaderboard agents={agentPerf} compact loading={loading} />
            <TemplateLeaderboard templates={templatePerf} compact loading={loading} />
          </div>
          <ChannelPerf channels={channelPerf} loading={loading} />
          <AlertsPanel alerts={alerts} loading={loading} />
          <DataQualityPanel quality={dataQuality} loading={loading} />
        </div>
      </div>
    )
  }

  // ── 100% — CEO War Room ────────────────────────────────────────────────────
  return (
    <div className="kpi kpi--warroom">
      <FilterBar
        filters={filters}
        onChange={handleFilterChange}
        loading={loading}
        selectedState={selectedState}
        onClearState={clearState}
      />

      <div className="kpi-scroll">
        <ExecStrip summary={summary} timeSeries={timeSeries} loading={loading} compact={false} />

        <div className="kpi-warroom-main">
          <div className="kpi-warroom-left">
            <UsaMap
              states={statePerf}
              selectedState={selectedState}
              onStateClick={handleStateClick}
              loading={loading}
            />
            <AcquisitionFunnel stages={funnel} loading={loading} />
          </div>
          <div className="kpi-warroom-right">
            <AlertsPanel alerts={alerts} loading={loading} />
            <SpendPanel spend={spend} loading={loading} />
          </div>
        </div>

        <TimeSeriesPanel timeSeries={timeSeries} loading={loading} />

        <div className="kpi-three-col">
          <StateLeaderboard
            states={statePerf}
            selectedState={selectedState}
            onSelect={handleStateClick}
            compact={false}
            loading={loading}
          />
          <MarketLeaderboard markets={marketPerf} compact={false} loading={loading} />
          <AgentLeaderboard agents={agentPerf} compact={false} loading={loading} />
        </div>

        <TemplateLeaderboard templates={templatePerf} compact={false} loading={loading} />

        <div className="kpi-two-col">
          <ChannelPerf channels={channelPerf} loading={loading} />
          <OfferContractPanel metrics={offerMetrics} loading={loading} />
        </div>

        <div className="kpi-two-col">
          <BuyerDemandPanel metrics={buyerMetrics} loading={loading} />
          <DataQualityPanel quality={dataQuality} loading={loading} />
        </div>

        <NumbersHealthPanel
          numbers={numberHealth}
          carriers={carrierPerf}
          compact={false}
          loading={loading}
        />
      </div>
    </div>
  )
}
