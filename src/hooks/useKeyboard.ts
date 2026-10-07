import { useEffect, useRef } from 'react'
import { useGalaxy } from '../state/useGalaxy'
import { cycleOrder, getEntity, FOCUS_PARAM } from '../data/links'
import { audio } from '../audio/audio'

/**
 * Global keyboard controls:
 *   Ctrl/⌘+K or /  — command palette
 *   ← / →          — cycle bodies
 *   Enter          — open the selected body's link
 *   Esc            — close overlays, then deselect
 *   M              — mute/unmute
 */
export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inField =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      const st = useGalaxy.getState()

      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        st.setPaletteOpen(!st.paletteOpen)
        return
      }
      if (e.key === 'Escape') {
        if (st.paletteOpen) st.setPaletteOpen(false)
        else if (st.settingsOpen) st.setSettingsOpen(false)
        else if (st.selectedId) st.select(null)
        return
      }
      if (inField) return

      if (e.key === '/') {
        e.preventDefault()
        st.setPaletteOpen(true)
        return
      }
      if (e.key === 'm' || e.key === 'M') {
        st.toggleAudio()
        audio.setEnabled(!st.settings.audio)
        return
      }
      if (st.paletteOpen || st.settingsOpen) return

      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        const dir = e.key === 'ArrowRight' ? 1 : -1
        const current = st.selectedId ? cycleOrder.findIndex((x) => x.id === st.selectedId) : -1
        const next = cycleOrder[(current + dir + cycleOrder.length) % cycleOrder.length]
        st.select(next.id)
        audio.blip()
      }
      if (e.key === 'Enter' && st.selectedId) {
        const entity = getEntity(st.selectedId)
        if (entity?.url) window.open(entity.url, '_blank', 'noopener,noreferrer')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** keeps ?focus=<id> in the URL so any star can be shared or bookmarked */
export function useDeepLink() {
  const ready = useGalaxy((s) => s.ready)
  const selectedId = useGalaxy((s) => s.selectedId)
  // capture at first render — the URL-sync effect below would otherwise
  // strip the param before the scene is ready to fly
  const initialFocus = useRef(new URLSearchParams(window.location.search).get(FOCUS_PARAM))

  // fly to the shared star once the scene can actually do it
  useEffect(() => {
    if (!ready || !initialFocus.current) return
    const entity = getEntity(initialFocus.current)
    initialFocus.current = null
    if (entity) useGalaxy.getState().select(entity.id)
  }, [ready])

  // reflect the current selection in the URL without adding history entries
  useEffect(() => {
    if (!ready) return
    const url = new URL(window.location.href)
    if (selectedId) url.searchParams.set(FOCUS_PARAM, selectedId)
    else url.searchParams.delete(FOCUS_PARAM)
    window.history.replaceState(null, '', url)
  }, [ready, selectedId])
}
