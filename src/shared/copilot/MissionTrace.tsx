/**
 * NEXUS MissionTrace — Cinematic Activity Log
 *
 * Structured event feed showing copilot actions with timestamps,
 * severity, and stateful event stages. Compact + expanded modes.
 * Newest entries animate in from the top with spring motion.
 */

import { useState } from 'react'
import type { TraceEvent } from './copilot-state'

interface MissionTraceProps {
  events: TraceEvent[]
  maxVisible?: number
}

const TYPE_ICONS: Record<string, string> = {
  context: '◈',
  parse: '⟐',
  search: '⏻',
  analysis: '◉',
  draft: '✎',
  execution: '▶',
  completion: '✓',
  error: '⚠',
  voice: '◌',
  greeting: '●',
  confirmation: '⟡',
  system: '⎔',
}

const TYPE_ACCENT: Record<string, string> = {
  context: 'trace-ctx',
  parse: 'trace-parse',
  search: 'trace-search',
  analysis: 'trace-analyze',
  draft: 'trace-draft',
  execution: 'trace-exec',
  completion: 'trace-done',
  error: 'trace-err',
  voice: 'trace-voice',
  greeting: 'trace-greet',
  confirmation: 'trace-confirm',
  system: 'trace-sys',
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

export function MissionTrace({ events, maxVisible = 50 }: MissionTraceProps) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? events.slice(0, maxVisible) : events.slice(0, 8)

  if (events.length === 0) {
    return (
      <div className="nx-trace nx-trace--empty">
        <span className="nx-trace__empty-label">No mission activity</span>
      </div>
    )
  }

  return (
    <div className={`nx-trace ${expanded ? 'nx-trace--expanded' : ''}`}>
      <div className="nx-trace__header">
        <span className="nx-trace__title">Mission Trace</span>
        <span className="nx-trace__count">{events.length}</span>
        {events.length > 8 && (
          <button className="nx-trace__toggle" onClick={() => setExpanded(e => !e)}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
      </div>
      <div className="nx-trace__feed">
        {visible.map((ev, i) => (
          <div
            key={ev.id}
            className={`nx-trace__event ${TYPE_ACCENT[ev.type] ?? 'trace-sys'}`}
            style={{ animationDelay: `${i * 30}ms` }}
          >
            <span className="nx-trace__icon">{TYPE_ICONS[ev.type] ?? '·'}</span>
            <div className="nx-trace__body">
              <span className="nx-trace__label">{ev.label}</span>
              {ev.detail && <span className="nx-trace__detail">{ev.detail}</span>}
            </div>
            <span className="nx-trace__ts">{formatTimestamp(ev.ts)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
