import { useState } from 'react'
import { Icon } from '../../shared/icons'

const classes = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ')

interface SettingToggle {
  id: string
  label: string
  description: string
  enabled: boolean
}

const defaultSettings: SettingToggle[] = [
  { id: 'autopilot', label: 'Autopilot Engine', description: 'Allow AI to auto-escalate hot leads, pause stale outreach, and generate draft responses.', enabled: true },
  { id: 'notifications', label: 'Push Notifications', description: 'Receive browser notifications for critical alerts and autopilot actions.', enabled: true },
  { id: 'sound', label: 'Sound Alerts', description: 'Play audio cues for P0 alerts and hot lead escalations.', enabled: false },
  { id: 'ai-draft', label: 'AI Draft Generation', description: 'Automatically generate response drafts for new inbound messages.', enabled: true },
  { id: 'auto-approve', label: 'Auto-Approve Low-Risk', description: 'Let autopilot execute actions with >90% confidence without manual approval.', enabled: false },
  { id: 'buyer-match', label: 'Buyer Match Alerts', description: 'Notify when a new property matches a buyer profile criteria.', enabled: true },
  { id: 'title-alerts', label: 'Title Status Alerts', description: 'Alert when title records change status or new issues are detected.', enabled: true },
  { id: 'keyboard-hints', label: 'Keyboard Hint Bar', description: 'Show the command grammar hint bar at the bottom of every surface.', enabled: true },
  { id: 'compact-mode', label: 'Compact Mode', description: 'Reduce spacing and font sizes for higher information density.', enabled: false },
  { id: 'dark-map', label: 'Dark Map Theme', description: 'Use the dark matter tile set for the geographic map.', enabled: true },
]

export const SettingsPage = () => {
  const [settings, setSettings] = useState(defaultSettings)

  const toggle = (id: string) => {
    setSettings((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
    )
  }

  return (
    <div className="nx-settings">
      <header className="nx-surface-header">
        <div className="nx-surface-header__title">
          <Icon className="nx-surface-icon" name="settings" />
          <h1>Settings</h1>
        </div>
      </header>

      <div className="nx-settings__body">
        <section className="nx-settings__group">
          <h2>System Preferences</h2>
          <div className="nx-settings__list">
            {settings.map((setting) => (
              <div key={setting.id} className="nx-setting-row">
                <div className="nx-setting-row__info">
                  <strong>{setting.label}</strong>
                  <p>{setting.description}</p>
                </div>
                <button
                  type="button"
                  className={classes('nx-toggle', setting.enabled && 'is-on')}
                  onClick={() => toggle(setting.id)}
                  role="switch"
                  aria-checked={setting.enabled}
                >
                  <span className="nx-toggle__thumb" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="nx-settings__group">
          <h2>Keyboard Commands</h2>
          <div className="nx-settings__shortcuts">
            <div className="nx-shortcut"><kbd>g h</kbd><span>Go Home (Live Dashboard)</span></div>
            <div className="nx-shortcut"><kbd>g i</kbd><span>Go Inbox</span></div>
            <div className="nx-shortcut"><kbd>g a</kbd><span>Go Alerts</span></div>
            <div className="nx-shortcut"><kbd>g s</kbd><span>Go Stats</span></div>
            <div className="nx-shortcut"><kbd>g p</kbd><span>Go Markets (Pipeline)</span></div>
            <div className="nx-shortcut"><kbd>g b</kbd><span>Go Buyer Intelligence</span></div>
            <div className="nx-shortcut"><kbd>g t</kbd><span>Go Title War Room</span></div>
            <div className="nx-shortcut"><kbd>g w</kbd><span>Go Watchlists</span></div>
            <div className="nx-shortcut"><kbd>g d</kbd><span>Go Settings</span></div>
            <div className="nx-shortcut"><kbd>⌘K</kbd><span>Command Palette</span></div>
            <div className="nx-shortcut"><kbd>⌘M</kbd><span>Map Focus (on Live)</span></div>
            <div className="nx-shortcut"><kbd>⌘B</kbd><span>Battlefield Mode (on Live)</span></div>
            <div className="nx-shortcut"><kbd>x</kbd><span>Toggle Autopilot Approval</span></div>
            <div className="nx-shortcut"><kbd>n</kbd><span>Toggle Notifications</span></div>
          </div>
        </section>

        <section className="nx-settings__group">
          <h2>About</h2>
          <div className="nx-settings__about">
            <p><strong>NEXUS</strong> Command Operating System</p>
            <p>React 19 · TypeScript · MapLibre GL · Vite</p>
          </div>
        </section>
      </div>
    </div>
  )
}
