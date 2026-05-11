import { useState, useEffect, useCallback } from 'react'
import { Icon } from '../../shared/icons'
import './kpi-intelligence.css'
import { 
  fetchPerformanceOverview, 
  fetchPerformanceOutliers, 
  fetchAttributionCoverage
} from '../../lib/data/performanceIntelligence'
import type {
  PerformanceFilters,
  TemplatePerformance,
  NumberPerformance,
  MarketPerformance,
  PropertyTypePerformance,
  SellerSignalPerformance,
  StagePerformance,
  Outlier,
  PerformanceTrend
} from '../../lib/data/performanceIntelligence'

export const KpiIntelligencePage = () => {
  const [filters, setFilters] = useState<PerformanceFilters>({ time_window: '7d' })
  const [isLoading, setIsLoading] = useState(true)
  
  const [overview, setOverview] = useState<any>(null)
  const [outliers, setOutliers] = useState<Outlier[]>([])
  const [coverage, setCoverage] = useState<any>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [ov, out, cov] = await Promise.all([
        fetchPerformanceOverview(filters),
        fetchPerformanceOutliers(),
        fetchAttributionCoverage()
      ])
      setOverview(ov)
      setOutliers(out)
      setCoverage(cov)
    } catch (err) {
      console.error('Failed to load performance data', err)
    } finally {
      setIsLoading(false)
    }
  }, [filters])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleFilterChange = (key: keyof PerformanceFilters, value: any) => {
    setFilters(prev => {
      const next = { ...prev, [key]: value }
      if (!value) delete next[key]
      return next
    })
  }

  const clearFilters = () => {
    setFilters({ time_window: filters.time_window })
  }

  const activeFilterCount = Object.keys(filters).length - 1 // minus time_window

  const renderBadge = (label: string) => {
    return <span className={`nx-kpi-badge ${label}`}>{label.replace('_', ' ')}</span>
  }

  const renderSkeleton = (width = '100%', height = '24px') => (
    <div className="nx-kpi-skeleton" style={{ width, height }} />
  )

  const TrendChart = ({ data, metricKey, color, label }: { data: PerformanceTrend[], metricKey: keyof PerformanceTrend, color: string, label: string }) => {
    if (!data || data.length === 0) return <div className="nx-kpi-empty-state">No trend data</div>
    const max = Math.max(...data.map(d => Number(d[metricKey]) || 0), 1)
    
    return (
      <div className="nx-kpi-chart-card">
        <h4>{label}</h4>
        <div className="nx-kpi-chart-wrapper">
          {data.map((d, i) => {
            const val = Number(d[metricKey]) || 0;
            const pct = (val / max) * 100;
            return (
              <div 
                key={i} 
                className="nx-kpi-chart-bar-container" 
                data-tooltip={`${d.trend_date}: ${val.toFixed(val % 1 !== 0 ? 1 : 0)}`}
              >
                <div 
                  className="nx-kpi-chart-bar" 
                  style={{ height: `${pct}%`, backgroundColor: color }} 
                />
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const isFilterUnsupported = (panelType: string) => {
    // If a filter is applied that the panel's view doesn't support, we show it's disabled/unsupported.
    // Panel Types: 'template', 'market', 'number', 'property_type', 'seller_signal', 'property_signal', 'stage', 'touch'
    const hasUnsupported = Object.keys(filters).some(key => {
      if (key === 'time_window') return false;
      if (panelType === 'number' && key === 'market') return false; // number view supports market
      return key !== panelType && key !== `${panelType}_key` && key !== 'podio_tags'; // approximate check
    });
    return hasUnsupported;
  }

  return (
    <main className="nx-kpi-page">
      <header className="nx-kpi-page__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div>
            <span>NEXUS</span>
            <h1>Performance Intelligence Command Center</h1>
          </div>
          {coverage && (
            <div className="nx-kpi-status-pulse">
              System Live • Attribution: {coverage.coverage_pct.toFixed(1)}%
            </div>
          )}
        </div>
        <div className="nx-kpi-controls">
          <select 
            className="nx-kpi-btn" 
            value={filters.time_window} 
            onChange={e => handleFilterChange('time_window', e.target.value)}
            style={{ backgroundColor: 'transparent' }}
          >
            <option value="today">Today</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="all_time">All Time</option>
          </select>
          <button type="button" className="nx-kpi-btn" onClick={loadData}>
            <Icon name="refresh-cw" />
          </button>
        </div>
      </header>

      {/* FILTER STRIP */}
      <section className="nx-kpi-filter-strip">
        <span style={{ fontSize: '12px', color: '#64748b', marginRight: '8px', alignSelf: 'center' }}>
          Filters {activeFilterCount > 0 && `(${activeFilterCount})`}:
        </span>
        <select 
          className="nx-kpi-filter-chip"
          value={filters.market || ''}
          onChange={e => handleFilterChange('market', e.target.value)}
        >
          <option value="">All Markets</option>
          <option value="DFW">DFW</option>
          <option value="HOU">HOU</option>
          <option value="ATL">ATL</option>
          <option value="MIA">MIA</option>
        </select>
        
        <select 
          className="nx-kpi-filter-chip"
          value={filters.property_type || ''}
          onChange={e => handleFilterChange('property_type', e.target.value)}
        >
          <option value="">All Property Types</option>
          <option value="SFR">SFR</option>
          <option value="Multifamily">Multifamily</option>
          <option value="Land">Land</option>
          <option value="Commercial">Commercial</option>
        </select>

        <select 
          className="nx-kpi-filter-chip"
          value={filters.stage || ''}
          onChange={e => handleFilterChange('stage', e.target.value)}
        >
          <option value="">All Stages</option>
          <option value="prospecting">Prospecting</option>
          <option value="negotiation">Negotiation</option>
          <option value="underwriting">Underwriting</option>
          <option value="contract">Contract</option>
        </select>

        <input 
          className="nx-kpi-filter-chip"
          placeholder="Template Key..."
          value={filters.template_key || ''}
          onChange={e => handleFilterChange('template_key', e.target.value)}
          style={{ width: '120px' }}
        />

        {activeFilterCount > 0 && (
          <button className="nx-kpi-filter-chip active" onClick={clearFilters}>
            Clear All
          </button>
        )}
      </section>

      {/* Executive KPI Cards Grid */}
      <section className="nx-kpi-metric-grid">
        <article className="nx-kpi-metric-card">
          <span>Total Sends</span>
          <strong>{isLoading ? renderSkeleton('80px', '32px') : overview?.sends.toLocaleString()}</strong>
        </article>
        <article className="nx-kpi-metric-card">
          <span>Delivery Rate</span>
          <strong>{isLoading ? renderSkeleton('80px', '32px') : `${overview?.delivery_rate_pct.toFixed(1)}%`}</strong>
        </article>
        <article className="nx-kpi-metric-card">
          <span>Reply Rate</span>
          <strong>{isLoading ? renderSkeleton('80px', '32px') : `${overview?.reply_rate_pct.toFixed(1)}%`}</strong>
        </article>
        <article className="nx-kpi-metric-card">
          <span>Positive Rate</span>
          <strong>{isLoading ? renderSkeleton('80px', '32px') : `${overview?.positive_rate_pct.toFixed(1)}%`}</strong>
          <div className="nx-kpi-metric-trend positive">Strong Intent</div>
        </article>
        <article className="nx-kpi-metric-card">
          <span>Opt-Out Rate</span>
          <strong>{isLoading ? renderSkeleton('80px', '32px') : `${overview?.opt_out_rate_pct.toFixed(1)}%`}</strong>
          <div className="nx-kpi-metric-trend negative">Risk Indicator</div>
        </article>
        <article className="nx-kpi-metric-card">
          <span>Failure Rate</span>
          <strong>{isLoading ? renderSkeleton('80px', '32px') : `${overview?.failure_rate_pct.toFixed(1)}%`}</strong>
        </article>
      </section>

      {/* AI Recommendations */}
      <section className="nx-kpi-recommendations">
        <h3><Icon name="cpu" /> Deterministic AI Recommendations</h3>
        <div className="nx-kpi-recommendation-list">
          {isLoading ? (
            <>
              {renderSkeleton('100%', '48px')}
              {renderSkeleton('100%', '48px')}
            </>
          ) : outliers.length > 0 ? (
            outliers.map((o, idx) => {
              if (o.outlier_type === 'riskiest_template') {
                return <div key={idx} className="nx-kpi-rec-item"><strong>Template Risk:</strong> Template {o.key} has elevated opt-outs ({o.score.toFixed(1)}%). Reduce send weight immediately and rewrite.</div>
              }
              if (o.outlier_type === 'best_template') {
                return <div key={idx} className="nx-kpi-rec-item"><strong>Template Winner:</strong> Template {o.key} has strong positive intent ({o.score.toFixed(1)}%). Increase usage for matching profiles.</div>
              }
              if (o.outlier_type === 'best_market') {
                return <div key={idx} className="nx-kpi-rec-item"><strong>Market Winner:</strong> Market {o.key} is outperforming baselines. Shift volume budget here.</div>
              }
              return null;
            })
          ) : (
            <div className="nx-kpi-empty-state">No significant action items detected. Metrics are stable.</div>
          )}
        </div>
      </section>

      <div className="nx-kpi-panels">
        {/* Template Intelligence */}
        <section className="nx-kpi-panel">
          <header className="nx-kpi-panel-header">
            <h3>Template Intelligence</h3>
            {isFilterUnsupported('template') && <span style={{fontSize: '11px', color: '#f59e0b'}}>Filters Unsupported</span>}
          </header>
          <div className="nx-kpi-panel-content">
            <table className="nx-kpi-table">
              <thead>
                <tr>
                  <th>Template</th>
                  <th>Sends</th>
                  <th>Reply %</th>
                  <th>Pos %</th>
                  <th>Opt-Out %</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6}>{renderSkeleton()}</td></tr>
                ) : overview?.templates.slice(0, 8).map((t: TemplatePerformance) => (
                  <tr key={t.template_key}>
                    <td>{t.template_key}</td>
                    <td>{t.sends}</td>
                    <td>{t.reply_rate_pct.toFixed(1)}%</td>
                    <td style={{ color: '#10b981' }}>{t.positive_rate_pct.toFixed(1)}%</td>
                    <td style={{ color: t.opt_out_rate_pct > 3 ? '#ef4444' : 'inherit' }}>{t.opt_out_rate_pct.toFixed(1)}%</td>
                    <td>{renderBadge(t.performance_label)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Number Intelligence */}
        <section className="nx-kpi-panel">
          <header className="nx-kpi-panel-header">
            <h3>Number / Routing Intelligence</h3>
            {isFilterUnsupported('number') && <span style={{fontSize: '11px', color: '#f59e0b'}}>Filters Unsupported</span>}
          </header>
          <div className="nx-kpi-panel-content">
            <table className="nx-kpi-table">
              <thead>
                <tr>
                  <th>Number Key</th>
                  <th>Market</th>
                  <th>Sends</th>
                  <th>Delivery %</th>
                  <th>Fail %</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6}>{renderSkeleton()}</td></tr>
                ) : overview?.numbers.slice(0, 8).map((n: NumberPerformance) => (
                  <tr key={n.textgrid_number_key}>
                    <td>{n.textgrid_number_key}</td>
                    <td>{n.market || '-'}</td>
                    <td>{n.sends}</td>
                    <td>{n.delivery_rate_pct.toFixed(1)}%</td>
                    <td style={{ color: n.failure_rate_pct > 10 ? '#ef4444' : 'inherit' }}>{n.failure_rate_pct.toFixed(1)}%</td>
                    <td>{renderBadge(n.performance_label)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Market Intelligence */}
        <section className="nx-kpi-panel">
          <header className="nx-kpi-panel-header">
            <h3>Market Intelligence</h3>
            {isFilterUnsupported('market') && <span style={{fontSize: '11px', color: '#f59e0b'}}>Filters Unsupported</span>}
          </header>
          <div className="nx-kpi-panel-content">
            <table className="nx-kpi-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Sends</th>
                  <th>Reply %</th>
                  <th>Pos %</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={5}>{renderSkeleton()}</td></tr>
                ) : overview?.markets.map((m: MarketPerformance) => (
                  <tr key={m.market}>
                    <td>{m.market}</td>
                    <td>{m.sends}</td>
                    <td>{m.reply_rate_pct.toFixed(1)}%</td>
                    <td style={{ color: '#10b981' }}>{m.positive_rate_pct.toFixed(1)}%</td>
                    <td>{renderBadge(m.performance_label)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Property Type Intelligence */}
        <section className="nx-kpi-panel">
          <header className="nx-kpi-panel-header">
            <h3>Property Type Intelligence</h3>
            {isFilterUnsupported('property_type') && <span style={{fontSize: '11px', color: '#f59e0b'}}>Filters Unsupported</span>}
          </header>
          <div className="nx-kpi-panel-content">
            <table className="nx-kpi-table">
              <thead>
                <tr>
                  <th>Property Type</th>
                  <th>Sends</th>
                  <th>Reply %</th>
                  <th>Pos %</th>
                  <th>Opt-Out %</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={5}>{renderSkeleton()}</td></tr>
                ) : overview?.propertyTypes.map((pt: PropertyTypePerformance) => (
                  <tr key={pt.property_type}>
                    <td>{pt.property_type || 'Unknown'}</td>
                    <td>{pt.sends}</td>
                    <td>{pt.reply_rate_pct.toFixed(1)}%</td>
                    <td style={{ color: '#10b981' }}>{pt.positive_rate_pct.toFixed(1)}%</td>
                    <td>{pt.opt_out_rate_pct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Seller Signal Intelligence */}
        <section className="nx-kpi-panel">
          <header className="nx-kpi-panel-header">
            <h3>Seller Signal Intelligence</h3>
          </header>
          <div className="nx-kpi-panel-content">
            <table className="nx-kpi-table">
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Freq</th>
                  <th>Pos %</th>
                  <th>Avg Response (h)</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={4}>{renderSkeleton()}</td></tr>
                ) : overview?.sellerSignals.map((s: SellerSignalPerformance) => (
                  <tr key={s.seller_signal}>
                    <td>{s.seller_signal}</td>
                    <td>{s.sends}</td>
                    <td style={{ color: '#10b981' }}>{s.positive_rate_pct.toFixed(1)}%</td>
                    <td>{s.avg_response_hours?.toFixed(1) || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Stage Intelligence */}
        <section className="nx-kpi-panel">
          <header className="nx-kpi-panel-header">
            <h3>Stage & Touch Intelligence</h3>
          </header>
          <div className="nx-kpi-panel-content">
            <table className="nx-kpi-table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Touch #</th>
                  <th>Sends</th>
                  <th>Reply %</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={4}>{renderSkeleton()}</td></tr>
                ) : overview?.stages.map((s: StagePerformance, i: number) => {
                  const touch = overview?.touches[i]
                  return (
                  <tr key={s.current_stage || i}>
                    <td>{s.current_stage || 'Unknown'}</td>
                    <td>{touch?.touch_number || '-'}</td>
                    <td>{s.sends}</td>
                    <td>{s.reply_rate_pct.toFixed(1)}%</td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        </section>

        {/* Property Signal Intelligence */}
        <section className="nx-kpi-panel">
          <header className="nx-kpi-panel-header">
            <h3>Property Signal Intelligence</h3>
            {isFilterUnsupported('property_signal') && <span style={{fontSize: '11px', color: '#f59e0b'}}>Filters Unsupported</span>}
          </header>
          <div className="nx-kpi-panel-content">
            <table className="nx-kpi-table">
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Freq</th>
                  <th>Reply %</th>
                  <th>Pos %</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={4}>{renderSkeleton()}</td></tr>
                ) : overview?.propertySignals?.map((s: any) => (
                  <tr key={s.podio_tags}>
                    <td>{s.podio_tags}</td>
                    <td>{s.sends}</td>
                    <td>{(s.reply_rate_pct || 0).toFixed(1)}%</td>
                    <td style={{ color: '#10b981' }}>{(s.positive_rate_pct || 0).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Outlier Radar */}
      <section className="nx-kpi-radar-section">
        <h3><Icon name="radar" /> Outlier Radar</h3>
        {isLoading ? (
           <div style={{width: '100%'}}>{renderSkeleton('100%', '40px')}</div>
        ) : outliers.map((o, idx) => (
          <div key={idx} style={{ 
            padding: '12px 16px', 
            background: 'rgba(0,0,0,0.3)', 
            borderRadius: '8px', 
            borderLeft: `4px solid ${o.performance_label === 'winner' ? '#10b981' : o.performance_label === 'risky' ? '#f59e0b' : '#ef4444'}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            minWidth: '240px',
            flex: 1
          }}>
            <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase' }}>{o.outlier_type.replace(/_/g, ' ')}</span>
            <span style={{ fontSize: '14px', fontWeight: 500, color: '#fff' }}>{o.key}</span>
            <span style={{ fontSize: '12px', color: o.performance_label === 'winner' ? '#10b981' : '#f59e0b' }}>
              Score: {o.score.toFixed(1)}
            </span>
          </div>
        ))}
        {!isLoading && outliers.length === 0 && (
          <div className="nx-kpi-empty-state">No outliers detected.</div>
        )}
      </section>

    </main>
  )
}
