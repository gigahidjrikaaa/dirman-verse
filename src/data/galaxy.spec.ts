import { describe, it, expect, beforeEach } from 'vitest'
import { normalizeGalaxy, parseGalaxyJson, exportGalaxyJson } from './galaxyData'
import { diffGalaxy, diffIsEmpty, diffSummary } from './diff'
import { validateGalaxy } from './validate'
import { hash01, resolveStyle } from './starStyles'
import type { GalaxyData } from './galaxyData'

// minimal localStorage stub (galaxyData only touches it in load/save/reset,
// which these tests avoid — but normalize tests need a clean environment)
beforeEach(() => {
  const store = new Map<string, string>()
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage
})

const VALID: GalaxyData = {
  sectors: [
    {
      id: 'test',
      name: 'Test Cluster',
      hue: 46,
      systems: [
        {
          id: 'sys',
          name: 'Test System',
          importance: 3,
          bodies: [
            { id: 'b1', name: 'Link One', url: 'https://example.com/one' },
            { id: 'b2', name: 'Link Two', url: 'https://example.com/two', kind: 'moon' },
          ],
        },
      ],
    },
  ],
}

describe('normalizeGalaxy', () => {
  it('passes a valid dataset through with fields intact', () => {
    const out = normalizeGalaxy(VALID)
    expect(out).not.toBeNull()
    expect(out!.sectors).toHaveLength(1)
    expect(out!.sectors[0].name).toBe('Test Cluster')
    expect(out!.sectors[0].systems[0].bodies).toHaveLength(2)
    expect(out!.sectors[0].hue).toBe(46)
  })

  it('returns null for garbage input', () => {
    expect(normalizeGalaxy(null)).toBeNull()
    expect(normalizeGalaxy('nope')).toBeNull()
    expect(normalizeGalaxy({})).toBeNull()
    expect(normalizeGalaxy({ sectors: 'x' })).toBeNull()
    // sectors that are all-invalid normalize to an empty dataset → null
    expect(normalizeGalaxy({ sectors: [null, 42] })).toBeNull()
  })

  it('drops bodies without a URL instead of crashing', () => {
    const dirty = {
      sectors: [
        {
          id: 's',
          name: 'S',
          hue: 46,
          systems: [
            {
              id: 'y',
              name: 'Y',
              bodies: [
                { id: 'ok', name: 'Has URL', url: 'https://x.com' },
                { id: 'bad', name: 'No URL', url: '' },
              ],
            },
          ],
        },
      ],
    }
    const out = normalizeGalaxy(dirty)
    expect(out!.sectors[0].systems[0].bodies).toHaveLength(1)
    expect(out!.sectors[0].systems[0].bodies[0].name).toBe('Has URL')
  })

  it('deduplicates colliding ids', () => {
    const dup = {
      sectors: [
        {
          id: 'dup',
          name: 'Dup',
          hue: 46,
          systems: [
            { id: 'dup', name: 'A', bodies: [{ id: 'x', name: 'X', url: 'https://a.com' }] },
            { id: 'dup', name: 'B', bodies: [{ id: 'x', name: 'Y', url: 'https://b.com' }] },
          ],
        },
      ],
    }
    const out = normalizeGalaxy(dup)!
    const ids = out.sectors.flatMap((s) => s.systems.map((y) => y.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('coerces non-numeric hues into range', () => {
    const out = normalizeGalaxy({
      sectors: [{ id: 'h', name: 'H', hue: 'NaN' as unknown as number, systems: [] }],
    })
    expect(Number.isFinite(out!.sectors[0].hue)).toBe(true)
  })

  it('export → parse round-trips to the canonical form (idempotent)', () => {
    const json = exportGalaxyJson(VALID)
    const back = parseGalaxyJson(json)
    // canonicalization fills defaults (kind: 'planet'), so compare against
    // a re-normalized draft — parse(normalize(x)) must equal normalize(x)
    const canonical = normalizeGalaxy(VALID)
    expect(back).toEqual(canonical)
    // and it's idempotent: parsing twice changes nothing
    expect(parseGalaxyJson(exportGalaxyJson(back!))).toEqual(canonical)
  })
})

describe('diffGalaxy', () => {
  it('detects added, removed and changed links', () => {
    const before: GalaxyData = {
      sectors: [
        {
          id: 'c',
          name: 'Cluster',
          hue: 46,
          systems: [
            {
              id: 's',
              name: 'System',
              bodies: [
                { id: 'keep', name: 'Keep', url: 'https://keep.com' },
                { id: 'gone', name: 'Gone', url: 'https://gone.com' },
                { id: 'chg', name: 'Old Name', url: 'https://old.com' },
              ],
            },
          ],
        },
      ],
    }
    const after: GalaxyData = {
      sectors: [
        {
          id: 'c',
          name: 'Cluster',
          hue: 46,
          systems: [
            {
              id: 's',
              name: 'System',
              bodies: [
                { id: 'keep', name: 'Keep', url: 'https://keep.com' },
                { id: 'chg', name: 'New Name', url: 'https://new.com' },
                { id: 'new', name: 'Brand New', url: 'https://new-link.com' },
              ],
            },
          ],
        },
      ],
    }
    const d = diffGalaxy(before, after)
    expect(d.removedLinks.map((l) => l.name)).toEqual(['Gone'])
    expect(d.changedLinks).toHaveLength(1)
    expect(d.changedLinks[0].to?.name).toBe('New Name')
    expect(d.addedLinks.map((l) => l.name)).toEqual(['Brand New'])
    expect(diffIsEmpty(d)).toBe(false)
    expect(diffSummary(d)).toContain('+1 links')
  })

  it('reports empty diff for identical datasets', () => {
    expect(diffIsEmpty(diffGalaxy(VALID, VALID))).toBe(true)
  })
})

describe('validateGalaxy', () => {
  it('flags empty cluster and link names as errors', () => {
    const bad: GalaxyData = {
      sectors: [
        {
          id: 'c',
          name: '  ',
          hue: 46,
          systems: [
            {
              id: 's',
              name: 'Sys',
              bodies: [{ id: 'b', name: '', url: 'https://x.com' }],
            },
          ],
        },
      ],
    }
    const issues = validateGalaxy(bad)
    const errors = issues.filter((i) => i.level === 'error')
    expect(errors.length).toBeGreaterThanOrEqual(2)
  })

  it('warns about URLs missing a scheme', () => {
    const bad: GalaxyData = {
      sectors: [
        {
          id: 'c',
          name: 'C',
          hue: 46,
          systems: [
            {
              id: 's',
              name: 'S',
              bodies: [{ id: 'b', name: 'B', url: 'example.com/page' }],
            },
          ],
        },
      ],
    }
    const issues = validateGalaxy(bad)
    expect(issues.some((i) => i.msg.includes('https://'))).toBe(true)
  })
})

describe('starStyles', () => {
  it('hashes ids deterministically', () => {
    expect(hash01('integrity')).toBe(hash01('integrity'))
    expect(hash01('integrity')).not.toBe(hash01('courage'))
  })

  it('assigns sun archetypes only to suns', () => {
    const s = resolveStyle('x', 'sun', 2)
    expect([1, 2, 3, 4, 5]).toContain(s.code)
    const p = resolveStyle('y', 'planet', 2)
    expect([10, 11, 12, 13, 14, 15]).toContain(p.code)
  })

  it('honors a valid style override and rejects a mismatched one', () => {
    expect(resolveStyle('x', 'sun', 2, 'pulse').code).toBe(4)
    // a planet style on a sun falls back to the hash assignment
    const forced = resolveStyle('x', 'sun', 2, 'rock')
    expect([1, 2, 3, 4, 5]).toContain(forced.code)
  })
})
