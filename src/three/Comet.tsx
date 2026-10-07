import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { mulberry32 } from '../utils/random'
import { useGalaxy } from '../state/useGalaxy'
import { secretComet } from '../data/links'
import { markComet, clearPickEntry } from './input'
import { cometBridge } from './runtime'

const FLIGHT_SECONDS = 7
const TRAIL_POINTS = 26

/** soft radial glow — a sprite without a map renders as a raw square */
function glowTexture(): THREE.Texture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,0.95)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

interface Flight {
  from: THREE.Vector3
  to: THREE.Vector3
  t: number
  trail: THREE.Vector3[]
}

/**
 * Easter egg: every so often a rogue comet streaks across the galaxy.
 * Click it before it fades to unlock a hidden link.
 */
export function Comet() {
  const reduced = useGalaxy((s) => s.settings.reducedMotion)
  const setToast = useGalaxy((s) => s.setToast)
  const groupRef = useRef<THREE.Group>(null)
  const trailRef = useRef<THREE.BufferGeometry>(null)
  const flight = useRef<Flight | null>(null)
  const nextIn = useRef(12)
  const rand = useRef(mulberry32(99))
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const haloTexture = useMemo(glowTexture, [])

  useEffect(() => {
    cometBridge.onClick = () => {
      flight.current = null
      clearPickEntry('comet')
      if (groupRef.current) groupRef.current.visible = false
      window.open(secretComet.url, '_blank', 'noopener,noreferrer')
      setToast(secretComet.toast)
      nextIn.current = 24 + rand.current() * 30
    }
    return () => {
      cometBridge.onClick = null
    }
  }, [setToast])

  const tmp = useRef(new THREE.Vector3())

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const group = groupRef.current
    if (!group || reduced) return

    if (!flight.current) {
      nextIn.current -= dt
      if (nextIn.current <= 0) {
        const r = rand.current
        const a0 = r() * Math.PI * 2
        const a1 = a0 + Math.PI * (0.6 + r() * 0.6)
        const radius = 55 + r() * 25
        flight.current = {
          from: new THREE.Vector3(Math.cos(a0) * radius, (r() - 0.3) * 36, Math.sin(a0) * radius),
          to: new THREE.Vector3(Math.cos(a1) * radius, (r() - 0.5) * 36, Math.sin(a1) * radius),
          t: 0,
          trail: Array.from({ length: TRAIL_POINTS }, () => new THREE.Vector3()),
        }
        group.visible = true
      } else {
        if (group.visible) {
          group.visible = false
          clearPickEntry('comet')
        }
        return
      }
    }

    const f = flight.current
    f.t += dt / FLIGHT_SECONDS
    if (f.t >= 1) {
      flight.current = null
      clearPickEntry('comet')
      group.visible = false
      nextIn.current = 18 + rand.current() * 30
      return
    }

    // gentle arc + head position
    const e = f.t
    tmp.current.copy(f.from).lerp(f.to, e)
    tmp.current.y += Math.sin(e * Math.PI) * 6
    group.position.copy(tmp.current)

    // trail history
    f.trail.pop()
    f.trail.unshift(tmp.current.clone())
    const geo = trailRef.current
    if (geo) {
      const arr = geo.getAttribute('position').array as Float32Array
      f.trail.forEach((p, i) => {
        arr[i * 3] = p.x
        arr[i * 3 + 1] = p.y
        arr[i * 3 + 2] = p.z
      })
      geo.getAttribute('position').needsUpdate = true
    }

    // register for clicking (generous radius, it moves fast)
    const ndc = tmp.current.clone().project(camera)
    if (ndc.z < 1) {
      const px = (ndc.x * 0.5 + 0.5) * size.width
      const py = (-ndc.y * 0.5 + 0.5) * size.height
      markComet('comet', px, py, 26)
    } else {
      clearPickEntry('comet')
    }
  })

  const trailPositions = useMemo(
    () => new Float32Array(TRAIL_POINTS * 3),
    [],
  )

  return (
    <group ref={groupRef} visible={false}>
      <mesh renderOrder={2}>
        <sphereGeometry args={[0.55, 12, 12]} />
        <meshBasicMaterial color="#cfe8ff" transparent opacity={0.95} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* glow halo */}
      <sprite scale={[6, 6, 1]} renderOrder={2}>
        <spriteMaterial
          map={haloTexture}
          color="#7fb8ff"
          transparent
          opacity={0.55}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <line>
        <bufferGeometry ref={trailRef}>
          <bufferAttribute attach="attributes-position" args={[trailPositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#9fd0ff" transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
      </line>
    </group>
  )
}
