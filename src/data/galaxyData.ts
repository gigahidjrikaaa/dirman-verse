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

export const DEFAULT_GALAXY: GalaxyData = {
  sectors: [
    {
      id: 'important',
      name: 'Important Links',
      hue: 46,
      systems: [
        {
          id: 'command',
          name: 'Command Hub',
          importance: 3,
          description: 'The center of the war map.',
          bodies: [
            { id: 'main-site', name: 'Main Site', url: 'https://example.com/', description: 'The flagship gate.' },
            { id: 'dashboard', name: 'Dashboard', url: 'https://example.com/dashboard', kind: 'moon' },
          ],
        },
        {
          id: 'quick',
          name: 'Quick Access',
          importance: 2,
          description: 'Everyday essentials, one warp away.',
          bodies: [
            { id: 'mail', name: 'Mail', url: 'https://mail.google.com/' },
            { id: 'calendar', name: 'Calendar', url: 'https://calendar.google.com/', kind: 'moon' },
          ],
        },
      ],
    },
    {
      id: 'docs',
      name: 'Documentation',
      hue: 356,
      systems: [
        {
          id: 'archive',
          name: 'Docs Archive',
          importance: 2,
          description: 'The written doctrine.',
          bodies: [
            { id: 'library', name: 'Policy Library', url: 'https://example.com/docs' },
            { id: 'guidelines', name: 'Guidelines', url: 'https://example.com/guidelines', kind: 'moon' },
          ],
        },
        {
          id: 'reports',
          name: 'Reports Station',
          importance: 1,
          description: 'After-action records.',
          bodies: [
            { id: 'quarterly', name: 'Quarterly Reports', url: 'https://example.com/reports' },
          ],
        },
      ],
    },
    {
      id: 'academic',
      name: 'Academic Materials',
      hue: 282,
      systems: [
        {
          id: 'lecture',
          name: 'Lecture Hall',
          importance: 3,
          description: 'Doctrine from the academy.',
          bodies: [
            { id: 'notes', name: 'Course Notes', url: 'https://example.com/notes' },
            { id: 'slides', name: 'Slides', url: 'https://example.com/slides', kind: 'moon' },
          ],
        },
        {
          id: 'research',
          name: 'Research Ring',
          importance: 2,
          url: 'https://scholar.google.com/',
          description: 'The frontier, mapped.',
          bodies: [
            { id: 'papers', name: 'Papers', url: 'https://scholar.google.com/' },
            { id: 'journals', name: 'Journals', url: 'https://example.com/journals', kind: 'moon' },
          ],
        },
      ],
    },
    {
      id: 'forms',
      name: 'Forms',
      hue: 222,
      systems: [
        {
          id: 'registry',
          name: 'Registry',
          importance: 2,
          description: 'Paperwork, filed and flying.',
          bodies: [
            { id: 'requests', name: 'Request Forms', url: 'https://example.com/forms' },
            { id: 'templates', name: 'Templates', url: 'https://example.com/templates', kind: 'moon' },
          ],
        },
      ],
    },
    {
      id: 'hr',
      name: 'Human Resources',
      hue: 187,
      systems: [
        {
          id: 'people',
          name: 'People Hub',
          importance: 2,
          description: 'The crew manifest.',
          bodies: [
            { id: 'directory', name: 'Directory', url: 'https://example.com/directory' },
            { id: 'org-chart', name: 'Org Chart', url: 'https://example.com/org', kind: 'moon' },
          ],
        },
        {
          id: 'welfare',
          name: 'Welfare Station',
          importance: 1,
          description: 'Take care of the troops.',
          bodies: [
            { id: 'benefits', name: 'Benefits', url: 'https://example.com/benefits' },
            { id: 'careers', name: 'Careers', url: 'https://example.com/careers', kind: 'moon' },
          ],
        },
      ],
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
