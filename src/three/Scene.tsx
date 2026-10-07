import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import { GalaxyBackdrop } from './GalaxyBackdrop'
import { MarchRoute } from './MarchRoute'
import { Nebulae } from './Nebulae'
import { SectorLabels } from './SectorLabels'
import { Systems } from './Systems'
import { LinkBodies } from './LinkBodies'
import { Comet } from './Comet'
import { CameraRig } from './CameraRig'
import { Effects } from './Effects'
import { useGalaxy } from '../state/useGalaxy'

/** fires `ready` once the scene has actually painted frames — releases the preloader */
function ReadinessProbe() {
  const setReady = useGalaxy((s) => s.setReady)
  const frames = useRef(0)
  const done = useRef(false)
  useFrame(() => {
    if (done.current) return
    frames.current++
    if (frames.current >= 3) {
      done.current = true
      setReady(true)
    }
  })
  return null
}

function FarStars() {
  const quality = useGalaxy((s) => s.quality)
  const reduced = useGalaxy((s) => s.settings.reducedMotion)
  const count = quality === 'high' ? 9000 : quality === 'medium' ? 5000 : 1500
  return (
    <Stars
      radius={340}
      depth={90}
      count={count}
      factor={5.2}
      saturation={0.45}
      fade
      speed={reduced ? 0 : 0.6}
    />
  )
}

export function Scene() {
  const quality = useGalaxy((s) => s.quality)
  // debug toggles for bisecting render issues: ?nocomet / ?nofx
  const [skipComet, skipFx] = useMemo(() => {
    const p = new URLSearchParams(window.location.search)
    return [p.has('nocomet'), p.has('nofx')]
  }, [])

  // far-field quality tier is applied via a keyed remount so drei Stars rebuilds
  return (
    <>
      <GalaxyBackdrop key={`bg-${quality}`} />
      <FarStars key={`stars-${quality}`} />
      <Nebulae />
      <MarchRoute />
      <Systems />
      <SectorLabels />
      <LinkBodies />
      {!skipComet && <Comet />}
      <CameraRig />
      {!skipFx && <Effects />}
      <ReadinessProbe />
    </>
  )
}
