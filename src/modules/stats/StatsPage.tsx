import type { StatsModel, KPIMetric } from './stats.adapter'
import { Icon } from '../../shared/icons'

const classes = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

const changeIcon = (dir: KPIMetric['changeDirection']) =>
  dir === 'up' ? 'trending-up' : dir === 'down' ? 'trending-up' : null

export const StatsPage = ({ data }: { data: StatsModel }) => (
  <div className="nx-stats">
    <header className="nx-surface-header">
      <div className="nx-surface-header__title">
        <Icon className="nx-surface-icon" name="stats" />
        <h1>Intelligence Dashboard</h1>
      </div>
      <div className="nx-surface-header__stats">
        <span className="nx-badge nx-badge--success">{data.totalPipelineValue} pipeline</span>
        <span className="nx-badge nx-badge--primary">{data.totalOutbound} outbound</span>
      </div>
    </header>

    <section className="nx-stats__kpi-grid">
      {data.kpis.map((kpi) => (
        <article key={kpi.id} className={classes('nx-kpi-card', `is-${kpi.tone}`)}>
          <span className="nx-kpi-card__label">{kpi.label}</span>
          <strong className="nx-kpi-card__value">{kpi.value}</strong>
          <span className={classes('nx-kpi-card__change', `is-${kpi.changeDirection}`)}>
            {changeIcon(kpi.changeDirection) && (
              <Icon
                className={classes('nx-kpi-card__arrow', kpi.changeDirection === 'down' && 'is-inverted')}
                name="trending-up"
              />
            )}
            {kpi.change}
          </span>
        </article>
      ))}
    </section>

    <div className="nx-stats__split">
      <section className="nx-stats__rankings">
        <h2>Market Rankings</h2>
        <div className="nx-table-card">
          <table className="nx-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Market</th>
                <th>Pipeline</th>
                <th>Reply Rate</th>
                <th>Health</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.marketRankings.map((m) => (
                <tr key={m.id}>
                  <td className="nx-rank-cell">{m.rank}</td>
                  <td><strong>{m.name}</strong></td>
                  <td>{m.pipelineLabel}</td>
                  <td>{m.replyLabel}</td>
                  <td>{m.healthScore}</td>
                  <td>
                    <span className={classes('nx-status-chip', `is-${m.campaignStatus}`)}>
                      {m.campaignStatus.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="nx-stats__sidebar">
        <section className="nx-stats__autopilot">
          <h2>
            <Icon className="nx-section-icon" name="zap" />
            Autopilot
          </h2>
          <div className="nx-autopilot-summary">
            <div className="nx-autopilot-summary__row">
              <span>Engine Status</span>
              <span className={classes('nx-status-chip', `is-${data.autopilot.engineStatus}`)}>
                {data.autopilot.engineStatus.toUpperCase()}
              </span>
            </div>
            <div className="nx-autopilot-summary__row">
              <span>Total Actions</span>
              <strong>{data.autopilot.totalActions}</strong>
            </div>
            <div className="nx-autopilot-summary__row">
              <span>Pending Approval</span>
              <strong>{data.autopilot.pendingApproval}</strong>
            </div>
            <div className="nx-autopilot-summary__row">
              <span>Avg Confidence</span>
              <strong>{data.autopilot.confidenceAvg}%</strong>
            </div>
          </div>
        </section>

        <section className="nx-stats__nba">
          <h2>
            <Icon className="nx-section-icon" name="target" />
            Next Best Actions
          </h2>
          <div className="nx-nba-list">
            {data.nba.topActions.slice(0, 4).map((action) => (
              <div key={action.id} className={classes('nx-nba-item', `is-${action.impact}`)}>
                <div className="nx-nba-item__header">
                  <span className="nx-nba-item__urgency">{action.urgency}</span>
                  <span className={classes('nx-impact-badge', `is-${action.impact}`)}>
                    {action.impact.toUpperCase()}
                  </span>
                </div>
                <p className="nx-nba-item__action">{action.action}</p>
                <span className="nx-nba-item__confidence">{action.confidence}% confidence</span>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  </div>
)
