import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { mulberry32 } from '../utils/random'
import { useGalaxy } from '../state/useGalaxy'
/** soft radial-gradient blob texture, generated procedurally — zero assets */
function makeNebulaTexture(): THREE.Texture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,0.85)')
  g.addColorStop(0.28, 'rgba(255,255,255,0.38)')
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

interface Cloud {
  position: [number, number, number]
  scale: number
  color: string
  opacity: number
  spin: number
}

/** tinted nebula clouds hovering over each sector arm — pure sprites, one texture */
export function Nebulae() {
  const reduced = useGalaxy((s) => s.settings.reducedMotion)
  const quality = useGalaxy((s) => s.quality)
  const spritesRef = useRef<(THREE.Sprite | null)[]>([])

  const texture = useMemo(makeNebulaTexture, [])

  // low tier: one cloud per sector instead of two (sprites = draw calls)
  const layers = quality === 'low' ? 1 : 2

  const clouds = useMemo<Cloud[]>(() => {
    const rand = mulberry32(4242)
    const hues = [46, 356, 282, 222, 187]
    const out: Cloud[] = []
    for (let i = 0; i < hues.length; i++) {
      const hue = hues[i]
      const armAngle = (i / hues.length) * Math.PI * 2
      const r = 16 + rand() * 26
      const color = new THREE.Color().setHSL(hue / 360, 0.85, 0.5)
      const variants: Array<() => Cloud> = [
        () => ({
          position: [
            Math.cos(armAngle) * r,
            4 + rand() * 8,
            Math.sin(armAngle) * r,
          ] as [number, number, number],
          scale: 30 + rand() * 28,
          color: `#${color.getHexString()}`,
          opacity: 0.05 + rand() * 0.04,
          spin: (rand() - 0.5) * 0.02,
        }),
        () => ({
          position: [
            Math.cos(armAngle + 0.7) * r * 0.7,
            -5 - rand() * 6,
            Math.sin(armAngle + 0.7) * r * 0.7,
          ] as [number, number, number],
          scale: 24 + rand() * 20,
          color: `#${color.offsetHSL(0.04, 0, 0.05).getHexString()}`,
          opacity: 0.04 + rand() * 0.03,
          spin: (rand() - 0.5) * 0.02,
        }),
      ]
      for (let v = 0; v < layers; v++) out.push(variants[v]())
    }
    return out
  }, [layers])

  useFrame((_, delta) => {
    if (reduced) return
    for (const s of spritesRef.current) {
      if (s) s.material.rotation += delta * 0.008
    }
  })

  return (
    <group renderOrder={-1}>
      {clouds.map((c, i) => (
        <sprite
          key={i}
          position={c.position}
          scale={[c.scale, c.scale, 1]}
          ref={(el) => {
            spritesRef.current[i] = el
          }}
        >
          <spriteMaterial
            map={texture}
            color={c.color}
            opacity={c.opacity}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            rotation={c.spin * 100}
          />
        </sprite>
      ))}
    </group>
  )
}
