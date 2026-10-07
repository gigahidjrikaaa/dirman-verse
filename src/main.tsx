import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useGalaxy } from './state/useGalaxy'
import { galaxyClock } from './three/runtime'
import './index.css'

// dev-only debug handles for console debugging of the galaxy state machine
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__galaxy = useGalaxy
  ;(window as unknown as Record<string, unknown>).__galaxyTime = galaxyClock
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
