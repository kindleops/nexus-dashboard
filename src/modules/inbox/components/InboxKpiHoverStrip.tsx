import { useState } from 'react'
import { cls } from '../../../shared/utils'
import type { KpiData } from '../inbox-kpi-helpers'
import { Icon } from '../../../shared/icons'

interface InboxKpiHoverStripProps {
  kpis: KpiData[]
  activeViewKey: string
  onSelectKpi: (viewKey: string) => void
}

export const InboxKpiHoverStrip = ({ kpis, activeViewKey, onSelectKpi }: InboxKpiHoverStripProps) => {
  const [hoveredKpi, setHoveredKpi] = useState<string | null>(null)

  return (
    <div className="nx-kpi-hover-strip">
      {kpis.map((kpi) => {
        const isActive = activeViewKey === kpi.viewFilter
        const isHovered = hoveredKpi === kpi.id

        return (
          <div
            key={kpi.id}
            className={cls(
              'nx-kpi-card',
              isActive && 'is-active',
              kpi.count && Number(kpi.count) > 0 && 'has-data'
            )}
            onMouseEnter={() => setHoveredKpi(kpi.id)}
            onMouseLeave={() => setHoveredKpi(null)}
            onClick={() => onSelectKpi(kpi.viewFilter)}
          >
            <div className="nx-kpi-card__inner">
              <span className="nx-kpi-card__count">{kpi.count}</span>
              <span className="nx-kpi-card__label">{kpi.label}</span>
              {kpi.count && Number(kpi.count) > 0 && <div className="nx-kpi-card__pulse" />}
            </div>

            {isHovered && (
              <div className="nx-kpi-card__popover">
                <header>
                  <strong>{kpi.label} Intelligence</strong>
                </header>
                <div className="nx-kpi-card__popover-body">
                  {kpi.details?.map((detail, idx) => (
                    <div key={idx} className="nx-kpi-card__detail-row">
                      <span>{detail.label}</span>
                      <b>{detail.value}</b>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
