import { lazy, Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Scene } from './three/Scene'
import { Hud } from './ui/Hud'
import { InfoCard } from './ui/InfoCard'
import { CommandPalette } from './ui/CommandPalette'
import { SettingsDrawer } from './ui/SettingsDrawer'
import { Preloader } from './ui/Preloader'
import { FallbackList } from './ui/FallbackList'
import { useGalaxy } from './state/useGalaxy'
import { useKeyboard, useDeepLink } from './hooks/useKeyboard'
import { useAdaptiveQuality } from './hooks/useAdaptiveQuality'
import { audio } from './audio/audio'

// the link manager is a standalone page — keep it out of the main bundle
const ConfigPage = lazy(() =>
  import('./ui/ConfigPage').then((m) => ({ default: m.ConfigPage })),
)

/** bridges the adaptive-quality hook into the canvas render loop */
function QualityGovernor() {
  useAdaptiveQuality()
  return null
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'))
  } catch {
    return false
  }
}

export default function App() {
  // #/config is the standalone link manager — no canvas, no scene hooks
  const [route] = useState(() => window.location.hash)
  if (route === '#/config') {
    return (
      <Suspense fallback={null}>
        <ConfigPage />
      </Suspense>
    )
  }

  const [webgl] = useState(webglAvailable)
  const preloaderDone = useGalaxy((s) => s.preloaderDone)
  const audioOn = useGalaxy((s) => s.settings.audio)
  // ?pxdebug keeps the drawing buffer readable for pixel probes
  const [pxdebug] = useState(() => new URLSearchParams(window.location.search).has('pxdebug'))

  useKeyboard()
  useDeepLink()

  useEffect(() => {
    audio.setEnabled(audioOn)
  }, [audioOn])

  if (!webgl) return <FallbackList />

  return (
    <>
      <Canvas
        className="galaxy-canvas"
        camera={{ position: [0, 55, 88], fov: 58, near: 0.1, far: 3000 }}
        dpr={[1, 2]}
        gl={{
          antialias: false,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: pxdebug,
          stencil: false,
        }}
      >
        <color attach="background" args={['#050208']} />
        <Scene />
        <QualityGovernor />
      </Canvas>

      {!preloaderDone && <Preloader />}
      <Hud />
      <InfoCard />
      <CommandPalette />
      <SettingsDrawer />
    </>
  )
}
