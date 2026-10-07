import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { galaxyVertexShader, galaxyFragmentShader } from '../shaders/galaxy.glsl'
import { useGalaxy } from '../state/useGalaxy'
import { GALAXY_RADIUS, allEntities } from '../data/links'
import { characterValues } from '../data/characters'
import { mulberry32 } from '../utils/random'

const COUNTS = { high: 65000, medium: 30000, low: 9000 } as const

/**
 * The Nine-Pointed Mandala backdrop: nine identical character tails at
 * perfect 40° intervals, a diffuse disk, and a gunungan core — one Points
 * draw call. Particles dim around each clickable system (clearings).
 */
export function GalaxyBackdrop() {
  const quality = useGalaxy((s) => s.quality)
  const reduced = useGalaxy((s) => s.settings.reducedMotion)
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const dpr = useThree((s) => s.viewport.dpr)

  const count = COUNTS[quality]

  const { geometry, uniforms } = useMemo(() => {
    const rand = mulberry32(777)
    const radius = GALAXY_RADIUS * 1.4
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const scales = new Float32Array(count)

    const inside = new THREE.Color('#ffd9b0')
    const outside = new THREE.Color('#45265c')
    const bulge = new THREE.Color('#ffe6c4')
    const mixed = new THREE.Color()

    const gauss = () => rand() + rand() + rand() - 1.5
    // particle budget: the NINE CHARACTER TAILS radiating from the core, a
    // diffuse disk for volume, and a gunungan-profile core (tall bulge)
    const tailCount = Math.floor(count * 0.46)

    // per-tail particle share: identical arcs — symmetry through form,
    // distinction through character shade
    const perTail = Math.floor(tailCount / characterValues.length)

    const CORE_R = 8.5
    const TAIL_TIP = GALAXY_RADIUS + 2
    const TAIL_SWEEP = 1.15 // shared curl — every tail has the same shape
    const TAIL_ARC = 1.1 // shared gentle arch

    let idx = 0
    characterValues.forEach((c, k) => {
      const baseAngle = (k / characterValues.length) * Math.PI * 2
      const tailColor = new THREE.Color().setHSL(c.hue / 360, c.sat, c.light)

      for (let n = 0; n < perTail; n++, idx++) {
        const i3 = idx * 3
        const tt = rand()
        let ang = baseAngle + tt * TAIL_SWEEP
        ang += Math.sin(tt * 34.0 + k * 2.4) * 0.018 // hairline ripple
        const r = CORE_R + tt * (TAIL_TIP - CORE_R) + (rand() - 0.5) * 2.2

        const offset = gauss() * 2.0 * (0.35 + tt * 1.1)
        const px = -Math.sin(ang)
        const pz = Math.cos(ang)
        const x = Math.cos(ang) * r + px * offset
        const z = Math.sin(ang) * r + pz * offset
        const y = Math.sin(tt * Math.PI) * TAIL_ARC + gauss() * 0.9

        // brighter along the spine, softening toward the rim
        const spine = 1 - Math.min(Math.abs(offset) / 3.6, 1)
        let shade = 0.55 + spine * 0.5 + rand() * 0.35
        let sparkleSize = 1
        if (rand() < 0.09) {
          sparkleSize = 1.5
          shade *= 1.3
        }

        positions[i3] = x
        positions[i3 + 1] = y
        positions[i3 + 2] = z

        mixed.copy(tailColor).lerp(inside, (1 - tt) * 0.4).lerp(outside, tt * 0.2)
        colors[i3] = mixed.r * shade
        colors[i3 + 1] = mixed.g * shade
        colors[i3 + 2] = mixed.b * shade

        scales[idx] = (0.35 + Math.pow(rand(), 3) * 2.0) * sparkleSize
      }
    })
    // gunungan core: a tall, mountain-profiled central bulge
    const coreEnd = Math.min(count, tailCount + Math.floor(count * 0.2))
    for (let i = tailCount; i < coreEnd; i++) {
      const i3 = i * 3
      const r = Math.pow(rand(), 1.6) * 9.5
      const angle = rand() * Math.PI * 2
      positions[i3] = Math.cos(angle) * r
      positions[i3 + 1] = gauss() * (4.2 * Math.pow(1 - r / 9.5, 1.4) + 0.5)
      positions[i3 + 2] = Math.sin(angle) * r

      mixed.copy(bulge).lerp(inside, rand() * 0.6)
      const shade = 0.9 + rand() * 0.7
      colors[i3] = mixed.r * shade
      colors[i3 + 1] = mixed.g * shade
      colors[i3 + 2] = mixed.b * shade

      scales[i] = 0.35 + Math.pow(rand(), 3) * 2.2
    }

    // the diffuse disk fills the rest, giving the galaxy volume
    for (let i = coreEnd; i < count; i++) {
      const i3 = i * 3
      const r = Math.pow(rand(), 0.62) * radius
      const angle = rand() * Math.PI * 2 + (r / radius) * 2.0
      positions[i3] = Math.cos(angle) * r
      positions[i3 + 1] = gauss() * 2.4 * (1.2 - (r / radius) * 0.8)
      positions[i3 + 2] = Math.sin(angle) * r

      mixed
        .copy(inside)
        .lerp(outside, THREE.MathUtils.clamp(r / radius + (rand() - 0.5) * 0.24, 0, 1))
      const shade = 0.5 + rand() * 0.45
      colors[i3] = mixed.r * shade
      colors[i3 + 1] = mixed.g * shade
      colors[i3 + 2] = mixed.b * shade

      scales[i] = 0.35 + Math.pow(rand(), 3) * 2.2
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
    geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1))

    return {
      geometry: geo,
      uniforms: {
        uTime: { value: reduced ? 40 : 0 },
        uSize: { value: 240 },
        uPixelRatio: { value: 1 },
        // darker pockets behind the clickable systems (static positions)
        uClear: {
          value: allEntities.filter((e) => e.kind === 'sun').map((s) => s.center.clone()),
        },
      },
    }
    // rebuild when quality tier changes particle count
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count])

  useFrame((_, delta) => {
    const mat = matRef.current
    if (!mat) return
    if (!reduced) mat.uniforms.uTime.value += delta
    mat.uniforms.uPixelRatio.value = dpr
  })

  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={-2}>
      <shaderMaterial
        ref={matRef}
        vertexShader={galaxyVertexShader}
        fragmentShader={galaxyFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}
