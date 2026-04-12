import { startTransition, useEffect, useMemo, useState } from 'react'
import { pushRoutePath, replaceRoutePath, useRoutePath } from './router'
import { resolveRoute } from './routes'
import { useCommandGrammar, type CommandBinding } from '../shared/command-grammar'
import { Icon } from '../shared/icons'

// ── Types ──────────────────────────────────────────────────────────────────

interface RouteLoadState {
  status: 'loading' | 'ready' | 'error'
  path: string
  data: unknown
  message: string
}

const initialState: RouteLoadState = {
  status: 'loading',
  path: '',
  data: null,
  message: '',
}

// ── Nav Items ──────────────────────────────────────────────────────────────

type NavIconName = 'radar' | 'inbox' | 'alert' | 'stats' | 'map' | 'users' | 'file-text' | 'settings' | 'bell' | 'star'

interface NavItem {
  path: string
  label: string
  icon: NavIconName
  shortcut: string
}

const navItems: NavItem[] = [
  { path: '/dashboard/live', label: 'Command Center', icon: 'radar', shortcut: 'g h' },
  { path: '/inbox', label: 'Inbox', icon: 'inbox', shortcut: 'g i' },
  { path: '/alerts', label: 'Alerts', icon: 'alert', shortcut: 'g a' },
  { path: '/stats', label: 'Intelligence', icon: 'stats', shortcut: 'g s' },
  { path: '/markets', label: 'Markets', icon: 'map', shortcut: 'g m' },
  { path: '/buyer', label: 'Buyers', icon: 'users', shortcut: 'g b' },
  { path: '/title', label: 'Title & Closing', icon: 'file-text', shortcut: 'g t' },
  { path: '/watchlists', label: 'Watchlists', icon: 'star', shortcut: 'g w' },
  { path: '/notifications', label: 'Notifications', icon: 'bell', shortcut: 'g n' },
  { path: '/settings', label: 'Settings', icon: 'settings', shortcut: 'g d' },
]

// ── Component ──────────────────────────────────────────────────────────────

export const CommandCenterApp = () => {
  const path = useRoutePath()
  const route = resolveRoute(path)
  const [routeState, setRouteState] = useState<RouteLoadState>({
    ...initialState,
    path: route.path,
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)

  // Command grammar bindings
  const bindings = useMemo<CommandBinding[]>(() => [
    ...navItems.map((item) => ({
      keys: item.shortcut,
      seq: item.shortcut.split(' '),
      label: item.label,
      category: 'Navigation',
      action: () => pushRoutePath(item.path),
    })),
    {
      keys: '?',
      seq: ['?'],
      label: 'Toggle keyboard hints',
      category: 'System',
      action: () => pushRoutePath('/settings'),
    },
  ], [])

  const grammarState = useCommandGrammar(bindings)

  useEffect(() => {
    document.title = route.title
  }, [route.title])

  useEffect(() => {
    let active = true

    route
      .loader()
      .then((data) => {
        if (!active) return

        startTransition(() => {
          setRouteState({ status: 'ready', path: route.path, data, message: '' })
        })
      })
      .catch((error: unknown) => {
        if (!active) return

        const message = error instanceof Error ? error.message : 'Unknown route loader error'
        setRouteState({ status: 'error', path: route.path, data: null, message })
      })

    return () => { active = false }
  }, [route])

  const isRouteLoading = routeState.path !== route.path || routeState.status === 'loading'

  // ── Loading State ──────────────────────────────────────────────────────

  if (isRouteLoading) {
    return (
      <main className="app-state">
        <div className="app-state__panel">
          <span className="app-state__eyebrow">NEXUS</span>
          <h1>Initializing command center</h1>
          <p>Loading live route intelligence for `{route.path}`.</p>
        </div>
      </main>
    )
  }

  // ── Error State ────────────────────────────────────────────────────────

  if (routeState.status === 'error') {
    return (
      <main className="app-state">
        <div className="app-state__panel">
          <span className="app-state__eyebrow">Route Error</span>
          <h1>Unable to load surface</h1>
          <p>{routeState.message}</p>
          <button
            className="app-state__button"
            type="button"
            onClick={() => replaceRoutePath('/dashboard/live')}
          >
            Retry live route
          </button>
        </div>
      </main>
    )
  }

  // ── Ready State ────────────────────────────────────────────────────────

  return (
    <div className="nx-os">
      {/* Sidebar */}
      <nav
        className={`nx-sidebar ${sidebarCollapsed ? 'nx-sidebar--collapsed' : ''}`}
        onMouseEnter={() => setSidebarCollapsed(false)}
        onMouseLeave={() => setSidebarCollapsed(true)}
      >
        <div className="nx-sidebar__brand">
          <span className="nx-sidebar__logo">N</span>
          {!sidebarCollapsed && <span className="nx-sidebar__title">NEXUS</span>}
        </div>

        <ul className="nx-sidebar__nav">
          {navItems.map((item) => {
            const isActive = route.path === item.path
            return (
              <li key={item.path}>
                <button
                  type="button"
                  className={`nx-sidebar__link ${isActive ? 'nx-sidebar__link--active' : ''}`}
                  onClick={() => pushRoutePath(item.path)}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <Icon name={item.icon} className="nx-sidebar__icon" />
                  {!sidebarCollapsed && (
                    <>
                      <span className="nx-sidebar__label">{item.label}</span>
                      <kbd className="nx-sidebar__shortcut">{item.shortcut}</kbd>
                    </>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Main content */}
      <main className="app-root">
        {route.render(routeState.data)}
      </main>

      {/* Grammar pending indicator */}
      {grammarState.pending && (
        <div className="nx-grammar-hint">
          <kbd>{grammarState.pending}</kbd>
          <span>waiting for next key…</span>
        </div>
      )}
    </div>
  )
}
