import { allEntities, type Entity } from '../data/links'

/**
 * Shared pointer/input state + screen-space picking registry.
 *
 * We pick bodies by projecting their world positions to screen pixels each
 * frame (cheap for <100 entities) instead of raycasting billboarded quads —
 * this keeps hit-testing consistent with what the user actually sees and
 * gives us a configurable, forgiving click radius.
 */

export const input = {
  pointerDown: false,
  /** pixels moved since pointerdown — used to distinguish click vs drag */
  moved: 0,
  lastX: 0,
  lastY: 0,
  /** NDC mouse position for parallax */
  nx: 0,
  ny: 0,
  /** seconds since the last user interaction (for idle drift) */
  idleFor: 0,
  /** focus mode drag, owned by CameraRig */
  focusTheta: 0,
}

interface PickEntry {
  x: number
  y: number
  /** pick radius in CSS pixels */
  r: number
  entity?: Entity
  comet?: boolean
}

const registry = new Map<string, PickEntry>()

export function updatePickEntry(
  id: string,
  x: number,
  y: number,
  r: number,
  entity?: Entity,
) {
  let e = registry.get(id)
  if (!e) {
    e = { x, y, r, entity }
    registry.set(id, e)
  }
  e.x = x
  e.y = y
  e.r = r
  e.entity = entity
}

export function markComet(id: string, x: number, y: number, r: number) {
  updatePickEntry(id, x, y, r)
  registry.get(id)!.comet = true
}

export function clearPickEntry(id: string) {
  registry.delete(id)
}

/** nearest entry under the pointer, forgiving minimum radius in CSS px */
export function pick(px: number, py: number): { id: string; entity?: Entity; comet?: boolean } | null {
  let best: { id: string; d2: number } | null = null
  for (const [id, e] of registry) {
    const dx = px - e.x
    const dy = py - e.y
    const radius = Math.max(e.r * 1.25, 18)
    const d2 = dx * dx + dy * dy
    if (d2 <= radius * radius && (!best || d2 < best.d2)) {
      best = { id, d2 }
    }
  }
  if (!best) return null
  const entry = registry.get(best.id)!
  return { id: best.id, entity: entry.entity, comet: entry.comet }
}

/** reset hover when pointer leaves the canvas */
export function hoverAt(
  px: number,
  py: number,
  setHovered: (id: string | null) => void,
): void {
  const hit = pick(px, py)
  setHovered(hit?.entity?.id ?? null)
}

export const entityCount = allEntities.length
