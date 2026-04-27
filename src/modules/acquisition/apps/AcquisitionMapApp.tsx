import { useMemo, useState } from 'react'
import { Icon } from '../../../shared/icons'
import { AcquisitionAppShell } from '../components/AcquisitionAppShell'
import { EmptyState } from '../components/AcquisitionComponents'
import { filterByMarket } from '../helpers'
import type { AcquisitionWorkspaceModel } from '../acquisition.types'

interface AcquisitionMapAppProps {
  data: AcquisitionWorkspaceModel
}

const MapLayers = ['Lead Pulses', 'Heat Mode', 'Distress Layers', 'Equity Layers', 'Reply Clusters', 'Market Comparison']

export const AcquisitionMapApp = ({ data }: AcquisitionMapAppProps) => {
  const [selectedMarket, setSelectedMarket] = useState<string>(data.marketOptions[0] ?? 'All Markets')
  const [activeLayer, setActiveLayer] = useState('Lead Pulses')

  const filteredMapPoints = useMemo(
    () => filterByMarket(data.mapPoints, selectedMarket),
    [data.mapPoints, selectedMarket],
  )

  return (
    <AcquisitionAppShell
      breadcrumb="Acquisition Map"
      appName="Acquisition Map"
      appDescription="Spatial lead analysis and geographic clustering"
      appStatus={`${filteredMapPoints.length} market points`}
      marketOptions={data.marketOptions}
      selectedMarket={selectedMarket}
      onMarketChange={setSelectedMarket}
    >
      <div className="acq-app-body acq-map-body">
        <aside className="acq-filter-rail acq-map-controls">
          <h3>Layers</h3>
          <nav className="acq-view-nav">
            {MapLayers.map((layer) => (
              <button
                key={layer}
                type="button"
                className={activeLayer === layer ? 'is-active' : ''}
                onClick={() => setActiveLayer(layer)}
              >
                <Icon name="layers" />
                {layer}
              </button>
            ))}
          </nav>

          <div className="acq-map-stats">
            <h4>Market Stats</h4>
            {filteredMapPoints.length > 0 ? (
              <div className="acq-stats-list">
                {filteredMapPoints.slice(0, 5).map((point) => (
                  <div key={point.id} className="acq-stat-item">
                    <span>{point.marketName}</span>
                    <span className="acq-stat-value">{point.leadPulse} leads</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="acq-empty-stat">No market data</p>
            )}
          </div>
        </aside>

        <main className="acq-app-main acq-map-main">
          {filteredMapPoints.length > 0 ? (
            <div className="acq-map-container">
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
                <div style={{ textAlign: 'center' }}>
                  <Icon name="map" style={{ width: '3rem', height: '3rem', opacity: 0.5, marginBottom: '1rem' }} />
                  <p>Map preview for {selectedMarket}</p>
                  <p style={{fontSize: '0.85rem', opacity: 0.6}}>{filteredMapPoints.length} market points available</p>
                </div>
              </div>
              <button type="button" className="acq-map-fullscreen" title="Fullscreen">
                <Icon name="maximize" />
              </button>
            </div>
          ) : (
            <EmptyState
              title="No map data available"
              detail="Select a different market or check data connectivity."
            />
          )}
        </main>
      </div>
    </AcquisitionAppShell>
  )
}
