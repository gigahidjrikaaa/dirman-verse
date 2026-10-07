import { useEffect, useState } from 'react'
import {
  DEFAULT_GALAXY,
  exportGalaxyJson,
  loadGalaxyData,
  normalizeGalaxy,
  parseGalaxyJson,
  resetGalaxyData,
  saveGalaxyData,
  slugify,
  withUrlScheme,
  type BodyDef,
  type GalaxyData,
  type SectorDef,
  type SystemDef,
} from '../data/galaxyData'

const SUN_STYLES = ['auto', 'classic', 'giant', 'flame', 'pulse', 'binary']
const BODY_STYLES = ['auto', 'terran', 'gas', 'ice', 'lava', 'ringed', 'rock']

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

function newId(name: string): string {
  return `${slugify(name) || 'link'}-${Math.random().toString(36).slice(2, 5)}`
}

/**
 * #/config — the in-app link manager. Edits live in localStorage; the galaxy
 * boots from the saved dataset until reset. Export the JSON to bake changes
 * into src/data/links.ts for every visitor.
 */
export function ConfigPage() {
  const [draft, setDraft] = useState<GalaxyData>(() => loadGalaxyData())
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState<'editor' | 'json'>('editor')
  const [jsonText, setJsonText] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 3500)
    return () => clearTimeout(t)
  }, [notice])

  // warn before leaving with unsaved edits
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (!dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const update = (produce: (d: GalaxyData) => void) => {
    setDraft((prev) => {
      const next = clone(prev)
      produce(next)
      return next
    })
    setDirty(true)
  }

  const totalLinks = draft.sectors.reduce(
    (n, s) => n + s.systems.reduce((m, y) => m + y.bodies.length, 0),
    0,
  )

  const goGalaxy = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    window.location.href = '/'
  }

  const save = () => {
    const clean = normalizeGalaxy(draft)
    if (!clean) {
      setNotice('⚠️ Could not save — the dataset is invalid.')
      return
    }
    setDraft(clean)
    saveGalaxyData(clean)
    window.location.href = '/'
  }

  const resetDefaults = () => {
    if (!window.confirm('Reset ALL links to the built-in defaults? Your saved changes will be erased.')) return
    resetGalaxyData()
    setDraft(clone(DEFAULT_GALAXY))
    setDirty(false)
    setNotice('Reset to built-in defaults.')
  }

  // ---------- sector / system / body operations ----------
  const patchSector = (si: number, patch: Partial<SectorDef>) =>
    update((d) => Object.assign(d.sectors[si], patch))
  const addSector = () =>
    update((d) => {
      d.sectors.push({
        id: newId('cluster'),
        name: 'New Cluster',
        hue: Math.floor(Math.random() * 360),
        systems: [],
      })
    })
  const removeSector = (si: number) =>
    update((d) => {
      if (!window.confirm(`Delete cluster "${d.sectors[si].name}" and everything inside it?`)) return
      d.sectors.splice(si, 1)
    })
  const moveSector = (si: number, dir: -1 | 1) =>
    update((d) => {
      const j = si + dir
      if (j < 0 || j >= d.sectors.length) return
      ;[d.sectors[si], d.sectors[j]] = [d.sectors[j], d.sectors[si]]
    })

  const patchSystem = (si: number, yi: number, patch: Partial<SystemDef>) =>
    update((d) => Object.assign(d.sectors[si].systems[yi], patch))
  const addSystem = (si: number) =>
    update((d) => {
      d.sectors[si].systems.push({ id: newId('system'), name: 'New System', importance: 2, bodies: [] })
    })
  const removeSystem = (si: number, yi: number) =>
    update((d) => {
      if (!window.confirm(`Delete system "${d.sectors[si].systems[yi].name}"?`)) return
      d.sectors[si].systems.splice(yi, 1)
    })
  const moveSystem = (si: number, yi: number, dir: -1 | 1) =>
    update((d) => {
      const arr = d.sectors[si].systems
      const j = yi + dir
      if (j < 0 || j >= arr.length) return
      ;[arr[yi], arr[j]] = [arr[j], arr[yi]]
    })

  const patchBody = (si: number, yi: number, bi: number, patch: Partial<BodyDef>) =>
    update((d) => {
      const b = d.sectors[si].systems[yi].bodies[bi]
      if (patch.url !== undefined) patch.url = withUrlScheme(patch.url as string)
      Object.assign(b, patch)
    })
  const addBody = (si: number, yi: number) =>
    update((d) => {
      d.sectors[si].systems[yi].bodies.push({
        id: newId('link'),
        name: 'New Link',
        url: 'https://',
        kind: 'planet',
      })
    })
  const removeBody = (si: number, yi: number, bi: number) =>
    update((d) => {
      d.sectors[si].systems[yi].bodies.splice(bi, 1)
    })
  const moveBody = (si: number, yi: number, bi: number, dir: -1 | 1) =>
    update((d) => {
      const arr = d.sectors[si].systems[yi].bodies
      const j = bi + dir
      if (j < 0 || j >= arr.length) return
      ;[arr[bi], arr[j]] = [arr[j], arr[bi]]
    })

  // ---------- JSON tab ----------
  const applyJson = () => {
    const parsed = parseGalaxyJson(jsonText)
    if (!parsed) {
      setNotice('⚠️ Invalid JSON — nothing applied.')
      return
    }
    setDraft(parsed)
    setDirty(true)
    setTab('editor')
    setNotice('JSON applied to the draft — review and save.')
  }
  const copyJson = () => {
    navigator.clipboard?.writeText(exportGalaxyJson(draft)).then(
      () => setNotice('JSON copied to clipboard.'),
      () => setNotice('Could not copy.'),
    )
  }
  const downloadJson = () => {
    const blob = new Blob([exportGalaxyJson(draft)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'dirman-galaxy-links.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const importFile = (file: File) => {
    file.text().then((text) => {
      const parsed = parseGalaxyJson(text)
      if (!parsed) {
        setNotice('⚠️ That file is not a valid galaxy dataset.')
        return
      }
      setDraft(parsed)
      setDirty(true)
      setNotice('File imported — review and save.')
    })
  }

  const hueColor = (hue: number) => `hsl(${((hue % 360) + 360) % 360} 65% 60%)`

  return (
    <div className="config-page">
      <header className="config-head">
        <div>
          <div className="config-title">DIRMAN VERSE — LINK MANAGER</div>
          <div className="config-sub">
            {draft.sectors.length} clusters · {totalLinks} links ·{' '}
            {dirty ? <span className="config-dirty">unsaved changes</span> : 'all changes saved'}
          </div>
        </div>
        <div className="config-actions">
          <button className="btn ghost" onClick={goGalaxy}>← Back to galaxy</button>
          <button className="btn primary" onClick={save}>Save & launch</button>
        </div>
      </header>

      {notice && <div className="config-notice">{notice}</div>}

      <div className="config-tabs">
        <button className={tab === 'editor' ? 'on' : ''} onClick={() => setTab('editor')}>Editor</button>
        <button className={tab === 'json' ? 'on' : ''} onClick={() => {
          if (tab !== 'json') setJsonText(exportGalaxyJson(draft))
          setTab('json')
        }}>JSON</button>
      </div>

      {tab === 'editor' ? (
        <div className="config-editor">
          <p className="config-hint">
            Clusters become spiral stretches along the march route — the first
            one sits at the core of the galaxy.
          </p>
          {draft.sectors.map((sector, si) => (
            <details key={sector.id} className="config-card" open>
              <summary>
                <span className="config-chip" style={{ background: `hsl(${sector.hue} 65% 60%)` }} />
                {sector.name}
                <span className="config-count">
                  {sector.systems.length} systems ·{' '}
                  {sector.systems.reduce((n, y) => n + y.bodies.length, 0)} links
                </span>
              </summary>

              <div className="config-card-body">
                <div className="config-row">
                  <label>Name
                    <input
                      value={sector.name}
                      onChange={(e) => patchSector(si, { name: e.target.value })}
                    />
                  </label>
                  <label>Hue {sector.hue}°
                    <input
                      type="range"
                      min={0}
                      max={359}
                      value={sector.hue}
                      onChange={(e) => patchSector(si, { hue: Number(e.target.value) })}
                    />
                  </label>
                  <span
                    className="config-chip"
                    style={{ background: hueColor(sector.hue) }}
                    title="Cluster color"
                  />
                  <div className="config-rowbtns">
                    <button className="icon-btn" title="Move up" onClick={() => moveSector(si, -1)}>↑</button>
                    <button className="icon-btn" title="Move down" onClick={() => moveSector(si, 1)}>↓</button>
                    <button className="icon-btn danger" title="Delete cluster" onClick={() => removeSector(si)}>✕</button>
                  </div>
                </div>

                {sector.systems.map((sys, yi) => (
                  <details key={sys.id} className="config-system">
                    <summary>
                      <span className="config-kind sun" />
                      {sys.name}
                      <span className="config-count">{sys.bodies.length} links</span>
                    </summary>
                    <div className="config-card-body">
                      <div className="config-row">
                        <label>Name
                          <input value={sys.name} onChange={(e) => patchSystem(si, yi, { name: e.target.value })} />
                        </label>
                        <label>Rank
                          <select
                            value={sys.importance ?? 2}
                            onChange={(e) => patchSystem(si, yi, { importance: Number(e.target.value) as 1 | 2 | 3 })}
                          >
                            <option value={1}>★</option>
                            <option value={2}>★★</option>
                            <option value={3}>★★★</option>
                          </select>
                        </label>
                        <label>Sun style
                          <select
                            value={sys.style ?? 'auto'}
                            onChange={(e) =>
                              patchSystem(si, yi, e.target.value === 'auto'
                                ? { style: undefined }
                                : { style: e.target.value })
                            }
                          >
                            {SUN_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </label>
                      </div>
                      <div className="config-row">
                        <label>System URL (optional)
                          <input value={sys.url ?? ''} onChange={(e) => patchSystem(si, yi, { url: e.target.value })} />
                        </label>
                        <label>Description
                          <input value={sys.description ?? ''} onChange={(e) => patchSystem(si, yi, { description: e.target.value })} />
                        </label>
                      </div>
                      <div className="config-row">
                        <label>Tint (hue shift)
                          <input
                            type="number"
                            min={-40}
                            max={40}
                            value={sys.tint ?? ''}
                            placeholder="auto"
                            onChange={(e) =>
                              patchSystem(si, yi, e.target.value === ''
                                ? { tint: undefined }
                                : { tint: Number(e.target.value) })
                            }
                          />
                        </label>
                        <div className="config-rowbtns">
                          <button className="icon-btn" title="Move up" onClick={() => moveSystem(si, yi, -1)}>↑</button>
                          <button className="icon-btn" title="Move down" onClick={() => moveSystem(si, yi, 1)}>↓</button>
                          <button className="icon-btn danger" title="Delete system" onClick={() => removeSystem(si, yi)}>✕</button>
                        </div>
                      </div>

                      <div className="config-links">
                        {sys.bodies.map((body, bi) => (
                          <div key={body.id} className="config-link">
                            <span className={`config-kind ${body.kind ?? 'planet'}`} />
                            <input
                              className="config-link-name"
                              value={body.name}
                              placeholder="Link name"
                              onChange={(e) => patchBody(si, yi, bi, { name: e.target.value })}
                            />
                            <input
                              className="config-link-url"
                              value={body.url}
                              placeholder="https://…"
                              onChange={(e) => patchBody(si, yi, bi, { url: e.target.value })}
                            />
                            <select
                              value={body.kind ?? 'planet'}
                              onChange={(e) => patchBody(si, yi, bi, { kind: e.target.value as 'planet' | 'moon' })}
                            >
                              <option value="planet">planet</option>
                              <option value="moon">moon</option>
                            </select>
                            <select
                              value={body.style ?? 'auto'}
                              onChange={(e) =>
                                patchBody(si, yi, bi, e.target.value === 'auto'
                                  ? { style: undefined }
                                  : { style: e.target.value })
                              }
                            >
                              {BODY_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <input
                              type="number"
                              className="config-link-tint"
                              min={-40}
                              max={40}
                              value={body.tint ?? ''}
                              placeholder="tint"
                              onChange={(e) =>
                                patchBody(si, yi, bi, e.target.value === ''
                                  ? { tint: undefined }
                                  : { tint: Number(e.target.value) })
                              }
                            />
                            <div className="config-rowbtns">
                              <button className="icon-btn" title="Move up" onClick={() => moveBody(si, yi, bi, -1)}>↑</button>
                              <button className="icon-btn" title="Move down" onClick={() => moveBody(si, yi, bi, 1)}>↓</button>
                              <button className="icon-btn danger" title="Delete link" onClick={() => removeBody(si, yi, bi)}>✕</button>
                            </div>
                          </div>
                        ))}
                        <button className="btn ghost small" onClick={() => addBody(si, yi)}>+ Add link</button>
                      </div>
                    </div>
                  </details>
                ))}
                <button className="btn ghost small" onClick={() => addSystem(si)}>+ Add system</button>
              </div>
            </details>
          ))}
          <button className="btn ghost" onClick={addSector}>+ Add cluster</button>
        </div>
      ) : (
        <div className="config-json">
          <p className="config-hint">
            The full dataset as JSON — import, paste, or hand-edit it, then apply.
          </p>
          <textarea
            className="config-json-area"
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            spellCheck={false}
          />
          <div className="config-actions">
            <button className="btn ghost" onClick={() => setJsonText(exportGalaxyJson(draft))}>Refresh from draft</button>
            <button className="btn ghost" onClick={applyJson}>Apply to draft</button>
            <button className="btn ghost" onClick={copyJson}>Copy</button>
            <button className="btn ghost" onClick={downloadJson}>Download</button>
            <label className="btn ghost config-file">
              Import file
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
              />
            </label>
          </div>
        </div>
      )}

      <footer className="config-foot">
        <div>
          Saved links live in <strong>this browser</strong> (localStorage). To publish
          them for every visitor, use <em>Download</em> and replace the sectors array
          in <code>src/data/links.ts</code>.
        </div>
        <button className="btn ghost small danger-text" onClick={resetDefaults}>
          Reset to defaults
        </button>
      </footer>
    </div>
  )
}
