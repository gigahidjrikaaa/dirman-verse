import { useEffect, useState } from 'react'
import { useGalaxy } from '../state/useGalaxy'
import { allEntities, getEntity, type Entity } from '../data/links'
import { audio } from '../audio/audio'

function open(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** github.com/dirman instead of https://github.com/dirman/ */
function prettyUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') + new URL(url).pathname.replace(/\/$/, '')
  } catch {
    return url
  }
}

export function InfoCard() {
  const selectedId = useGalaxy((s) => s.selectedId)
  const select = useGalaxy((s) => s.select)
  const charted = useGalaxy((s) => s.charted)
  const setToast = useGalaxy((s) => s.setToast)
  const selected = getEntity(selectedId)

  // keep the last card mounted briefly so it can animate out
  const [display, setDisplay] = useState<Entity | null>(null)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (selected) {
      setDisplay(selected)
      setClosing(false)
      return
    }
    setClosing(true)
    const t = setTimeout(() => {
      setDisplay(null)
      setClosing(false)
    }, 300)
    return () => clearTimeout(t)
  }, [selected])

  const entity = display
  if (!entity) return null

  const chartedSet = new Set(charted)
  const siblings = allEntities.filter((e) => e.kind !== 'sun' && e.systemId === entity.systemId)
  const hue = entity.sectorHue

  const share = () => {
    const url = `${window.location.origin}${window.location.pathname}?focus=${entity.id}`
    navigator.clipboard?.writeText(url).then(
      () => setToast('🔗 Star link copied to clipboard'),
      () => setToast('Could not copy the link'),
    )
  }

  return (
    <aside
      key={entity.id}
      className={`info-card glass ${closing ? 'card-out' : ''}`}
      aria-label={`${entity.name} details`}
    >
      <button className="icon-btn card-close" onClick={() => select(null)} aria-label="Close">
        ✕
      </button>

      <div className="card-sector" style={{ ['--sector' as string]: `hsl(${hue} 80% 65%)` }}>
        {entity.sectorName}
        {entity.kind !== 'sun' && chartedSet.has(entity.id) && (
          <span className="charted-badge" title="You have visited this world">✦ charted</span>
        )}
      </div>

      <h2 className="card-title">
        <span className={`card-kind ${entity.kind}`} aria-hidden />
        {entity.name}
        {entity.kind === 'sun' && (
          <span className="rank-stars" title="System importance" aria-label={`${entity.importance ?? 2} rank stars`}>
            {'★'.repeat(entity.importance ?? 2)}
          </span>
        )}
      </h2>
      <div className="card-system">{entity.kind === 'sun' ? 'star system' : `orbiting ${entity.systemName}`}</div>

      {entity.url && (
        <a
          className="card-url"
          href={entity.url}
          target="_blank"
          rel="noopener noreferrer"
          title={entity.url}
        >
          <span className="card-url-glyph" aria-hidden>⛓</span>
          <span className="card-url-text">{prettyUrl(entity.url)}</span>
          <span className="card-url-ext" aria-hidden>↗</span>
        </a>
      )}

      {entity.description && <p className="card-desc">{entity.description}</p>}

      <div className="card-actions">
        {entity.url && (
          <button className="btn primary" onClick={() => open(entity.url!)}>
            Open link <span aria-hidden>↗</span>
          </button>
        )}
        <button className="btn ghost" onClick={share}>Share star</button>
      </div>

      {entity.kind === 'sun' && siblings.length > 0 && (
        <div className="card-related">
          <div className="related-label">Planets of this system</div>
          <ul>
            {siblings.map((b) => (
              <li key={b.id}>
                <button
                  className="related-btn"
                  onClick={() => {
                    select(b.id)
                    audio.blip()
                  }}
                >
                  <span className={`card-kind ${b.kind}`} aria-hidden />
                  {b.name}
                  {chartedSet.has(b.id) && <span className="related-charted">✦</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}
