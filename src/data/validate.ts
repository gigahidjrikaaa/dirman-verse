import type { GalaxyData } from './galaxyData'
import { normalizeGalaxy } from './galaxyData'

/**
 * Inline validation for the link manager — surfaced as you type, not just
 * at save time. Levels: 'error' blocks saving; 'warning' informs.
 */

export interface ValidationIssue {
  /** stable key, e.g. "s:0:name" or "b:2:1:0:url" */
  key: string
  level: 'error' | 'warning'
  msg: string
}

export function validateGalaxy(d: GalaxyData): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  d.sectors.forEach((sector, si) => {
    if (!sector.name.trim()) {
      issues.push({ key: `s:${si}:name`, level: 'error', msg: 'Cluster needs a name' })
    }
    const sysNames = new Set<string>()
    sector.systems.forEach((sys, yi) => {
      if (!sys.name.trim()) {
        issues.push({ key: `y:${si}:${yi}:name`, level: 'error', msg: 'System needs a name' })
      }
      const sysKey = sys.name.trim().toLowerCase()
      if (sysKey && sysNames.has(sysKey)) {
        issues.push({ key: `y:${si}:${yi}:dup`, level: 'warning', msg: 'Duplicate system name' })
      }
      sysNames.add(sysKey)

      const urls = new Set<string>()
      sys.bodies.forEach((body, bi) => {
        const bKey = `b:${si}:${yi}:${bi}`
        if (!body.name.trim()) {
          issues.push({ key: `${bKey}:name`, level: 'error', msg: 'Link needs a name' })
        }
        const url = body.url.trim()
        if (!url) {
          issues.push({
            key: `${bKey}:url`,
            level: 'warning',
            msg: 'Empty URL — this link will be removed when you save',
          })
        } else if (!/^(https?:\/\/|mailto:)/i.test(url)) {
          issues.push({ key: `${bKey}:url`, level: 'warning', msg: 'URL is missing https://' })
        } else if (urls.has(url.toLowerCase())) {
          issues.push({ key: `${bKey}:urldup`, level: 'warning', msg: 'Duplicate URL in this system' })
        }
        urls.add(url.toLowerCase())
      })
    })
  })

  return issues
}

export function issuesForPrefix(
  issues: ValidationIssue[],
  prefix: string,
): ValidationIssue[] {
  return issues.filter((i) => i.key.startsWith(prefix))
}

/** what normalizeGalaxy will change on save — surfaced so nothing is silent */
export function normalizationReport(d: GalaxyData): {
  removedLinks: number
  totalBefore: number
  totalAfter: number
} {
  const totalBefore = d.sectors.reduce(
    (n, s) => n + s.systems.reduce((m, y) => m + y.bodies.length, 0),
    0,
  )
  const clean = normalizeGalaxy(d)
  const totalAfter = clean
    ? clean.sectors.reduce(
        (n, s) => n + s.systems.reduce((m, y) => m + y.bodies.length, 0),
        0,
      )
    : 0
  return { removedLinks: Math.max(0, totalBefore - totalAfter), totalBefore, totalAfter }
}
