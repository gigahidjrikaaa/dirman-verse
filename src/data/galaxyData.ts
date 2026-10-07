/* ============================================================================
   GALAXY DATA — types, defaults, and the browser persistence layer.
   ----------------------------------------------------------------------------
   The galaxy boots from localStorage when a saved dataset exists (created by
   the #/config link manager) and falls back to the built-in defaults below.
============================================================================ */

export interface BodyDef {
  id: string
  name: string
  url: string
  kind?: 'planet' | 'moon'
  description?: string
  /** pin a celestial archetype: terran | gas | ice | lava | ringed | rock */
  style?: string
  /** hue shift (−40..40) from the cluster color */
  tint?: number
}

export interface SystemDef {
  id: string
  name: string
  importance?: 1 | 2 | 3
  url?: string
  description?: string
  bodies: BodyDef[]
  /** pin a sun archetype: classic | giant | flame | pulse | binary */
  style?: string
  /** hue shift (−40..40) from the cluster color */
  tint?: number
}

export interface SectorDef {
  id: string
  name: string
  hue: number
  systems: SystemDef[]
}

export interface GalaxyData {
  sectors: SectorDef[]
}

/**
 * The default dataset: nine clusters, one per character tail, each with a
 * themed system and placeholder links. Rename or remap them freely in the
 * #/config link manager — the layout stays symmetric for any cluster count
 * (clusters wrap around the nine tails in order).
 */
export const DEFAULT_GALAXY: GalaxyData = {
  sectors: [
    {
      id: 'integrity', name: 'Integrity', hue: 46,
      systems: [{
        id: 'ethics-vault', name: 'Ethics Vault', importance: 3,
        description: 'The compass of the realm.',
        bodies: [
          { id: 'conduct', name: 'Code of Conduct', url: 'https://example.com/conduct', description: 'The oath every star swears.' },
          { id: 'training', name: 'Integrity Training', url: 'https://example.com/training', kind: 'moon' },
        ],
      }],
    },
    {
      id: 'courage', name: 'Courage', hue: 355,
      systems: [{
        id: 'bravefront', name: 'Bravefront', importance: 2,
        description: 'Where hard calls are logged.',
        bodies: [
          { id: 'decisions', name: 'Hard Decisions', url: 'https://example.com/decisions' },
          { id: 'feedback', name: 'Feedback Channel', url: 'https://example.com/feedback', kind: 'moon' },
        ],
      }],
    },
    {
      id: 'vision', name: 'Strategic Vision', hue: 285,
      systems: [{
        id: 'horizon', name: 'Horizon', importance: 2,
        description: 'The map of what comes next.',
        bodies: [
          { id: 'roadmap', name: 'Roadmap 2030', url: 'https://example.com/roadmap' },
          { id: 'strategy', name: 'Strategy Deck', url: 'https://example.com/strategy', kind: 'moon' },
        ],
      }],
    },
    {
      id: 'communication', name: 'Communication', hue: 187,
      systems: [{
        id: 'signal-tower', name: 'Signal Tower', importance: 2,
        description: 'Every front hears every order.',
        bodies: [
          { id: 'announcements', name: 'Announcements', url: 'https://example.com/announcements' },
          { id: 'newsletter', name: 'Newsletter', url: 'https://example.com/newsletter', kind: 'moon' },
        ],
      }],
    },
    {
      id: 'collaboration', name: 'Collaboration', hue: 118,
      systems: [{
        id: 'common-ground', name: 'Common Ground', importance: 2,
        description: 'Shared tables, shared wins.',
        bodies: [
          { id: 'team-spaces', name: 'Team Spaces', url: 'https://example.com/teams' },
          { id: 'boards', name: 'Shared Boards', url: 'https://example.com/boards', kind: 'moon' },
        ],
      }],
    },
    {
      id: 'resilience', name: 'Resilience', hue: 22,
      systems: [{
        id: 'ironhold', name: 'Ironhold', importance: 2,
        description: 'Unbroken through the longest march.',
        bodies: [
          { id: 'continuity', name: 'Continuity Plans', url: 'https://example.com/continuity' },
          { id: 'reviews', name: 'Incident Reviews', url: 'https://example.com/reviews', kind: 'moon' },
        ],
      }],
    },
    {
      id: 'initiative', name: 'Initiative', hue: 12,
      systems: [{
        id: 'firstlight', name: 'Firstlight', importance: 2,
        description: 'First to move, without orders.',
        bodies: [
          { id: 'lab', name: 'Innovation Lab', url: 'https://example.com/lab' },
          { id: 'ideas', name: 'Idea Board', url: 'https://example.com/ideas', kind: 'moon' },
        ],
      }],
    },
    {
      id: 'empathy', name: 'Empathy', hue: 335,
      systems: [{
        id: 'heartline', name: 'Heartline', importance: 2,
        description: 'The strength to care.',
        bodies: [
          { id: 'care', name: 'Care Programs', url: 'https://example.com/care' },
          { id: 'support', name: 'Support Portal', url: 'https://example.com/support', kind: 'moon' },
        ],
      }],
    },
    {
      id: 'accountability', name: 'Accountability', hue: 55,
      systems: [{
        id: 'ledger', name: 'Ledger', importance: 2,
        description: 'Every outcome, owned.',
        bodies: [
          { id: 'okr', name: 'OKR Tracker', url: 'https://example.com/okr' },
          { id: 'audit', name: 'Audit Trail', url: 'https://example.com/audit', kind: 'moon' },
        ],
      }],
    },
  ],
}

const STORAGE_KEY = 'dirman-galaxy-data'

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'cluster'
  )
}

/** repair arbitrary input into a valid dataset; null when unusable */
export function normalizeGalaxy(input: unknown): GalaxyData | null {
  if (!input || typeof input !== 'object') return null
  const rawSectors = (input as { sectors?: unknown }).sectors
  if (!Array.isArray(rawSectors)) return null

  const usedIds = new Set<string>()
  const uniqueId = (base: string): string => {
    let id = base || 'cluster'
    let n = 2
    while (usedIds.has(id)) id = `${base}-${n++}`
    usedIds.add(id)
    return id
  }

  const sectors: SectorDef[] = []
  for (const raw of rawSectors) {
    if (!raw || typeof raw !== 'object') continue
    const rs = raw as Partial<SectorDef>
    if (!rs.name || typeof rs.name !== 'string') continue
    const id = uniqueId(typeof rs.id === 'string' && rs.id ? rs.id : slugify(rs.name))
    const systems: SystemDef[] = []
    for (const rawSys of Array.isArray(rs.systems) ? rs.systems : []) {
      if (!rawSys || typeof rawSys !== 'object') continue
      const ry = rawSys as Partial<SystemDef>
      if (!ry.name || typeof ry.name !== 'string') continue
      const sysId = uniqueId(typeof ry.id === 'string' && ry.id ? ry.id : slugify(ry.name))
      const bodies: BodyDef[] = []
      for (const rawBody of Array.isArray(ry.bodies) ? ry.bodies : []) {
        if (!rawBody || typeof rawBody !== 'object') continue
        const rb = rawBody as Partial<BodyDef>
        if (!rb.name || typeof rb.name !== 'string') continue
        if (!rb.url || typeof rb.url !== 'string') continue // a body is a link
        bodies.push({
          id: uniqueId(typeof rb.id === 'string' && rb.id ? rb.id : slugify(rb.name)),
          name: rb.name,
          url: rb.url,
          kind: rb.kind === 'moon' ? 'moon' : 'planet',
          ...(rb.description ? { description: rb.description } : {}),
          ...(rb.style ? { style: rb.style } : {}),
          ...(typeof rb.tint === 'number' ? { tint: rb.tint } : {}),
        })
      }
      const importance = Number(ry.importance)
      systems.push({
        id: sysId,
        name: ry.name,
        ...(Number.isFinite(importance) ? { importance: (Math.min(3, Math.max(1, importance)) as 1 | 2 | 3) } : {}),
        ...(ry.url && typeof ry.url === 'string' ? { url: ry.url } : {}),
        ...(ry.description ? { description: ry.description } : {}),
        bodies,
        ...(ry.style ? { style: ry.style } : {}),
        ...(typeof ry.tint === 'number' ? { tint: ry.tint } : {}),
      })
    }
    const hue = Number(rs.hue)
    sectors.push({
      id,
      name: rs.name,
      hue: Number.isFinite(hue) ? ((hue % 360) + 360) % 360 : 46,
      systems,
    })
  }
  if (sectors.length === 0) return null
  return { sectors }
}

export function loadGalaxyData(): GalaxyData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_GALAXY
    return normalizeGalaxy(JSON.parse(raw)) ?? DEFAULT_GALAXY
  } catch {
    return DEFAULT_GALAXY
  }
}

export function saveGalaxyData(data: GalaxyData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function resetGalaxyData() {
  localStorage.removeItem(STORAGE_KEY)
}

export function exportGalaxyJson(data: GalaxyData): string {
  return JSON.stringify(data, null, 2)
}

export function parseGalaxyJson(text: string): GalaxyData | null {
  try {
    return normalizeGalaxy(JSON.parse(text))
  } catch {
    return null
  }
}

export function withUrlScheme(url: string): string {
  const u = url.trim()
  if (!u) return u
  return /^[a-z]+:\/\//i.test(u) ? u : `https://${u}`
}
