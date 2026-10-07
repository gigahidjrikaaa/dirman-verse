/* ============================================================================
   THE NINE CHARACTERS
   ----------------------------------------------------------------------------
   The nine tails of the galaxy each carry one core character value of the
   P3MD / PFLP Sudirman batch — the potentials that shape an excellent SOE
   leader. Each tail has its own shade (hue/saturation/lightness) and its
   own shape DNA (curl, wave, elevation, width, length, density), so the
   nine are visually distinct: gold and straight for Integrity, a rippling
   signal wave for Communication, a high-climbing arc for Vision, and so on.

   ⚠ The names below are placeholders aligned with common SOE leadership
   competencies — if the batch's official nine differ, edit ONLY this file.
============================================================================ */

export interface TailCharacter {
  id: string
  name: string
  /** local-language name */
  alt: string
  desc: string
  /** shade */
  hue: number // 0–360
  sat: number // 0–1
  light: number // 0–1
  /** shape DNA */
  curl: number // spiral twists along the tail (turns, negative = counter)
  waveFreq: number // undulations along its length
  waveAmp: number // angular sway of the wave (radians)
  elevAmp: number // vertical wave amplitude (world units)
  lift: number // overall climb (+) / dive (−) toward the tip
  width: number // lateral spread (world units)
  length: number // 0–1 of the rim distance
  density: number // relative particle share
  sparkle: number // size boost on bright particles
  twin: boolean // two laces braided side by side
}

export const characterValues: TailCharacter[] = [
  {
    id: 'integrity',
    name: 'Integrity',
    alt: 'Integritas',
    desc: 'truth as the compass',
    hue: 46, sat: 0.7, light: 0.72,
    curl: 0.55, waveFreq: 2, waveAmp: 0.1, elevAmp: 1.2,
    lift: 0.8, width: 2.0, length: 1.0, density: 1.4, sparkle: 1.3,
    twin: false,
  },
  {
    id: 'courage',
    name: 'Courage',
    alt: 'Keberanian',
    desc: 'act despite fear',
    hue: 355, sat: 0.62, light: 0.6,
    curl: 0.15, waveFreq: 1, waveAmp: 0.05, elevAmp: 0.4,
    lift: -0.4, width: 3.2, length: 0.62, density: 1.2, sparkle: 1.5,
    twin: false,
  },
  {
    id: 'vision',
    name: 'Strategic Vision',
    alt: 'Visi Strategis',
    desc: 'aim beyond the horizon',
    hue: 285, sat: 0.5, light: 0.66,
    curl: -0.4, waveFreq: 1.5, waveAmp: 0.22, elevAmp: 5.5,
    lift: 3.2, width: 2.6, length: 0.95, density: 0.9, sparkle: 1.2,
    twin: false,
  },
  {
    id: 'communication',
    name: 'Communication',
    alt: 'Komunikasi',
    desc: 'signals that reach every front',
    hue: 187, sat: 0.5, light: 0.64,
    curl: 0.8, waveFreq: 6, waveAmp: 0.3, elevAmp: 2.2,
    lift: 0.2, width: 1.6, length: 0.9, density: 1.0, sparkle: 1.2,
    twin: false,
  },
  {
    id: 'collaboration',
    name: 'Collaboration',
    alt: 'Kolaborasi',
    desc: 'shoulder to shoulder',
    hue: 118, sat: 0.35, light: 0.6,
    curl: 0.35, waveFreq: 3, waveAmp: 0.12, elevAmp: 1.5,
    lift: 0.5, width: 4.2, length: 0.85, density: 1.15, sparkle: 1.0,
    twin: true,
  },
  {
    id: 'resilience',
    name: 'Resilience',
    alt: 'Ketangguhan',
    desc: 'unbroken on the longest march',
    hue: 22, sat: 0.6, light: 0.58,
    curl: 0.7, waveFreq: 2.5, waveAmp: 0.08, elevAmp: 0.5,
    lift: -1.2, width: 2.2, length: 1.0, density: 1.25, sparkle: 1.1,
    twin: false,
  },
  {
    id: 'initiative',
    name: 'Initiative',
    alt: 'Inisiatif',
    desc: 'first to move, without orders',
    hue: 12, sat: 0.6, light: 0.64,
    curl: 0.05, waveFreq: 1, waveAmp: 0.4, elevAmp: 2.8,
    lift: 1.4, width: 1.4, length: 0.7, density: 0.85, sparkle: 1.4,
    twin: false,
  },
  {
    id: 'empathy',
    name: 'Empathy',
    alt: 'Empati',
    desc: 'the strength to care',
    hue: 335, sat: 0.42, light: 0.7,
    curl: -0.25, waveFreq: 2, waveAmp: 0.18, elevAmp: 1.8,
    lift: 1.0, width: 5.0, length: 0.8, density: 1.0, sparkle: 0.9,
    twin: false,
  },
  {
    id: 'accountability',
    name: 'Accountability',
    alt: 'Akuntabilitas',
    desc: 'own every outcome',
    hue: 55, sat: 0.42, light: 0.66,
    curl: 0.3, waveFreq: 1, waveAmp: 0.04, elevAmp: 0.3,
    lift: 0.1, width: 1.1, length: 1.0, density: 1.3, sparkle: 1.0,
    twin: false,
  },
]

/** css hsl() string for legends */
export function characterCssColor(c: TailCharacter): string {
  return `hsl(${c.hue} ${Math.round(c.sat * 100)}% ${Math.round(c.light * 100)}%)`
}
