import { useState, useEffect } from 'react'

export interface TemplateStat {
  template_id: string
  template_name: string
  use_case_slug: string
  stage_code: string
  language: string
  tone: string
  deal_strategy: string
  is_first_touch: boolean
  is_follow_up: boolean
  template_text: string
  active: boolean
  total_queued: number
  total_sent: number
  total_delivered: number
  total_failed: number
  total_reply_count: number
  unique_seller_replies: number
  positive_interest_count: number
  ownership_confirmed_count: number
  opt_out_count: number
  wrong_number_count: number
  hostile_or_legal_count: number
  stage_advanced_count: number
  offers_created_count: number
  contracts_created_count: number
  closed_won_count: number
  estimated_revenue: number
  overall_score: number
}

export const TemplateAnalytics = () => {
  const [stats, setStats] = useState<TemplateStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Filters
  const [dateRange, setDateRange] = useState('30d')
  const [market, setMarket] = useState('all')
  const [agentId] = useState('all')

  const fetchStats = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/internal/analytics/templates/ownership-check?start_date=${getStartDate(dateRange)}&market=${market === 'all' ? '' : market}&agent_id=${agentId === 'all' ? '' : agentId}`)
      const result = await response.json()
      if (result.success) {
        setStats(result.data)
      } else {
        setError(result.error || 'Failed to fetch template stats')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStats()
  }, [dateRange, market, agentId])

  const getStartDate = (range: string) => {
    const now = new Date()
    if (range === '7d') now.setDate(now.getDate() - 7)
    else if (range === '30d') now.setDate(now.getDate() - 30)
    else if (range === '90d') now.setDate(now.getDate() - 90)
    else return ''
    return now.toISOString()
  }

  if (loading && stats.length === 0) return <div className="nx-stats-loading">Loading Analytics...</div>
  if (error) return <div className="nx-stats-error">Error: {error}</div>

  return (
    <div className="nx-template-analytics">
      <header className="nx-stats-header">
        <div className="nx-stats-header__title">
          <p className="cc-eyebrow">SMS Strategy</p>
          <h1>Template Performance</h1>
        </div>
        <div className="nx-stats-filters">
          <select className="nx-stats-filter-select" value={market} onChange={(e) => setMarket(e.target.value)}>
            <option value="all">All Markets</option>
            <option value="Dallas">Dallas</option>
            <option value="Houston">Houston</option>
            <option value="Phoenix">Phoenix</option>
          </select>
          <select className="nx-stats-filter-select" value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
            <option value="all">All Time</option>
          </select>
        </div>
      </header>

      <section className="nx-kpi-grid">
        <div className="nx-kpi-card">
          <span className="nx-kpi-card__label">Best Reply Rate</span>
          <span className="nx-kpi-card__value">
            {stats.length > 0 ? `${Math.max(...stats.map(s => s.total_delivered > 0 ? (s.unique_seller_replies / s.total_delivered) * 100 : 0)).toFixed(1)}%` : '0%'}
          </span>
        </div>
        <div className="nx-kpi-card">
          <span className="nx-kpi-card__label">Top Progression</span>
          <span className="nx-kpi-card__value">
            {stats.length > 0 ? `${Math.max(...stats.map(s => s.unique_seller_replies > 0 ? (s.stage_advanced_count / s.unique_seller_replies) * 100 : 0)).toFixed(1)}%` : '0%'}
          </span>
        </div>
        <div className="nx-kpi-card">
          <span className="nx-kpi-card__label">Avg. Score</span>
          <span className="nx-kpi-card__value">
            {stats.length > 0 ? (stats.reduce((acc, s) => acc + Number(s.overall_score), 0) / stats.length).toFixed(1) : '0'}
          </span>
        </div>
        <div className="nx-kpi-card">
          <span className="nx-kpi-card__label">Revenue Generated</span>
          <span className="nx-kpi-card__value">
            ${(stats.reduce((acc, s) => acc + Number(s.estimated_revenue), 0) / 1000).toFixed(1)}k
          </span>
        </div>
      </section>

      <div className="nx-stats-table-container">
        <table className="nx-stats-table">
          <thead>
            <tr>
              <th>Template Variant</th>
              <th>Sent</th>
              <th>Reply %</th>
              <th>Pos %</th>
              <th>Prog %</th>
              <th>Opt-Out %</th>
              <th>Score</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {stats.map(template => (
              <tr key={template.template_id}>
                <td className="nx-td-template">
                  <div className="nx-template-info">
                    <span className="nx-template-name">{template.template_name || 'Unnamed Template'}</span>
                    <span className="nx-template-preview">{template.template_text?.slice(0, 40)}...</span>
                  </div>
                </td>
                <td>{template.total_sent}</td>
                <td>{template.total_delivered > 0 ? ((template.unique_seller_replies / template.total_delivered) * 100).toFixed(1) : 0}%</td>
                <td>{template.unique_seller_replies > 0 ? ((template.positive_interest_count / template.unique_seller_replies) * 100).toFixed(1) : 0}%</td>
                <td>{template.unique_seller_replies > 0 ? ((template.stage_advanced_count / template.unique_seller_replies) * 100).toFixed(1) : 0}%</td>
                <td className={template.total_delivered > 0 && (template.opt_out_count / template.total_delivered) > 0.05 ? 'text-danger' : ''}>
                  {template.total_delivered > 0 ? ((template.opt_out_count / template.total_delivered) * 100).toFixed(1) : 0}%
                </td>
                <td>
                  <div className="nx-score-pill" style={{ 
                    backgroundColor: `rgba(var(--score-rgb), ${Number(template.overall_score) / 100})`,
                    color: Number(template.overall_score) > 50 ? 'white' : 'inherit'
                  }}>
                    {Math.round(Number(template.overall_score))}
                  </div>
                </td>
                <td>
                  {Number(template.overall_score) > 75 ? (
                    <span className="nx-badge is-success">SCALE</span>
                  ) : Number(template.overall_score) > 40 ? (
                    <span className="nx-badge is-warning">TESTING</span>
                  ) : (
                    <span className="nx-badge is-danger">PAUSE</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
