import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useGalaxy } from './state/useGalaxy'
import { setGalaxyData } from './data/links'
import { normalizeGalaxy } from './data/galaxyData'
import { fetchGalaxy } from './lib/backend'
import { galaxyClock } from './three/runtime'
import './index.css'

// dev-only debug handles for console debugging of the galaxy state machine
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__galaxy = useGalaxy
  ;(window as unknown as Record<string, unknown>).__galaxyTime = galaxyClock
}

/**
 * Boot chain: fetch the published dataset from the configured backend
 * (≤2.5s) so the galaxy renders with it; fall back to localStorage and
 * built-in defaults when unreachable. The static #boot splash covers
 * the wait.
 */
async function boot() {
  try {
    const data = await fetchGalaxy()
    if (data) {
      const clean = normalizeGalaxy(data)
      if (clean) setGalaxyData(clean)
    }
  } catch {
    // backend unreachable — fall back to localStorage/defaults
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
