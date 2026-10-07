import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Bloom, ChromaticAberration, EffectComposer, Vignette } from '@react-three/postprocessing'
import type { BloomEffect, ChromaticAberrationEffect } from 'postprocessing'
import { fx } from './runtime'
import { useGalaxy } from '../state/useGalaxy'

/**
 * Post-processing: bloom for the glow, a vignette for cinema framing, and
 * chromatic aberration whose strength rides the warp energy channel.
 * On low-end devices the whole composer is skipped — the glows are additive
 * and read well without it, and the composer is the heaviest per-pixel cost.
 */
export function Effects() {
  const quality = useGalaxy((s) => s.quality)
  const bloomOn = useGalaxy((s) => s.bloomOn)
  const bloomRef = useRef<BloomEffect>(null)
  const caRef = useRef<ChromaticAberrationEffect>(null)
  const initialOffset = useMemo(() => new THREE.Vector2(0.0011, 0.0008), [])

  useFrame(() => {
    if (bloomRef.current) {
      bloomRef.current.intensity = 0.85 + fx.warp * 1.0
    }
    if (caRef.current) {
      const k = fx.warp
      caRef.current.offset.set(0.0011 + k * 0.0042, 0.0008 + k * 0.0032)
    }
  })

  if (!bloomOn) return null

  return (
    <EffectComposer multisampling={0}>
      <Bloom
        ref={bloomRef}
        mipmapBlur
        intensity={0.85}
        luminanceThreshold={0.16}
        luminanceSmoothing={0.3}
        radius={quality === 'low' ? 0.7 : 0.85}
      />
      <ChromaticAberration ref={caRef} offset={initialOffset} />
      <Vignette eskil={false} offset={0.24} darkness={0.68} />
    </EffectComposer>
  )
}
