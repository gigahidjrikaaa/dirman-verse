import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  backendConfigured,
  fetchBackendRevisions,
  fetchBackendStatus,
  loadBackendConfig,
  publishBackendLinks,
  saveBackendConfig,
  type BackendConfig,
  type Revision,
} from '../lib/backend'

const SUN_STYLES = ['auto', 'classic', 'giant', 'flame', 'pulse', 'binary']
const BODY_STYLES = ['auto', 'terran', 'gas', 'ice', 'lava', 'ringed', 'rock']

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

function newId(name: string): string {
  return `${slugify(name) || 'link'}-${Math.random().toString(36).slice(2, 5)}`
}

/** smooth animated collapse (grid-rows trick — no janky max-height) */
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className={`collapse ${open ? 'open' : ''}`}>
      <div className="collapse-inner">{children}</div>
    </div>
  )
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
  const [backend, setBackend] = useState<BackendConfig>(() => loadBackendConfig())
  const [backendOpen, setBackendOpen] = useState(false)
  const [backendStatus, setBackendStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle')
  const [backendMsg, setBackendMsg] = useState('')
  const [backendDataset, setBackendDataset] = useState<GalaxyData | null>(null)
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [publishing, setPublishing] = useState(false)
  const [openClusters, setOpenClusters] = useState<Set<string>>(
    () => new Set(loadGalaxyData().sectors.slice(0, 1).map((s) => s.id)),
  )
  const [openSystems, setOpenSystems] = useState<Set<string>>(() => new Set())
  const jsonRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 3200)
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

  const update = useCallback((produce: (d: GalaxyData) => void) => {
    setDraft((prev) => {
      const next = clone(prev)
      produce(next)
      return next
    })
    setDirty(true)
  }, [])

  const totalLinks = useMemo(
    () =>
      draft.sectors.reduce(
        (n, s) => n + s.systems.reduce((m, y) => m + y.bodies.length, 0),
        0,
      ),
    [draft],
  )
  const totalSystems = useMemo(
    () => draft.sectors.reduce((n, s) => n + s.systems.length, 0),
    [draft],
  )

  const toggleSet = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    key: string,
  ) =>
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const scrollToCluster = (id: string) => {
    document
      .getElementById(`cluster-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const goGalaxy = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    window.location.href = '/'
  }

  // Ctrl+S always sees the latest draft through the ref
  const draftRef = useRef(draft)
  draftRef.current = draft

  const backendPatch = useCallback((patch: Partial<BackendConfig>) => {
    setBackend((prev) => {
      const next = { ...prev, ...patch }
      saveBackendConfig(next)
      return next
    })
  }, [])

  const save = useCallback(async () => {
    const clean = normalizeGalaxy(draftRef.current)
    if (!clean) {
      setNotice('⚠️ Could not save — the dataset is invalid.')
      return
    }
    // backend configured → publish there; otherwise local-only boot
    if (backend.base.trim() !== '') {
      try {
        await publishBackendLinks(clean, backend.author)
      } catch (err) {
        saveGalaxyData(clean) // local cache still updated
        setNotice(
          '⚠️ Backend publish failed (' +
            (err instanceof Error ? err.message : 'error') +
            ') — saved locally only.',
        )
        return
      }
    }
    saveGalaxyData(clean)
    window.location.href = '/'
  }, [backend])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [save])

  // pull the published dataset into the editor once at boot (when configured)
  useEffect(() => {
    if (!backendConfigured()) return
    let cancelled = false
    fetchBackendStatus()
      .then((status) => {
        if (cancelled || !status.data) return
        const clean = normalizeGalaxy(status.data)
        if (!clean) return
        setDraft(clean)
        setBackendDataset(clean)
        setNotice('Loaded the published dataset from the backend.')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const resetDefaults = () => {
    if (!window.confirm('Reset ALL links to the built-in defaults? Your saved changes will be erased.'))
      return
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
      const s: SectorDef = {
        id: newId('cluster'),
        name: 'New Cluster',
        hue: Math.floor(Math.random() * 360),
        systems: [],
      }
      d.sectors.push(s)
      setOpenClusters((prev) => new Set(prev).add(s.id))
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
  const addSystem = (si: number, sector: SectorDef) =>
    update((d) => {
      const sys: SystemDef = {
        id: newId('system'),
        name: 'New System',
        importance: 2,
        bodies: [],
      }
      d.sectors[si].systems.push(sys)
      setOpenSystems((prev) => new Set(prev).add(sys.id))
      setOpenClusters((prev) => new Set(prev).add(sector.id))
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

  const testBackend = async () => {
    saveBackendConfig(backend)
    setBackendStatus('checking')
    setBackendMsg('')
    try {
      const status = await fetchBackendStatus()
      setBackendStatus('ok')
      const clusters = status.data ? normalizeGalaxy(status.data)?.sectors.length ?? 0 : 0
      setBackendMsg(
        status.data
          ? `✓ Connected — ${clusters} clusters · last updated by ${status.updated_by ?? '—'}`
          : '✓ Connected — the backend has no dataset yet.',
      )
      setBackendDataset(status.data ? normalizeGalaxy(status.data) : null)
      try {
        setRevisions(await fetchBackendRevisions())
      } catch {
        setRevisions([])
      }
    } catch (err) {
      setBackendStatus('error')
      setBackendMsg('⚠️ ' + (err instanceof Error ? err.message : 'connection failed'))
    }
  }

  const loadBackendDraft = () => {
    if (!backendDataset) return
    setDraft(backendDataset)
    setDirty(true)
    setNotice('Backend dataset loaded into the editor.')
  }

  const publishNow = async () => {
    const clean = normalizeGalaxy(draftRef.current)
    if (!clean) {
      setNotice('⚠️ Dataset invalid — nothing to publish.')
      return
    }
    setPublishing(true)
    try {
      await publishBackendLinks(clean, backend.author)
      saveGalaxyData(clean)
      setBackendStatus('ok')
      setNotice('✓ Published to the backend — live for everyone.')
    } catch (err) {
      setNotice('⚠️ Publish failed: ' + (err instanceof Error ? err.message : 'error'))
    } finally {
      setPublishing(false)
    }
  }

  const hueColor = (hue: number) => `hsl(${(((hue % 360) + 360) % 360)} 65% 60%)`

  return (
    <div className="config-page">
      <header className="config-bar">
        <button className="icon-btn config-back" onClick={goGalaxy} aria-label="Back to galaxy" title="Back to galaxy">
          ←
        </button>
        <div className="config-bar-title">
          LINK MANAGER
          <span className={`config-dirty-tag ${dirty ? 'show' : ''}`}>
            {dirty ? '● unsaved' : 'saved'}
          </span>
        </div>
        <div className="config-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'editor'}
            className={tab === 'editor' ? 'on' : ''}
            onClick={() => setTab('editor')}
          >
            Editor
          </button>
          <button
            role="tab"
            aria-selected={tab === 'json'}
            className={tab === 'json' ? 'on' : ''}
            onClick={() => {
              if (tab !== 'json') setJsonText(exportGalaxyJson(draft))
              setTab('json')
            }}
          >
            JSON
          </button>
        </div>

        <section className="config-backend">
          <button
            className="config-backend-head"
            onClick={() => setBackendOpen(!backendOpen)}
            aria-expanded={backendOpen}
          >
            <span className="config-backend-dot" data-state={backendStatus} />
            <span className="config-backend-title">Backend sync</span>
            <span className="config-backend-sub">
              {backend.base.trim() ? backend.base : 'not configured'}
            </span>
            <span className="icon-btn chevron" aria-hidden>⌄</span>
          </button>
          <Collapse open={backendOpen}>
            <div className="config-backend-body">
              <p className="config-hint">
                Publishing pushes this dataset to a Postgres-backed API so every
                device — and every visitor — sees the same galaxy. Needs{' '}
                <code>DATABASE_URL</code> and <code>ADMIN_PASSWORD</code> set on
                the server (see README).
              </p>
              <div className="config-fields">
                <label className="field grow">
                  <span>API base</span>
                  <input
                    inputMode="url"
                    value={backend.base}
                    placeholder="/api"
                    onChange={(e) => backendPatch({ base: e.target.value })}
                  />
                </label>
                <label className="field grow">
                  <span>Admin password</span>
                  <input
                    type="password"
                    value={backend.password}
                    placeholder="ADMIN_PASSWORD"
                    onChange={(e) => backendPatch({ password: e.target.value })}
                  />
                </label>
                <label className="field grow">
                  <span>Your name</span>
                  <input
                    value={backend.author}
                    placeholder="who is editing?"
                    onChange={(e) => backendPatch({ author: e.target.value })}
                  />
                </label>
                <button
                  className="btn ghost small"
                  onClick={testBackend}
                  disabled={backend.base.trim() === ''}
                >
                  Test connection
                </button>
              </div>
              {backendMsg && (
                <div className="config-backend-msg" data-state={backendStatus}>
                  {backendMsg}
                </div>
              )}
              {backendStatus === 'ok' && (
                <div className="config-actions">
                  {backendDataset && (
                    <button className="btn ghost small" onClick={loadBackendDraft}>
                      Load dataset into editor
                    </button>
                  )}
                  <button className="btn primary small" onClick={publishNow} disabled={publishing}>
                    {publishing ? 'Publishing…' : 'Publish to backend'}
                  </button>
                </div>
              )}
              {revisions.length > 0 && (
                <div className="config-revisions">
                  <div className="config-links-label">Recent changes</div>
                  {revisions.slice(0, 5).map((r) => (
                    <div key={r.id} className="config-rev">
                      <span>#{r.id}</span>
                      <span>{r.author ?? '—'}</span>
                      <span>{new Date(r.created_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Collapse>
        </section>
      </header>

      {notice && <div className="config-toast">{notice}</div>}

      {tab === 'editor' ? (
        <>
          {draft.sectors.length > 2 && (
            <nav className="cluster-nav" aria-label="Jump to cluster">
              {draft.sectors.map((s) => (
                <button key={s.id} onClick={() => scrollToCluster(s.id)}>
                  <span className="config-chip" style={{ background: hueColor(s.hue) }} />
                  {s.name}
                </button>
              ))}
            </nav>
          )}

          <div className="config-editor">
            <p className="config-hint">
              Clusters become spiral stretches along the march route — the first
              one sits at the core of the galaxy.
            </p>

            {draft.sectors.map((sector, si) => {
              const clusterOpen = openClusters.has(sector.id)
              const clusterLinks = sector.systems.reduce((n, y) => n + y.bodies.length, 0)
              return (
                <section
                  key={sector.id}
                  id={`cluster-${sector.id}`}
                  className={`config-card ${clusterOpen ? 'open' : ''}`}
                >
                  <div className="config-card-head">
                    <button
                      className="icon-btn chevron"
                      aria-expanded={clusterOpen}
                      aria-label={clusterOpen ? 'Collapse cluster' : 'Expand cluster'}
                      onClick={() => toggleSet(setOpenClusters, sector.id)}
                    >
                      ⌄
                    </button>
                    <span className="config-chip" style={{ background: hueColor(sector.hue) }} />
                    <input
                      className="config-title-input"
                      value={sector.name}
                      placeholder="Cluster name"
                      onChange={(e) => patchSector(si, { name: e.target.value })}
                    />
                    <span className="config-count">
                      {sector.systems.length} sys · {clusterLinks} links
                    </span>
                    <div className="config-rowbtns">
                      <button className="icon-btn" title="Move up" onClick={() => moveSector(si, -1)}>↑</button>
                      <button className="icon-btn" title="Move down" onClick={() => moveSector(si, 1)}>↓</button>
                      <button className="icon-btn danger" title="Delete cluster" onClick={() => removeSector(si)}>✕</button>
                    </div>
                  </div>

                  <Collapse open={clusterOpen}>
                    <div className="config-card-body">
                      <div className="config-fields">
                        <label className="field grow">
                          <span>Hue {sector.hue}°</span>
                          <div className="hue-line">
                            <input
                              type="range"
                              min={0}
                              max={359}
                              value={sector.hue}
                              onChange={(e) => patchSector(si, { hue: Number(e.target.value) })}
                            />
                            <span className="config-chip big" style={{ background: hueColor(sector.hue) }} />
                          </div>
                        </label>
                      </div>

                      {sector.systems.length === 0 && (
                        <div className="config-empty">No systems yet in this cluster.</div>
                      )}

                      {sector.systems.map((sys, yi) => {
                        const sysOpen = openSystems.has(sys.id)
                        return (
                          <section key={sys.id} className={`config-system ${sysOpen ? 'open' : ''}`}>
                            <div className="config-system-head">
                              <button
                                className="icon-btn chevron"
                                aria-expanded={sysOpen}
                                aria-label={sysOpen ? 'Collapse system' : 'Expand system'}
                                onClick={() => toggleSet(setOpenSystems, sys.id)}
                              >
                                ⌄
                              </button>
                              <span className={`config-kind sun`} />
                              <input
                                className="config-title-input"
                                value={sys.name}
                                placeholder="System name"
                                onChange={(e) => patchSystem(si, yi, { name: e.target.value })}
                              />
                              <span className="config-count">{sys.bodies.length} links</span>
                              <div className="config-rowbtns">
                                <button className="icon-btn" title="Move up" onClick={() => moveSystem(si, yi, -1)}>↑</button>
                                <button className="icon-btn" title="Move down" onClick={() => moveSystem(si, yi, 1)}>↓</button>
                                <button className="icon-btn danger" title="Delete system" onClick={() => removeSystem(si, yi)}>✕</button>
                              </div>
                            </div>

                            <Collapse open={sysOpen}>
                              <div className="config-system-body">
                                <div className="config-fields three">
                                  <label className="field">
                                    <span>Rank</span>
                                    <select
                                      value={sys.importance ?? 2}
                                      onChange={(e) =>
                                        patchSystem(si, yi, { importance: Number(e.target.value) as 1 | 2 | 3 })
                                      }
                                    >
                                      <option value={1}>★</option>
                                      <option value={2}>★★</option>
                                      <option value={3}>★★★</option>
                                    </select>
                                  </label>
                                  <label className="field">
                                    <span>Sun style</span>
                                    <select
                                      value={sys.style ?? 'auto'}
                                      onChange={(e) =>
                                        patchSystem(si, yi, e.target.value === 'auto'
                                          ? { style: undefined }
                                          : { style: e.target.value })
                                      }
                                    >
                                      {SUN_STYLES.map((s) => (
                                        <option key={s} value={s}>{s}</option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="field">
                                    <span>Tint (hue shift)</span>
                                    <input
                                      type="number"
                                      min={-40}
                                      max={40}
                                      placeholder="auto"
                                      value={sys.tint ?? ''}
                                      onChange={(e) =>
                                        patchSystem(si, yi, e.target.value === ''
                                          ? { tint: undefined }
                                          : { tint: Number(e.target.value) })
                                      }
                                    />
                                  </label>
                                </div>
                                <div className="config-fields">
                                  <label className="field grow">
                                    <span>System URL (optional)</span>
                                    <input
                                      inputMode="url"
                                      value={sys.url ?? ''}
                                      placeholder="https://…"
                                      onChange={(e) => patchSystem(si, yi, { url: e.target.value })}
                                    />
                                  </label>
                                  <label className="field grow">
                                    <span>Description</span>
                                    <input
                                      value={sys.description ?? ''}
                                      onChange={(e) => patchSystem(si, yi, { description: e.target.value })}
                                    />
                                  </label>
                                </div>

                                <div className="config-links">
                                  <div className="config-links-label">
                                    {sys.bodies.length} link{sys.bodies.length === 1 ? '' : 's'}
                                  </div>
                                  {sys.bodies.length === 0 && (
                                    <div className="config-empty">No links yet — add the first one.</div>
                                  )}
                                  {sys.bodies.map((body, bi) => (
                                    <div key={body.id} className="link-row">
                                      <div className="link-row-top">
                                        <span className={`config-kind ${body.kind ?? 'planet'}`} />
                                        <input
                                          className="link-name"
                                          value={body.name}
                                          placeholder="Link name"
                                          onChange={(e) => patchBody(si, yi, bi, { name: e.target.value })}
                                        />
                                        <div className="config-rowbtns">
                                          <button className="icon-btn" title="Move up" onClick={() => moveBody(si, yi, bi, -1)}>↑</button>
                                          <button className="icon-btn" title="Move down" onClick={() => moveBody(si, yi, bi, 1)}>↓</button>
                                          <button className="icon-btn danger" title="Delete link" onClick={() => removeBody(si, yi, bi)}>✕</button>
                                        </div>
                                      </div>
                                      <input
                                        className="link-url"
                                        inputMode="url"
                                        value={body.url}
                                        placeholder="https://…"
                                        onChange={(e) => patchBody(si, yi, bi, { url: e.target.value })}
                                      />
                                      <div className="link-row-opts">
                                        <select
                                          value={body.kind ?? 'planet'}
                                          aria-label="Body kind"
                                          onChange={(e) =>
                                            patchBody(si, yi, bi, { kind: e.target.value as 'planet' | 'moon' })
                                          }
                                        >
                                          <option value="planet">planet</option>
                                          <option value="moon">moon</option>
                                        </select>
                                        <select
                                          value={body.style ?? 'auto'}
                                          aria-label="Star style"
                                          onChange={(e) =>
                                            patchBody(si, yi, bi, e.target.value === 'auto'
                                              ? { style: undefined }
                                              : { style: e.target.value })
                                          }
                                        >
                                          {BODY_STYLES.map((s) => (
                                            <option key={s} value={s}>{s}</option>
                                          ))}
                                        </select>
                                        <input
                                          type="number"
                                          min={-40}
                                          max={40}
                                          placeholder="tint"
                                          aria-label="Hue tint"
                                          value={body.tint ?? ''}
                                          onChange={(e) =>
                                            patchBody(si, yi, bi, e.target.value === ''
                                              ? { tint: undefined }
                                              : { tint: Number(e.target.value) })
                                          }
                                        />
                                      </div>
                                      <input
                                        className="link-desc"
                                        value={body.description ?? ''}
                                        placeholder="Description (optional — shown in the star's card)"
                                        onChange={(e) => patchBody(si, yi, bi, { description: e.target.value })}
                                      />
                                    </div>
                                  ))}
                                  <button className="btn ghost small dashed" onClick={() => addBody(si, yi)}>
                                    + Add link
                                  </button>
                                </div>
                              </div>
                            </Collapse>
                          </section>
                        )
                      })}

                      <button className="btn ghost small dashed" onClick={() => addSystem(si, sector)}>
                        + Add system
                      </button>
                    </div>
                  </Collapse>
                </section>
              )
            })}

            {draft.sectors.length === 0 && (
              <div className="config-empty big">The galaxy is empty — add your first cluster.</div>
            )}
            <button className="btn ghost dashed wide" onClick={addSector}>+ Add cluster</button>
          </div>
        </>
      ) : (
        <div className="config-json">
          <p className="config-hint">
            The full dataset as JSON — import, paste, or hand-edit it, then apply.
          </p>
          <textarea
            ref={jsonRef}
            className="config-json-area"
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            spellCheck={false}
          />
          <div className="config-actions">
            <button className="btn ghost" onClick={() => setJsonText(exportGalaxyJson(draft))}>
              Refresh from draft
            </button>
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
        <div className="config-foot-info">
          {draft.sectors.length} clusters · {totalSystems} systems · {totalLinks} links
          <span className={`config-dirty-tag ${dirty ? 'show' : ''}`}>
            {dirty ? '● unsaved changes — Ctrl+S to save' : 'all saved'}
          </span>
        </div>
        <div className="config-foot-actions">
          <button className="btn ghost small danger-text" onClick={resetDefaults}>
            Reset to defaults
          </button>
          <button className="btn primary" onClick={save} disabled={!dirty || publishing}>
            {publishing ? 'Saving…' : 'Save & launch'}
          </button>
        </div>
      </footer>
    </div>
  )
}
