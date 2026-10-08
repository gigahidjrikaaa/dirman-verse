import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useGalaxy } from './state/useGalaxy'
import { setGalaxyData } from './data/links'
import { normalizeGalaxy } from './data/galaxyData'
import { backendConfigured, fetchBackendStatus } from './lib/backend'
import { galaxyClock } from './three/runtime'
import './index.css'

// dev-only debug handles for console debugging of the galaxy state machine
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__galaxy = useGalaxy
  ;(window as unknown as Record<string, unknown>).__galaxyTime = galaxyClock
}

/**
 * Boot chain: if a backend is configured, the published dataset is fetched
 * first (≤2.5s) so the galaxy renders with it; otherwise we boot straight
 * from localStorage/defaults. The static #boot splash covers the wait.
 */
async function boot() {
  if (backendConfigured()) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 2500)
      const status = await fetchBackendStatus(ctrl.signal)
      clearTimeout(timer)
      if (status.data) {
        const clean = normalizeGalaxy(status.data)
        if (clean) setGalaxyData(clean)
      }
    } catch {
      // backend unreachable — fall back to localStorage/defaults
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

  // fade out the static splash just after React mounts
  requestAnimationFrame(() => {
    const bootEl = document.getElementById('boot')
    if (bootEl) {
      bootEl.classList.add('boot-out')
      setTimeout(() => bootEl.remove(), 700)
    }
  })
}

void boot()
