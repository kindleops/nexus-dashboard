import { useState } from 'react'
import type { MarketsModel, ActiveMarket } from './markets.adapter'
import { Icon } from '../../shared/icons'
import { formatCompactNumber } from '../../shared/formatters'

const classes = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

const heatClass: Record<ActiveMarket['heat'], string> = {
  hot: 'is-hot',
  warm: 'is-warm',
  steady: 'is-steady',
}

export const MarketsPage = ({ data }: { data: MarketsModel }) => {
  const [selectedId, setSelectedId] = useState<string | null>(data.markets[0]?.id ?? null)
  const selected = data.markets.find((m) => m.id === selectedId) ?? null

  return (
    <div className="nx-markets">
      <header className="nx-surface-header">
        <div className="nx-surface-header__title">
          <Icon className="nx-surface-icon" name="map" />
          <h1>Active Markets</h1>
        </div>
        <div className="nx-surface-header__stats">
          <span className="nx-badge nx-badge--success">{data.totalPipeline} pipeline</span>
          <span className="nx-badge nx-badge--primary">{data.liveCount} live</span>
          {data.pausedCount > 0 && (
            <span className="nx-badge nx-badge--muted">{data.pausedCount} paused</span>
          )}
        </div>
      </header>

      <div className="nx-markets__body">
        <aside className="nx-markets__list">
          {data.markets.map((market) => (
            <button
              key={market.id}
              type="button"
              className={classes(
                'nx-market-row',
                selectedId === market.id && 'is-selected',
                market.campaignStatus === 'paused' && 'is-paused',
              )}
              onClick={() => setSelectedId(market.id)}
            >
              <div className="nx-market-row__top">
                <span className={classes('nx-heat-badge', heatClass[market.heat])}>
                  {market.heat.toUpperCase()}
                </span>
                <strong>{market.name}</strong>
                <span className={classes('nx-status-chip', `is-${market.campaignStatus}`)}>
                  {market.campaignStatus.toUpperCase()}
                </span>
              </div>
              <div className="nx-market-row__stats">
                <span>{market.pipelineLabel}</span>
                <span>{formatCompactNumber(market.outboundToday)} sent</span>
                <span>{market.hotLeads} hot</span>
                <span>Health {market.healthScore}</span>
              </div>
            </button>
          ))}
        </aside>

        <main className="nx-markets__detail">
          {selected ? (
            <div className="nx-market-detail">
              <div className="nx-market-detail__hero">
                <h2>{selected.label}</h2>
                <span className="nx-market-detail__scan">{selected.scanLabel}</span>
                <span className="nx-market-detail__sweep">Last sweep {selected.lastSweepLabel}</span>
              </div>

              <div className="nx-market-detail__kpi-grid">
                <div className="nx-kpi-mini">
                  <span>Outbound</span>
                  <strong>{formatCompactNumber(selected.outboundToday)}</strong>
                </div>
                <div className="nx-kpi-mini">
                  <span>Replies</span>
                  <strong>{formatCompactNumber(selected.repliesToday)}</strong>
                </div>
                <div className="nx-kpi-mini">
                  <span>Hot Leads</span>
                  <strong>{selected.hotLeads}</strong>
                </div>
                <div className="nx-kpi-mini">
                  <span>Pipeline</span>
                  <strong>{selected.pipelineLabel}</strong>
                </div>
                <div className="nx-kpi-mini">
                  <span>Reply Rate</span>
                  <strong>{selected.replyLabel}</strong>
                </div>
                <div className="nx-kpi-mini">
                  <span>Opt-Out</span>
                  <strong>{selected.optOutRate}%</strong>
                </div>
                <div className="nx-kpi-mini">
                  <span>Health</span>
                  <strong>{selected.healthScore}</strong>
                </div>
                <div className="nx-kpi-mini">
                  <span>Capacity</span>
                  <strong>{selected.capacityStrain}%</strong>
                </div>
              </div>

              <section className="nx-market-detail__section">
                <h3>Operational Risk</h3>
                <div className={classes('nx-risk-indicator', `is-${selected.operationalRisk}`)}>
                  {selected.operationalRisk.toUpperCase()}
                </div>
                <div className="nx-capacity-bar">
                  <div
                    className="nx-capacity-bar__fill"
                    style={{ width: `${selected.capacityStrain}%` }}
                  />
                </div>
                <span className="nx-capacity-label">
                  {selected.capacityStrain}% capacity strain • {selected.alertCount} active alerts
                </span>
              </section>

              <section className="nx-market-detail__section">
                <h3>Top ZIP Codes</h3>
                <div className="nx-table-card">
                  <table className="nx-table">
                    <thead>
                      <tr>
                        <th>ZIP</th>
                        <th>Outbound</th>
                        <th>Trend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.topZips.map((z) => (
                        <tr key={z.zip}>
                          <td>{z.zip}</td>
                          <td>{formatCompactNumber(z.outbound)}</td>
                          <td>{z.trend}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <div className="nx-market-detail__footer">
                <span>{selected.leadCount} leads</span>
                <span>{selected.agentCount} agents</span>
                <span>{selected.activeProperties.toLocaleString()} properties</span>
              </div>
            </div>
          ) : (
            <div className="nx-empty-state nx-empty-state--large">
              <Icon className="nx-empty-icon" name="map" />
              <p>Select a market</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
