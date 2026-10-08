import * as THREE from 'three'
import { mulberry32 } from '../utils/random'
import { hash01, resolveStyle } from './starStyles'
import { loadGalaxyData, type GalaxyData } from './galaxyData'

export type { BodyDef, SystemDef, SectorDef, GalaxyData } from './galaxyData'

/* ============================================================================
   LAYOUT ENGINE — turns the galaxy dataset into positioned 3D entities.
   ----------------------------------------------------------------------------
   The dataset comes from loadGalaxyData(): the saved #/config edits when they
   exist, otherwise the built-in defaults. Everything below is deterministic
   (seeded) — no need to touch it.

   The galaxy is not a flat pinwheel: every system is strung along the
   MARCH ROUTE — a single winding, climbing curve from the core to the rim,
   one sector per stretch, honoring the long marches of Jenderal Sudirman.
============================================================================ */

/** the live dataset — defaults, localStorage save, or backend (via setGalaxyData) */
export let galaxy: GalaxyData = loadGalaxyData()
export const GALAXY_RADIUS = 54

/**
 * The Nine-Pointed Mandala: nine identical character tails at perfect 40°
 * intervals. Tail k carries cluster k (mod 9); systems sit on mirrored
 * rings — system yi of every cluster shares the same tail fraction, so the
 * whole formation is rotationally symmetric.
 */
export const TAIL_COUNT = 9
const TAIL_CORE = 10
const TAIL_TIP = GALAXY_RADIUS + 2
const TAIL_SWEEP = 1.15 // radians the tail curls over its full length
const COUNCIL_T = 0.62 // tail fraction where each cluster's first system sits

/** point along tail k's symmetric arc (t: 0 = core, 1 = tip) */
export function tailPlacement(k: number, t: number, out: THREE.Vector3): THREE.Vector3 {
  const base = (k / TAIL_COUNT) * Math.PI * 2
  const ang = base + t * TAIL_SWEEP
  const r = TAIL_CORE + t * (TAIL_TIP - TAIL_CORE)
  const y = Math.sin(t * Math.PI) * 1.1
  return out.set(Math.cos(ang) * r, y, Math.sin(ang) * r)
}

/** the circle through every cluster's first system — the Council Ring */
export const COUNCIL_RADIUS = TAIL_CORE + COUNCIL_T * (TAIL_TIP - TAIL_CORE)
export const COUNCIL_Y = Math.sin(COUNCIL_T * Math.PI) * 1.1

export type EntityKind = 'sun' | 'planet' | 'moon'

export interface Entity {
  id: string
  name: string
  kind: EntityKind
  url?: string
  description?: string
  sectorId: string
  sectorName: string
  sectorHue: number
  systemId: string
  systemName: string
  color: THREE.Color
  size: number
  /** suns only: rank stars 1–3 shown in the info card */
  importance?: number
  /** shader archetype code (see starStyles.ts) */
  style: number
  /** stable per-link 0..1 random, drives procedural surface variation */
  seed: number
  /** index within all entities, stable, used for shader instance ids */
  index: number
  /** bodies orbit their sun; suns sit still */
  orbit?: { radius: number; phase: number; speed: number }
  center: THREE.Vector3
  /** sector index → system index → body index, for keyboard cycling */
  path: [number, number, number]
}

const entities: Entity[] = []
const entityById = new Map<string, Entity>()

// derived state — rebuilt by buildLayout() below
export const allEntities = entities
export let bodies: Entity[] = []
export let totalBodyCount = 0
export let totalSystemCount = 0
export let cycleOrder: Entity[] = []
export let flatLinks: FlatLink[] = []

/**
 * Rebuilds the whole galaxy layout from `galaxy`. Called once at module init
 * and again by setGalaxyData() when a backend dataset arrives pre-render.
 */
function buildLayout() {
  entities.length = 0
  entityById.clear()
  const rand = mulberry32(20261004)

  galaxy.sectors.forEach((sector, si) => {
    const tail = si % TAIL_COUNT

    sector.systems.forEach((sys, yi) => {
      // mirrored rings: system yi of every cluster shares the same fraction
      const t = Math.min(COUNCIL_T + yi * 0.15, 0.94)
      const center = tailPlacement(tail, t, new THREE.Vector3())
      // systems hold their station — minimal scatter, symmetry first
      center.x += (rand() + rand() - 1) * 0.5
      center.y += (rand() + rand() - 1) * 0.35
      center.z += (rand() + rand() - 1) * 0.5

    const importance = sys.importance ?? 2

    // every sun gets its own shade: cluster hue + seeded/tinted shift
    const hueShift = sys.tint ?? (hash01(`${sys.id}:h`) - 0.5) * 24
    const satJ = (hash01(`${sys.id}:s`) - 0.5) * 0.12
    const lightJ = (hash01(`${sys.id}:l`) - 0.5) * 0.12
    const hue = (((sector.hue + hueShift) % 360) + 360) % 360
    const sunColor = new THREE.Color().setHSL(
      hue / 360,
      THREE.MathUtils.clamp(0.55 + satJ, 0.3, 0.8),
      THREE.MathUtils.clamp(0.72 + lightJ, 0.55, 0.82),
    )
    const { code: sunStyle, seed: sunSeed } = resolveStyle(sys.id, 'sun', importance, sys.style)

    // the sun itself is an entity too — clicking it opens the system card
    const sun: Entity = {
      id: sys.id,
      name: sys.name,
      kind: 'sun',
      url: sys.url,
      description: sys.description,
      sectorId: sector.id,
      sectorName: sector.name,
      sectorHue: sector.hue,
      systemId: sys.id,
      systemName: sys.name,
      color: sunColor,
      size: 1.9 + importance * 0.7,
      importance,
      style: sunStyle,
      seed: sunSeed,
      index: entities.length,
      center,
      path: [si, yi, 0],
    }
    entities.push(sun)
    entityById.set(sun.id, sun)

    sys.bodies.forEach((body, bi) => {
      const isMoon = body.kind === 'moon'
      const orbitRadius = (isMoon ? 1.6 : 2.9) + bi * 1.15 + rand() * 0.4
      const bodyId = `${sys.id}-${body.id}`
      // every body gets its own shade within the cluster family
      const bodyHueShift =
        body.tint ?? (hash01(`${bodyId}:h`) - 0.5) * 24 + (isMoon ? 26 : 0)
      const bodySatJ = (hash01(`${bodyId}:s`) - 0.5) * 0.14
      const bodyLightJ = (hash01(`${bodyId}:l`) - 0.5) * 0.12
      const bodyHue = (((sector.hue + bodyHueShift) % 360) + 360) % 360
      const bodyColor = new THREE.Color().setHSL(
        bodyHue / 360,
        THREE.MathUtils.clamp((isMoon ? 0.38 : 0.6) + bodySatJ, 0.2, 0.75),
        THREE.MathUtils.clamp((isMoon ? 0.66 : 0.74) + bodyLightJ, 0.5, 0.85),
      )
      const { code: bodyStyle, seed: bodySeed } = resolveStyle(
        bodyId,
        isMoon ? 'moon' : 'planet',
        2,
        body.style,
      )
      const e: Entity = {
        id: bodyId,
        name: body.name,
        kind: isMoon ? 'moon' : 'planet',
        url: body.url,
        description: body.description,
        sectorId: sector.id,
        sectorName: sector.name,
        sectorHue: sector.hue,
        systemId: sys.id,
        systemName: sys.name,
        color: bodyColor,
        size: isMoon ? 0.42 + rand() * 0.1 : 0.62 + rand() * 0.26,
        style: bodyStyle,
        seed: bodySeed,
        index: entities.length,
        orbit: {
          radius: orbitRadius,
          phase: rand() * Math.PI * 2,
          speed: (0.16 / Math.sqrt(orbitRadius)) * (rand() > 0.12 ? 1 : -1),
        },
        center,
        path: [si, yi, bi + 1],
      }
      entities.push(e)
      entityById.set(e.id, e)
    })
  })
  })

  bodies = entities.filter((e) => e.kind !== 'sun')
  totalBodyCount = bodies.length
  totalSystemCount = entities.filter((e) => e.kind === 'sun').length
  cycleOrder = [...entities].sort(
    (a, b) => a.path[0] - b.path[0] || a.path[1] - b.path[1] || a.path[2] - b.path[2],
  )
  flatLinks = entities
    .filter((e) => e.url)
    .map((e) => ({
      id: e.id,
      name: e.name,
      url: e.url!,
      sector: e.sectorName,
      sectorId: e.sectorId,
      system: e.systemName,
    }))
}

buildLayout()

/** swap the dataset and rebuild the whole layout (used by the backend boot) */
export function setGalaxyData(data: GalaxyData) {
  galaxy = data
  buildLayout()
}

export function getEntity(id: string | null | undefined): Entity | undefined {
  return id ? entityById.get(id) : undefined
}

const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()

/** world position of an entity at galaxy-time `t` (bodies orbit, suns sit still) */
export function entityWorldPos(entity: Entity, t: number, out: THREE.Vector3): THREE.Vector3 {
  if (!entity.orbit) return out.copy(entity.center)
  const { radius, phase, speed } = entity.orbit
  const a = phase + t * speed
  _e.set(0, a, 0)
  _q.setFromEuler(_e)
  return out.copy(_v.set(0, 0, radius)).applyQuaternion(_q).add(entity.center)
}

export const FOCUS_PARAM = 'focus'

/** easter egg — the rogue comet that occasionally streaks across opens this */
export const secretComet = {
  name: 'Rogue Comet',
  url: 'https://example.com/secret',
  toast: '☄️ You caught the rogue comet — a hidden link, unlocked.',
}

export interface FlatLink {
  name: string
  url: string
  sector: string
  sectorId: string
  system: string
  id: string
}
