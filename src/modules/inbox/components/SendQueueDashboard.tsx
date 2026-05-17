import { useState, useMemo } from 'react'
import type { QueueItem, QueueModel } from '../../../lib/data/queueData'
import type { QueueCommandMode } from './QueueCommandCenter'
import type { QueueProcessorHealth } from '../../../lib/data/inboxData'
import '../send-queue-dashboard.css'

// ── Helpers ────────────────────────────────────────────────────────────────

const relTime = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const truncate = (s: string, max: number) =>
  s.length > max ? s.slice(0, max) + '…' : s

// ── Pipeline stage config ──────────────────────────────────────────────────

type StageTone = 'blue' | 'cyan' | 'green' | 'amber' | 'red' | 'muted'

interface PipelineStage {
  key: string
  label: string
  statuses: string[]
  tone: StageTone
}

const PIPELINE_STAGES: PipelineStage[] = [
  { key: 'approval',  label: 'Candidate', statuses: ['approval'],              tone: 'muted' },
  { key: 'queued',    label: 'Queued',    statuses: ['queued'],                tone: 'muted' },
  { key: 'scheduled', label: 'Scheduled', statuses: ['scheduled'],             tone: 'blue'  },
  { key: 'ready',     label: 'Ready',     statuses: ['ready'],                 tone: 'cyan'  },
  { key: 'sending',   label: 'Sending',   statuses: ['sending'],               tone: 'blue'  },
  { key: 'sent',      label: 'Sent',      statuses: ['sent'],                  tone: 'blue'  },
  { key: 'delivered', label: 'Delivered', statuses: ['delivered'],             tone: 'green' },
  { key: 'replied',   label: 'Replied',   statuses: ['replied_before_send'],   tone: 'green' },
]

// ── Failure group config ───────────────────────────────────────────────────

type FailureGroupKey =
  | 'Carrier' | 'Compliance' | 'Routing' | 'Template'
  | 'Webhook' | 'Contact Window' | 'Duplicate' | 'Payload' | 'Unknown'

type FailureSeverity = 'red' | 'amber' | 'muted'

const FAILURE_META: Record<FailureGroupKey, { severity: FailureSeverity; desc: string }> = {
  Carrier:          { severity: 'red',   desc: 'TextGrid carrier rejection or delivery error.' },
  Compliance:       { severity: 'red',   desc: 'DNC conflict, opt-out, or suppression match.' },
  Routing:          { severity: 'red',   desc: 'No valid sender found for this market.' },
  Template:         { severity: 'amber', desc: 'Missing template, blank body, or variable error.' },
  Webhook:          { severity: 'amber', desc: 'TextGrid webhook error or callback failure.' },
  'Contact Window': { severity: 'amber', desc: 'Send outside allowed contact hours.' },
  Duplicate:        { severity: 'muted', desc: 'Duplicate row or active conversation conflict.' },
  Payload:          { severity: 'muted', desc: 'Sync error, missing payload field, or data issue.' },
  Unknown:          { severity: 'muted', desc: 'Uncategorized or unclassified failure.' },
}

const failureSeverity = (group: string | null): FailureSeverity =>
  FAILURE_META[group as FailureGroupKey]?.severity ?? 'muted'

// ── Main component ─────────────────────────────────────────────────────────

interface SendQueueDashboardProps {
  queueModel: QueueModel | null
  processorHealth: QueueProcessorHealth | null
  queueCommandMode: QueueCommandMode
  onSelectItem?: (linkedThreadId: string) => void
}

export function SendQueueDashboard({
  queueModel,
  processorHealth,
  queueCommandMode,
  onSelectItem,
}: SendQueueDashboardProps) {
  const [searchQuery, setSearchQuery]     = useState('')
  const [statusFilter, setStatusFilter]   = useState<string>('all')
  const [marketFilter, setMarketFilter]   = useState<string>('all')
  const [failureFilter, setFailureFilter] = useState<string | null>(null)

  const items = useMemo(() => queueModel?.items ?? [], [queueModel])

  // ── Pipeline counts ─────────────────────────────────────────────────────

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of PIPELINE_STAGES) counts[s.key] = 0
    for (const item of items) {
      for (const s of PIPELINE_STAGES) {
        if (s.statuses.includes(item.status)) { counts[s.key]++; break }
      }
    }
    return counts
  }, [items])

  // ── Health metrics ──────────────────────────────────────────────────────

  const healthMetrics = useMemo(() => {
    const failedToday       = processorHealth?.failedTodayCount    ?? queueModel?.failedCount ?? 0
    const routingBlocked    = processorHealth?.routingBlockedCount  ?? 0
    const suppressionBlocked = processorHealth?.suppressionBlockedCount ?? 0
    const blankBody         = processorHealth?.blankBodyBlockedCount ?? 0
    const needsReview       = queueModel?.approvalCount ?? 0
    const webhookHealthy    = processorHealth?.webhookHealthy ?? true
    return { failedToday, routingBlocked, suppressionBlocked, blankBody, needsReview, webhookHealthy }
  }, [processorHealth, queueModel])

  // ── Failure taxonomy ────────────────────────────────────────────────────

  const failureTaxonomy = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) {
      if (item.status === 'failed' || item.status === 'retry' || item.status === 'blocked') {
        const g = item.failureGroup ?? 'Unknown'
        counts.set(g, (counts.get(g) ?? 0) + 1)
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([group, count]) => ({
        group,
        count,
        meta: FAILURE_META[group as FailureGroupKey] ?? { severity: 'muted' as const, desc: 'Unknown failure type.' },
      }))
  }, [items])

  const totalFailed = failureTaxonomy.reduce((s, f) => s + f.count, 0)
  const maxFailCount = failureTaxonomy[0]?.count ?? 1

  // ── Market load ─────────────────────────────────────────────────────────

  const marketLoad = useMemo(() => {
    const map = new Map<string, { scheduled: number; ready: number; sent: number; failed: number; blocked: number; total: number }>()
    for (const item of items) {
      const m = item.market || 'Unknown'
      if (!map.has(m)) map.set(m, { scheduled: 0, ready: 0, sent: 0, failed: 0, blocked: 0, total: 0 })
      const e = map.get(m)!
      e.total++
      if (item.status === 'scheduled')                         e.scheduled++
      else if (item.status === 'ready')                        e.ready++
      else if (item.status === 'sent' || item.status === 'delivered') e.sent++
      else if (item.status === 'failed' || item.status === 'retry')   e.failed++
      else if (item.status === 'blocked' || item.status === 'held')   e.blocked++
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 12)
      .map(([market, c]) => ({ market, ...c }))
  }, [items])

  // ── Routing coverage ────────────────────────────────────────────────────

  const routingCoverage = useMemo(() => {
    const marketSenders  = new Map<string, Set<string>>()
    const marketBlocked  = new Map<string, number>()
    const tierCounts     = { tier1: 0, tier2: 0, tier3: 0 }

    for (const item of items) {
      const m = item.market || 'Unknown'
      if (!marketSenders.has(m)) marketSenders.set(m, new Set())
      if (item.textgridNumber) marketSenders.get(m)!.add(item.textgridNumber)

      if (item.failureGroup === 'Routing')
        marketBlocked.set(m, (marketBlocked.get(m) ?? 0) + 1)

      const rr = (item.routingReason ?? '').toLowerCase()
      if (rr.includes('tier 1') || rr.includes('exact'))   tierCounts.tier1++
      else if (rr.includes('tier 2') || rr.includes('state'))  tierCounts.tier2++
      else if (rr.includes('tier 3') || rr.includes('cluster')) tierCounts.tier3++
    }

    const routingTotal        = tierCounts.tier1 + tierCounts.tier2 + tierCounts.tier3
    const marketsWithSenders  = Array.from(marketSenders.values()).filter(s => s.size > 0).length
    const marketsBlocked      = marketBlocked.size
    const routingBlockedTotal = Array.from(marketBlocked.values()).reduce((a, b) => a + b, 0)
    const tier1Pct = routingTotal ? Math.round((tierCounts.tier1 / routingTotal) * 100) : 0
    const tier2Pct = routingTotal ? Math.round((tierCounts.tier2 / routingTotal) * 100) : 0
    const tier3Pct = routingTotal ? Math.round((tierCounts.tier3 / routingTotal) * 100) : 0

    const sendersByMarket = Array.from(marketSenders.entries())
      .map(([market, senders]) => ({
        market, senderCount: senders.size,
        blocked: marketBlocked.get(market) ?? 0,
      }))
      .sort((a, b) => b.senderCount - a.senderCount)
      .slice(0, 8)

    return { marketsWithSenders, marketsBlocked, routingBlockedTotal, tier1Pct, tier2Pct, tier3Pct, sendersByMarket }
  }, [items])

  // ── Routing blocked rows from processor health ──────────────────────────

  const routingBlockedRows = processorHealth?.routingBlockedRows ?? []

  // ── Template coverage ───────────────────────────────────────────────────

  const templateCoverage = useMemo(() => {
    const counts          = new Map<string, number>()
    const failedByTpl     = new Map<string, number>()
    let missingTemplate   = 0
    let blankBody         = 0

    for (const item of items) {
      const name = item.templateName || 'No Template'
      counts.set(name, (counts.get(name) ?? 0) + 1)
      if (!item.templateName || item.templateName === 'Template not attached') missingTemplate++
      if (!item.messageText) blankBody++
      if (item.failureGroup === 'Template')
        failedByTpl.set(name, (failedByTpl.get(name) ?? 0) + 1)
    }

    const topTemplates = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([name, count]) => ({ name, count, failCount: failedByTpl.get(name) ?? 0 }))

    return { topTemplates, missingTemplate, blankBody }
  }, [items])

  // ── Row inspector filters ───────────────────────────────────────────────

  const allMarkets = useMemo(() => {
    const s = new Set(items.map(i => i.market || 'Unknown'))
    return Array.from(s).sort()
  }, [items])

  const filteredRows = useMemo((): QueueItem[] => {
    let result = items
    if (statusFilter !== 'all') {
      const stage = PIPELINE_STAGES.find(s => s.key === statusFilter)
      result = stage
        ? result.filter(i => stage.statuses.includes(i.status))
        : result.filter(i => i.status === statusFilter || (statusFilter === 'failed' && i.status === 'retry'))
    }
    if (marketFilter !== 'all')
      result = result.filter(i => (i.market || 'Unknown') === marketFilter)
    if (failureFilter)
      result = result.filter(i => i.failureGroup === failureFilter)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(i =>
        i.sellerName.toLowerCase().includes(q) ||
        i.propertyAddress.toLowerCase().includes(q) ||
        i.market.toLowerCase().includes(q) ||
        i.templateName.toLowerCase().includes(q) ||
        i.phone.includes(q),
      )
    }
    return result.slice(0, 60)
  }, [items, statusFilter, marketFilter, failureFilter, searchQuery])

  const hasFilters = statusFilter !== 'all' || marketFilter !== 'all' || !!failureFilter || !!searchQuery.trim()
  const clearFilters = () => { setStatusFilter('all'); setMarketFilter('all'); setFailureFilter(null); setSearchQuery('') }

  // ── Render ──────────────────────────────────────────────────────────────

  const health         = processorHealth?.status ?? 'unknown'
  const healthTone     = health === 'healthy' ? 'green' : health === 'warning' ? 'amber' : health === 'critical' ? 'red' : 'muted'
  const modeTone       = queueCommandMode === 'live' ? 'green' : queueCommandMode === 'safe' ? 'blue' : 'muted'
  const modeLabel      = queueCommandMode === 'live' ? 'Live Autopilot' : queueCommandMode === 'safe' ? 'Safe Autopilot' : 'Off'
  const totalItems     = items.length
  const isLoading      = !queueModel

  return (
    <div className="sqd">

      {/* ── Queue Flow Pipeline ──────────────────────────────────────────── */}
      <div className="sqd-pipeline">
        <div className="sqd-pipeline__inner">
          {PIPELINE_STAGES.map((stage, i) => {
            const count     = stageCounts[stage.key] ?? 0
            const isActive  = statusFilter === stage.key
            return (
              <div key={stage.key} className="sqd-pipeline__step">
                <button
                  type="button"
                  className={`sqd-stage is-${stage.tone}${isActive ? ' is-active' : ''}${count === 0 ? ' is-zero' : ''}`}
                  onClick={() => setStatusFilter(p => p === stage.key ? 'all' : stage.key)}
                  title={`Filter by ${stage.label}`}
                >
                  <span className="sqd-stage__count">{count.toLocaleString()}</span>
                  <span className="sqd-stage__label">{stage.label}</span>
                </button>
                {i < PIPELINE_STAGES.length - 1 && <span className="sqd-pipeline__arrow">›</span>}
              </div>
            )
          })}
        </div>
        <div className="sqd-pipeline__footer">
          {isLoading
            ? <span className="sqd-pipeline__loading"><span className="sqd-spinner sqd-spinner--sm" />Loading queue data…</span>
            : <span>{totalItems.toLocaleString()} rows loaded</span>
          }
          {processorHealth?.checkedAt && (
            <span className="sqd-pipeline__checked">Last checked {relTime(processorHealth.checkedAt)}</span>
          )}
        </div>
      </div>

      {/* ── Health Summary Row ───────────────────────────────────────────── */}
      <div className="sqd-health-row">
        <div className={`sqd-hcard sqd-hcard--status is-${healthTone}`}>
          <div className={`sqd-hcard__dot is-${healthTone}`} />
          <span className="sqd-hcard__label">Queue Health</span>
          <strong className="sqd-hcard__value">
            {health === 'healthy' ? 'Healthy' : health === 'warning' ? 'Warning' : health === 'critical' ? 'Critical' : 'Unknown'}
          </strong>
        </div>

        <div className={`sqd-hcard is-${modeTone}`}>
          <span className="sqd-hcard__label">System Mode</span>
          <strong className="sqd-hcard__value">{modeLabel}</strong>
        </div>

        <div className="sqd-hcard">
          <span className="sqd-hcard__label">Ready to Send</span>
          <strong className={`sqd-hcard__value${(queueModel?.readyCount ?? 0) > 0 ? ' is-cyan' : ''}`}>{queueModel?.readyCount ?? '—'}</strong>
        </div>

        <div className="sqd-hcard">
          <span className="sqd-hcard__label">Scheduled</span>
          <strong className="sqd-hcard__value is-blue">{queueModel?.scheduledCount ?? '—'}</strong>
        </div>

        <div className="sqd-hcard">
          <span className="sqd-hcard__label">Sent Today</span>
          <strong className={`sqd-hcard__value${(queueModel?.sentTodayCount ?? 0) > 0 ? ' is-green' : ''}`}>{queueModel?.sentTodayCount ?? '—'}</strong>
        </div>

        <div className="sqd-hcard">
          <span className="sqd-hcard__label">Delivered Today</span>
          <strong className={`sqd-hcard__value${(queueModel?.deliveredTodayCount ?? 0) > 0 ? ' is-green' : ''}`}>{queueModel?.deliveredTodayCount ?? '—'}</strong>
        </div>

        <div className="sqd-hcard">
          <span className="sqd-hcard__label">Failed Today</span>
          <strong className={`sqd-hcard__value${healthMetrics.failedToday > 0 ? ' is-red' : ''}`}>{healthMetrics.failedToday}</strong>
        </div>

        <div className="sqd-hcard">
          <span className="sqd-hcard__label">Routing Blocked</span>
          <strong className={`sqd-hcard__value${healthMetrics.routingBlocked > 0 ? ' is-amber' : ''}`}>{healthMetrics.routingBlocked}</strong>
        </div>

        <div className="sqd-hcard">
          <span className="sqd-hcard__label">Needs Review</span>
          <strong className={`sqd-hcard__value${healthMetrics.needsReview > 0 ? ' is-amber' : ''}`}>{healthMetrics.needsReview}</strong>
        </div>

        <div className="sqd-hcard">
          <span className="sqd-hcard__label">Webhook</span>
          <strong className={`sqd-hcard__value${healthMetrics.webhookHealthy ? ' is-green' : ' is-red'}`}>
            {healthMetrics.webhookHealthy ? 'OK' : 'Error'}
          </strong>
        </div>
      </div>

      {/* ── Diagnostic Panels ────────────────────────────────────────────── */}
      <div className="sqd-diag-row">

        {/* Failure Taxonomy */}
        <div className="sqd-panel">
          <div className="sqd-panel__head">
            <span className="sqd-panel__eyebrow">Failure Taxonomy</span>
            {totalFailed > 0 && <span className="sqd-panel__count">{totalFailed} total</span>}
            {failureFilter && (
              <button type="button" className="sqd-clear-chip" onClick={() => setFailureFilter(null)}>
                {failureFilter} ×
              </button>
            )}
          </div>
          {failureTaxonomy.length === 0 ? (
            <div className="sqd-empty">
              <span className="sqd-empty__icon">✓</span>
              <span>No failures in current window</span>
            </div>
          ) : (
            <div className="sqd-failure-list">
              {failureTaxonomy.map(({ group, count, meta }) => (
                <button
                  key={group}
                  type="button"
                  className={`sqd-failure-row is-${meta.severity}${failureFilter === group ? ' is-active' : ''}`}
                  onClick={() => setFailureFilter(p => p === group ? null : group)}
                >
                  <div className="sqd-failure-row__left">
                    <span className={`sqd-failure-row__dot is-${meta.severity}`} />
                    <span className="sqd-failure-row__name">{group}</span>
                  </div>
                  <div className="sqd-failure-row__bar-wrap">
                    <div
                      className={`sqd-failure-row__bar is-${meta.severity}`}
                      style={{ width: `${Math.max(4, (count / maxFailCount) * 100)}%` }}
                    />
                  </div>
                  <span className="sqd-failure-row__count">{count}</span>
                  <p className="sqd-failure-row__desc">{meta.desc}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Routing Coverage */}
        <div className="sqd-panel">
          <div className="sqd-panel__head">
            <span className="sqd-panel__eyebrow">Routing Coverage</span>
          </div>

          <div className="sqd-rmetrics">
            <div className="sqd-rmetric">
              <span className="sqd-rmetric__label">Markets w/ Senders</span>
              <strong className="sqd-rmetric__val is-green">{routingCoverage.marketsWithSenders}</strong>
            </div>
            <div className="sqd-rmetric">
              <span className="sqd-rmetric__label">Markets Blocked</span>
              <strong className={`sqd-rmetric__val${routingCoverage.marketsBlocked > 0 ? ' is-red' : ''}`}>{routingCoverage.marketsBlocked}</strong>
            </div>
            <div className="sqd-rmetric">
              <span className="sqd-rmetric__label">Routing Blocked Rows</span>
              <strong className={`sqd-rmetric__val${routingCoverage.routingBlockedTotal > 0 ? ' is-amber' : ''}`}>{routingCoverage.routingBlockedTotal}</strong>
            </div>
          </div>

          <div className="sqd-tier-bars">
            {[
              { label: 'Tier 1 Exact Match', pct: routingCoverage.tier1Pct, tone: 'green' },
              { label: 'Tier 2 State Fallback', pct: routingCoverage.tier2Pct, tone: 'blue' },
              { label: 'Tier 3 Cluster', pct: routingCoverage.tier3Pct, tone: 'amber' },
            ].map(({ label, pct, tone }) => (
              <div key={label} className="sqd-tier-bar">
                <span className="sqd-tier-bar__label">{label}</span>
                <div className="sqd-tier-bar__track">
                  <div className={`sqd-tier-bar__fill is-${tone}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="sqd-tier-bar__pct">{pct}%</span>
              </div>
            ))}
          </div>

          {routingCoverage.sendersByMarket.length > 0 && (
            <div className="sqd-sender-table">
              {routingCoverage.sendersByMarket.map(({ market, senderCount, blocked }) => (
                <div key={market} className="sqd-sender-row">
                  <span className="sqd-sender-row__market">{market}</span>
                  <span className="sqd-sender-row__senders">{senderCount} sender{senderCount !== 1 ? 's' : ''}</span>
                  {blocked > 0 && <span className="sqd-sender-row__blocked">{blocked} blocked</span>}
                </div>
              ))}
            </div>
          )}

          {routingBlockedRows.length > 0 && (
            <div className="sqd-routing-blocked">
              <div className="sqd-routing-blocked__head">Blocked Rows</div>
              {routingBlockedRows.slice(0, 4).map(row => (
                <div key={row.id} className="sqd-routing-blocked__row">
                  <span>{truncate(row.sellerName, 18)}</span>
                  <span className="sqd-routing-blocked__market">{row.market}</span>
                  <span className="sqd-routing-blocked__reason">{truncate(row.reason, 22)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Template Coverage */}
        <div className="sqd-panel">
          <div className="sqd-panel__head">
            <span className="sqd-panel__eyebrow">Template Coverage</span>
          </div>

          <div className="sqd-rmetrics">
            <div className="sqd-rmetric">
              <span className="sqd-rmetric__label">Missing Template</span>
              <strong className={`sqd-rmetric__val${templateCoverage.missingTemplate > 0 ? ' is-amber' : ''}`}>
                {templateCoverage.missingTemplate}
              </strong>
            </div>
            <div className="sqd-rmetric">
              <span className="sqd-rmetric__label">Blank Body</span>
              <strong className={`sqd-rmetric__val${templateCoverage.blankBody > 0 ? ' is-red' : ''}`}>
                {templateCoverage.blankBody}
              </strong>
            </div>
          </div>

          <div className="sqd-template-list">
            {templateCoverage.topTemplates.map(({ name, count, failCount }) => {
              const maxCount = templateCoverage.topTemplates[0]?.count ?? 1
              return (
                <div key={name} className="sqd-template-row">
                  <span className="sqd-template-row__name" title={name}>{truncate(name, 26)}</span>
                  <div className="sqd-template-row__bar-wrap">
                    <div
                      className="sqd-template-row__bar"
                      style={{ width: `${Math.max(4, (count / maxCount) * 100)}%` }}
                    />
                  </div>
                  <span className="sqd-template-row__count">{count}</span>
                  {failCount > 0 && <span className="sqd-template-row__fail">{failCount} fail</span>}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Market Load ──────────────────────────────────────────────────── */}
      <div className="sqd-section">
        <div className="sqd-section__head">
          <span className="sqd-section-eyebrow">Market Load</span>
          {marketFilter !== 'all' && (
            <button type="button" className="sqd-clear-chip" onClick={() => setMarketFilter('all')}>
              {marketFilter} ×
            </button>
          )}
        </div>
        <div className="sqd-market-grid">
          {marketLoad.map(({ market, scheduled, ready, sent, failed, blocked, total }) => (
            <button
              key={market}
              type="button"
              className={`sqd-market-card${marketFilter === market ? ' is-active' : ''}`}
              onClick={() => setMarketFilter(p => p === market ? 'all' : market)}
            >
              <span className="sqd-market-card__name">{market}</span>
              <div className="sqd-market-card__stats">
                {ready > 0     && <span className="is-cyan">{ready} ready</span>}
                {scheduled > 0 && <span className="is-blue">{scheduled} sched</span>}
                {sent > 0      && <span className="is-green">{sent} sent</span>}
                {failed > 0    && <span className="is-red">{failed} fail</span>}
                {blocked > 0   && <span className="is-amber">{blocked} blkd</span>}
              </div>
              <span className="sqd-market-card__total">{total}</span>
            </button>
          ))}
          {marketLoad.length === 0 && (
            <div className="sqd-empty" style={{ gridColumn: '1 / -1' }}>No market data available.</div>
          )}
        </div>
      </div>

      {/* ── Queue Row Inspector ──────────────────────────────────────────── */}
      <div className="sqd-section sqd-inspector">
        <div className="sqd-inspector__controls">
          <span className="sqd-section-eyebrow">Queue Row Inspector</span>
          <div className="sqd-inspector__filter-row">
            <input
              type="search"
              className="sqd-search"
              placeholder="Search seller, address, market, template…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            <select
              className="sqd-select"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="all">All Statuses</option>
              {PIPELINE_STAGES.map(s => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
              <option value="failed">Failed / Retry</option>
              <option value="held">Held</option>
              <option value="blocked">Blocked</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              className="sqd-select"
              value={marketFilter}
              onChange={e => setMarketFilter(e.target.value)}
            >
              <option value="all">All Markets</option>
              {allMarkets.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {hasFilters && (
              <button type="button" className="sqd-clear-btn" onClick={clearFilters}>
                Clear all
              </button>
            )}
          </div>
          <span className="sqd-inspector__count">
            {filteredRows.length.toLocaleString()} of {totalItems.toLocaleString()} rows
            {failureFilter && ` · ${failureFilter} failures`}
          </span>
        </div>

        <div className="sqd-table">
          <div className="sqd-table__head">
            <span>Seller / Property</span>
            <span>Market</span>
            <span>Status</span>
            <span>Template</span>
            <span>From</span>
            <span>To</span>
            <span>Scheduled</span>
            <span>Failure</span>
          </div>
          <div className="sqd-table__body">
            {filteredRows.map(item => (
              <button
                key={item.id}
                type="button"
                className={[
                  'sqd-table__row',
                  `sqd-table__row--${item.status}`,
                  item.linkedInboxThreadId && onSelectItem ? 'is-linked' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => item.linkedInboxThreadId && onSelectItem?.(item.linkedInboxThreadId)}
                title={item.linkedInboxThreadId ? 'Click to open thread' : undefined}
              >
                <div className="sqd-cell sqd-cell--seller">
                  <strong>{truncate(item.sellerName, 20)}</strong>
                  <small>{truncate(item.propertyAddress, 24)}</small>
                </div>
                <span className="sqd-cell">{item.market || '—'}</span>
                <span className="sqd-cell">
                  <span className={`sqd-status-pill sqd-status-pill--${item.status}`}>{item.status.replace(/_/g, ' ')}</span>
                </span>
                <span className="sqd-cell sqd-cell--dim">{truncate(item.templateName || '—', 22)}</span>
                <span className="sqd-cell sqd-cell--mono">
                  {item.textgridNumber ? `…${item.textgridNumber.slice(-4)}` : '—'}
                </span>
                <span className="sqd-cell sqd-cell--mono">
                  {item.phone ? `…${item.phone.slice(-4)}` : '—'}
                </span>
                <span className="sqd-cell sqd-cell--time">{relTime(item.scheduledForLocal)}</span>
                <span className="sqd-cell">
                  {item.failureGroup ? (
                    <span className={`sqd-fail-pill is-${failureSeverity(item.failureGroup)}`}>
                      {item.failureGroup}
                    </span>
                  ) : '—'}
                </span>
              </button>
            ))}
            {filteredRows.length === 0 && (
              <div className="sqd-table__empty">No rows match current filters.</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Command Center Link ──────────────────────────────────────────── */}
      <div className="sqd-cc-note">
        <span className="sqd-cc-note__icon">⌘</span>
        <span>Queue actions — Run Safe Batch, Retry Failed, Cancel Stale — live in the</span>
        <span className="sqd-cc-note__badge">Queue Command Center</span>
        <span>dropdown.</span>
      </div>
    </div>
  )
}
