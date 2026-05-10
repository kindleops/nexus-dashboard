import { CopilotOrb } from '../../../shared/copilot/CopilotOrb'

const cls = (...t: Array<string | false | null | undefined>) => t.filter(Boolean).join(' ')

export const CopilotOrbTrigger = ({
  onClick,
  active = false,
  isReady = true,
  size = 'md',
}: {
  onClick?: any
  active?: boolean
  isReady?: boolean
  size?: string
}) => (
  <button
    type="button"
    className={cls('nx-copilot-orb-trigger', active && 'is-active', !isReady && 'is-disabled', `is-${size}`)}
    onClick={(event) => onClick?.(event)}
  >
    <CopilotOrb
      state={active ? 'listening' : 'idle'}
      amplitude={active ? 0.4 : 0}
      onClick={() => onClick?.()}
      onPushToTalk={() => {}}
      onPushToTalkRelease={() => {}}
    />
  </button>
)
