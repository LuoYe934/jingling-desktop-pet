import { create } from 'zustand'
import type { AppSettings, TtsSettings } from '../types/tauri'

export type PetMotion = 'idle' | 'hover' | 'tap' | 'rightTap' | 'drag' | 'thinking' | 'happy' | 'error'

interface PetStore {
  motion: PetMotion
  settings: AppSettings
  ttsSettings: TtsSettings
  showTokenStats: boolean
  hasApiKey: boolean
  setMotion: (motion: PetMotion) => void
  setSettings: (settings: AppSettings) => void
  setTtsSettings: (settings: TtsSettings) => void
  setShowTokenStats: (showTokenStats: boolean) => void
  setHasApiKey: (hasApiKey: boolean) => void
}

const defaultTtsSettings: TtsSettings = {
  enabled: false,
  engine: 'system',
  rate: 1,
  volume: 0.85,
  voiceURI: '',
}

function loadTtsSettings(): TtsSettings {
  try {
    const raw = window.localStorage.getItem('jingling-tts-settings')
    if (!raw) return defaultTtsSettings
    const parsed = JSON.parse(raw) as Partial<TtsSettings>
    const engine: TtsSettings['engine'] = parsed.engine === 'piper' ? 'piper' : 'system'
    return {
      enabled: Boolean(parsed.enabled),
      engine,
      rate: typeof parsed.rate === 'number' ? Math.min(1.8, Math.max(0.6, parsed.rate)) : defaultTtsSettings.rate,
      volume:
        typeof parsed.volume === 'number'
          ? Math.min(1, Math.max(0, parsed.volume))
          : defaultTtsSettings.volume,
      voiceURI: typeof parsed.voiceURI === 'string' ? parsed.voiceURI : defaultTtsSettings.voiceURI,
    }
  } catch {
    return defaultTtsSettings
  }
}

function saveTtsSettings(settings: TtsSettings) {
  try {
    window.localStorage.setItem('jingling-tts-settings', JSON.stringify(settings))
  } catch {
    // Local storage can be unavailable in locked-down WebViews.
  }
}

function loadShowTokenStats() {
  try {
    const raw = window.localStorage.getItem('jingling-show-token-stats')
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

function saveShowTokenStats(enabled: boolean) {
  try {
    window.localStorage.setItem('jingling-show-token-stats', String(enabled))
  } catch {
    // Local storage can be unavailable in locked-down WebViews.
  }
}

export const usePetStore = create<PetStore>((set) => ({
  motion: 'idle',
  settings: {
    model: 'deepseek-v4-flash',
    scale: 1,
    alwaysOnTop: true,
    replyLimit: 100,
  },
  ttsSettings: loadTtsSettings(),
  showTokenStats: loadShowTokenStats(),
  hasApiKey: false,
  setMotion: (motion) => set({ motion }),
  setSettings: (settings) => set({ settings }),
  setTtsSettings: (ttsSettings) => {
    saveTtsSettings(ttsSettings)
    set({ ttsSettings })
  },
  setShowTokenStats: (showTokenStats) => {
    saveShowTokenStats(showTokenStats)
    set({ showTokenStats })
  },
  setHasApiKey: (hasApiKey) => set({ hasApiKey }),
}))
