import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { pushRoutePath, replaceRoutePath, useRoutePath } from './router'
import { resolveRoute } from './routes'
import { useCommandGrammar, type CommandBinding } from '../shared/command-grammar'
import { Icon } from '../shared/icons'
import { AICopilot, type CopilotContext } from '../shared/AICopilot'
import { BriefingPanel, buildBriefingDigest, type BriefingDigest } from '../shared/BriefingPanel'
import { NotificationToasts, NotificationCenter, useNotificationCount } from '../shared/NotificationToast'
import { playSound } from '../shared/sounds'

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
  room: string
}

const navItems: NavItem[] = [
  { path: '/dashboard/live', label: 'Home', icon: 'radar', shortcut: 'H', room: 'Command Floor' },
  { path: '/inbox', label: 'Inbox', icon: 'inbox', shortcut: 'I', room: 'Comms Deck' },
  { path: '/alerts', label: 'Alerts', icon: 'alert', shortcut: 'A', room: 'Threat Board' },
  { path: '/stats', label: 'Intelligence', icon: 'stats', shortcut: 'G', room: 'Strategy Room' },
  { path: '/markets', label: 'Markets', icon: 'map', shortcut: 'M', room: 'Operations Room' },
  { path: '/buyer', label: 'Buyers', icon: 'users', shortcut: 'B', room: 'Capital Deployment' },
  { path: '/title', label: 'Title', icon: 'file-text', shortcut: 'T', room: 'Execution Room' },
  { path: '/watchlists', label: 'Watchlists', icon: 'star', shortcut: 'W', room: 'Tracked Targets' },
  { path: '/notifications', label: 'Notifications', icon: 'bell', shortcut: 'N', room: 'Event Stream' },
  { path: '/settings', label: 'Settings', icon: 'settings', shortcut: 'S', room: 'Control Layer' },
]

// ── Global Command Palette ─────────────────────────────────────────────────

interface GlobalCommand {
  id: string
  label: string
  hint?: string
  category: string
  action: () => void
}

// ── Component ──────────────────────────────────────────────────────────────

export const CommandCenterApp = () => {
  const path = useRoutePath()
  const route = resolveRoute(path)
  const [routeState, setRouteState] = useState<RouteLoadState>({
    ...initialState,
    path: route.path,
  })
  const [cmdOpen, setCmdOpen] = useState(false)
  const [cmdQuery, setCmdQuery] = useState('')
  const [cmdFocus, setCmdFocus] = useState(0)
  const cmdInputRef = useRef<HTMLInputElement>(null)

  // New Phase 4 systems
  const [copilotOpen, setCopilotOpen] = useState(false)
  const [briefingOpen, setBriefingOpen] = useState(false)
  const [briefingDigest, setBriefingDigest] = useState<BriefingDigest | null>(null)
  const [notifCenterOpen, setNotifCenterOpen] = useState(false)
  const notifCount = useNotificationCount()

  // Command grammar bindings — single-key navigation
  const bindings = useMemo<CommandBinding[]>(() => [
    ...navItems.map((item) => ({
      keys: item.shortcut,
      seq: [item.shortcut.toLowerCase()],
      label: item.label,
      category: 'Navigation',
      action: () => pushRoutePath(item.path),
    })),
  ], [])

  const grammarState = useCommandGrammar(bindings)

  // Global commands for palette
  const globalCommands = useMemo<GlobalCommand[]>(() => [
    ...navItems.map((item) => ({
      id: `go-${item.path}`,
      label: `Go to ${item.label}`,
      hint: item.shortcut,
      category: 'Navigation',
      action: () => pushRoutePath(item.path),
    })),
    { id: 'focus-dallas', label: 'Focus Dallas', category: 'Markets', action: () => pushRoutePath('/markets') },
    { id: 'focus-houston', label: 'Focus Houston', category: 'Markets', action: () => pushRoutePath('/markets') },
    { id: 'focus-phoenix', label: 'Focus Phoenix', category: 'Markets', action: () => pushRoutePath('/markets') },
    { id: 'focus-minneapolis', label: 'Focus Minneapolis', category: 'Markets', action: () => pushRoutePath('/markets') },
    { id: 'show-heatmap', label: 'Show Heatmap', category: 'Map Modes', action: () => pushRoutePath('/dashboard/live') },
    { id: 'show-lead-temp', label: 'Show Lead Temperature', category: 'Map Modes', action: () => pushRoutePath('/dashboard/live') },
    { id: 'show-pressure', label: 'Show Market Pressure', category: 'Map Modes', action: () => pushRoutePath('/dashboard/live') },
    { id: 'show-buyer-demand', label: 'Show Buyer Demand', category: 'Map Modes', action: () => pushRoutePath('/dashboard/live') },
    { id: 'enter-battlefield', label: 'Enter Battlefield', category: 'Views', action: () => pushRoutePath('/dashboard/live') },
    { id: 'open-copilot', label: 'Open AI Copilot', hint: '⌘J', category: 'AI', action: () => setCopilotOpen(true) },
    { id: 'open-briefing', label: 'Operator Briefing', hint: '⌘.', category: 'AI', action: () => openBriefing() },
    { id: 'open-notif-center', label: 'Notification Center', category: 'System', action: () => setNotifCenterOpen(true) },
  ], [])

  const filteredCommands = cmdQuery.trim()
    ? globalCommands.filter(
        (c) =>
          c.label.toLowerCase().includes(cmdQuery.toLowerCase()) ||
          c.hint?.toLowerCase().includes(cmdQuery.toLowerCase()) ||
          c.category.toLowerCase().includes(cmdQuery.toLowerCase()),
      )
    : globalCommands

  const groupedCommands = useMemo(() => {
    const map = new Map<string, GlobalCommand[]>()
    for (const cmd of filteredCommands) {
      const existing = map.get(cmd.category)
      if (existing) existing.push(cmd)
      else map.set(cmd.category, [cmd])
    }
    return Array.from(map.entries()).map(([category, items]) => ({ category, items }))
  }, [filteredCommands])

  const flatCommands = groupedCommands.flatMap((g) => g.items)

  const openCmd = useCallback(() => {
    setCmdOpen(true)
    setCmdQuery('')
    setCmdFocus(0)
    setTimeout(() => cmdInputRef.current?.focus(), 50)
  }, [])

  const closeCmd = useCallback(() => {
    setCmdOpen(false)
    setCmdQuery('')
    setCmdFocus(0)
  }, [])

  // AI Copilot context — derived from current route
  const copilotContext = useMemo<CopilotContext>(() => ({
    surface: route.path,
  }), [route.path])

  // Briefing digest builder
  const openBriefing = useCallback(() => {
    const digest = buildBriefingDigest({
      hotLeadCount: 0,
      warmLeadCount: 0,
      totalLeads: 0,
      activeAlerts: 0,
      criticalAlerts: 0,
      activeMarkets: 0,
      healthLabel: 'Nominal',
      pipelineValue: '$0',
      agentsActive: 0,
      autopilotActions: 0,
      unreadInbox: 0,
    })
    setBriefingDigest(digest)
    setBriefingOpen(true)
    playSound('briefing-open')
  }, [])

  // Global keyboard — ⌘K, ⌘J, ⌘., /, Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (cmdOpen) closeCmd()
        else openCmd()
        return
      }
      // ⌘J — AI Copilot toggle
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        setCopilotOpen((prev) => {
          if (!prev) playSound('copilot-wake')
          return !prev
        })
        return
      }
      // ⌘. — Operator Briefing
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault()
        if (!briefingOpen) openBriefing()
        else setBriefingOpen(false)
        return
      }
      if (e.key === 'Escape' && cmdOpen) {
        closeCmd()
        return
      }
      // / opens palette when not in an input
      const tag = (e.target as HTMLElement)?.tagName
      if (e.key === '/' && !cmdOpen && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault()
        openCmd()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [cmdOpen, openCmd, closeCmd, briefingOpen, openBriefing])

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

  // Current active nav
  const activeNav = navItems.find((n) => n.path === route.path)

  // Palette key nav
  const onCmdKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCmdFocus((i) => Math.min(i + 1, flatCommands.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCmdFocus((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && flatCommands[cmdFocus]) {
      e.preventDefault()
      flatCommands[cmdFocus].action()
      closeCmd()
    }
  }

  // Reset focus on search
  useEffect(() => { setCmdFocus(0) }, [cmdQuery])

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

  // ── Ready State — Command-First Layout ─────────────────────────────────

  let cmdItemIdx = -1

  return (
    <div className="nx-os">
      {/* Minimal bottom dock — only visible on non-Home surfaces */}
      {route.path !== '/dashboard/live' && (
        <nav className="nx-dock" aria-label="Navigation dock">
          <button
            type="button"
            className="nx-dock__home"
            onClick={() => pushRoutePath('/dashboard/live')}
            title="Home (H)"
          >
            <Icon name="radar" className="nx-dock__icon" />
          </button>
          <div className="nx-dock__divider" />
          {navItems.filter(n => n.path !== '/dashboard/live' && n.path !== '/settings').map((item) => (
            <button
              key={item.path}
              type="button"
              className={`nx-dock__item ${route.path === item.path ? 'is-active' : ''}`}
              onClick={() => pushRoutePath(item.path)}
              title={`${item.label} (${item.shortcut})`}
            >
              <Icon name={item.icon} className="nx-dock__icon" />
            </button>
          ))}
          <div className="nx-dock__spacer" />
          <button
            type="button"
            className={`nx-dock__item ${copilotOpen ? 'is-active' : ''}`}
            onClick={() => { setCopilotOpen((p) => { if (!p) playSound('copilot-wake'); return !p }); }}
            title="AI Copilot (⌘J)"
          >
            <Icon name="spark" className="nx-dock__icon" />
          </button>
          <button
            type="button"
            className="nx-dock__item"
            onClick={() => setNotifCenterOpen(true)}
            title="Notifications"
          >
            <Icon name="bell" className="nx-dock__icon" />
            {notifCount > 0 && <span className="nx-dock__badge">{notifCount}</span>}
          </button>
          <button
            type="button"
            className="nx-dock__cmd"
            onClick={openCmd}
            title="Command Palette (⌘K)"
          >
            <Icon name="command" className="nx-dock__icon" />
          </button>
        </nav>
      )}

      {/* Room label — non-Home surfaces */}
      {route.path !== '/dashboard/live' && activeNav && (
        <div className="nx-room-label">
          <span className="nx-room-label__name">{activeNav.room}</span>
        </div>
      )}

      {/* Main content — full bleed */}
      <main className="nx-stage">
        {route.render(routeState.data)}
      </main>

      {/* Command Palette */}
      {cmdOpen && (
        <div
          className="nx-cmd-overlay"
          role="dialog"
          aria-modal
          aria-label="Command palette"
          onClick={(e) => { if (e.target === e.currentTarget) closeCmd() }}
        >
          <div className="nx-cmd" onKeyDown={onCmdKeyDown}>
            <div className="nx-cmd__bar">
              <span className="nx-cmd__prompt">&gt;</span>
              <input
                ref={cmdInputRef}
                className="nx-cmd__input"
                type="text"
                placeholder="Type a command…"
                value={cmdQuery}
                onChange={(e) => setCmdQuery(e.target.value)}
              />
              <kbd className="nx-cmd__esc">ESC</kbd>
            </div>
            <div className="nx-cmd__results" role="listbox">
              {groupedCommands.length === 0 ? (
                <div className="nx-cmd__empty">No results for "{cmdQuery}"</div>
              ) : (
                groupedCommands.map(({ category, items }) => (
                  <div key={category} className="nx-cmd__group">
                    <span className="nx-cmd__group-label">{category}</span>
                    {items.map((cmd) => {
                      cmdItemIdx++
                      const isFocused = cmdItemIdx === cmdFocus
                      return (
                        <button
                          key={cmd.id}
                          className={`nx-cmd__item ${isFocused ? 'is-focused' : ''}`}
                          type="button"
                          role="option"
                          aria-selected={isFocused}
                          onClick={() => { cmd.action(); closeCmd() }}
                        >
                          <span className="nx-cmd__item-label">{cmd.label}</span>
                          {cmd.hint ? <span className="nx-cmd__item-hint">{cmd.hint}</span> : null}
                        </button>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Grammar pending indicator */}
      {grammarState.pending && (
        <div className="nx-grammar-hint">
          <kbd>{grammarState.pending}</kbd>
          <span>waiting for next key…</span>
        </div>
      )}

      {/* Global notification toasts */}
      <NotificationToasts />

      {/* AI Copilot panel */}
      <AICopilot
        open={copilotOpen}
        context={copilotContext}
        onClose={() => setCopilotOpen(false)}
        onAction={(actionId) => {
          if (actionId === 'go-alerts') pushRoutePath('/alerts')
          else if (actionId === 'focus-hot') pushRoutePath('/dashboard/live')
          else if (actionId === 'batch-reply') pushRoutePath('/inbox')
        }}
      />

      {/* Operator Briefing panel */}
      <BriefingPanel
        open={briefingOpen}
        digest={briefingDigest}
        onClose={() => setBriefingOpen(false)}
      />

      {/* Notification Center */}
      <NotificationCenter
        open={notifCenterOpen}
        onClose={() => setNotifCenterOpen(false)}
      />
    </div>
  )
}
