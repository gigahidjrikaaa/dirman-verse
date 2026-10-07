import { useGalaxy } from '../state/useGalaxy'
import { totalBodyCount } from '../data/links'
import { characterValues, characterCssColor } from '../data/characters'
import { audio } from '../audio/audio'

export function SettingsDrawer() {
  const open = useGalaxy((s) => s.settingsOpen)
  const setOpen = useGalaxy((s) => s.setSettingsOpen)
  const settings = useGalaxy((s) => s.settings)
  const toggleAudio = useGalaxy((s) => s.toggleAudio)
  const toggleReducedMotion = useGalaxy((s) => s.toggleReducedMotion)
  const charted = useGalaxy((s) => s.charted)

  if (!open) return null

  return (
    <div className="drawer-backdrop" onClick={() => setOpen(false)}>
      <aside className="drawer glass" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>Flight settings</h2>
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close settings">✕</button>
        </div>

        <label className="drawer-row">
          <span>
            Ambient sound
            <small>synthesized deep-space drone</small>
          </span>
          <input
            type="checkbox"
            checked={settings.audio}
            onChange={() => {
              toggleAudio()
              audio.setEnabled(!settings.audio)
            }}
          />
        </label>

        <label className="drawer-row">
          <span>
            Reduced motion
            <small>freezes drift, twinkle and warp travel</small>
          </span>
          <input type="checkbox" checked={settings.reducedMotion} onChange={toggleReducedMotion} />
        </label>

        <div className="drawer-row static">
          <span>
            Exploration log
            <small>{charted.length} of {totalBodyCount} worlds charted — stored in this browser</small>
          </span>
          <button
            className="btn ghost small"
            onClick={() => {
              localStorage.removeItem('dirman-galaxy-charted')
              useGalaxy.setState({ charted: [] })
              useGalaxy.getState().setToast('Discovery log wiped — the galaxy is uncharted again')
            }}
          >
            Reset
          </button>
        </div>

        <div className="drawer-row static">
          <span>
            Link manager
            <small>add, edit and remove links without touching code</small>
          </span>
          <button
            className="btn ghost small"
            onClick={() => {
              window.location.hash = '#/config'
              window.location.reload()
            }}
          >
            Open ↗
          </button>
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">★ The Nine Characters</div>
          <p className="drawer-section-sub">
            Each tail of the galaxy carries one — the potentials of a Sudirman batch.
          </p>
          <ul className="chars-list">
            {characterValues.map((c) => (
              <li key={c.id}>
                <span
                  className="char-dot"
                  style={{
                    background: characterCssColor(c),
                    boxShadow: `0 0 10px ${characterCssColor(c)}`,
                  }}
                />
                <span className="char-name">
                  {c.name}
                  <small>{c.alt}</small>
                </span>
                <span className="char-desc">{c.desc}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="drawer-foot">
          <p>
            Add or edit destinations in <code>src/data/links.ts</code> — sectors become
            spiral arms, systems become suns, and every body is a link.
          </p>
          <p className="keys">
            <kbd>←</kbd><kbd>→</kbd> cycle · <kbd>Enter</kbd> open · <kbd>Esc</kbd> back ·
            <kbd>⌘K</kbd> search · <kbd>F</kbd> free-fly · <kbd>M</kbd> sound
          </p>
        </div>
      </aside>
    </div>
  )
}
