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
  type BodyDef,
  type GalaxyData,
  type SystemDef,
} from '../data/galaxyData'
import { setGalaxyData } from '../data/links'
import { clearDraft, loadDraft, saveDraft } from '../data/draft'
import { issuesForPrefix, validateGalaxy } from '../data/validate'
import { diffGalaxy, diffSummary, type GalaxyDiff } from '../data/diff'
import {
  fetchGalaxy,
  loadAuth,
  logoutRequest,
  PublishConflictError,
  publishGalaxy,
  type AuthState,
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

/** the change list inside the review modal */
function DiffList({ diff }: { diff: GalaxyDiff }) {
  const groups: { label: string; cls: string; lines: string[] }[] = [
    {
      label: 'Added clusters',
      cls: 'add',
      lines: diff.addedClusters.map((c) => c.name),
    },
    {
      label: 'Removed clusters',
      cls: 'del',
      lines: diff.removedClusters.map((c) => c.name),
    },
    {
      label: 'Added systems',
      cls: 'add',
      lines: diff.addedSystems.map((s) => `${s.system} — ${s.cluster}`),
    },
    {
      label: 'Removed systems',
      cls: 'del',
      lines: diff.removedSystems.map((s) => `${s.system} — ${s.cluster}`),
    },
    {
      label: 'Added links',
      cls: 'add',
      lines: diff.addedLinks.map((l) => `${l.name} → ${l.to?.url ?? ''} (${l.system})`),
    },
    {
      label: 'Removed links',
      cls: 'del',
      lines: diff.removedLinks.map((l) => `${l.name} (${l.system})`),
    },
    {
      label: 'Edited links',
      cls: 'chg',
      lines: diff.changedLinks.map(
        (l) => `${l.system}: ${l.from?.name ?? ''} → ${l.to?.name ?? ''} · ${l.to?.url ?? ''}`,
      ),
    },
  ].filter((g) => g.lines.length > 0)

  return (
    <div className="diff-list">
      {groups.length === 0 && <div className="diff-none">No changes.</div>}
      {groups.map((g) => (
        <div key={g.label} className={`diff-group ${g.cls}`}>
          <div className="diff-group-label">{g.label}</div>
          {g.lines.map((line, i) => (
            <div key={i} className="diff-line">
              {line}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * #/config — the in-app link manager.
 *
 * Draft model: edits live in memory + an autosaved localStorage draft
 * (dirman-galaxy-draft). Publishing is explicit: review the diff, then
 * push to the Dirman Dex server (admin) — separated so drafts never
 * change the live galaxy sight-unseen.
 */
export function ConfigPage({ onSignOut }: { onSignOut?: () => void }) {
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
  const jsonRef = useRef<HTMLTextAreaElement | null>(null)
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

  // ----- backend + session state -----
  const [auth] = useState<AuthState | null>(() => loadAuth())
  const [backendOpen, setBackendOpen] = useState(false)
  const [backendStatus, setBackendStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle')
  const [backendMsg, setBackendMsg] = useState('')
  const [backendDataset, setBackendDataset] = useState<GalaxyData | null>(null)
  /** updated_at stamp of the server dataset this draft is based on (If-Match) */
  const [publishedAt, setPublishedAt] = useState<string | null>(null)
  /** null = not probed yet; false = server unreachable */
  const [serverDetected, setServerDetected] = useState<boolean | null>(null)

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

  // probe the server once on mount: loads the published dataset into the
  // editor (unless an unsaved local draft won) and records its updated_at
  // so publishing can use If-Match optimistic concurrency
  useEffect(() => {
    let cancelled = false
    setBackendStatus('checking')
    fetchGalaxy()
      .then((data) => {
        if (cancelled) return
        setServerDetected(true)
        if (!data) {
          setBackendStatus('ok')
          setBackendMsg('Server reachable — nothing published yet.')
          return
        }
        const clean = normalizeGalaxy(data)
        setBackendDataset(clean)
        setPublishedAt(
          (data as GalaxyData & { updated_at?: string }).updated_at ?? null,
        )
        if (!clean) {
          setBackendStatus('error')
          setBackendMsg('Server dataset is unreadable — publishing will replace it.')
          return
        }
        if (!recoveredRef.current) {
          replaceDraftState(clean, false)
          showToast('Loaded the published dataset from the server.')
        }
        setBackendStatus('ok')
        setBackendMsg('Server reachable — publishing goes live for everyone.')
      })
      .catch(() => {
        if (cancelled) return
        setServerDetected(false)
        setBackendStatus('error')
        setBackendMsg('Cannot reach the server — saving locally only.')
      })
    return () => {
      cancelled = true
    }
  }, [replaceDraftState, showToast])

  // ----- CRUD (each edit tagged so rapid typing coalesces in history) -----
  const patchSector = (si: number, patch: Partial<{ name: string; hue: number }>, tag?: string) =>
    update((d) => {
      const s = d.sectors[si]
      if (s) Object.assign(s, patch)
    }, tag)

  const patchSystem = (si: number, yi: number, patch: Partial<SystemDef>, tag?: string) =>
    update((d) => {
      const y = d.sectors[si]?.systems[yi]
      if (y) Object.assign(y, patch)
    }, tag)

  const patchBody = (
    si: number,
    yi: number,
    bi: number,
    patch: Partial<BodyDef>,
    tag?: string,
  ) =>
    update((d) => {
      const b = d.sectors[si]?.systems[yi]?.bodies[bi]
      if (b) Object.assign(b, patch)
    }, tag)

  const toggleSet = (
    setter: (fn: (prev: Set<string>) => Set<string>) => void,
    id: string,
  ) =>
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const scrollToCluster = (id: string) =>
    document.getElementById(`cluster-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const scrollToSystem = (id: string) =>
    setTimeout(
      () =>
        document
          .getElementById(`system-${id}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      60,
    )

  const addSector = () =>
    update((d) => {
      const id = newId('cluster')
      d.sectors.push({
        id,
        name: `Cluster ${d.sectors.length + 1}`,
        hue: (d.sectors.length * 40) % 360,
        systems: [],
      })
      setOpenClusters((prev) => new Set(prev).add(id))
      setTimeout(() => scrollToCluster(id), 60)
    })

  const removeSector = (si: number) => {
    const removed = draftRef.current.sectors[si]
    if (!removed) return
    update((d) => {
      d.sectors.splice(si, 1)
    })
    showToast(`Deleted “${removed.name}”.`, {
      label: 'Undo',
      run: () =>
        update((d) => {
          d.sectors.splice(Math.min(si, d.sectors.length), 0, removed)
        }, `restore:${removed.id}:${Date.now()}`),
    })
  }

  const moveSector = (si: number, dir: -1 | 1) =>
    update((d) => {
      const j = si + dir
      const s = d.sectors
      if (j < 0 || j >= s.length) return
      ;[s[si], s[j]] = [s[j], s[si]]
    })

  const addSystem = (si: number) =>
    update((d) => {
      const s = d.sectors[si]
      if (!s) return
      const id = newId('system')
      s.systems.push({ id, name: 'New system', importance: 2, bodies: [] })
      setOpenSystems((prev) => new Set(prev).add(id))
      scrollToSystem(id)
    })

  const removeSystem = (si: number, yi: number) => {
    const s = draftRef.current.sectors[si]
    const removed = s?.systems[yi]
    if (!s || !removed) return
    update((d) => {
      d.sectors[si]?.systems.splice(yi, 1)
    })
    showToast(`Deleted “${removed.name}”.`, {
      label: 'Undo',
      run: () =>
        update((d) => {
          d.sectors[si]?.systems.splice(Math.min(yi, d.sectors[si]?.systems.length ?? 0), 0, removed)
        }, `restore:${removed.id}:${Date.now()}`),
    })
  }

  const moveSystem = (si: number, yi: number, dir: -1 | 1) =>
    update((d) => {
      const sys = d.sectors[si]?.systems
      if (!sys) return
      const j = yi + dir
      if (j < 0 || j >= sys.length) return
      ;[sys[yi], sys[j]] = [sys[j], sys[yi]]
    })

  const addBody = (si: number, yi: number) =>
    update((d) => {
      const y = d.sectors[si]?.systems[yi]
      if (!y) return
      y.bodies.push({ id: newId('link'), name: 'New link', url: 'https://', kind: 'planet' })
    })

  const removeBody = (si: number, yi: number, bi: number) => {
    const y = draftRef.current.sectors[si]?.systems[yi]
    const removed = y?.bodies[bi]
    if (!y || !removed) return
    update((d) => {
      d.sectors[si]?.systems[yi]?.bodies.splice(bi, 1)
    })
    showToast(`Deleted link “${removed.name}”.`, {
      label: 'Undo',
      run: () =>
        update((d) => {
          const yy = d.sectors[si]?.systems[yi]
          yy?.bodies.splice(Math.min(bi, yy?.bodies.length ?? 0), 0, removed)
        }, `restore:${removed.id}:${Date.now()}`),
    })
  }

  const moveBody = (si: number, yi: number, bi: number, dir: -1 | 1) =>
    update((d) => {
      const bodies = d.sectors[si]?.systems[yi]?.bodies
      if (!bodies) return
      const j = bi + dir
      if (j < 0 || j >= bodies.length) return
      ;[bodies[bi], bodies[j]] = [bodies[j], bodies[bi]]
    })

  // ----- JSON tab -----
  useEffect(() => {
    if (tab === 'json') setJsonText(exportGalaxyJson(draftRef.current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

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
  const requestReviewRef = useRef(requestReview)
  requestReviewRef.current = requestReview

  // Ctrl+Z / Ctrl+Y / Ctrl+S — always the latest requestReview via ref
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault()
        redo()
      } else if (k === 's') {
        e.preventDefault()
        requestReviewRef.current(serverDetected === false ? 'local' : 'backend')
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [undo, redo, serverDetected])

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
        const meta = await publishGalaxy(clean, {
          ifMatch: publishedAt,
          force,
          updatedBy: auth?.user.name || auth?.user.email || 'unknown',
        })
        saveGalaxyData(clean)
        setPublishedAt(meta.updated_at)
        setBackendDataset(clean)
        setDirty(false)
        setReview(null)
        exitToGalaxy(
          clean,
          `✓ Published by ${meta.updated_by} — live for everyone`,
        )
      } else {
        saveGalaxyData(clean)
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
      } else if (err instanceof Error && err.message.includes('admin')) {
        showToast('⚠️ Admin role required to publish. You are signed in, but not as an admin.')
      } else {
        showToast('⚠️ ' + (err instanceof Error ? err.message : 'Save failed'))
      }
      setSaving(false)
    }
  }

  const probeBackend = () => {
    setBackendStatus('checking')
    setBackendMsg('')
    fetchGalaxy()
      .then((data) => {
        setServerDetected(true)
        if (!data) {
          setBackendStatus('ok')
          setBackendMsg('Server reachable — nothing published yet.')
          return
        }
        const clean = normalizeGalaxy(data)
        setBackendDataset(clean)
        setPublishedAt((data as GalaxyData & { updated_at?: string }).updated_at ?? null)
        setBackendStatus(clean ? 'ok' : 'error')
        setBackendMsg(clean ? 'Server reachable.' : 'Server dataset is unreadable.')
      })
      .catch(() => {
        setServerDetected(false)
        setBackendStatus('error')
        setBackendMsg('Cannot reach the server — saving locally only.')
      })
  }

  const loadBackendDatasetIntoEditor = () => {
    if (!backendDataset) return
    replaceDraftState(backendDataset, true)
    showToast('Server dataset loaded into the editor.')
  }

  const publishNow = () => requestReview('backend')

  const signOut = async () => {
    if (dirty && !window.confirm('Sign out? Unsaved changes stay as a local draft.')) return
    await logoutRequest()
    onSignOut?.()
  }

  const q = query.trim().toLowerCase()
  const searching = q !== ''
  const matchText = (t: string) => t.toLowerCase().includes(q)

  const targetForFoot = serverDetected === false ? 'local' : 'backend'

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
                ? 'offline — saving locally only'
                : auth
                  ? `signed in as ${auth.user.name || auth.user.email}`
                  : 'not signed in'}
          </span>
          <span className="icon-btn chevron" aria-hidden>⌄</span>
        </button>
        <Collapse open={backendOpen}>
          <div className="config-backend-body">
            <p className="config-hint">
              Publishing pushes this dataset to the Dirman Dex server, so every
              device — and every visitor — sees the same galaxy. An{' '}
              <code>admin</code> role is required to publish.
            </p>
            {auth ? (
              <div className="config-session">
                <span className="config-session-user">
                  Signed in as <strong>{auth.user.name || auth.user.email}</strong>
                  <span className="config-session-role">{auth.user.role}</span>
                </span>
                <button className="btn ghost small" onClick={signOut}>
                  Sign out
                </button>
              </div>
            ) : (
              <div className="config-backend-msg" data-state="error">
                Not signed in — reload the page to log in.
              </div>
            )}
            {backendMsg && (
              <div className="config-backend-msg" data-state={backendStatus}>
                {backendMsg}
              </div>
            )}
            <div className="config-actions">
              <button
                className="btn ghost small"
                onClick={probeBackend}
                disabled={backendStatus === 'checking'}
              >
                {backendStatus === 'checking' ? 'Checking…' : 'Re-check server'}
              </button>
              {backendDataset && (
                <button className="btn ghost small" onClick={loadBackendDatasetIntoEditor}>
                  Load server dataset
                </button>
              )}
              <button
                className="btn primary small"
                onClick={publishNow}
                disabled={saving || backendStatus !== 'ok'}
              >
                {saving ? 'Saving…' : 'Publish to server'}
              </button>
            </div>
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
              one sits at the core of the galaxy. Autosaved locally as you type;
              publishing makes it live for everyone.
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
                          <section key={sys.id} id={`system-${sys.id}`} className={`config-system ${sysOpen ? 'open' : ''}`}>
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

                      <button className="btn ghost small dashed" onClick={() => addSystem(si)}>
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
            onClick={() => requestReview(targetForFoot)}
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
