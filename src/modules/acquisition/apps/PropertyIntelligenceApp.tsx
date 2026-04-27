import { useMemo, useState } from 'react'
import { pushRoutePath } from '../../../app/router'
import { Icon } from '../../../shared/icons'
import { AcquisitionAppShell } from '../components/AcquisitionAppShell'
import { ScoreBar, StatusPill } from '../components/AcquisitionComponents'
import { EmptyState } from '../components/AcquisitionComponents'
import { filterByMarket, currency } from '../helpers'
import type { AcquisitionWorkspaceModel, AcquisitionProperty } from '../acquisition.types'

interface PropertyIntelligenceAppProps {
  data: AcquisitionWorkspaceModel
}

const PropertyViews = [
  'High Motivation',
  'Offer Ready',
  'Needs Review',
  'High Equity',
  'Probate',
  'Tax Delinquent',
  'Absentee',
  'Multifamily',
  'Commercial',
  'All Properties',
]

const filterPropertiesByView = (properties: AcquisitionProperty[], view: string): AcquisitionProperty[] => {
  const normalized = view.toLowerCase()
  if (normalized === 'high motivation') return properties.filter((p) => p.aiScore >= 75)
  if (normalized === 'offer ready') return properties.filter((p) => p.offerStatus === 'Ready')
  if (normalized === 'needs review') return properties.filter((p) => p.offerStatus === 'Pending Review')
  if (normalized === 'high equity') return properties.filter((p) => p.equity > 100000)
  if (normalized === 'probate') return properties.filter((p) => p.probateFlag)
  if (normalized === 'tax delinquent') return properties.filter((p) => p.taxFlag)
  if (normalized === 'absentee') return properties.filter((p) => p.ownerName && !p.occupancy?.includes('Owner'))
  if (normalized === 'multifamily') return properties.filter((p) => p.propertyType.toLowerCase().includes('multifamily'))
  if (normalized === 'commercial') return properties.filter((p) => p.propertyType.toLowerCase().includes('commercial'))
  return properties
}

export const PropertyIntelligenceApp = ({ data }: PropertyIntelligenceAppProps) => {
  const [selectedMarket, setSelectedMarket] = useState<string>(data.marketOptions[0] ?? 'All Markets')
  const [search, setSearch] = useState('')
  const [activeView, setActiveView] = useState('All Properties')

  const filteredProperties = useMemo(() => {
    let results = filterByMarket(data.properties, selectedMarket)
    results = filterPropertiesByView(results, activeView)

    if (search.trim()) {
      const needle = search.toLowerCase()
      results = results.filter((property) =>
        [property.address, property.market, property.ownerName, property.propertyType, property.offerStatus].some(
          (text) => text?.toLowerCase().includes(needle),
        ),
      )
    }

    return results
  }, [data.properties, selectedMarket, activeView, search])

  return (
    <AcquisitionAppShell
      breadcrumb="Property Intelligence"
      appName="Property Intelligence"
      appDescription="Property review and underwriting entry point"
      appStatus={`${filteredProperties.length} properties`}
      marketOptions={data.marketOptions}
      selectedMarket={selectedMarket}
      onMarketChange={setSelectedMarket}
      search={search}
      onSearchChange={setSearch}
      actions={[
        {
          label: 'Bulk Review',
          icon: 'check-square',
          onClick: () => console.log('Bulk review'),
        },
      ]}
    >
      <div className="acq-app-body">
        <aside className="acq-filter-rail">
          <h3>Views</h3>
          <nav className="acq-view-nav">
            {PropertyViews.map((view) => (
              <button
                key={view}
                type="button"
                className={activeView === view ? 'is-active' : ''}
                onClick={() => {
                  setActiveView(view)
                  setSearch('')
                }}
              >
                {view}
              </button>
            ))}
          </nav>
        </aside>

        <main className="acq-app-main">
          {filteredProperties.length > 0 ? (
            <div className="acq-table-wrapper">
              <table className="acq-table">
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Type</th>
                    <th>Owner</th>
                    <th>Market</th>
                    <th>Value</th>
                    <th>Equity</th>
                    <th>AI Score</th>
                    <th>Status</th>
                    <th className="acq-col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProperties.map((property) => (
                    <tr key={property.id} className="acq-table-row">
                      <td className="acq-col-name">
                        <strong>{property.address}</strong>
                        {(property.taxFlag || property.probateFlag || property.foreclosureFlag) && (
                          <div className="acq-property-flags">
                            {property.taxFlag && <span className="acq-flag is-tax">Tax</span>}
                            {property.probateFlag && <span className="acq-flag is-probate">Probate</span>}
                            {property.foreclosureFlag && <span className="acq-flag is-foreclosure">Foreclosure</span>}
                          </div>
                        )}
                      </td>
                      <td>
                        <small>{property.propertyType}</small>
                      </td>
                      <td>
                        <small>{property.ownerName}</small>
                      </td>
                      <td>{property.market}</td>
                      <td className="acq-col-number">{currency(property.value)}</td>
                      <td className="acq-col-number">{currency(property.equity)}</td>
                      <td className="acq-col-score">
                        <ScoreBar value={property.aiScore} tone={property.aiScore >= 75 ? 'good' : property.aiScore <= 40 ? 'critical' : 'warn'} />
                      </td>
                      <td>
                        <StatusPill value={property.offerStatus} />
                      </td>
                      <td className="acq-col-actions">
                        <div className="acq-row-actions">
                          <button type="button" title="Open property" onClick={() => console.log('Open property')}>
                            <Icon name="arrow-up-right" />
                          </button>
                          <button type="button" title="View on map" onClick={() => pushRoutePath('/acquisition/map')}>
                            <Icon name="map" />
                          </button>
                          <button type="button" title="Underwrite" onClick={() => pushRoutePath('/acquisition/underwriting')}>
                            <Icon name="trending-up" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No properties found"
              detail="No properties match your search and filters. Try adjusting your market selection or view."
            />
          )}
        </main>
      </div>
    </AcquisitionAppShell>
  )
}
