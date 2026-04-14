/**
 * NEXUS CopilotOrb — Floating Neural Core Trigger
 *
 * Canvas-rendered animated orb that reflects the copilot's current state.
 * Renders as a floating button when copilot is in 'orb' presence mode.
 * Clicking opens the sidecar panel. Long-press activates push-to-talk.
 */

import { useRef, useEffect, useCallback, useState } from 'react'
import type { CopilotState } from './copilot-state'
import { STATE_META } from './copilot-state'

interface CopilotOrbProps {
  state: CopilotState
  amplitude: number
  onClick: () => void
  onPushToTalk: () => void
  onPushToTalkRelease: () => void
  className?: string
}

export function CopilotOrb({ state, amplitude, onClick, onPushToTalk, onPushToTalkRelease, className }: CopilotOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const startRef = useRef(Date.now())
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isHolding, setIsHolding] = useState(false)
  const meta = STATE_META[state]
  const metaRef = useRef(meta)
  const ampRef = useRef(amplitude)
  metaRef.current = meta
  ampRef.current = amplitude

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const size = 56
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    ctx.scale(dpr, dpr)

    const cx = size / 2
    const cy = size / 2

    const draw = () => {
      const t = (Date.now() - startRef.current) / 1000
      const m = metaRef.current
      const amp = ampRef.current

      ctx.clearRect(0, 0, size, size)

      // Outer glow ring
      const glowR = 24 + Math.sin(t * m.orbSpeed * 2) * 2 + amp * 4
      const grad = ctx.createRadialGradient(cx, cy, glowR * 0.3, cx, cy, glowR)
      grad.addColorStop(0, `rgba(${m.hue},${0.15 + m.orbIntensity * 0.3 + amp * 0.2})`)
      grad.addColorStop(0.6, `rgba(${m.hue},${0.05 + m.orbIntensity * 0.1})`)
      grad.addColorStop(1, `rgba(${m.hue},0)`)
      ctx.beginPath()
      ctx.arc(cx, cy, glowR, 0, Math.PI * 2)
      ctx.fillStyle = grad
      ctx.fill()

      // Inner core — neural pulse rings
      const rings = 3
      for (let i = 0; i < rings; i++) {
        const phase = t * m.orbSpeed * (1.5 + i * 0.4) + i * 2.1
        const r = 8 + i * 4 + Math.sin(phase) * (2 + amp * 3)
        const alpha = (0.12 + m.orbIntensity * 0.2 - i * 0.04) * (1 + amp * 0.5)
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(${m.hue},${Math.min(alpha, 0.7)})`
        ctx.lineWidth = 1.2 - i * 0.2
        ctx.stroke()
      }

      // Center dot
      const dotR = 3 + Math.sin(t * m.orbSpeed * 3) * 0.5 + amp * 2
      ctx.beginPath()
      ctx.arc(cx, cy, dotR, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${m.hue},${0.5 + m.orbIntensity * 0.4 + amp * 0.3})`
      ctx.fill()

      // Scanning arc (only when actively processing)
      if (m.orbSpeed > 1.0) {
        const arcAngle = t * m.orbSpeed * 4
        const arcLen = Math.PI * 0.4
        ctx.beginPath()
        ctx.arc(cx, cy, 18, arcAngle, arcAngle + arcLen)
        ctx.strokeStyle = `rgba(${m.hue},${0.25 + amp * 0.15})`
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  const handlePointerDown = useCallback(() => {
    holdTimerRef.current = setTimeout(() => {
      setIsHolding(true)
      onPushToTalk()
    }, 300)
  }, [onPushToTalk])

  const handlePointerUp = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (isHolding) {
      setIsHolding(false)
      onPushToTalkRelease()
    } else {
      onClick()
    }
  }, [isHolding, onClick, onPushToTalkRelease])

  const handlePointerLeave = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (isHolding) {
      setIsHolding(false)
      onPushToTalkRelease()
    }
  }, [isHolding, onPushToTalkRelease])

  return (
    <button
      className={`nx-copilot-orb ${meta.accentClass} ${isHolding ? 'is-holding' : ''} ${className ?? ''}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      aria-label={`Copilot — ${meta.label}`}
      title={meta.label}
    >
      <canvas ref={canvasRef} className="nx-copilot-orb__canvas" />
      <span className="nx-copilot-orb__label">{meta.sublabel}</span>
    </button>
  )
}
