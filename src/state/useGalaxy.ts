import { create } from 'zustand'
import { detectDeviceTier } from '../utils/system'
import { getEntity } from '../data/links'

export type CameraMode = 'explore' | 'warp' | 'focus' | 'fly'
export type QualityTier = 'high' | 'medium' | 'low'

interface Settings {
  audio: boolean
  reducedMotion: boolean
}

interface GalaxyState {
  /** scene has rendered its first frames — preloader may release */
  ready: boolean
  preloaderDone: boolean
  /** the preloader fade began — camera starts its arrival glide */
  introStarted: boolean
  mode: CameraMode
  hoveredId: string | null
  selectedId: string | null
  paletteOpen: boolean
  settingsOpen: boolean
  settings: Settings
  quality: QualityTier
  /** post-processing bloom toggle — the governor disables it when needed */
  bloomOn: boolean
  /** multiplier on the tier's DPR — lowered by the governor on weak devices */
  dprScale: number
  /** 0→1 warp energy, drives FOV punch + chromatic aberration + bloom */
  warpEnergy: number
  charted: string[]
  toast: string | null

  setReady: (v: boolean) => void
  setPreloaderDone: (v: boolean) => void
  beginIntro: () => void
  setMode: (m: CameraMode) => void
  setHovered: (id: string | null) => void
  select: (id: string | null) => void
  setPaletteOpen: (v: boolean) => void
  setSettingsOpen: (v: boolean) => void
  toggleAudio: () => void
  toggleReducedMotion: () => void
  setQuality: (q: QualityTier) => void
  setBloomOn: (v: boolean) => void
  setDprScale: (v: number) => void
  setWarpEnergy: (v: number) => void
  markCharted: (id: string) => void
  setToast: (msg: string | null) => void
}

const REDUCED_KEY = 'dirman-galaxy-settings'
const CHARTED_KEY = 'dirman-galaxy-charted'

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

function loadCharted(): string[] {
  try {
    const raw = localStorage.getItem(CHARTED_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const prefersReduced =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const INITIAL_TIER = detectDeviceTier()

export const useGalaxy = create<GalaxyState>((set, get) => ({
  ready: false,
  preloaderDone: false,
  introStarted: false,
  mode: 'explore',
  hoveredId: null,
  selectedId: null,
  paletteOpen: false,
  settingsOpen: false,
  settings: loadJSON(REDUCED_KEY, { audio: false, reducedMotion: prefersReduced }),
  /** starting tier comes from the device; the governor only steps down */
  quality: INITIAL_TIER,
  /** post-processing bloom — off on weak devices, governor may disable it */
  bloomOn: INITIAL_TIER !== 'low',
  /** multiplier on the tier's DPR — the governor lowers it in weak moments */
  dprScale: 1,
  warpEnergy: 0,
  charted: loadCharted(),
  toast: null,

  setReady: (v) => set({ ready: v }),
  setPreloaderDone: (v) => set({ preloaderDone: v }),
  beginIntro: () => set((s) => (s.introStarted ? s : { introStarted: true })),
  setMode: (mode) => set({ mode }),
  setHovered: (hoveredId) => set({ hoveredId }),
  select: (id) => {
    // ignore unknown ids (bad deep links) instead of polluting state
    if (id && !getEntity(id)) return
    if (id) get().markCharted(id)
    set({ selectedId: id })
  },
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  toggleAudio: () =>
    set((s) => {
      const settings = { ...s.settings, audio: !s.settings.audio }
      localStorage.setItem(REDUCED_KEY, JSON.stringify(settings))
      return { settings }
    }),
  toggleReducedMotion: () =>
    set((s) => {
      const settings = { ...s.settings, reducedMotion: !s.settings.reducedMotion }
      localStorage.setItem(REDUCED_KEY, JSON.stringify(settings))
      return { settings }
    }),
  setQuality: (quality) => set({ quality }),
  setBloomOn: (bloomOn) => set({ bloomOn }),
  setDprScale: (dprScale) => set({ dprScale }),
  setWarpEnergy: (warpEnergy) => set({ warpEnergy }),
  markCharted: (id) =>
    set((s) => {
      if (s.charted.includes(id)) return s
      const charted = [...s.charted, id]
      localStorage.setItem(CHARTED_KEY, JSON.stringify(charted))
      return { charted }
    }),
  setToast: (toast) => set({ toast }),
}))
