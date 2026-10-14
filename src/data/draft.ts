import type { GalaxyData } from './galaxyData'
import { normalizeGalaxy } from './galaxyData'

/**
 * The unsaved working draft — kept in its own localStorage key, separate
 * from the published dataset. Autosaved by the editor; cleared on save.
 */

const DRAFT_KEY = 'dirman-galaxy-draft'

export interface DraftSave {
  savedAt: number
  data: GalaxyData
}

export function loadDraft(): DraftSave | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DraftSave
    if (!parsed || typeof parsed.savedAt !== 'number') return null
    const clean = normalizeGalaxy(parsed.data)
    if (!clean) return null
    return { savedAt: parsed.savedAt, data: clean }
  } catch {
    return null
  }
}

export function saveDraft(data: GalaxyData) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), data }))
}

export function clearDraft() {
  localStorage.removeItem(DRAFT_KEY)
}
