/* ============================================================================
   STAR STYLES — the celestial archetypes that make every link unique.
   ----------------------------------------------------------------------------
   Each link's id is hashed into a stable archetype + seed, so every star has
   its own look that survives reloads and edits to other entries. A link can
   also pin its look explicitly:  style: 'ringed'  /  tint: -20  in links.ts.
============================================================================ */

const PLANET_STYLES = ['terran', 'gas', 'ice', 'lava', 'ringed', 'rock'] as const
const MOON_STYLES = ['rock', 'ice', 'terran'] as const

/** shader float codes (sun codes < 10, planet/moon codes >= 10) */
export const STYLE_CODES: Record<string, number> = {
  classic: 1,
  giant: 2,
  flame: 3,
  pulse: 4,
  binary: 5,
  terran: 10,
  gas: 11,
  ice: 12,
  lava: 13,
  ringed: 14,
  rock: 15,
}

/** FNV-1a → deterministic 0..1 per id string */
export function hash01(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 4294967296
}

const pick = <T,>(pool: readonly T[], h: number): T =>
  pool[Math.floor(h * pool.length) % pool.length]

/**
 * Stable archetype for a link. Suns of importance 3 bias toward the grander
 * types (giants, pulsars, binaries); moons get the small-body pool.
 */
export function assignStyle(
  id: string,
  kind: 'sun' | 'planet' | 'moon',
  importance = 2,
): string {
  const h = hash01(id)
  if (kind === 'sun') {
    const pool =
      importance === 3
        ? (['giant', 'pulse', 'binary', 'flame', 'giant', 'classic'] as const)
        : importance === 2
          ? (['classic', 'flame', 'giant', 'pulse'] as const)
          : (['classic', 'flame'] as const)
    return pick(pool, h)
  }
  if (kind === 'moon') return pick(MOON_STYLES, h)
  return pick(PLANET_STYLES, h)
}

/**
 * Resolve the final archetype for a link: the data override wins when it is
 * a valid name for that kind, otherwise the stable hash assignment applies.
 */
export function resolveStyle(
  id: string,
  kind: 'sun' | 'planet' | 'moon',
  importance: number,
  override?: string,
): { code: number; seed: number } {
  let name: string | undefined
  if (override && STYLE_CODES[override] !== undefined) {
    const isSunStyle = STYLE_CODES[override] < 10
    if ((kind === 'sun') === isSunStyle) name = override
  }
  const final = name ?? assignStyle(id, kind, importance)
  return { code: STYLE_CODES[final], seed: hash01(id + ':seed') }
}
