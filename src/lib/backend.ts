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

const DEFAULTS: BackendConfig = { base: '', password: '', author: '' }

export function loadBackendConfig(): BackendConfig {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
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

/** POST a dataset — requires the admin password */
export async function publishBackendLinks(data: GalaxyData, author: string): Promise<void> {
  const { password } = loadBackendConfig()
  const res = await fetch(endpoint('/links'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Password': password },
    body: JSON.stringify({ data, author: author || 'anonymous' }),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error(j?.error ?? `HTTP ${res.status}`)
  }
}

export interface Revision {
  id: number
  author: string | null
  created_at: string
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
