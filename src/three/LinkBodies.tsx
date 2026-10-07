import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { starVertexShader, starFragmentShader } from '../shaders/star.glsl'
import { useGalaxy } from '../state/useGalaxy'
import { allEntities, entityWorldPos } from '../data/links'
import { updatePickEntry } from './input'
import { galaxyClock } from './runtime'

/**
 * The navigable layer: every sun / planet / moon as one instanced draw call.
 * Each frame it advances the galaxy clock, writes body world positions into
 * the instance buffer and projects screen-space pick radii for the pointer
 * controller.
 */
export function LinkBodies() {
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const hoverGroupRef = useRef<THREE.Group>(null)
  const hoveredId = useGalaxy((s) => s.hoveredId)
  const selectedId = useGalaxy((s) => s.selectedId)
  const charted = useGalaxy((s) => s.charted)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)

  // one extra beam instance per sun — vertical light pillars over systems
  const sunCount = useMemo(() => allEntities.filter((e) => e.kind === 'sun').length, [])
  const count = allEntities.length + sunCount

  const { geometry, uniforms } = useMemo(() => {
    const centers = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const phases = new Float32Array(count)
    const kinds = new Float32Array(count)
    const chartedFlags = new Float32Array(count)
    const indices = new Float32Array(count)
    const styles = new Float32Array(count)
    const seeds = new Float32Array(count)

    allEntities.forEach((e, i) => {
      centers[i * 3] = e.center.x
      centers[i * 3 + 1] = e.center.y
      centers[i * 3 + 2] = e.center.z
      colors[i * 3] = e.color.r
      colors[i * 3 + 1] = e.color.g
      colors[i * 3 + 2] = e.color.b
      sizes[i] = e.size * (e.kind === 'sun' ? 1.25 : 1.0)
      phases[i] = (i * 0.618) % 1
      kinds[i] = e.kind === 'sun' ? 1 : 0
      chartedFlags[i] = 0
      indices[i] = i
      styles[i] = e.style
      seeds[i] = e.seed
    })

    // beacon pillars (aKind = 2): one per sun, rising from its center
    const suns = allEntities.filter((e) => e.kind === 'sun')
    suns.forEach((s, j) => {
      const i = allEntities.length + j
      centers[i * 3] = s.center.x
      centers[i * 3 + 1] = s.center.y
      centers[i * 3 + 2] = s.center.z
      colors[i * 3] = s.color.r
      colors[i * 3 + 1] = s.color.g
      colors[i * 3 + 2] = s.color.b
      sizes[i] = s.size
      phases[i] = (j * 0.383) % 1
      kinds[i] = 2 // beacon beam
      chartedFlags[i] = 0
      indices[i] = -2 // never hover/selected
      styles[i] = 0
      seeds[i] = (i * 0.383) % 1
    })

    const geo = new THREE.PlaneGeometry(1, 1)
    geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(centers, 3))
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3))
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 1))
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1))
    geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kinds, 1))
    geo.setAttribute('aCharted', new THREE.InstancedBufferAttribute(chartedFlags, 1))
    geo.setAttribute('aIndex', new THREE.InstancedBufferAttribute(indices, 1))
    geo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(styles, 1))
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1))

    return {
      geometry: geo,
      uniforms: {
        uTime: { value: 0 },
        uHoverIndex: { value: -1 },
        uSelectedIndex: { value: -1 },
      },
    }
  }, [count, sunCount])

  const indexById = useMemo(() => {
    const m = new Map<string, number>()
    allEntities.forEach((e) => m.set(e.id, e.index))
    return m
  }, [])

  // keep the charted flags in sync with persisted discovery state
  useEffect(() => {
    const attr = geometry.getAttribute('aCharted') as THREE.InstancedBufferAttribute
    const set = new Set(charted)
    allEntities.forEach((e) => {
      attr.array[e.index] = e.kind !== 'sun' && set.has(e.id) ? 1 : 0
    })
    attr.needsUpdate = true
  }, [charted, geometry])

  useEffect(() => {
    if (!matRef.current) return
    matRef.current.uniforms.uSelectedIndex.value = selectedId ? (indexById.get(selectedId) ?? -1) : -1
  }, [selectedId, indexById])

  useEffect(() => {
    if (!matRef.current) return
    matRef.current.uniforms.uHoverIndex.value = hoveredId ? (indexById.get(hoveredId) ?? -1) : -1
  }, [hoveredId, indexById])

  // pointer cursor while hovering a body
  useEffect(() => {
    document.body.style.cursor = hoveredId ? 'pointer' : 'auto'
    return () => {
      document.body.style.cursor = 'auto'
    }
  }, [hoveredId])

  // dev-only debug handle to the body mesh
  useEffect(() => {
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__bodyMesh = () => meshRef.current
      ;(window as unknown as Record<string, unknown>).__readPixel = (
        ndcX: number,
        ndcY: number,
      ) => {
        const glCtx = gl.getContext()
        const w = glCtx.drawingBufferWidth
        const h = glCtx.drawingBufferHeight
        const px = Math.floor((ndcX * 0.5 + 0.5) * w)
        const py = Math.floor((1 - (ndcY * 0.5 + 0.5)) * h)
        const buf = new Uint8Array(4)
        glCtx.readPixels(px, py, 1, 1, glCtx.RGBA, glCtx.UNSIGNED_BYTE, buf)
        return { px, py, rgba: [...buf] }
      }
    }
  }, [])

  const hoveredEntity = hoveredId ? allEntities.find((e) => e.id === hoveredId) : undefined

  // scratch vectors — the per-frame loop must not allocate (GC churn on
  // weak devices) — and one shared projection scratch
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const ndc = useMemo(() => new THREE.Vector3(), [])

  useFrame((state, delta) => {
    const mat = matRef.current
    const attr = geometry.getAttribute('aCenter') as THREE.InstancedBufferAttribute
    if (!mat || !attr) return

    if (!useGalaxy.getState().settings.reducedMotion) galaxyClock.t += delta
    mat.uniforms.uTime.value = state.clock.elapsedTime

    const arr = attr.array as Float32Array
    const halfH = size.height / 2
    const fovRad = ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 180
    const tanHalf = Math.tan(fovRad / 2)

    for (const e of allEntities) {
      entityWorldPos(e, galaxyClock.t, tmp)
      arr[e.index * 3] = tmp.x
      arr[e.index * 3 + 1] = tmp.y
      arr[e.index * 3 + 2] = tmp.z

      // screen-space pick entry (scratch vector — no allocation)
      ndc.copy(tmp).project(camera)
      if (ndc.z > 1 || ndc.z < -1) {
        updatePickEntry(e.id, -9999, -9999, 0, e)
      } else {
        const px = (ndc.x * 0.5 + 0.5) * size.width
        const py = (-ndc.y * 0.5 + 0.5) * size.height
        const dist = tmp.distanceTo(camera.position)
        const rPx = (e.size / Math.max(dist * tanHalf, 0.001)) * halfH
        updatePickEntry(e.id, px, py, rPx, e)
      }
    }
    attr.needsUpdate = true

    // position the hover label over the hovered body
    if (hoverGroupRef.current && hoveredId) {
      const e = allEntities.find((x) => x.id === hoveredId)
      if (e) {
        entityWorldPos(e, galaxyClock.t, tmp)
        tmp.y += e.size * 0.9
        hoverGroupRef.current.position.copy(tmp)
      }
    }
  })

  return (
    <group>
      {/* instancedMesh is required — a plain mesh would draw only instance 0.
          Instanced attributes live only on the geometry (created in useMemo):
          declaring them again in JSX would create a second attribute object
          over the same array and the renderer could bind a stale buffer. */}
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, count]}
        geometry={geometry}
        frustumCulled={false}
        renderOrder={1}
      >
        <shaderMaterial
          ref={matRef}
          vertexShader={starVertexShader}
          fragmentShader={starFragmentShader}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </instancedMesh>

      {hoveredEntity && (
        <group ref={hoverGroupRef}>
          <Html center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
            <div className="star-label">
              <span className={`star-label-dot ${hoveredEntity.kind}`} />
              {hoveredEntity.name}
              <span className="star-label-hint">
                {hoveredEntity.kind === 'sun' ? 'system' : 'click to warp'}
              </span>
            </div>
          </Html>
        </group>
      )}
    </group>
  )
}
