import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { allEntities } from '../data/links'
import { useGalaxy } from '../state/useGalaxy'
import { ringVertexShader, ringFragmentShader } from '../shaders/ring.glsl'

const RING_SEGMENTS = 96

/**
 * Orbit lines for the clickable systems — merged into ONE LineSegments draw
 * call with a custom shader: a comet-head sweep travels each ring, fine dust
 * ticks ride the line, and every ring has a dimmer halo twin just outside it
 * for a soft glow. All motion lives in the shader (zero CPU per frame).
 */
export function Systems() {
  const reduced = useGalaxy((s) => s.settings.reducedMotion)

  const geometry = useMemo(() => {
    const gold = new THREE.Color('#e8b84b')
    const positions: number[] = []
    const colors: number[] = []
    const ts: number[] = []
    const phases: number[] = []
    const brights: number[] = []

    const suns = allEntities.filter((e) => e.kind === 'sun')
    for (const sun of suns) {
      const ringColor = new THREE.Color()
        .setHSL(sun.sectorHue / 360, 0.55, 0.58)
        .lerp(gold, 0.5)
      const phase = Math.random() * Math.PI * 2
      const orbiters = allEntities.filter(
        (e) => e.kind !== 'sun' && e.systemId === sun.systemId && e.orbit,
      )

      const pushRing = (radius: number, bright: number) => {
        for (let s = 0; s < RING_SEGMENTS; s++) {
          const t0 = s / RING_SEGMENTS
          const t1 = (s + 1) / RING_SEGMENTS
          const a0 = t0 * Math.PI * 2
          const a1 = t1 * Math.PI * 2
          positions.push(
            sun.center.x + Math.cos(a0) * radius,
            sun.center.y,
            sun.center.z + Math.sin(a0) * radius,
            sun.center.x + Math.cos(a1) * radius,
            sun.center.y,
            sun.center.z + Math.sin(a1) * radius,
          )
          for (const c of [ringColor.r, ringColor.g, ringColor.b, ringColor.r, ringColor.g, ringColor.b])
            colors.push(c)
          ts.push(t0, t1)
          phases.push(phase, phase)
          brights.push(bright, bright)
        }
      }

      for (const orb of orbiters) {
        pushRing(orb.orbit!.radius, 1.0) // main line
        pushRing(orb.orbit!.radius * 1.04, 0.32) // halo twin just outside
      }
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3))
    geo.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 1))
    geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1))
    geo.setAttribute('aBright', new THREE.Float32BufferAttribute(brights, 1))
    return geo
  }, [])

  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uFlow: { value: reduced ? 0 : 1 } }),
    // uFlow follows the reduced-motion setting
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  useEffect(() => {
    uniforms.uFlow.value = reduced ? 0 : 1
  }, [reduced, uniforms])

  useFrame((_, delta) => {
    if (reduced) return
    uniforms.uTime.value += delta
  })

  return (
    <lineSegments geometry={geometry} frustumCulled={false} renderOrder={0}>
      <shaderMaterial
        vertexShader={ringVertexShader}
        fragmentShader={ringFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </lineSegments>
  )
}
