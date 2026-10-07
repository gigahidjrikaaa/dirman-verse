import { galaxy, flatLinks } from '../data/links'

/**
 * No-WebGL / crawlers fallback: the full galaxy as a plain readable list
 * of real hyperlinks, grouped by sector.
 */
export function FallbackList() {
  return (
    <div className="fallback">
      <header>
        <h1>Dirman Galaxy</h1>
        <p>
          Your browser can’t render the 3D universe (WebGL unavailable), so here is
          the same galaxy as a plain map of links.
        </p>
      </header>
      {galaxy.sectors.map((sector) => (
        <section key={sector.id}>
          <h2 style={{ color: `hsl(${sector.hue} 80% 68%)` }}>{sector.name}</h2>
          {sector.systems.map((sys) => (
            <div key={sys.id} className="fallback-system">
              <h3>
                {sys.url ? (
                  <a href={sys.url} target="_blank" rel="noopener noreferrer">{sys.name} ↗</a>
                ) : (
                  sys.name
                )}
              </h3>
              <ul>
                {sys.bodies.map((b) => (
                  <li key={b.id}>
                    <a href={b.url} target="_blank" rel="noopener noreferrer">
                      {b.name} ↗
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      <footer>
        <p>{flatLinks.length} destinations · enable JavaScript + WebGL for the full experience.</p>
      </footer>
    </div>
  )
}
