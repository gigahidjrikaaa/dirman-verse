import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { COUNCIL_RADIUS, COUNCIL_Y } from '../data/links'
import { useGalaxy } from '../state/useGalaxy'

const PULSES = 3

function emberTexture(): THREE.Texture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,235,190,0.95)')
  g.addColorStop(0.3, 'rgba(255,206,106,0.5)')
  g.addColorStop(1, 'rgba(255,206,106,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * The Council Ring — a clean circle threading every cluster's first system
 * at the same radius, with ember pulses traveling the line.
 */
export function MarchRoute() {
  const reduced = useGalaxy((s) => s.settings.reducedMotion)
  const quality = useGalaxy((s) => s.quality)
  const pulsesRef = useRef<(THREE.Sprite | null)[]>([])

  const { curve, geometry } = useMemo(() => {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2
      pts.push(
        new THREE.Vector3(
          Math.cos(a) * COUNCIL_RADIUS,
          COUNCIL_Y,
          Math.sin(a) * COUNCIL_RADIUS,
        ),
      )
    }
    const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5)
    // tube tessellation scales with the quality tier
    const segs = quality === 'high' ? 260 : quality === 'medium' ? 180 : 110
    const rad = quality === 'low' ? 6 : 8
    const geometry = new THREE.TubeGeometry(curve, segs, 0.13, rad, false)
    return { curve, geometry }
  }, [quality])

  // the rebuild above swaps the geometry prop — dispose the replaced one
  useEffect(() => () => geometry.dispose(), [geometry])

  const texture = useMemo(emberTexture, [])

  useFrame((state) => {
    if (reduced) return
    const t = state.clock.elapsedTime
    for (let i = 0; i < PULSES; i++) {
      const sp = pulsesRef.current[i]
      if (!sp) continue
      const u = (t * 0.022 + i / PULSES) % 1
      curve.getPointAt(u, sp.position)
      const s = 2.4 + Math.sin(t * 2 + i * 2.1) * 0.6
      sp.scale.set(s, s, 1)
    }
  })

  return (
    <group renderOrder={0}>
      <mesh geometry={geometry}>
        <meshBasicMaterial
          color="#e8b84b"
          transparent
          opacity={0.15}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {Array.from({ length: PULSES }, (_, i) => (
        <sprite
          key={i}
          ref={(el) => {
            pulsesRef.current[i] = el
          }}
        >
          <spriteMaterial
            map={texture}
            color="#ffdf9e"
            transparent
            opacity={0.55}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </group>
  )
}
