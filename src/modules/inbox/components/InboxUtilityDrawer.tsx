import type { InboxWorkflowThread } from '../../../lib/data/inboxWorkflowData'
import type { ThreadContext } from '../../../lib/data/inboxData'
import { Icon } from '../../../shared/icons'
import { getStatusVisual, statusStyleVars } from '../status-visuals'

const fallback = (value: unknown, placeholder = 'Unknown') => {
  const text = String(value ?? '').trim()
  return text || placeholder
}

export const MapDossierDrawer = ({
  mode,
  thread,
  context,
  full,
  onToggleFull,
  onClose,
}: {
  mode: 'map' | 'dossier'
  thread: InboxWorkflowThread | null
  context: ThreadContext | null
  full: boolean
  onToggleFull: () => void
  onClose: () => void
}) => {
  const title = mode === 'map' ? 'Map View' : 'Deal Dossier'
  const address = fallback(context?.property?.address || thread?.propertyAddress || thread?.subject, 'Property Unknown')
  const statusVisual = getStatusVisual(thread?.inboxStage, Boolean(thread?.isOptOut || thread?.inboxStatus === 'suppressed'))
  const record = (thread ?? {}) as Record<string, unknown>
  const propertyRecord = (context?.property ?? {}) as Record<string, unknown>
  const lat = record['latitude'] ?? record['lat'] ?? propertyRecord['latitude'] ?? propertyRecord['lat']
  const lng = record['longitude'] ?? record['lng'] ?? propertyRecord['longitude'] ?? propertyRecord['lng']
  const hasCoordinates = Boolean(lat && lng)

  return (
    <section className={full ? 'nx-view-drawer is-full' : 'nx-view-drawer'}>
      <header>
        <span>
          <Icon name={mode === 'map' ? 'map' : 'briefing'} />
          {title}
        </span>
        <div>
          <button type="button" onClick={onToggleFull} title={full ? 'Split view' : 'Full view'}>
            <Icon name={full ? 'layout-split' : 'maximize'} />
          </button>
          <button type="button" onClick={onClose} title="Close">
            <Icon name="close" />
          </button>
        </div>
      </header>

      {mode === 'map' ? (
        <div className="nx-map-placeholder">
          <div className="nx-map-grid">
            {hasCoordinates ? (
              <span className="nx-map-pin nx-status-dot" style={statusStyleVars(statusVisual)}>
                <Icon name="pin" />
              </span>
            ) : (
              <span className="nx-map-pin nx-map-pin--empty"><Icon name="pin" /></span>
            )}
          </div>
          <aside>
            <strong>{address}</strong>
            <span>{fallback(thread?.market || thread?.marketId, 'Market Unknown')}</span>
            <p>{hasCoordinates ? 'Selected lead pin is matched to the current status.' : 'No coordinates linked for this lead yet.'}</p>
          </aside>
        </div>
      ) : (
        <div className="nx-dossier-placeholder">
          {['Property', 'Prospect', 'Owner', 'Offer', 'History'].map((section) => (
            <article key={section}>
              <span>{section}</span>
              <strong>{section === 'Property' ? address : 'Pending enrichment'}</strong>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export const InboxUtilityDrawer = ({
  type,
  thread,
  onClose,
}: {
  type: 'ai' | 'keys'
  thread: InboxWorkflowThread | null
  onClose: () => void
}) => {
  const title = type === 'ai' ? 'AI Assistant' : 'Keyboard Shortcuts'
  const shortcuts = [
    ['[', 'Toggle left panel'],
    [']', 'Toggle right panel'],
    ['\\', 'Toggle dossier'],
    ['⌘M', 'Toggle map view'],
    ['⌘K', 'Global search'],
    ['⌘Enter', 'Send message'],
  ]

  return (
    <aside className="nx-utility-drawer">
      <header>
        <span>
          <Icon name={type === 'ai' ? 'brain' : 'key'} />
          {title}
        </span>
        <button type="button" onClick={onClose} title="Close">
          <Icon name="close" />
        </button>
      </header>

      {type === 'ai' ? (
        <div className="nx-ai-drawer-body">
          <p>{thread ? `Draft workspace for ${fallback(thread.ownerName, 'this seller')}.` : 'Select a thread to open AI drafting.'}</p>
          <button type="button" className="nx-primary-action" disabled={!thread}>
            <Icon name="spark" />
            Generate Draft
          </button>
        </div>
      ) : (
        <div className="nx-shortcut-list">
          {shortcuts.map(([key, label]) => (
            <div key={key}>
              <kbd>{key}</kbd>
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
