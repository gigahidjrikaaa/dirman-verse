import type { GalaxyData } from './galaxyData'

/**
 * Diff between the published dataset and the editor draft — shown in the
 * review step before publishing so nothing changes sight-unseen.
 */

export interface LinkChange {
  id: string
  cluster: string
  system: string
  name: string
  from?: { name: string; url: string }
  to?: { name: string; url: string }
}

export interface ClusterChange {
  id: string
  name: string
}

export interface GalaxyDiff {
  addedClusters: ClusterChange[]
  removedClusters: ClusterChange[]
  addedSystems: { cluster: string; system: string }[]
  removedSystems: { cluster: string; system: string }[]
  addedLinks: LinkChange[]
  removedLinks: LinkChange[]
  changedLinks: LinkChange[]
}

export function diffGalaxy(before: GalaxyData, after: GalaxyData): GalaxyDiff {
  const diff: GalaxyDiff = {
    addedClusters: [],
    removedClusters: [],
    addedSystems: [],
    removedSystems: [],
    addedLinks: [],
    removedLinks: [],
    changedLinks: [],
  }

  const beforeById = new Map(before.sectors.map((s) => [s.id, s]))
  const afterById = new Map(after.sectors.map((s) => [s.id, s]))

  for (const [id, sector] of afterById) {
    if (!beforeById.has(id)) diff.addedClusters.push({ id, name: sector.name })
  }
  for (const [id, sector] of beforeById) {
    if (!afterById.has(id)) diff.removedClusters.push({ id, name: sector.name })
  }

  for (const [id, afterSector] of afterById) {
    const beforeSector = beforeById.get(id)
    if (!beforeSector) continue

    const beforeSys = new Map(beforeSector.systems.map((y) => [y.id, y]))
    const afterSys = new Map(afterSector.systems.map((y) => [y.id, y]))

    for (const [sid, sys] of afterSys) {
      if (!beforeSys.has(sid)) {
        diff.addedSystems.push({ cluster: afterSector.name, system: sys.name })
      }
    }
    for (const [sid, sys] of beforeSys) {
      if (!afterSys.has(sid)) {
        diff.removedSystems.push({ cluster: afterSector.name, system: sys.name })
      }
    }

    for (const [sid, sys] of afterSys) {
      const beforeSysEntry = beforeSys.get(sid)
      if (!beforeSysEntry) continue

      const beforeBodies = new Map(beforeSysEntry.bodies.map((b) => [b.id, b]))
      const afterBodies = new Map(sys.bodies.map((b) => [b.id, b]))

      for (const [bid, body] of afterBodies) {
        const was = beforeBodies.get(bid)
        if (!was) {
          diff.addedLinks.push({
            id: bid, cluster: afterSector.name, system: sys.name, name: body.name,
            to: { name: body.name, url: body.url },
          })
          continue
        }
        if (was.name !== body.name || was.url !== body.url || (was.description ?? '') !== (body.description ?? '')) {
          diff.changedLinks.push({
            id: bid, cluster: afterSector.name, system: sys.name, name: body.name,
            from: { name: was.name, url: was.url },
            to: { name: body.name, url: body.url },
          })
        }
      }
      for (const [bid, body] of beforeBodies) {
        if (!afterBodies.has(bid)) {
          diff.removedLinks.push({
            id: bid, cluster: afterSector.name, system: sys.name, name: body.name,
            from: { name: body.name, url: body.url },
          })
        }
      }
    }
  }

  return diff
}

export function diffIsEmpty(d: GalaxyDiff): boolean {
  return (
    d.addedClusters.length === 0 &&
    d.removedClusters.length === 0 &&
    d.addedSystems.length === 0 &&
    d.removedSystems.length === 0 &&
    d.addedLinks.length === 0 &&
    d.removedLinks.length === 0 &&
    d.changedLinks.length === 0
  )
}

export function diffSummary(d: GalaxyDiff): string {
  const parts: string[] = []
  if (d.addedLinks.length) parts.push(`+${d.addedLinks.length} links`)
  if (d.removedLinks.length) parts.push(`−${d.removedLinks.length} links`)
  if (d.changedLinks.length) parts.push(`~${d.changedLinks.length} edited`)
  if (d.addedSystems.length) parts.push(`+${d.addedSystems.length} systems`)
  if (d.removedSystems.length) parts.push(`−${d.removedSystems.length} systems`)
  if (d.addedClusters.length) parts.push(`+${d.addedClusters.length} clusters`)
  if (d.removedClusters.length) parts.push(`−${d.removedClusters.length} clusters`)
  return parts.length ? parts.join(' · ') : 'no changes'
}
