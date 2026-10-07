import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGalaxy, type QualityTier } from '../state/useGalaxy'

const TIER_DPR: Record<QualityTier, number> = { high: 2, medium: 1.35, low: 1 }
/** beyond the lowest tier the governor multiplies DPR down, step by step */
const DPR_STEPS = [1, 0.85, 0.72, 0.6]

/**
 * Watches rolling FPS and steps the render cost down when the frame budget
 * is missed — never back up, to avoid oscillation. The escalation ladder:
 * quality tier (particle counts) → DPR multiplier → bloom off.
 */
export function useAdaptiveQuality() {
  const setDpr = useThree((s) => s.setDpr)
  const quality = useGalaxy((s) => s.quality)
  const setQuality = useGalaxy((s) => s.setQuality)
  const dprScale = useGalaxy((s) => s.dprScale)
  const setDprScale = useGalaxy((s) => s.setDprScale)
  const bloomOn = useGalaxy((s) => s.bloomOn)
  const setBloomOn = useGalaxy((s) => s.setBloomOn)
  const acc = useRef({ frames: 0, time: 0, lowStreak: 0 })

  useEffect(() => {
    setDpr(Math.min(TIER_DPR[quality] * dprScale, window.devicePixelRatio || 1))
  }, [quality, dprScale, setDpr])

  useFrame((_, dt) => {
    const a = acc.current
    a.frames++
    a.time += dt
    if (a.time < 2.5) return
    const fps = a.frames / a.time
    a.frames = 0
    a.time = 0

    if (fps >= 38) {
      a.lowStreak = 0
      return
    }
    // two consecutive slow windows before each step
    a.lowStreak++
    if (a.lowStreak < 2) return
    a.lowStreak = 0

    if (quality === 'high') setQuality('medium')
    else if (quality === 'medium') setQuality('low')
    else {
      const i = DPR_STEPS.indexOf(dprScale)
      const next = DPR_STEPS[Math.min(i + 1, DPR_STEPS.length - 1)]
      if (next !== dprScale) setDprScale(next)
      else if (bloomOn) setBloomOn(false)
    }
  })
}
