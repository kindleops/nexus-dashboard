import { useCallback, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../shared/icons'
import type {
  InboxAdvancedFilters,
  InboxStageSelectValue,
  InboxViewSelectValue,
} from '../inbox-ui-helpers'
import { stageOptions, viewOptions } from '../inbox-ui-helpers'
import type { AdvancedFilterOptions } from './InboxSidebar'

interface AdvancedFiltersPopoverProps {
  open: boolean
  stageFilter: InboxStageSelectValue
  setStageFilter: (filter: InboxStageSelectValue) => void
  viewFilter: InboxViewSelectValue
  setViewFilter: (filter: InboxViewSelectValue) => void
  advancedFilters: InboxAdvancedFilters
  onAdvancedFiltersChange: (patch: Partial<InboxAdvancedFilters>) => void
  advancedFilterOptions: AdvancedFilterOptions
  viewCounts: Record<string, number | null | undefined>
  onReset: () => void
  onClose: () => void
  onApply?: () => void
}

const numberInput = (value: number | undefined): string => (value === undefined ? '' : String(value))

const asNumber = (value: string): number | undefined => {
  if (!value.trim()) return undefined
  const num = Number(value)
  return Number.isFinite(num) ? num : undefined
}

const selectOptions = (options: string[]) => (
  <>
    <option value="">Any</option>
    {options.map((option) => (
      <option key={option} value={option}>{option}</option>
    ))}
  </>
)

const FilterGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="nx-filter-group">
    <header>{title}</header>
    <div>{children}</div>
  </section>
)

export const AdvancedFiltersPopover = ({
  open,
  stageFilter,
  setStageFilter,
  viewFilter,
  setViewFilter,
  advancedFilters,
  onAdvancedFiltersChange,
  advancedFilterOptions,
  viewCounts,
  onReset,
  onClose,
  onApply,
}: AdvancedFiltersPopoverProps) => {
  const DEV = Boolean(import.meta.env.DEV)
  const patch = useCallback((next: Partial<InboxAdvancedFilters>) => {
    onAdvancedFiltersChange(next)
  }, [onAdvancedFiltersChange])

  useEffect(() => {
    if (open && DEV) {
      console.log(`[NexusPopover]`, { name: 'AdvancedFilters', action: 'open', open: true })
    }
  }, [open, DEV])

  const handleClose = useCallback(() => {
    if (DEV) console.log(`[NexusPopover]`, { name: 'AdvancedFilters', action: 'close', open: false })
    onClose()
  }, [onClose, DEV])

  if (!open) return null

  return createPortal(
    <div className="nx-filter-overlay" role="presentation" onMouseDown={handleClose}>
      <section
        className="nx-filter-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Advanced filters"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="nx-filter-modal__header">
          <div>
            <span>Command Filters</span>
            <strong>Advanced Filters</strong>
          </div>
          <button type="button" onClick={handleClose} aria-label="Close advanced filters">
            <Icon name="close" />
          </button>
        </header>

        <div className="nx-filter-modal__body">
          <FilterGroup title="Stage / Status">
            <label>
              <span>Stage</span>
              <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value as InboxStageSelectValue)}>
                {stageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span>Status / View</span>
              <select value={viewFilter} onChange={(event) => setViewFilter(event.target.value as InboxViewSelectValue)}>
                {viewOptions.map((option) => {
                  const c = viewCounts[option.value]
                  const label = c === null || c === undefined ? '—' : String(c)
                  return (
                    <option key={option.value} value={option.value}>{option.label} ({label})</option>
                  )
                })}
              </select>
            </label>
          </FilterGroup>

          <FilterGroup title="Market / State / Zip">
            <label><span>Market</span><select value={advancedFilters.market ?? ''} onChange={(event) => patch({ market: event.target.value || undefined })}>{selectOptions(advancedFilterOptions.markets)}</select></label>
            <label><span>State</span><select value={advancedFilters.state ?? ''} onChange={(event) => patch({ state: event.target.value || undefined })}>{selectOptions(advancedFilterOptions.states)}</select></label>
            <label><span>Zip</span><select value={advancedFilters.zip ?? ''} onChange={(event) => patch({ zip: event.target.value || undefined })}>{selectOptions(advancedFilterOptions.zips)}</select></label>
          </FilterGroup>

          <FilterGroup title="Property Type / Units">
            <label><span>Property Type</span><select value={advancedFilters.propertyType ?? ''} onChange={(event) => patch({ propertyType: event.target.value || undefined })}>{selectOptions(advancedFilterOptions.propertyTypes)}</select></label>
            <label><span>Beds Min</span><input type="number" value={numberInput(advancedFilters.bedsMin)} onChange={(event) => patch({ bedsMin: asNumber(event.target.value) })} /></label>
            <label><span>Baths Min</span><input type="number" value={numberInput(advancedFilters.bathsMin)} onChange={(event) => patch({ bathsMin: asNumber(event.target.value) })} /></label>
          </FilterGroup>

          <FilterGroup title="Value / Equity / Repair Cost / Cash Offer">
            <label><span>Estimated Value Min</span><input type="number" value={numberInput(advancedFilters.estimatedValueMin)} onChange={(event) => patch({ estimatedValueMin: asNumber(event.target.value) })} /></label>
            <label><span>Estimated Value Max</span><input type="number" value={numberInput(advancedFilters.estimatedValueMax)} onChange={(event) => patch({ estimatedValueMax: asNumber(event.target.value) })} /></label>
            <label><span>Repair Cost Min</span><input type="number" value={numberInput(advancedFilters.repairCostMin)} onChange={(event) => patch({ repairCostMin: asNumber(event.target.value) })} /></label>
            <label><span>Repair Cost Max</span><input type="number" value={numberInput(advancedFilters.repairCostMax)} onChange={(event) => patch({ repairCostMax: asNumber(event.target.value) })} /></label>
            <label><span>Cash Offer Min</span><input type="number" value={numberInput(advancedFilters.cashOfferMin)} onChange={(event) => patch({ cashOfferMin: asNumber(event.target.value) })} /></label>
            <label><span>Cash Offer Max</span><input type="number" value={numberInput(advancedFilters.cashOfferMax)} onChange={(event) => patch({ cashOfferMax: asNumber(event.target.value) })} /></label>
          </FilterGroup>

          <FilterGroup title="Seller Demographics">
            <label><span>Seller Age Min</span><input type="number" value={numberInput(advancedFilters.sellerAgeMin)} onChange={(event) => patch({ sellerAgeMin: asNumber(event.target.value) })} /></label>
            <label><span>Household Income Min</span><input type="number" value={numberInput(advancedFilters.householdIncomeMin)} onChange={(event) => patch({ householdIncomeMin: asNumber(event.target.value) })} /></label>
            <label><span>Household Income Max</span><input type="number" value={numberInput(advancedFilters.householdIncomeMax)} onChange={(event) => patch({ householdIncomeMax: asNumber(event.target.value) })} /></label>
            <label><span>Net Asset Value Min</span><input type="number" value={numberInput(advancedFilters.netAssetValueMin)} onChange={(event) => patch({ netAssetValueMin: asNumber(event.target.value) })} /></label>
            <label><span>Net Asset Value Max</span><input type="number" value={numberInput(advancedFilters.netAssetValueMax)} onChange={(event) => patch({ netAssetValueMax: asNumber(event.target.value) })} /></label>
          </FilterGroup>

          <FilterGroup title="Owner Type">
            <label><span>Owner Type</span><select value={advancedFilters.ownerType ?? ''} onChange={(event) => patch({ ownerType: event.target.value || undefined })}>{selectOptions(advancedFilterOptions.ownerTypes)}</select></label>
            <label><span>Occupancy</span><select value={advancedFilters.occupancy ?? ''} onChange={(event) => patch({ occupancy: event.target.value || undefined })}>{selectOptions(advancedFilterOptions.occupancies)}</select></label>
            <label>
              <span>Out Of State</span>
              <select value={advancedFilters.outOfStateOwner ?? 'all'} onChange={(event) => patch({ outOfStateOwner: event.target.value as InboxAdvancedFilters['outOfStateOwner'] })}>
                <option value="all">Any</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          </FilterGroup>

          <FilterGroup title="Contact Quality">
            <label><span>Best Contact Window</span><input value={advancedFilters.bestContactWindow ?? ''} onChange={(event) => patch({ bestContactWindow: event.target.value || undefined })} placeholder="Morning, Evening..." /></label>
            <label><span>Priority</span><select value={advancedFilters.priority ?? ''} onChange={(event) => patch({ priority: event.target.value || undefined })}><option value="">Any</option><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label>
          </FilterGroup>

          <FilterGroup title="AI Score / Motivation">
            <label><span>AI Score Min</span><input type="number" value={numberInput(advancedFilters.aiScoreMin)} onChange={(event) => patch({ aiScoreMin: asNumber(event.target.value) })} /></label>
            <label><span>Motivation Min</span><input type="number" value={numberInput(advancedFilters.motivationMin)} onChange={(event) => patch({ motivationMin: asNumber(event.target.value) })} /></label>
            <label><span>Persona</span><select value={advancedFilters.persona ?? ''} onChange={(event) => patch({ persona: event.target.value || undefined })}>{selectOptions(advancedFilterOptions.personas)}</select></label>
          </FilterGroup>

          <FilterGroup title="Language">
            <label><span>Language</span><select value={advancedFilters.language ?? ''} onChange={(event) => patch({ language: event.target.value || undefined })}>{selectOptions(advancedFilterOptions.languages)}</select></label>
          </FilterGroup>

          <FilterGroup title="Campaign / Number">
            <label><span>Assigned Agent</span><select value={advancedFilters.assignedAgent ?? ''} onChange={(event) => patch({ assignedAgent: event.target.value || undefined })}>{selectOptions(advancedFilterOptions.assignedAgents)}</select></label>
          </FilterGroup>

          <FilterGroup title="Date Range">
            <label><span>Activity From</span><input type="date" value={advancedFilters.activityDateFrom ?? ''} onChange={(event) => patch({ activityDateFrom: event.target.value || undefined })} /></label>
            <label><span>Activity To</span><input type="date" value={advancedFilters.activityDateTo ?? ''} onChange={(event) => patch({ activityDateTo: event.target.value || undefined })} /></label>
          </FilterGroup>
        </div>

        <footer className="nx-filter-modal__footer">
          <button 
            type="button" 
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onReset()
            }}
          >
            Reset
          </button>
          <div className="nx-filter-modal__footer-actions">
            <button 
              type="button" 
              disabled 
              title="Save View is not available yet"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              Save View
            </button>
            <button
              type="button"
              className="nx-primary-action"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onApply?.()
                handleClose()
              }}
            >
              Apply Filters
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body
  )
}
