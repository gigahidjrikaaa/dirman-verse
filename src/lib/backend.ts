import type { GalaxyData } from '../data/galaxyData'

/**
 * Client for the Dirman Dex backend (FastAPI on Render):
 *   POST /api/auth/login      → JWT (same credentials as the Dex app)
 *   GET  /api/auth/session    → validates/slides the token
 *   GET  /api/config/galaxy   → published galaxy dataset (public)
 *   PUT  /api/config/galaxy   → publish (admin token required)
 *
 * The JWT is stored per browser; the galaxy boots from the published
 * dataset and falls back to localStorage/defaults when unreachable.
 */

export class BackendUnavailableError extends Error {
  constructor(message = 'no server detected on this origin') {
    super(message)
    this.name = 'BackendUnavailableError'
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

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export interface DexUser {
  id: string
  email: string
  name: string
  role: string
  content_role?: string | null
}

const AUTH_KEY = 'dirman-auth'
const LEGACY_CFG_KEY = 'dirman-backend'

const DEFAULT_BASE = 'https://dirman-dex.onrender.com'

/**
 * API origin. A build-time env var (VITE_GALAXY_API_BASE) pins a
 * deployment; otherwise a localStorage override (tests, power users)
 * wins; the legacy relative '/api' value from the old backend era is
 * ignored; default is the public Dex API on Render.
 */
export function apiBase(): string {
  const envBase = (import.meta.env.VITE_GALAXY_API_BASE as string | undefined)?.trim()
  if (envBase) return envBase.replace(/\/+$/, '')
  let stored = ''
  try {
    const raw = localStorage.getItem(LEGACY_CFG_KEY)
    stored = raw ? ((JSON.parse(raw) as { base?: string }).base?.trim() ?? '') : ''
  } catch {
    // corrupt override — ignore it
  }
  return (stored && stored !== '/api' ? stored : DEFAULT_BASE).replace(/\/+$/, '')
}

export interface AuthState {
  token: string
  user: DexUser
}

export function loadAuth(): AuthState | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AuthState
    return parsed?.token && parsed?.user ? parsed : null
  } catch {
    return null
  }
}

export function saveAuth(auth: AuthState) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth))
}

export function clearAuth() {
  localStorage.removeItem(AUTH_KEY)
}

export function authHeaders(): Record<string, string> {
  const auth = loadAuth()
  return auth ? { Authorization: `Bearer ${auth.token}` } : {}
}

/** POST /api/auth/login — same credentials as the Dirman Dex app */
export async function login(
  email: string,
  password: string,
): Promise<AuthState> {
  const base = apiBase()
  let res: Response
  try {
    res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  } catch {
    throw new BackendUnavailableError()
  }
  if (res.status === 401) throw new AuthError('Email atau kata sandi salah')
  if (!res.ok) throw new AuthError(`Login failed (HTTP ${res.status})`)
  const json = await res.json()
  if (!json?.access_token || !json?.user) throw new AuthError('Unexpected login response')
  const auth = { token: json.access_token as string, user: json.user as DexUser }
  saveAuth(auth)
  return auth
}

/** GET /api/auth/session — validates the stored token and slides its expiry */
export async function fetchSession(): Promise<AuthState> {
  const base = apiBase()
  let res: Response
  try {
    res = await fetch(`${base}/api/auth/session`, {
      headers: authHeaders(),
    })
  } catch {
    throw new BackendUnavailableError()
  }
  if (res.status === 401) throw new AuthError('session expired')
  if (!res.ok) throw new BackendUnavailableError(`HTTP ${res.status}`)
  const json = await res.json()
  if (!json?.user) throw new AuthError('no user in session')
  return {
    token: json.access_token ?? loadAuth()?.token ?? '',
    user: json.user as DexUser,
  }
}

export async function logoutRequest() {
  try {
    await fetch(`${apiBase()}/api/auth/logout`, {
      method: 'POST',
      headers: authHeaders(),
    })
  } catch {
    // best-effort — the client token is cleared regardless
  }
  clearAuth()
}

/** GET /api/config/galaxy — the published dataset (null when never published) */
export async function fetchGalaxy(): Promise<GalaxyData | null> {
  const base = apiBase()
  let res: Response
  try {
    res = await fetch(`${base}/api/config/galaxy`)
  } catch {
    throw new BackendUnavailableError()
  }
  if (res.status === 404) return null
  if (!res.ok) throw new BackendUnavailableError(`HTTP ${res.status}`)
  return (await res.json()) as GalaxyData
}

export interface PublishOptions {
  /** updated_at of the dataset this edit was based on — 409 on mismatch */
  ifMatch?: string | null
  force?: boolean
  updatedBy: string
}

/** PUT /api/config/galaxy — publish a new revision (admin token required) */
export async function publishGalaxy(
  data: GalaxyData,
  opts: PublishOptions,
): Promise<{ updated_at: string; updated_by: string }> {
  const base = apiBase()
  const auth = loadAuth()
  let res: Response
  try {
    res = await fetch(`${base}/api/config/galaxy`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? authHeaders() : {}),
      },
      body: JSON.stringify({ ...data, updated_by: opts.updatedBy, base_updated_at: opts.ifMatch ?? null, force: opts.force ?? false }),
    })
  } catch {
    throw new BackendUnavailableError()
  }
  const json = await res.json().catch(() => ({}))
  if (res.status === 409) {
    throw new PublishConflictError(json?.current ?? { data: null, updated_by: null, updated_at: null })
  }
  if (res.status === 403) throw new Error('admin access required')
  if (res.status === 401) throw new AuthError('session expired')
  if (!res.ok) throw new Error(json?.detail ?? `HTTP ${res.status}`)
  return {
    updated_at: json?.updated_at ?? new Date().toISOString(),
    updated_by: json?.updated_by ?? opts.updatedBy,
  }
}
