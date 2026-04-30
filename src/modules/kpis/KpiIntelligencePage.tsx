import { Icon } from '../../shared/icons'
import './kpi-intelligence.css'

const metricCards = [
  'Sent Today',
  'Reply Rate',
  'Positive Interest',
  'Stops',
  'Not Interested',
  'Wrong Numbers',
  'Hostile/Legal',
  'Qualified Rate',
  'Offer Funnel',
  'Time To First Response',
]

const chartCards = [
  'Reply Rate Over Time',
  'Market Performance',
  'Number Performance',
  'Stage Distribution',
  'Auto Reply Outcomes',
  'Offer Funnel Metrics',
  'Agent / Persona Performance',
  'Queue Health',
]

const filters = [
  'Market',
  'Number / TextGrid number',
  'Property type',
  'Seller age',
  'Net income',
  'Owner type',
  'Zip',
  'Motivation score',
  'Status',
  'Persona',
  'Lead score',
  'Acquisition strategy',
  'Stage',
  'Campaign / session',
  'Date range',
]

export const KpiIntelligencePage = () => (
  <main className="nx-kpi-page">
    <header className="nx-kpi-page__header">
      <div>
        <span>NEXUS</span>
        <h1>NEXUS KPI Intelligence</h1>
      </div>
      <button type="button">
        <Icon name="filter" />
        Filters
      </button>
    </header>

    <section className="nx-kpi-filter-strip">
      {filters.map((filter) => (
        <button key={filter} type="button" className="nx-kpi-filter-chip">{filter}</button>
      ))}
    </section>

    <section className="nx-kpi-metric-grid">
      {metricCards.map((metric) => (
        <article key={metric} className="nx-kpi-metric-card">
          <span>{metric}</span>
          <strong>--</strong>
        </article>
      ))}
    </section>

    <section className="nx-kpi-chart-grid">
      {chartCards.map((chart) => (
        <article key={chart} className="nx-kpi-chart-card">
          <header>
            <span>{chart}</span>
            <Icon name="stats" />
          </header>
          <div className="nx-kpi-chart-placeholder" />
        </article>
      ))}
    </section>
  </main>
)
