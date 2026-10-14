import type { GalaxyData } from '../data/galaxyData'

/**
 * Client helpers for the optional link backend (/api/links serverless
 * functions + Postgres). When configured, the backend is the source of
 * truth: the galaxy boots from it and the link manager publishes to it.
 */

export interface BackendConfig {
  /** API base, e.g. "/api" (same origin) or "https://dirman.vercel.app/api" */
  base: string
  password: string
  author: string
}

const KEY = 'dirman-backend'

const DEFAULTS: BackendConfig = { base: '/api', password: '', author: '' }

export function loadBackendConfig(): BackendConfig {
  try {
    const raw = localStorage.getItem(KEY)
    const cfg = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
    // same-origin deployments need no base — an empty stored value means /api
    if (!cfg.base.trim()) cfg.base = DEFAULTS.base
    return cfg
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveBackendConfig(cfg: BackendConfig) {
  localStorage.setItem(KEY, JSON.stringify(cfg))
}

export function backendConfigured(): boolean {
  return loadBackendConfig().base.trim() !== ''
}

const endpoint = (path: string) =>
  loadBackendConfig().base.replace(/\/+$/, '') + path

export interface BackendStatus {
  data: GalaxyData | null
  updated_by: string | null
  updated_at: string | null
}

/** GET the published dataset + last-update info (public) */
export async function fetchBackendStatus(signal?: AbortSignal): Promise<BackendStatus> {
  const res = await fetch(endpoint('/links'), { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  return {
    data: (json?.data ?? null) as GalaxyData | null,
    updated_by: json?.updated_by ?? null,
    updated_at: json?.updated_at ?? null,
  }
}

export class PublishConflictError extends Error {
  current: { data: GalaxyData | null; updated_by: string | null; updated_at: string | null }
  constructor(current: PublishConflictError['current']) {
    super('conflict — the dataset was updated by someone else')
    this.name = 'PublishConflictError'
    this.current = current
  }
}

export class BackendUnavailableError extends Error {
  constructor(message = 'no server detected on this origin') {
    super(message)
    this.name = 'BackendUnavailableError'
  }
}

/** POST a dataset — requires the admin password; 409 = someone published first */
export async function publishBackendLinks(
  data: GalaxyData,
  author: string,
  opts?: { ifMatch?: string; force?: boolean },
): Promise<{ updated_by: string | null; updated_at: string | null }> {
  const { password } = loadBackendConfig()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Admin-Password': password,
  }
  if (opts?.ifMatch) headers['If-Match'] = opts.ifMatch
  if (opts?.force) headers['X-Force'] = '1'

  let res: Response
  try {
    res = await fetch(endpoint('/links'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ data, author: author || 'anonymous' }),
    })
  } catch {
    throw new BackendUnavailableError()
  }
  if (res.status === 404 || res.status === 501) throw new BackendUnavailableError('no API on this origin')
  const json = await res.json().catch(() => ({}))
  if (res.status === 409) {
    throw new PublishConflictError(json?.current ?? { data: null, updated_by: null, updated_at: null })
  }
  if (!res.ok) {
    throw new Error(json?.error ?? `HTTP ${res.status}`)
  }
  return { updated_by: json?.updated_by ?? null, updated_at: json?.updated_at ?? null }
}

export interface Revision {
  id: number
  author: string | null
  created_at: string
  data: GalaxyData
}

/** GET the last 20 revisions (requires the admin password) */
export async function fetchBackendRevisions(): Promise<Revision[]> {
  const { password } = loadBackendConfig()
  const res = await fetch(endpoint('/revisions'), {
    headers: { 'X-Admin-Password': password },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  return (json?.revisions ?? []) as Revision[]
}
