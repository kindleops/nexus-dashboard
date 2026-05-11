import { useState, useMemo } from 'react'
import { Icon, type IconName } from '../../../shared/icons'
import { type OperationalKpi } from '../../../lib/data/inboxKpis'
import { useOperationalKpis } from '../../../lib/data/operationalKpis'
import { usePerformanceIntelligence, type TimeWindow } from '../../../lib/data/performanceIntelligence'

const cls = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

export const InboxKpiOrb = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const [timeWindow, setTimeWindow] = useState<OperationalKpi['timeWindow']>('24h')
  const [pinnedKpiId, setPinnedKpiId] = useState<string>(() => localStorage.getItem('nexus.pinnedInboxKpi') || 'reply-rate')

  const { kpis, isLive, recommendations } = useOperationalKpis(timeWindow)
  const { outliers, coverage } = usePerformanceIntelligence(timeWindow as TimeWindow)

  const allKpisList = useMemo(() => {
    if (!kpis) return []
    return [
      ...kpis.messaging,
      ...kpis.quality,
      ...kpis.automation,
      ...kpis.pipeline,
      ...kpis.financial
    ]
  }, [kpis])

  const pinnedKpi = useMemo(() => {
    return allKpisList.find(k => k.id === pinnedKpiId) || allKpisList[0]
  }, [allKpisList, pinnedKpiId])

  const handlePinKpi = (id: string) => {
    setPinnedKpiId(id)
    localStorage.setItem('nexus.pinnedInboxKpi', id)
  }

  const renderKpiCard = (kpi: OperationalKpi) => {
    let trendIcon: IconName | null = null
    if (kpi.trend === 'up') trendIcon = 'trending-up'
    if (kpi.trend === 'down') trendIcon = 'chevron-down'

    return (
      <div 
        key={kpi.id} 
        className={cls(
          'nx-orb-dashboard__card', 
          kpi.id === pinnedKpiId && 'is-pinned',
          !kpi.isAvailable && 'is-unavailable'
        )}
        onClick={() => kpi.isAvailable && handlePinKpi(kpi.id)}
      >
        <div className="nx-orb-dashboard__card-top">
          <span className="nx-orb-dashboard__card-label">{kpi.label}</span>
          {kpi.status && <div className={cls('nx-orb-dashboard__status-dot', `is-${kpi.status}`)} />}
        </div>
        <div className="nx-orb-dashboard__card-value">
          {kpi.value}{kpi.unit}
        </div>
        {trendIcon && (
          <div className={cls('nx-orb-dashboard__card-trend', `is-${kpi.trend}`)}>
            <Icon name={trendIcon} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div 
      className={cls('nx-kpi-orb-container', (isOpen || isPinned) && 'is-open')}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => !isPinned && setIsOpen(false)}
    >
      {/* The Orb / Capsule */}
      <div 
        className={cls(
          'nx-kpi-orb', 
          isPinned && 'is-pinned-active',
          isLive && 'is-live-pulsing'
        )}
        onClick={() => setIsPinned(!isPinned)}
      >
        <div className="nx-kpi-orb__glow" />
        <div className="nx-kpi-orb__inner">
          <div className={cls('nx-kpi-orb__icon-box', isLive && 'is-active')}>
            <Icon name={isLive ? 'zap' : 'activity'} />
          </div>
          {pinnedKpi && (
            <span className="nx-kpi-orb__headline">
              {pinnedKpi.label} <strong>{pinnedKpi.value}{pinnedKpi.unit}</strong>
            </span>
          )}
          {isLive && <div className="nx-kpi-orb__live-tag">LIVE</div>}
        </div>
      </div>

      {/* Expanded Dashboard */}
      {(isOpen || isPinned) && (
        <div className="nx-orb-dashboard nx-liquid-popover">
          <header className="nx-orb-dashboard__header">
            <div className="nx-orb-dashboard__title-stack">
              <div className="nx-orb-dashboard__title">Operational Intelligence</div>
              <div className="nx-orb-dashboard__subtitle">System Telemetry v2.0</div>
            </div>
            <div className="nx-orb-dashboard__windows">
              {(['today', '24h', '7d', '30d'] as const).map(w => (
                <button 
                  key={w} 
                  className={cls('nx-orb-dashboard__window-btn', timeWindow === w && 'is-active')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setTimeWindow(w)
                  }}
                >
                  {w.toUpperCase()}
                </button>
              ))}
            </div>
          </header>

          <div className="nx-orb-dashboard__content">
            <div className="nx-orb-dashboard__scroll-area">
              <section className="nx-orb-dashboard__section">
                <label>Messaging & Response</label>
                <div className="nx-orb-dashboard__grid">
                  {kpis?.messaging.map(renderKpiCard)}
                </div>
              </section>

              <section className="nx-orb-dashboard__section">
                <label>Automation & Quality</label>
                <div className="nx-orb-dashboard__grid">
                  {[...(kpis?.automation || []), ...(kpis?.quality || [])].map(renderKpiCard)}
                </div>
              </section>

              <section className="nx-orb-dashboard__section">
                <label>Pipeline & Financials</label>
                <div className="nx-orb-dashboard__grid">
                  {[...(kpis?.pipeline || []), ...(kpis?.financial || [])].map(renderKpiCard)}
                </div>
              </section>

              {/* Performance Intelligence Section */}
              <section className="nx-orb-dashboard__section">
                <label>Performance Outliers</label>
                <div className="nx-orb-dashboard__outliers">
                  {outliers?.bestTemplate && (
                    <div className="nx-outlier-card is-winner">
                      <div className="nx-outlier-card__header">
                        <Icon name="award" />
                        <span>Best Template</span>
                      </div>
                      <div className="nx-outlier-card__body">
                        <div className="nx-outlier-card__key">{outliers.bestTemplate.template_key}</div>
                        <div className="nx-outlier-card__stats">
                          {outliers.bestTemplate.positive_rate_pct.toFixed(1)}% pos rate • {outliers.bestTemplate.sends} sends
                        </div>
                        <div className="nx-outlier-card__rec">Rec: Increase weight for similar leads.</div>
                      </div>
                    </div>
                  )}

                  {outliers?.riskiestTemplate && (
                    <div className="nx-outlier-card is-risky">
                      <div className="nx-outlier-card__header">
                        <Icon name="alert-triangle" />
                        <span>Riskiest Template</span>
                      </div>
                      <div className="nx-outlier-card__body">
                        <div className="nx-outlier-card__key">{outliers.riskiestTemplate.template_key}</div>
                        <div className="nx-outlier-card__stats">
                          {outliers.riskiestTemplate.opt_out_rate_pct.toFixed(1)}% opt-out rate
                        </div>
                        <div className="nx-outlier-card__rec">Rec: Rewrite or reduce volume.</div>
                      </div>
                    </div>
                  )}

                  {outliers?.bestNumber && (
                    <div className="nx-outlier-card is-healthy">
                      <div className="nx-outlier-card__header">
                        <Icon name="check-circle" />
                        <span>Best Number</span>
                      </div>
                      <div className="nx-outlier-card__body">
                        <div className="nx-outlier-card__key">{outliers.bestNumber.friendly_name || outliers.bestNumber.textgrid_number_key}</div>
                        <div className="nx-outlier-card__stats">
                          Score: {outliers.bestNumber.health_score.toFixed(0)} • {outliers.bestNumber.reply_rate_pct.toFixed(1)}% reply
                        </div>
                      </div>
                    </div>
                  )}

                  {coverage && (
                    <div className="nx-outlier-card is-coverage">
                      <div className="nx-outlier-card__header">
                        <Icon name="search" />
                        <span>Attribution Coverage</span>
                      </div>
                      <div className="nx-outlier-card__body">
                        <div className="nx-outlier-card__value">{coverage.coverage_pct.toFixed(1)}%</div>
                        <div className="nx-outlier-card__rec">Rec: Recover missing IDs from send_queue.</div>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* AI Recommendation Strip */}
            {recommendations.length > 0 && (
              <div className="nx-orb-dashboard__recs">
                <div className="nx-orb-dashboard__recs-header">
                  <Icon name="brain" />
                  <span>AI Recommendations</span>
                </div>
                <div className="nx-orb-dashboard__recs-list">
                  {recommendations.map((rec, i) => (
                    <div key={i} className="nx-orb-dashboard__rec-item">
                      {rec}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <footer className="nx-orb-dashboard__footer">
            <div className="nx-orb-dashboard__status">
              <div className="nx-orb-dashboard__status-indicator is-healthy" />
              <span>System Nominal</span>
            </div>
            <div className="nx-orb-dashboard__last-updated">
              {kpis?.lastUpdated ? `Sync: ${new Date(kpis.lastUpdated).toLocaleTimeString()}` : 'Connecting...'}
            </div>
          </footer>
        </div>
      )}
    </div>
  )
}
