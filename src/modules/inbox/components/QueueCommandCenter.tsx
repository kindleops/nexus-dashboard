import type { QueueProcessorHealth } from '../../../lib/data/inboxData'

const cls = (...tokens: Array<string | false | null | undefined>) => tokens.filter(Boolean).join(' ')

export type QueueCommandMode = 'off' | 'safe' | 'live'

export interface QueueCommandCaps {
  sends_per_run: number
  auto_replies_per_run: number
  followups_per_run: number
  first_touches_per_run: number
  max_per_number_per_day: number
  max_per_market_per_hour: number
}

interface QueueCommandCenterProps {
  health: QueueProcessorHealth | null
  loading: boolean
  mode: QueueCommandMode
  caps: QueueCommandCaps
  actionLoading: string | null
  onModeChange: (mode: QueueCommandMode) => void
  onCapsChange: (patch: Partial<QueueCommandCaps>) => void
  onRefresh: () => void
  onRunSafeBatch: () => void
  onRunQueueNow: () => void
  onReprocessPaused: (ids?: string[]) => void
  onRetryFailed: () => void
  onReconcileDelivery: () => void
  onCancelStaleFollowUps: () => void
}

const statusLabel = (value: QueueProcessorHealth['status'] | 'unknown') => {
  if (value === 'healthy') return 'Healthy'
  if (value === 'warning') return 'Warning'
  if (value === 'critical') return 'Critical'
  return 'Unknown'
}

const metricsFor = (health: QueueProcessorHealth | null) => ([
  ['Queued', health?.queuedCount ?? 0],
  ['Scheduled', health?.scheduledCount ?? 0],
  ['Sending', health?.sendingCount ?? 0],
  ['Sent Today', health?.sentTodayCount ?? 0],
  ['Delivered Today', health?.deliveredTodayCount ?? 0],
  ['Failed Today', health?.failedTodayCount ?? 0],
  ['Blocked', health?.blockedCount ?? 0],
  ['Paused Invalid', health?.pausedInvalidCount ?? 0],
  ['Duplicate Skipped', health?.duplicateSkippedCount ?? 0],
  ['Suppression Blocked', health?.suppressionBlockedCount ?? 0],
  ['Blank Body Blocked', health?.blankBodyBlockedCount ?? 0],
  ['Routing Blocked', health?.routingBlockedCount ?? 0],
  ['Replied Before Send', health?.repliedBeforeSendCount ?? 0],
])

const toneForHealth = (health: QueueProcessorHealth | null): 'good' | 'warning' | 'critical' | 'neutral' => {
  if (!health) return 'neutral'
  if (health.status === 'healthy') return 'good'
  if (health.status === 'warning') return 'warning'
  if (health.status === 'critical') return 'critical'
  return 'neutral'
}

export function QueueCommandCenter({
  health,
  loading,
  mode,
  caps,
  actionLoading,
  onModeChange,
  onCapsChange,
  onRefresh,
  onRunSafeBatch,
  onRunQueueNow,
  onReprocessPaused,
  onRetryFailed,
  onReconcileDelivery,
  onCancelStaleFollowUps,
}: QueueCommandCenterProps) {
  const healthStatus = health?.status ?? 'unknown'
  const healthTone = toneForHealth(health)
  const liveBlocked = health?.liveAutopilotAllowed === false
  const controlsDisabled = loading || actionLoading !== null

  return (
    <div className="nx-queue-cc" role="dialog" aria-label="Queue Command Center">
      <div className="nx-queue-cc__header">
        <div className="nx-queue-cc__title-stack">
          <p className="nx-queue-cc__eyebrow">Queue Command Center</p>
          <h3>Deterministic Queue Operations</h3>
          <div className={cls('nx-queue-cc__hero-pill', `is-${healthTone}`)}>
            Health: {statusLabel(healthStatus)} {health?.queuedCount !== undefined ? `• ${health.queuedCount} queued` : ''}
          </div>
        </div>
        <div className={cls('nx-queue-cc__health', `is-${healthStatus}`)}>
          {statusLabel(healthStatus)}
        </div>
      </div>

      <div className="nx-queue-cc__summary">
        <p>{loading ? 'Synchronizing queue command telemetry...' : (health?.summary ?? 'No processor data available.')}</p>
        <div className="nx-queue-cc__summary-meta">
          <span>Mode: <strong>{mode === 'off' ? 'Off' : mode === 'safe' ? 'Safe Autopilot' : 'Live Autopilot'}</strong></span>
          <span>Last Check: <strong>{health?.checkedAt ? new Date(health.checkedAt).toLocaleTimeString() : '—'}</strong></span>
        </div>
      </div>

      <div className="nx-queue-cc__hero-grid">
        <div className={cls('nx-queue-cc__hero-card', `is-${healthTone}`)}>
          <div className="nx-queue-cc__hero-card-top">
            <span>Queue Health</span>
            <b>{statusLabel(healthStatus)}</b>
          </div>
          <strong>{health?.queuedCount ?? 0}</strong>
          <small>Queued now</small>
        </div>
        <div className="nx-queue-cc__hero-card is-neutral">
          <div className="nx-queue-cc__hero-card-top">
            <span>Delivered Today</span>
            <b>{health?.webhookHealthy ? 'Webhooks OK' : 'Webhook Stale'}</b>
          </div>
          <strong>{health?.deliveredTodayCount ?? 0}</strong>
          <small>{health?.latestWebhookAt ? `Last webhook ${new Date(health.latestWebhookAt).toLocaleTimeString()}` : 'No webhook seen'}</small>
        </div>
        <div className={cls('nx-queue-cc__hero-card', (health?.routingBlockedCount ?? 0) > 0 ? 'is-warning' : 'is-good')}>
          <div className="nx-queue-cc__hero-card-top">
            <span>Routing Blocked</span>
            <b>{(health?.routingBlockedCount ?? 0) > 0 ? 'Needs Review' : 'Clear'}</b>
          </div>
          <strong>{health?.routingBlockedCount ?? 0}</strong>
          <small>Paused sender resolution rows</small>
        </div>
      </div>

      <section className="nx-queue-cc__section">
        <div className="nx-queue-cc__section-head">
          <span>Mode</span>
          {liveBlocked && <small>Live Autopilot blocked while queue health is Critical</small>}
        </div>
        <div className="nx-queue-cc__segment">
          <button type="button" className={cls('nx-queue-cc__chip', mode === 'off' && 'is-active')} onClick={() => onModeChange('off')} disabled={controlsDisabled}>Off</button>
          <button type="button" className={cls('nx-queue-cc__chip', mode === 'safe' && 'is-active')} onClick={() => onModeChange('safe')} disabled={controlsDisabled}>Safe Autopilot</button>
          <button type="button" className={cls('nx-queue-cc__chip', mode === 'live' && 'is-active')} onClick={() => onModeChange('live')} disabled={controlsDisabled || liveBlocked}>Live Autopilot</button>
        </div>
      </section>

      <section className="nx-queue-cc__section">
        <div className="nx-queue-cc__section-head">
          <span>Actions</span>
          <button type="button" className="nx-queue-cc__inline-btn" onClick={onRefresh} disabled={controlsDisabled}>{loading ? 'Refreshing...' : 'Refresh'}</button>
        </div>
        <div className="nx-queue-cc__actions">
          <button type="button" onClick={onRunSafeBatch} disabled={controlsDisabled}>{actionLoading === 'safe_batch' ? 'Running Safe Batch...' : 'Run Safe Batch'}</button>
          <button type="button" onClick={onRunQueueNow} disabled={controlsDisabled || liveBlocked}>{actionLoading === 'run_now' ? 'Running Queue...' : 'Run Queue Now'}</button>
          <button type="button" onClick={() => onReprocessPaused()} disabled={controlsDisabled}>{actionLoading === 'reprocess_paused' ? 'Reprocessing...' : 'Reprocess Paused'}</button>
          <button type="button" onClick={onRetryFailed} disabled={controlsDisabled}>{actionLoading === 'retry_failed' ? 'Retrying...' : 'Retry Failed'}</button>
          <button type="button" onClick={onReconcileDelivery} disabled={controlsDisabled}>{actionLoading === 'reconcile_delivery' ? 'Reconciling...' : 'Reconcile Delivery'}</button>
          <button type="button" onClick={onCancelStaleFollowUps} disabled={controlsDisabled}>{actionLoading === 'cancel_stale_followups' ? 'Cancelling...' : 'Cancel Stale Follow-Ups'}</button>
        </div>
      </section>

      <section className="nx-queue-cc__section">
        <div className="nx-queue-cc__section-head">
          <span>Caps</span>
          <small>Operator-editable run limits</small>
        </div>
        <div className="nx-queue-cc__caps-grid">
          {([
            ['sends_per_run', 'Sends / Run'],
            ['auto_replies_per_run', 'Auto Replies / Run'],
            ['followups_per_run', 'Follow-Ups / Run'],
            ['first_touches_per_run', 'First Touches / Run'],
            ['max_per_number_per_day', 'Per Number / Day'],
            ['max_per_market_per_hour', 'Per Market / Hour'],
          ] as Array<[keyof QueueCommandCaps, string]>).map(([key, label]) => (
            <label key={key} className="nx-queue-cc__cap">
              <span>{label}</span>
              <input
                type="number"
                min={0}
                value={caps[key]}
                onChange={(event) => onCapsChange({ [key]: Math.max(0, Number(event.target.value) || 0) })}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="nx-queue-cc__section">
        <div className="nx-queue-cc__section-head">
          <span>Health Metrics</span>
          <small>{health?.failedRate !== null && health?.failedRate !== undefined ? `${Math.round(health.failedRate * 10) / 10}% failed rate` : '— failed rate'}</small>
        </div>
        <div className="nx-queue-cc__metrics-grid">
          {metricsFor(health).map(([label, value]) => (
            <div key={label} className={cls(
              'nx-queue-cc__metric',
              label === 'Failed Today' && (health?.failedTodayCount ?? 0) > 0 && 'is-critical',
              label === 'Routing Blocked' && (health?.routingBlockedCount ?? 0) > 0 && 'is-warning',
              label === 'Delivered Today' && (health?.deliveredTodayCount ?? 0) > 0 && 'is-good',
            )}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="nx-queue-cc__section">
        <div className="nx-queue-cc__section-head">
          <span>Routing Blocked</span>
          <small>{health?.routingBlockedRows.length ?? 0} paused rows need sender coverage</small>
        </div>
        <div className="nx-queue-cc__routing-list">
          {(health?.routingBlockedRows.length ?? 0) > 0 ? health!.routingBlockedRows.map((row) => (
            <div key={row.id} className="nx-queue-cc__routing-row">
              <div>
                <strong>{row.sellerName}</strong>
                <p>{row.propertyAddress}</p>
                <small>{row.market} • Routing Blocked • {row.reason}</small>
              </div>
              <button type="button" onClick={() => onReprocessPaused([row.id])} disabled={controlsDisabled}>
                {actionLoading === `retry_routing:${row.id}` ? 'Retrying...' : 'Retry Routing'}
              </button>
            </div>
          )) : (
            <div className="nx-queue-cc__empty">No paused routing failures right now.</div>
          )}
        </div>
      </section>
    </div>
  )
}
