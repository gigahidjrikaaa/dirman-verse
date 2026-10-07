import { useEffect, useRef } from 'react'
import { useGalaxy } from '../state/useGalaxy'
import { getEntity, totalBodyCount, totalSystemCount } from '../data/links'
import { audio } from '../audio/audio'

export function Hud() {
  const preloaderDone = useGalaxy((s) => s.preloaderDone)
  const mode = useGalaxy((s) => s.mode)
  const charted = useGalaxy((s) => s.charted)
  const settings = useGalaxy((s) => s.settings)
  const toggleAudio = useGalaxy((s) => s.toggleAudio)
  const setPaletteOpen = useGalaxy((s) => s.setPaletteOpen)
  const setSettingsOpen = useGalaxy((s) => s.setSettingsOpen)
  const selectedId = useGalaxy((s) => s.selectedId)
  const toast = useGalaxy((s) => s.toast)
  const setToast = useGalaxy((s) => s.setToast)
  const announced = useRef('')

  // auto-dismiss toasts
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(t)
  }, [toast, setToast])

  // screen-reader announcements for selection changes
  useEffect(() => {
    const e = getEntity(selectedId)
    announced.current = e ? `${e.name}, ${e.sectorName}` : ''
  }, [selectedId])

  const pct = Math.round((charted.length / totalBodyCount) * 100)

  const hint =
    mode === 'warp'
      ? 'warping…'
      : mode === 'focus'
        ? 'drag to orbit · scroll to zoom · Enter opens the link · Esc returns'
        : mode === 'fly'
          ? 'WASD thrust · SHIFT boost · drag to look · F to land'
          : 'drag to orbit · scroll to zoom · click a star to warp'

  return (
    <div className={`hud ${preloaderDone ? 'hud-in' : 'hud-hidden'}`}>
      <header className="hud-top">
        <div className="brand">
          <div className="brand-title">DIRMAN GALAXY</div>
          <div className="brand-sub">a war map of links · {totalSystemCount} systems · {totalBodyCount} worlds</div>
        </div>
        <nav className="hud-actions" aria-label="Galaxy controls">
          <button className="hud-btn" onClick={() => setPaletteOpen(true)}>
            <span aria-hidden>⌕</span> Search <kbd>⌘K</kbd>
          </button>
          <button
            className="hud-btn"
            onClick={() => {
              toggleAudio()
              audio.setEnabled(!settings.audio)
            }}
            aria-pressed={settings.audio}
            aria-label={settings.audio ? 'Mute ambience' : 'Play ambience'}
          >
            {settings.audio ? '◉ sound' : '◌ muted'}
          </button>
          <button className="hud-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
            ⚙
          </button>
        </nav>
      </header>

      <div className="hud-bottom">
        <div className="charted" title="Links you have visited">
          <div className="charted-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Galaxy charted">
            <div className="charted-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="charted-label">charted {charted.length}/{totalBodyCount} · {pct}%</span>
        </div>
        <div className={`hint ${mode}`} key={mode}>{hint}</div>
      </div>

      {toast && <div className="toast glass">{toast}</div>}

      <div className="sr-only" aria-live="polite">{announced.current}</div>
    </div>
  )
}
