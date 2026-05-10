import { useState, useEffect, useMemo } from 'react'
import { Icon, type IconName } from '../../../shared/icons'
import { fetchOperationalKpis, type OperationalKpi, type OperationalKpis } from '../../../lib/data/inboxKpis'

const cls = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

export const InboxKpiOrb = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const [kpis, setKpis] = useState<OperationalKpis | null>(null)
  const [timeWindow, setTimeWindow] = useState<OperationalKpi['timeWindow']>('24h')
  const [pinnedKpiId, setPinnedKpiId] = useState<string>(() => localStorage.getItem('nexus.pinnedInboxKpi') || 'reply-rate')

  useEffect(() => {
    const load = async () => {
      const data = await fetchOperationalKpis(timeWindow)
      setKpis(data)
    }
    load()
    const interval = setInterval(load, 60000) // Refresh every minute
    return () => clearInterval(interval)
  }, [timeWindow])

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
        className={cls('nx-kpi-orb', isPinned && 'is-pinned-active')}
        onClick={() => setIsPinned(!isPinned)}
      >
        <div className="nx-kpi-orb__glow" />
        <div className="nx-kpi-orb__inner">
          <Icon name="activity" />
          {pinnedKpi && (
            <span className="nx-kpi-orb__headline">
              {pinnedKpi.label} <strong>{pinnedKpi.value}{pinnedKpi.unit}</strong>
            </span>
          )}
        </div>
      </div>

      {/* Expanded Dashboard */}
      {(isOpen || isPinned) && (
        <div className="nx-orb-dashboard nx-liquid-popover">
          <header className="nx-orb-dashboard__header">
            <div className="nx-orb-dashboard__title">Operational Intelligence</div>
            <div className="nx-orb-dashboard__windows">
              {(['today', '24h', '7d', '30d'] as const).map(w => (
                <button 
                  key={w} 
                  className={cls('nx-orb-dashboard__window-btn', timeWindow === w && 'is-active')}
                  onClick={() => setTimeWindow(w)}
                >
                  {w.toUpperCase()}
                </button>
              ))}
            </div>
          </header>

          <div className="nx-orb-dashboard__content">
            <section className="nx-orb-dashboard__section">
              <label>Messaging Performance</label>
              <div className="nx-orb-dashboard__grid">
                {kpis?.messaging.map(renderKpiCard)}
              </div>
            </section>

            <section className="nx-orb-dashboard__section">
              <label>Pipeline & Financial</label>
              <div className="nx-orb-dashboard__grid">
                {[...(kpis?.pipeline || []), ...(kpis?.financial || [])].map(renderKpiCard)}
              </div>
            </section>
          </div>

          <footer className="nx-orb-dashboard__footer">
            <span>Last updated: {kpis?.lastUpdated ? new Date(kpis.lastUpdated).toLocaleTimeString() : '—'}</span>
            <div className="nx-orb-dashboard__hint">Click a metric to pin it to the orb</div>
          </footer>
        </div>
      )}
    </div>
  )
}
