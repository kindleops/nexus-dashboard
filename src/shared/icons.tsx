import type { SVGProps } from 'react'

type IconName =
  | 'search'
  | 'bell'
  | 'settings'
  | 'radar'
  | 'spark'
  | 'pin'
  | 'chevron-right'
  | 'arrow-up-right'
  | 'clock'
  | 'shield'
  | 'alert'
  | 'activity'
  | 'send'
  | 'calendar'
  | 'message'
  | 'target'
  | 'layers'
  | 'bolt'
  | 'close'
  | 'map'
  | 'layout-split'
  | 'list'
  | 'command'
  | 'maximize'

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
}

const commonProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  strokeWidth: 1.7,
}

export const Icon = ({ name, ...props }: IconProps) => {
  switch (name) {
    case 'search':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <circle cx="11" cy="11" r="6" {...commonProps} />
          <path d="m16 16 4.5 4.5" {...commonProps} />
        </svg>
      )
    case 'bell':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path d="M6 9a6 6 0 0 1 12 0v4l1.5 2.5H4.5L6 13z" {...commonProps} />
          <path d="M10 18a2 2 0 0 0 4 0" {...commonProps} />
        </svg>
      )
    case 'settings':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <circle cx="12" cy="12" r="3.2" {...commonProps} />
          <path
            d="m19.5 15.3-1.1.6.1 1.3-1.6 1.6-1.3-.1-.6 1.1H9.8l-.6-1.1-1.3.1-1.6-1.6.1-1.3-1.1-.6V8.7l1.1-.6-.1-1.3 1.6-1.6 1.3.1.6-1.1h4.4l.6 1.1 1.3-.1 1.6 1.6-.1 1.3 1.1.6z"
            {...commonProps}
          />
        </svg>
      )
    case 'radar':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <circle cx="12" cy="12" r="8.5" {...commonProps} />
          <circle cx="12" cy="12" r="4.5" {...commonProps} />
          <path d="M12 12 18 6" {...commonProps} />
          <path d="M12 3.5v17" {...commonProps} opacity="0.45" />
          <path d="M3.5 12h17" {...commonProps} opacity="0.45" />
        </svg>
      )
    case 'spark':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path d="M12 3 8.2 12h3.5L10 21l5.8-10H12z" {...commonProps} />
        </svg>
      )
    case 'pin':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path d="M12 21s6-5.2 6-11a6 6 0 0 0-12 0c0 5.8 6 11 6 11Z" {...commonProps} />
          <circle cx="12" cy="10" r="2.2" {...commonProps} />
        </svg>
      )
    case 'chevron-right':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path d="m9 6 6 6-6 6" {...commonProps} />
        </svg>
      )
    case 'arrow-up-right':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path d="M7 17 17 7" {...commonProps} />
          <path d="M9 7h8v8" {...commonProps} />
        </svg>
      )
    case 'clock':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <circle cx="12" cy="12" r="8.5" {...commonProps} />
          <path d="M12 7.2v5.1l3.7 2.2" {...commonProps} />
        </svg>
      )
    case 'shield':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path d="M12 3.5 18.5 6v5.2c0 4.4-2.8 7.6-6.5 9.3-3.7-1.7-6.5-4.9-6.5-9.3V6z" {...commonProps} />
        </svg>
      )
    case 'alert':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path d="m12 4.5 8 14H4z" {...commonProps} />
          <path d="M12 9v4.4" {...commonProps} />
          <path d="M12 16.8h.01" {...commonProps} />
        </svg>
      )
    case 'activity':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path d="M3 12h4l2.2-4 4.1 8 2.2-4H21" {...commonProps} />
        </svg>
      )
    case 'send':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path d="m3 20 18-8L3 4l3.6 7.2L14 12l-7.4.8z" {...commonProps} />
        </svg>
      )
    case 'calendar':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <rect x="4" y="6" width="16" height="14" rx="2" {...commonProps} />
          <path d="M8 3.8v4M16 3.8v4M4 10.2h16" {...commonProps} />
        </svg>
      )
    case 'message':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path d="M5 6.5h14v9H9l-4 3z" {...commonProps} />
        </svg>
      )
    case 'target':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <circle cx="12" cy="12" r="7.5" {...commonProps} />
          <circle cx="12" cy="12" r="3.5" {...commonProps} />
          <path d="M12 2.8v3.2M12 18v3.2M2.8 12H6M18 12h3.2" {...commonProps} />
        </svg>
      )
    case 'layers':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path d="m12 4 8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4" {...commonProps} />
        </svg>
      )
    case 'bolt':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path d="m13 2.8-7 10h4.6L10.8 21l7.2-10H13z" {...commonProps} />
        </svg>
      )
    case 'close':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path d="M6 6 18 18M18 6 6 18" {...commonProps} />
        </svg>
      )
    case 'map':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path d="M9 4 3 7v13l6-3M9 4l6 3M9 4v13M15 7l6-3v13l-6 3M15 7v13" {...commonProps} />
        </svg>
      )
    case 'layout-split':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <rect x="3" y="4" width="18" height="16" rx="2" {...commonProps} />
          <path d="M12 4v16" {...commonProps} />
        </svg>
      )
    case 'list':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" {...commonProps} />
        </svg>
      )
    case 'command':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path d="M9 5H7a2 2 0 0 0 0 4h2V7a2 2 0 0 0-2-2zM9 19H7a2 2 0 0 1 0-4h2v2a2 2 0 0 1-2 2zM15 5h2a2 2 0 0 1 0 4h-2V7a2 2 0 0 1 2-2zM15 19h2a2 2 0 0 0 0-4h-2v2a2 2 0 0 0 2 2z" {...commonProps} />
          <rect x="9" y="9" width="6" height="6" {...commonProps} />
        </svg>
      )
    case 'maximize':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path d="M4 14v6h6M20 10V4h-6M4 10V4h6M20 14v6h-6" {...commonProps} />
        </svg>
      )
  }
}
