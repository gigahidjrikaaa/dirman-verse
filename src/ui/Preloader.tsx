import { useEffect, useRef, useState, type RefObject } from 'react'
import { useGalaxy } from '../state/useGalaxy'
import { allEntities, GALAXY_RADIUS } from '../data/links'

const BOOT_LINES: Array<[number, string]> = [
  [6, 'establishing command post'],
  [26, 'plotting the march route'],
  [48, 'charting systems and worlds'],
  [70, 'calibrating gold coordinates'],
  [92, 'all fronts reporting — clear for warp'],
]

/**
 * Cinematic boot sequence: a 2D war map plotting the real galaxy layout —
 * radar sweep, staggered system pings, the golden march route drawing
 * itself — then the whole frame dives into the 3D scene.
 */
export function Preloader() {
  const ready = useGalaxy((s) => s.ready)
  const setPreloaderDone = useGalaxy((s) => s.setPreloaderDone)
  const [minTimePassed, setMinTimePassed] = useState(false)
  const [fading, setFading] = useState(false)
  const [progress, setProgress] = useState(0)
  const progressRef = useRef(0)

  useEffect(() => {
    const t0 = performance.now()
    const timer = setInterval(() => {
      const elapsed = (performance.now() - t0) / 1000
      const target = ready ? 100 : Math.min(92, (elapsed / 1.6) * 92)
      progressRef.current += (target - progressRef.current) * 0.25
      if (ready && progressRef.current > 99) progressRef.current = 100
      setProgress(progressRef.current)
    }, 50)
    return () => clearInterval(timer)
  }, [ready])

  useEffect(() => {
    const t = setTimeout(() => setMinTimePassed(true), 1500)
    return () => clearTimeout(t)
  }, [])

  // begin the fade once the scene has painted and the brand beat is done;
  // the camera starts its arrival glide the moment the map dissolves
  useEffect(() => {
    if (ready && minTimePassed && !fading) {
      setFading(true)
      useGalaxy.getState().beginIntro()
    }
  }, [ready, minTimePassed, fading])

  // unmount after the fade completes (separate effect: must not be cancelled
  // by the fading state change that starts it)
  useEffect(() => {
    if (!fading) return
    const t = setTimeout(() => setPreloaderDone(true), 950)
    return () => clearTimeout(t)
  }, [fading, setPreloaderDone])

  const activeLine = [...BOOT_LINES].reverse().find(([at]) => progress >= at)?.[1] ?? BOOT_LINES[0][1]

  return (
    <div className={`preloader ${fading ? 'preloader-out' : ''}`} aria-hidden={fading}>
      <div className="preloader-core">
        <div className="preloader-title">DIRMAN GALAXY</div>
        <div className="preloader-sub">a war map of links</div>
        <BootMap progressRef={progressRef} />
        <div className="preloader-bar">
          <div className="preloader-fill" style={{ width: `${Math.min(100, progress)}%` }} />
        </div>
        <div className="preloader-meta">
          <span className="preloader-log" key={activeLine}>{activeLine}</span>
          <span className="preloader-pct">{Math.round(progress)}%</span>
        </div>
      </div>
    </div>
  )
}

/** top-down 2D plot of the actual galaxy layout, brought alive piece by piece */
function BootMap({ progressRef }: { progressRef: RefObject<number> }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const SIZE = 340
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    ctx.scale(dpr, dpr)

    const cx = SIZE / 2
    const cy = SIZE / 2
    const mapRadius = SIZE / 2 - 18
    const scale = mapRadius / (GALAXY_RADIUS * 1.12)

    const suns = allEntities.filter((e) => e.kind === 'sun')
    const project = (v: { x: number; z: number }): [number, number] => [
      cx + v.x * scale,
      cy + v.z * scale,
    ]
    const sunPts = suns.map((s) => project(s.center))

    // cumulative route lengths for the progressive gold line
    const segLens: number[] = []
    let routeLen = 0
    for (let i = 1; i < sunPts.length; i++) {
      const l = Math.hypot(sunPts[i][0] - sunPts[i - 1][0], sunPts[i][1] - sunPts[i - 1][1])
      segLens.push(l)
      routeLen += l
    }

    const GOLD = (a: number) => `rgba(232, 184, 75, ${a})`

    let raf = 0
    const t0 = performance.now()

    const draw = (now: number) => {
      const t = (now - t0) / 1000
      const progress = Math.max(0, Math.min(100, progressRef.current ?? 0))
      ctx.clearRect(0, 0, SIZE, SIZE)

      // polar grid: rings, spokes, degree ticks
      ctx.strokeStyle = GOLD(0.1)
      ctx.lineWidth = 1
      for (const f of [0.33, 0.66, 1]) {
        ctx.beginPath()
        ctx.arc(cx, cy, mapRadius * f, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.strokeStyle = GOLD(0.06)
      for (let s = 0; s < 12; s++) {
        const a = (s / 12) * Math.PI * 2
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(a) * mapRadius * 0.33, cy + Math.sin(a) * mapRadius * 0.33)
        ctx.lineTo(cx + Math.cos(a) * mapRadius, cy + Math.sin(a) * mapRadius)
        ctx.stroke()
      }

      // radar sweep (frozen in reduced motion)
      const sweep = reduced ? 0.8 : t * 1.25
      const grad = ctx.createConicGradient(sweep, cx, cy)
      grad.addColorStop(0, GOLD(0.2))
      grad.addColorStop(0.14, GOLD(0))
      grad.addColorStop(1, GOLD(0))
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(cx, cy, mapRadius, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = GOLD(0.35)
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(sweep) * mapRadius, cy + Math.sin(sweep) * mapRadius)
      ctx.stroke()

      // the march route draws itself with progress
      const reveal = Math.max(0, Math.min(1, (progress - 6) / 78))
      if (reveal > 0) {
        ctx.strokeStyle = GOLD(0.75)
        ctx.lineWidth = 1.4
        ctx.shadowColor = 'rgba(232, 184, 75, 0.6)'
        ctx.shadowBlur = 5
        ctx.beginPath()
        ctx.moveTo(sunPts[0][0], sunPts[0][1])
        let drawn = reveal * routeLen
        for (let i = 0; i < segLens.length; i++) {
          if (drawn >= segLens[i]) {
            ctx.lineTo(sunPts[i + 1][0], sunPts[i + 1][1])
            drawn -= segLens[i]
          } else {
            const f = drawn / segLens[i]
            ctx.lineTo(
              sunPts[i][0] + (sunPts[i + 1][0] - sunPts[i][0]) * f,
              sunPts[i][1] + (sunPts[i + 1][1] - sunPts[i][1]) * f,
            )
            break
          }
        }
        ctx.stroke()
        ctx.shadowBlur = 0
      }

      // systems ping in, staggered; bodies as faint satellites
      const appearBase = 12
      suns.forEach((sun, i) => {
        const appearAt = appearBase + (i / suns.length) * 66
        const [sx, sy] = sunPts[i]
        const age = Math.max(0, Math.min(1, (progress - appearAt) / 22))
        if (age <= 0) return

        if (!reduced && age < 1) {
          // expanding ping rings
          for (const k of [0, 0.35]) {
            const r = 3 + (age - k) * 26
            if (r > 2) {
              ctx.strokeStyle = GOLD(Math.max(0, (1 - age) * 0.7))
              ctx.lineWidth = 1
              ctx.beginPath()
              ctx.arc(sx, sy, Math.max(2, r), 0, Math.PI * 2)
              ctx.stroke()
            }
          }
        }

        // sweep highlight
        const sunAngle = Math.atan2(sy - cy, sx - cx)
        let diff = Math.abs(((sweep - sunAngle) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI)
        const boost = reduced ? 0 : Math.max(0, 1 - diff / 0.45)

        // connector + planets
        const bodies = allEntities.filter((e) => e.systemId === sun.systemId && e.kind !== 'sun')
        ctx.strokeStyle = GOLD(0.2 + boost * 0.25)
        ctx.lineWidth = 1
        for (const b of bodies) {
          if (!b.orbit) continue
          const [bx, by] = project({
            x: sun.center.x + Math.cos(b.orbit.phase) * b.orbit.radius,
            z: sun.center.z + Math.sin(b.orbit.phase) * b.orbit.radius,
          })
          ctx.beginPath()
          ctx.moveTo(sx, sy)
          ctx.lineTo(bx, by)
          ctx.stroke()
          ctx.fillStyle = `rgba(240, 230, 200, ${0.55 + boost * 0.4})`
          ctx.beginPath()
          ctx.arc(bx, by, 1.4, 0, Math.PI * 2)
          ctx.fill()
        }

        // the sun itself
        const r = 2.6 + boost * 1.4
        ctx.fillStyle = `rgba(255, 240, 210, ${0.75 + boost * 0.25})`
        ctx.shadowColor = 'rgba(232, 184, 75, 0.9)'
        ctx.shadowBlur = 6 + boost * 8
        ctx.beginPath()
        ctx.arc(sx, sy, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
      })

      // corner brackets — command map frame
      ctx.strokeStyle = GOLD(0.55)
      ctx.lineWidth = 1.5
      const B = 14
      const corners: Array<[number, number, number, number]> = [
        [8, 8, 1, 1],
        [SIZE - 8, 8, -1, 1],
        [8, SIZE - 8, 1, -1],
        [SIZE - 8, SIZE - 8, -1, -1],
      ]
      for (const [x, y, dx, dy] of corners) {
        ctx.beginPath()
        ctx.moveTo(x + dx * B, y)
        ctx.lineTo(x, y)
        ctx.lineTo(x, y + dy * B)
        ctx.stroke()
      }

      raf = window.requestAnimationFrame(draw)
    }

    raf = window.requestAnimationFrame(draw)
    return () => window.cancelAnimationFrame(raf)
  }, [progressRef])

  return <canvas ref={ref} className="preloader-map" width={340} height={340} aria-hidden />
}
