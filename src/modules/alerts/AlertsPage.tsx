import { useState } from 'react'
import type { AlertsModel, AlertItem } from './alerts.adapter'
import { Icon } from '../../shared/icons'

const classes = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

const severityClass: Record<AlertItem['severity'], string> = {
  critical: 'is-critical',
  warning: 'is-warning',
  info: 'is-info',
}

export const AlertsPage = ({ data }: { data: AlertsModel }) => {
  const [filterSeverity, setFilterSeverity] = useState<string>('all')
  const [acknowledgedIds, setAcknowledgedIds] = useState<string[]>([])

  const filtered = data.alerts
    .filter((a) => filterSeverity === 'all' || a.severity === filterSeverity)
    .filter((a) => !acknowledgedIds.includes(a.id))

  return (
    <div className="nx-alerts">
      <header className="nx-surface-header">
        <div className="nx-surface-header__title">
          <Icon className="nx-surface-icon" name="alert" />
          <h1>Alerts</h1>
        </div>
        <div className="nx-surface-header__stats">
          <span className="nx-badge nx-badge--danger">{data.criticalCount} critical</span>
          <span className="nx-badge nx-badge--warning">{data.warningCount} warning</span>
          <span className="nx-badge nx-badge--muted">{data.infoCount} info</span>
        </div>
      </header>

      <div className="nx-alerts__filters">
        {['all', 'critical', 'warning', 'info'].map((sev) => (
          <button
            key={sev}
            type="button"
            className={classes('nx-filter-pill', filterSeverity === sev && 'is-active')}
            onClick={() => setFilterSeverity(sev)}
          >
            {sev === 'all' ? 'All Alerts' : sev.charAt(0).toUpperCase() + sev.slice(1)}
          </button>
        ))}
      </div>

      <div className="nx-alerts__grid">
        {filtered.map((alert) => (
          <article key={alert.id} className={classes('nx-alert-card', severityClass[alert.severity])}>
            <div className="nx-alert-card__header">
              <div className="nx-alert-card__meta">
                <span className={classes('nx-severity-badge', severityClass[alert.severity])}>
                  {alert.priority}
                </span>
                <span className="nx-alert-card__market">{alert.marketLabel}</span>
                <span className="nx-alert-card__time">{alert.timestampLabel}</span>
              </div>
              <button
                className="nx-inline-button"
                type="button"
                onClick={() => setAcknowledgedIds((ids) => [...ids, alert.id])}
              >
                Acknowledge
              </button>
            </div>
            <h3 className="nx-alert-card__title">{alert.title}</h3>
            <p className="nx-alert-card__detail">{alert.detail}</p>
            <div className="nx-alert-card__footer">
              <span className="nx-alert-card__metric">
                {alert.metricLabel}: <strong>{alert.metricValue}</strong>
              </span>
            </div>
          </article>
        ))}
        {filtered.length === 0 && (
          <div className="nx-empty-state">
            <Icon className="nx-empty-icon" name="check" />
            <p>All clear — no active alerts.</p>
          </div>
        )}
      </div>

      <section className="nx-alerts__affected">
        <h3>Affected Markets</h3>
        <div className="nx-tag-row">
          {data.affectedMarkets.map((market) => (
            <span key={market} className="nx-tag">{market}</span>
          ))}
        </div>
      </section>
    </div>
  )
}
