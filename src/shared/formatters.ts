const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const percentFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export const formatCompactNumber = (value: number) => compactNumberFormatter.format(value)

export const formatCurrency = (value: number) => currencyFormatter.format(value)

export const formatPercent = (value: number) => `${percentFormatter.format(value)}%`

export const formatMetricValue = (value: number, suffix = '') =>
  `${compactNumberFormatter.format(value)}${suffix}`

export const formatClockTime = (value: Date) =>
  new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(value)

export const formatShortDateTime = (iso: string) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))

export const formatRelativeTime = (iso: string) => {
  const deltaMinutes = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))

  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`
  }

  const deltaHours = Math.round(deltaMinutes / 60)
  if (deltaHours < 24) {
    return `${deltaHours}h ago`
  }

  const deltaDays = Math.round(deltaHours / 24)
  return `${deltaDays}d ago`
}

export const formatStageLabel = (value: string) =>
  value
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')

export const formatOwnerLabel = (value: string) =>
  value
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
