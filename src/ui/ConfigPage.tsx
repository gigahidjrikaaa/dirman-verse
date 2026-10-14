import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
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
import { setGalaxyData } from '../data/links'
import { loadDraft, saveDraft, clearDraft } from '../data/draft'
import { issuesForPrefix, validateGalaxy } from '../data/validate'
import { diffGalaxy, diffIsEmpty, diffSummary, type GalaxyDiff } from '../data/diff'
import {
  backendConfigured,
  fetchBackendRevisions,
  fetchBackendStatus,
  loadBackendConfig,
  PublishConflictError,
  publishBackendLinks,
  saveBackendConfig,
  type BackendConfig,
  type Revision,
} from '../lib/backend'
import { useGalaxy } from '../state/useGalaxy'

const SUN_STYLES = ['auto', 'classic', 'giant', 'flame', 'pulse', 'binary']
const BODY_STYLES = ['auto', 'terran', 'gas', 'ice', 'lava', 'ringed', 'rock']

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

function newId(name: string): string {
  return `${slugify(name) || 'link'}-${Math.random().toString(36).slice(2, 5)}`
}

/** smooth animated collapse (grid-rows trick — no janky max-height) */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`collapse ${open ? 'open' : ''}`}>
      <div className="collapse-inner">{children}</div>
    </div>
  )
}

/**
 * #/config — the in-app link manager.
 *
 * Draft model: edits live in memory + an autosaved localStorage draft
 * (dirman-galaxy-draft). Publishing is explicit: review the diff, then
 * push to the backend (or save locally) — separated so drafts never
 * change the live galaxy sight-unseen.
 */
export function ConfigPage() {
  // ----- draft + history -----
  const recovered = useMemo(() => loadDraft(), [])
  const recoveredRef = useRef(recovered)
  const [draft, setDraftState] = useState<GalaxyData>(() => recovered?.data ?? loadGalaxyData())
  const draftRef = useRef(draft)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const undoStack = useRef<GalaxyData[]>([])
  const redoStack = useRef<GalaxyData[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const lastEdit = useRef<{ tag: string; time: number }>({ tag: '', time: 0 })

  // ----- ui state -----
  const [tab, setTab] = useState<'editor' | 'json'>('editor')
  const [jsonText, setJsonText] = useState('')
  const [query, setQuery] = useState('')
  const [toast, setToastState] = useState<{
    msg: string
    action?: { label: string; run: () => void }
  } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [openClusters, setOpenClusters] = useState<Set<string>>(
    () => new Set(draft.sectors.slice(0, 1).map((s) => s.id)),
  )
  const [openSystems, setOpenSystems] = useState<Set<string>>(() => new Set())
  const [review, setReview] = useState<null | {
    diff: GalaxyDiff
    target: 'backend' | 'local'
  }>(null)
  const [conflict, setConflict] = useState<null | {
    by: string
    at: string
    theirs: GalaxyData | null
  }>(null)

  // ----- backend state -----
  const [backend, setBackend] = useState<BackendConfig>(() => loadBackendConfig())
  const backendRef = useRef(backend)
  backendRef.current = backend
  const [backendOpen, setBackendOpen] = useState(false)
  const [backendStatus, setBackendStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle')
  const [backendMsg, setBackendMsg] = useState('')
  const [backendDataset, setBackendDataset] = useState<GalaxyData | null>(null)
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [publishedAt, setPublishedAt] = useState<string | null>(null)
  /** null = not probed yet; false = this origin has no /api server */
  const [serverDetected, setServerDetected] = useState<boolean | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const showToast = useCallback(
    (msg: string, action?: { label: string; run: () => void }) => {
      setToastState({ msg, action })
      clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setToastState(null), 6500)
    },
    [],
  )

  const replaceDraftState = useCallback((d: GalaxyData, isDirty: boolean) => {
    draftRef.current = d
    setDraftState(d)
    setDirty(isDirty)
  }, [])

  // recovered draft notice
  useEffect(() => {
    const rec = recovered
    if (rec) {
      showToast(`Recovered your unsaved draft from ${new Date(rec.savedAt).toLocaleString()}`, {
        label: 'Discard',
        run: () => {
          clearDraft()
          replaceDraftState(loadGalaxyData(), false)
        },
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ----- validation + derived -----
  const issues = useMemo(() => validateGalaxy(draft), [draft])
  const errorCount = issues.filter((i) => i.level === 'error').length
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

  // ----- undo / redo (coalesced per-field tagging) -----
  const update = useCallback(
    (produce: (d: GalaxyData) => void, tag?: string) => {
      const prev = draftRef.current
      const next = clone(prev)
      produce(next)
      const now = Date.now()
      const coalesce =
        tag !== undefined &&
        lastEdit.current.tag === tag &&
        now - lastEdit.current.time < 900
      if (!coalesce) {
        undoStack.current = [...undoStack.current.slice(-49), prev]
        redoStack.current = []
        setCanUndo(true)
        setCanRedo(false)
      }
      lastEdit.current = { tag: tag ?? `t${now}`, time: now }
      draftRef.current = next
      setDraftState(next)
      setDirty(true)
    },
    [],
  )

  const undo = useCallback(() => {
    const stack = undoStack.current
    if (!stack.length) return
    const prev = stack[stack.length - 1]
    undoStack.current = stack.slice(0, -1)
    redoStack.current = [draftRef.current, ...redoStack.current].slice(0, 50)
    draftRef.current = prev
    setDraftState(prev)
    setDirty(true)
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(true)
  }, [])

  const redo = useCallback(() => {
    const stack = redoStack.current
    if (!stack.length) return
    const next = stack[0]
    redoStack.current = stack.slice(1)
    undoStack.current = [...undoStack.current, draftRef.current]
    draftRef.current = next
    setDraftState(next)
    setDirty(true)
    setCanUndo(true)
    setCanRedo(stack.length > 1)
  }, [])

  // ----- autosave (working draft, local-only — publishing stays explicit) -----
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => saveDraft(draftRef.current), 1200)
    return () => clearTimeout(t)
  }, [draft, dirty])

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

  // ----- backend -----
  const backendPatch = useCallback((patch: Partial<BackendConfig>) => {
    setBackend((prev) => {
      const next = { ...prev, ...patch }
      saveBackendConfig(next)
      return next
    })
  }, [])

  // probe the server once on mount: detects /api and auto-loads the
  // published dataset into the editor (skipped when a local draft won)
  useEffect(() => {
    if (!backendConfigured()) return
    if (recoveredRef.current) return
    let cancelled = false
    setBackendStatus('checking')
    fetchBackendStatus()
      .then((status) => {
        if (cancelled) return
        setServerDetected(true)
        if (!status.data) {
          setBackendStatus('ok')
          setBackendMsg('Server detected — nothing published yet.')
          return
        }
        const clean = normalizeGalaxy(status.data)
        if (!clean) return
        replaceDraftState(clean, false)
        setPublishedAt(status.updated_at)
        setBackendDataset(clean)
        setBackendStatus('ok')
        showToast('Loaded the published dataset from the server.')
      })
      .catch(() => {
        if (cancelled) return
        setServerDetected(false)
        setBackendStatus('error')
        setBackendMsg('No server detected on this origin — saving locally only.')
      })
    return () => {
      cancelled = true
    }
  }, [replaceDraftState])

  // ----- save / publish flow -----
  const exitToGalaxy = (published: GalaxyData, msg: string) => {
    setGalaxyData(published) // live rebuild, no reload
    clearDraft()
    useGalaxy.getState().setToast(msg)
    history.pushState(null, '', window.location.pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const requestReview = (target: 'backend' | 'local') => {
    if (errorCount > 0) {
      showToast(`⚠️ Fix ${errorCount} issue${errorCount === 1 ? '' : 's'} before saving`)
      return
    }
    const before =
      target === 'backend' && backendDataset ? backendDataset : loadGalaxyData()
    const diff = diffGalaxy(before, draftRef.current)
    setReview({ diff, target })
  }

  const confirmSave = async (force = false) => {
    const target = review?.target ?? 'local'
    const clean = normalizeGalaxy(draftRef.current)
    if (!clean) {
      showToast('⚠️ Dataset invalid — nothing saved.')
      return
    }
    setSaving(true)
    try {
      if (target === 'backend') {
        const meta = await publishBackendLinks(clean, backend.author, {
          ifMatch: publishedAt ?? undefined,
          force,
        })
        saveGalaxyData(clean)
        clearDraft()
        setDirty(false)
        setReview(null)
        exitToGalaxy(
          clean,
          `✓ Published by ${meta.updated_by ?? 'you'} — live for everyone`,
        )
      } else {
        saveGalaxyData(clean)
        setGalaxyData(clean)
        clearDraft()
        setDirty(false)
        setReview(null)
        exitToGalaxy(clean, '✓ Saved — galaxy updated')
      }
    } catch (err) {
      if (err instanceof PublishConflictError) {
        setConflict({
          by: err.current.updated_by ?? 'someone',
          at: err.current.updated_at ?? '',
          theirs: err.current.data ? normalizeGalaxy(err.current.data) : null,
        })
      } else {
        showToast('⚠️ ' + (err instanceof Error ? err.message : 'Save failed'))
      }
      setSaving(false)
    }
  }

  // ----- keyboard -----
  const requestReviewRef = useRef<(target: 'backend' | 'local') => void>(undefined as never)
  requestReviewRef.current = (target) => {
    if (errorCount > 0) {
      showToast(`⚠️ Fix ${errorCount} issue${errorCount === 1 ? '' : 's'} before saving`)
      return
    }
    const before =
      target === 'backend' && backendDataset ? backendDataset : loadGalaxyData()
    const diff = diffGalaxy(before, draftRef.current)
    setReview({ diff, target })
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 's') {
        e.preventDefault()
        requestReviewRef.current(backendRef.current.base.trim() !== '' ? 'backend' : 'local')
        return
      }
      if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo])

  // ----- CRUD (undoable, no window.confirm) -----
  const patchSector = (si: number, patch: Partial<SectorDef>, tag?: string) =>
    update((d) => Object.assign(d.sectors[si], patch), tag ?? `s:${si}:${Date.now()}`)
  const addSector = () =>
    update((d) => {
      d.sectors.push({
        id: newId('cluster'),
        name: 'New Cluster',
        hue: Math.floor(Math.random() * 360),
        systems: [],
      })
    }, `add-sector:${Date.now()}`)
  const removeSector = (si: number) =>
    update((d) => {
      const name = d.sectors[si].name
      d.sectors.splice(si, 1)
      showToast(`Deleted cluster "${name}"`, { label: 'Undo', run: () => undo() })
    }, `del-s:${si}:${Date.now()}`)
  const moveSector = (si: number, dir: -1 | 1) =>
    update((d) => {
      const j = si + dir
      if (j < 0 || j >= d.sectors.length) return
      ;[d.sectors[si], d.sectors[j]] = [d.sectors[j], d.sectors[si]]
    }, `mv-s:${si}:${dir}:${Date.now()}`)

  const patchSystem = (si: number, yi: number, patch: Partial<SystemDef>, tag?: string) =>
    update((d) => Object.assign(d.sectors[si].systems[yi], patch), tag ?? `y:${si}:${yi}:${Date.now()}`)
  const addSystem = (si: number, sectorId: string) =>
    update((d) => {
      const sys: SystemDef = { id: newId('system'), name: 'New System', importance: 2, bodies: [] }
      d.sectors[si].systems.push(sys)
      setOpenSystems((prev) => new Set(prev).add(sys.id))
      setOpenClusters((prev) => new Set(prev).add(sectorId))
    }, `add-y:${si}:${Date.now()}`)
  const removeSystem = (si: number, yi: number) =>
    update((d) => {
      const name = d.sectors[si].systems[yi].name
      d.sectors[si].systems.splice(yi, 1)
      showToast(`Deleted system "${name}"`, { label: 'Undo', run: () => undo() })
    }, `del-y:${si}:${yi}:${Date.now()}`)
  const moveSystem = (si: number, yi: number, dir: -1 | 1) =>
    update((d) => {
      const arr = d.sectors[si].systems
      const j = yi + dir
      if (j < 0 || j >= arr.length) return
      ;[arr[yi], arr[j]] = [arr[j], arr[yi]]
    }, `mv-y:${si}:${yi}:${dir}:${Date.now()}`)

  const patchBody = (si: number, yi: number, bi: number, patch: Partial<BodyDef>, tag?: string) =>
    update(
      (d) => {
        const b = d.sectors[si].systems[yi].bodies[bi]
        if (patch.url !== undefined) patch.url = withUrlScheme(patch.url as string)
        Object.assign(b, patch)
      },
      tag ?? `b:${si}:${yi}:${bi}:${Date.now()}`,
    )
  const addBody = (si: number, yi: number) =>
    update((d) => {
      d.sectors[si].systems[yi].bodies.push({
        id: newId('link'),
        name: 'New Link',
        url: 'https://',
        kind: 'planet',
      })
    }, `add-b:${si}:${yi}:${Date.now()}`)
  const removeBody = (si: number, yi: number, bi: number) =>
    update((d) => {
      const name = d.sectors[si].systems[yi].bodies[bi].name
      d.sectors[si].systems[yi].bodies.splice(bi, 1)
      showToast(`Deleted link "${name}"`, { label: 'Undo', run: () => undo() })
    }, `del-b:${si}:${yi}:${bi}:${Date.now()}`)
  const moveBody = (si: number, yi: number, bi: number, dir: -1 | 1) =>
    update((d) => {
      const arr = d.sectors[si].systems[yi].bodies
      const j = bi + dir
      if (j < 0 || j >= arr.length) return
      ;[arr[bi], arr[j]] = [arr[j], arr[bi]]
    }, `mv-b:${si}:${yi}:${bi}:${dir}:${Date.now()}`)

  // ----- backend handlers -----
  const testBackend = async () => {
    saveBackendConfig(backend)
    setBackendStatus('checking')
    setBackendMsg('')
    try {
      const status = await fetchBackendStatus()
      setServerDetected(true)
      setPublishedAt(status.updated_at)
      const clean = status.data ? normalizeGalaxy(status.data) : null
      setBackendDataset(clean)
      const clusters = clean?.sectors.length ?? 0
      try {
        setRevisions(await fetchBackendRevisions())
        setBackendStatus('ok')
        setBackendMsg(
          status.data
            ? `✓ Editor ready — ${clusters} clusters · last updated by ${status.updated_by ?? '—'}`
            : '✓ Editor ready — no dataset published yet.',
        )
        if (backend.password) setBackendOpen(false)
      } catch {
        setBackendStatus('error')
        setBackendMsg('⚠️ Server reachable, but that password was rejected.')
        setRevisions([])
      }
    } catch (err) {
      setServerDetected(false)
      setBackendStatus('error')
      setBackendMsg('⚠️ ' + (err instanceof Error ? err.message : 'no server detected'))
    }
  }

  const loadBackendDatasetIntoEditor = () => {
    if (!backendDataset) return
    replaceDraftState(backendDataset, true)
    showToast('Backend dataset loaded into the editor.')
  }

  const publishNow = () => requestReview(backend.base.trim() !== '' ? 'backend' : 'local')

  // ----- JSON tab -----
  const applyJson = () => {
    const parsed = parseGalaxyJson(jsonText)
    if (!parsed) {
      showToast('⚠️ Invalid JSON — nothing applied.')
      return
    }
    replaceDraftState(parsed, true)
    setTab('editor')
    showToast('JSON applied — Ctrl+Z undoes it.')
  }
  const copyJson = () => {
    navigator.clipboard?.writeText(exportGalaxyJson(draft)).then(
      () => showToast('JSON copied to clipboard.'),
      () => showToast('Could not copy.'),
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
        showToast('⚠️ That file is not a valid galaxy dataset.')
        return
      }
      replaceDraftState(parsed, true)
      showToast('File imported — review and save.')
    })
  }

  const hueColor = (hue: number) => `hsl(${((hue % 360) + 360) % 360} 65% 60%)`

  const goGalaxy = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    history.pushState(null, '', window.location.pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const resetDefaults = () =>
    update(
      (d) => {
        resetGalaxyData()
        d.sectors = clone(DEFAULT_GALAXY.sectors)
      },
      `reset:${Date.now()}`,
    )

  const jsonRef = useRef<HTMLTextAreaElement>(null)

  function toggleSet(
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    key: string,
  ) {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function scrollToCluster(id: string) {
    document
      .getElementById(`cluster-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function DiffList({ diff }: { diff: GalaxyDiff }) {
    if (diffIsEmpty(diff)) {
      return <div className="config-empty">No changes — identical to what's live.</div>
    }
    const groups: Array<{ label: string; cls: string; rows: string[] }> = []
    if (diff.addedClusters.length)
      groups.push({ label: 'New clusters', cls: 'add', rows: diff.addedClusters.map((c) => c.name) })
    if (diff.removedClusters.length)
      groups.push({ label: 'Removed clusters', cls: 'del', rows: diff.removedClusters.map((c) => c.name) })
    if (diff.addedSystems.length)
      groups.push({ label: 'New systems', cls: 'add', rows: diff.addedSystems.map((s) => `${s.system} (${s.cluster})`) })
    if (diff.removedSystems.length)
      groups.push({ label: 'Removed systems', cls: 'del', rows: diff.removedSystems.map((s) => `${s.system} (${s.cluster})`) })
    if (diff.addedLinks.length)
      groups.push({ label: 'New links', cls: 'add', rows: diff.addedLinks.map((l) => `${l.name} — ${l.system}`) })
    if (diff.removedLinks.length)
      groups.push({ label: 'Removed links', cls: 'del', rows: diff.removedLinks.map((l) => `${l.name} — ${l.system}`) })
    if (diff.changedLinks.length)
      groups.push({ label: 'Edited links', cls: 'mod', rows: diff.changedLinks.map((l) => l.name) })

    return (
      <div className="diff-list">
        {groups.map((g) => (
          <div key={g.label} className="diff-group">
            <div className={`diff-group-label ${g.cls}`}>{g.label}</div>
            {g.rows.map((r, i) => (
              <div key={i} className="diff-row">{r}</div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  const q = query.trim().toLowerCase()
  const searching = q !== ''
  const matchText = (t: string) => t.toLowerCase().includes(q)

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
          <button role="tab" aria-selected={tab === 'editor'} className={tab === 'editor' ? 'on' : ''} onClick={() => setTab('editor')}>
            Editor
          </button>
          <button role="tab" aria-selected={tab === 'json'} className={tab === 'json' ? 'on' : ''} onClick={() => setTab('json')}>
            JSON
          </button>
        </div>
      </header>

      <section className="config-backend">
        <button
          className="config-backend-head"
          onClick={() => setBackendOpen(!backendOpen)}
          aria-expanded={backendOpen}
        >
          <span className="config-backend-dot" data-state={backendStatus} />
          <span className="config-backend-title">Backend sync</span>
          <span className="config-backend-sub">
            {backendStatus === 'checking'
              ? 'checking…'
              : serverDetected === false
                ? 'no server — saving locally only'
                : backend.password
                  ? `editor ready · ${backend.author || 'unnamed'}`
                  : 'server detected — password needed'}
          </span>
          <span className="icon-btn chevron" aria-hidden>⌄</span>
        </button>
        <Collapse open={backendOpen}>
          <div className="config-backend-body">
            <p className="config-hint">
              {backend.password
                ? 'Editor ready on this device — publishing is one click away.'
                : 'Enter the editor password (the ADMIN_PASSWORD from the server setup) — one-time on this device.'}
            </p>
            <div className="config-fields">
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
              <button className="btn ghost small" onClick={testBackend}>
                Validate password
              </button>
            </div>
            {showAdvanced && (
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
              </div>
            )}
            <button className="config-advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
              {showAdvanced ? 'Hide' : 'Show'} advanced (custom API origin)
            </button>
            {backendMsg && (
              <div className="config-backend-msg" data-state={backendStatus}>
                {backendMsg}
              </div>
            )}
            {backendStatus === 'ok' && (
              <div className="config-actions">
                {backendDataset && (
                  <button className="btn ghost small" onClick={loadBackendDatasetIntoEditor}>
                    Load dataset into editor
                  </button>
                )}
                <button className="btn primary small" onClick={publishNow} disabled={saving}>
                  {saving ? 'Saving…' : 'Publish to backend'}
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

      {tab === 'editor' ? (
        <>
          <div className="config-toolbar">
            {draft.sectors.length > 1 && !searching && (
              <nav className="cluster-nav" aria-label="Jump to cluster">
                {draft.sectors.map((s) => (
                  <button key={s.id} onClick={() => scrollToCluster(s.id)}>
                    <span className="config-chip" style={{ background: hueColor(s.hue) }} />
                    {s.name}
                  </button>
                ))}
              </nav>
            )}
            <input
              className="config-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search links, systems…"
              aria-label="Search the editor"
            />
            <div className="config-toolbar-btns">
              <button className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">↶</button>
              <button className="icon-btn" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Y)">↷</button>
            </div>
          </div>

          <div className="config-editor">
            <p className="config-hint">
              Clusters become spiral stretches along the march route — the first
              one sits at the core of the galaxy. Autosaved locally as you type.
            </p>

            {searching && (
              <div className="config-search-info">
                Filtering by “{query}” — {draft.sectors.length} clusters
                <button className="btn ghost small" onClick={() => setQuery('')}>Clear</button>
              </div>
            )}

            {draft.sectors.map((sector, si) => {
              const clusterOpen = searching || openClusters.has(sector.id)
              const clusterMatch = searching && matchText(sector.name)
              const clusterLinks = sector.systems.reduce((n, y) => n + y.bodies.length, 0)
              const issuesHere = issuesForPrefix(issues, `s:${si}:`)
                .concat(issuesForPrefix(issues, `y:${si}:`))
                .concat(issuesForPrefix(issues, `b:${si}:`))
                .filter((i) => i.level === 'error')
              const visibleSystems = searching
                ? sector.systems.filter(
                    (sys) =>
                      matchText(sector.name) ||
                      matchText(sys.name) ||
                      sys.bodies.some(
                        (b) => matchText(b.name) || matchText(b.url) || matchText(b.description ?? ''),
                      ),
                  )
                : sector.systems
              if (searching && visibleSystems.length === 0 && !clusterMatch) return null

              return (
                <section
                  key={sector.id}
                  id={`cluster-${sector.id}`}
                  className={`config-card ${clusterOpen ? 'open' : ''} ${issuesHere.length ? 'has-issues' : ''}`}
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
                      onChange={(e) => patchSector(si, { name: e.target.value }, `s:${si}:name`)}
                    />
                    {issuesHere.length > 0 && (
                      <span className="config-issue-badge" title="Validation issues">{issuesHere.length}</span>
                    )}
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
                              onChange={(e) => patchSector(si, { hue: Number(e.target.value) }, `s:${si}:hue`)}
                            />
                            <span className="config-chip big" style={{ background: hueColor(sector.hue) }} />
                          </div>
                        </label>
                      </div>

                      {sector.systems.length === 0 && (
                        <div className="config-empty">No systems yet in this cluster.</div>
                      )}

                      {visibleSystems.map((sys) => {
                        const yi = sector.systems.indexOf(sys)
                        const sysOpen = searching || openSystems.has(sys.id)
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
                              <span className="config-kind sun" />
                              <input
                                className="config-title-input"
                                value={sys.name}
                                placeholder="System name"
                                onChange={(e) => patchSystem(si, yi, { name: e.target.value }, `y:${si}:${yi}:name`)}
                              />
                              {issues.some((i) => i.key === `y:${si}:${yi}:name` || i.key === `y:${si}:${yi}:dup`) && (
                                <span className="config-issue-badge">!</span>
                              )}
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
                                        patchSystem(si, yi, { importance: Number(e.target.value) as 1 | 2 | 3 }, `y:${si}:${yi}:imp`)
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
                                          : { style: e.target.value }, `y:${si}:${yi}:style`)
                                      }
                                    >
                                      {SUN_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
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
                                          : { tint: Number(e.target.value) }, `y:${si}:${yi}:tint`)
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
                                      onChange={(e) => patchSystem(si, yi, { url: e.target.value }, `y:${si}:${yi}:url`)}
                                    />
                                  </label>
                                  <label className="field grow">
                                    <span>Description</span>
                                    <input
                                      value={sys.description ?? ''}
                                      onChange={(e) => patchSystem(si, yi, { description: e.target.value }, `y:${si}:${yi}:desc`)}
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
                                  {sys.bodies.map((body, bi) => {
                                    const bodyIssues = issues.filter((i) =>
                                      i.key.startsWith(`b:${si}:${yi}:${bi}:`) && i.level === 'error'
                                    )
                                    const warns = issues.filter(
                                      (i) => i.key.startsWith(`b:${si}:${yi}:${bi}:`) && i.level === 'warning',
                                    )
                                    return (
                                      <div
                                        key={body.id}
                                        className={`link-row ${bodyIssues.length ? 'invalid' : ''}`}
                                      >
                                        <div className="link-row-top">
                                          <span className={`config-kind ${body.kind ?? 'planet'}`} />
                                          <input
                                            className="link-name"
                                            value={body.name}
                                            placeholder="Link name"
                                            onChange={(e) =>
                                              patchBody(si, yi, bi, { name: e.target.value }, `b:${si}:${yi}:${bi}:name`)
                                            }
                                          />
                                          {bodyIssues.length > 0 && (
                                            <span className="config-issue-badge" title={bodyIssues[0].msg}>!</span>
                                          )}
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
                                          onChange={(e) =>
                                            patchBody(si, yi, bi, { url: e.target.value }, `b:${si}:${yi}:${bi}:url`)
                                          }
                                        />
                                        {(warns.length > 0 || bodyIssues.length > 0) && (
                                          <div className="link-warns">
                                            {[...bodyIssues, ...warns].map((i, k) => (
                                              <span key={k}>{i.msg}</span>
                                            ))}
                                          </div>
                                        )}
                                        <div className="link-row-opts">
                                          <select
                                            value={body.kind ?? 'planet'}
                                            aria-label="Body kind"
                                            onChange={(e) =>
                                              patchBody(si, yi, bi, { kind: e.target.value as 'planet' | 'moon' }, `b:${si}:${yi}:${bi}:kind`)
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
                                                : { style: e.target.value }, `b:${si}:${yi}:${bi}:style`)
                                            }
                                          >
                                            {BODY_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
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
                                                : { tint: Number(e.target.value) }, `b:${si}:${yi}:${bi}:tint`)
                                            }
                                          />
                                        </div>
                                        <input
                                          className="link-desc"
                                          value={body.description ?? ''}
                                          placeholder="Description (optional — shown in the star's card)"
                                          onChange={(e) =>
                                            patchBody(si, yi, bi, { description: e.target.value }, `b:${si}:${yi}:${bi}:desc`)
                                          }
                                        />
                                      </div>
                                    )
                                  })}
                                  <button className="btn ghost small dashed" onClick={() => addBody(si, yi)}>
                                    + Add link
                                  </button>
                                </div>
                              </div>
                            </Collapse>
                          </section>
                        )
                      })}

                      <button className="btn ghost small dashed" onClick={() => addSystem(si, sector.id)}>
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
            {dirty ? '● unsaved — autosaved locally' : 'all saved'}
          </span>
          {errorCount > 0 && <span className="config-issue-badge">{errorCount} to fix</span>}
        </div>
        <div className="config-foot-actions">
          <button className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">↶</button>
          <button className="icon-btn" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Y)">↷</button>
          <button className="btn ghost small danger-text" onClick={resetDefaults}>
            Reset to defaults
          </button>
          <button
            className="btn primary"
            onClick={() => requestReview(backend.base.trim() !== '' ? 'backend' : 'local')}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save & launch'}
          </button>
        </div>
      </footer>

      {toast && (
        <div className="config-toast">
          <span>{toast.msg}</span>
          {toast.action && (
            <button
              className="config-toast-action"
              onClick={() => {
                toast.action!.run()
                setToastState(null)
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}

      {review && !conflict && (
        <div className="modal-backdrop" onClick={() => setReview(null)}>
          <div className="modal glass" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Review changes</h3>
            <div className="modal-sub">
              {review.target === 'backend'
                ? 'Publishing makes this live for every visitor.'
                : 'Saving updates this browser\u2019s galaxy.'}
            </div>
            <DiffList diff={review.diff} />
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setReview(null)}>Cancel</button>
              <button className="btn primary" onClick={() => confirmSave(false)} disabled={saving}>
                {review.target === 'backend' ? 'Publish' : 'Save'} — {diffSummary(review.diff)}
              </button>
            </div>
          </div>
        </div>
      )}

      {conflict && (
        <div className="modal-backdrop">
          <div className="modal glass">
            <h3 className="modal-title">⚠ Someone published first</h3>
            <p className="modal-sub">
              Updated by <strong>{conflict.by}</strong> at{' '}
              {conflict.at ? new Date(conflict.at).toLocaleString() : '—'}. Choose a version:
            </p>
            <div className="modal-actions">
              <button
                className="btn ghost"
                onClick={() => {
                  if (conflict.theirs) {
                    replaceDraftState(conflict.theirs, true)
                    showToast('Loaded their version into the editor.')
                  }
                  setConflict(null)
                }}
              >
                Load their version
              </button>
              <button className="btn primary" onClick={() => confirmSave(true)}>
                Publish mine anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
