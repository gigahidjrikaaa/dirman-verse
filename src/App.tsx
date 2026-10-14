import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Scene } from './three/Scene'
import { Hud } from './ui/Hud'
import { InfoCard } from './ui/InfoCard'
import { CommandPalette } from './ui/CommandPalette'
import { SettingsDrawer } from './ui/SettingsDrawer'
import { Preloader } from './ui/Preloader'
import { FallbackList } from './ui/FallbackList'
import { LoginPage } from './ui/LoginPage'
import { useGalaxy } from './state/useGalaxy'
import { useKeyboard, useDeepLink } from './hooks/useKeyboard'
import { useAdaptiveQuality } from './hooks/useAdaptiveQuality'
import { audio } from './audio/audio'
import {
  AuthError,
  clearAuth,
  fetchSession,
  loadAuth,
  type DexUser,
} from './lib/backend'

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
  // auth gate: checking (stored token being validated) → login | ready.
  // Everything — galaxy and link manager — sits behind the Dex login.
  const [authPhase, setAuthPhase] = useState<'checking' | 'login' | 'ready'>(() =>
    loadAuth() ? 'checking' : 'login',
  )
  const [user, setUser] = useState<DexUser | null>(() => loadAuth()?.user ?? null)

  useEffect(() => {
    if (authPhase !== 'checking') return
    let cancelled = false
    fetchSession()
      .then((s) => {
        if (cancelled) return
        setUser(s.user)
        setAuthPhase('ready')
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof AuthError) {
          clearAuth()
          setUser(null)
          setAuthPhase('login')
        } else {
          // server unreachable — let a previously signed-in user through;
          // publishing will surface a clear error later
          setAuthPhase('ready')
        }
      })
    return () => {
      cancelled = true
    }
  }, [authPhase])

  const handleSignedIn = useCallback((u: DexUser) => {
    setUser(u)
    setAuthPhase('ready')
  }, [])
  const handleSignOut = useCallback(() => {
    setUser(null)
    setAuthPhase('login')
  }, [])

  if (authPhase !== 'ready') {
    return <LoginPage onDone={handleSignedIn} checking={authPhase === 'checking'} />
  }

  return <RoutedApp user={user} onSignOut={handleSignOut} />
}

/** reactive hash route: #/config = link manager, anything else = the galaxy */
function RoutedApp({
  user,
  onSignOut,
}: {
  user: DexUser | null
  onSignOut: () => void
}) {
  const [route, setRoute] = useState(() => window.location.hash)
  useEffect(() => {
    const h = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', h)
    window.addEventListener('popstate', h)
    return () => {
      window.removeEventListener('hashchange', h)
      window.removeEventListener('popstate', h)
    }
  }, [])

  if (route === '#/config') {
    return (
      <Suspense fallback={null}>
        <ConfigPage onSignOut={onSignOut} />
      </Suspense>
    )
  }
  return <GalaxyApp key={user ? 'authed' : 'anon'} />
}

function GalaxyApp() {
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
