import { create } from 'zustand'
import type {
  AppSettings,
  CharacterRelationship,
  FreeModeEnhancementSettings,
  FreeModeMcpReservedSettings,
  FreeModeScreenEnhancementSettings,
  FreeModeVisionConfig,
  FreeModeVisionProvider,
  FreeModeWatcherSettings,
  GenieConfig,
  TtsSettings,
} from '../types/tauri'

export type PetMotion = 'idle' | 'hover' | 'tap' | 'rightTap' | 'drag' | 'thinking' | 'happy' | 'error'

interface PetStore {
  motion: PetMotion
  settings: AppSettings
  ttsSettings: TtsSettings
  activeRelationship: CharacterRelationship | null
  relationshipNotice: string
  showMessageTimes: boolean
  showTokenStats: boolean
  hasApiKey: boolean
  setMotion: (motion: PetMotion) => void
  setSettings: (settings: AppSettings) => void
  setTtsSettings: (settings: TtsSettings) => void
  setActiveRelationship: (relationship: CharacterRelationship | null) => void
  setRelationshipNotice: (notice: string) => void
  setShowMessageTimes: (showMessageTimes: boolean) => void
  setShowTokenStats: (showTokenStats: boolean) => void
  setHasApiKey: (hasApiKey: boolean) => void
}

const defaultGenieConfig: GenieConfig = {
  serverUrl: 'http://127.0.0.1:9880/',
  workPath:
    'C:\\Game\\Shinsekai\\Shinsekai 1.6.4-dev\\Shinsekai\\data\\tts_bundles\\installed\\genie_tts_server\\Genie-TTS Server',
  characterName: '',
  onnxModelDir: '',
  gptModelPath: '',
  sovitsModelPath: '',
  referenceAudioPath: '',
  referenceText: '',
  language: 'ja',
  referenceLanguage: 'ja',
}

const defaultTtsSettings: TtsSettings = {
  enabled: false,
  engine: 'system',
  rate: 1,
  volume: 0.85,
  voiceURI: '',
  genie: defaultGenieConfig,
}

export const defaultFreeModeEnhancementSettings: FreeModeEnhancementSettings = {
  screen: {
    ocrEnabled: true,
    uiReadEnabled: true,
    defaultRegion: 'full',
    timeoutMs: 4500,
  },
  vision: {
    enabled: false,
    provider: 'lm-studio',
    serviceUrl: 'http://127.0.0.1:8765/vision',
    stationUrl: 'http://127.0.0.1:2020/v1',
    qwenUrl: 'http://127.0.0.1:1234/v1/chat/completions',
    model: 'qwen2.5-vl-3b-instruct',
    timeoutMs: 30000,
    sendImageBase64: true,
  },
  watcher: {
    enabled: false,
    intervalMs: 5000,
    cooldownMs: 45000,
    region: 'active-window',
    mode: 'gentle',
    hiddenObservation: true,
    maxVisionCallsPerHour: 60,
  },
  httpTools: [],
  mcp: {
    enabled: false,
    defaultTimeoutMs: 30000,
    servers: [],
  },
}

function normalizeFreeModeEnhancementSettings(settings: unknown): FreeModeEnhancementSettings {
  const parsed = typeof settings === 'object' && settings !== null ? (settings as Partial<FreeModeEnhancementSettings>) : {}
  const screen: Partial<FreeModeScreenEnhancementSettings> =
    typeof parsed.screen === 'object' && parsed.screen !== null ? parsed.screen : {}
  const vision: Partial<FreeModeVisionConfig> =
    typeof parsed.vision === 'object' && parsed.vision !== null ? parsed.vision : {}
  const watcher: Partial<FreeModeWatcherSettings> =
    typeof parsed.watcher === 'object' && parsed.watcher !== null ? parsed.watcher : {}
  const mcp: Partial<FreeModeMcpReservedSettings> =
    typeof parsed.mcp === 'object' && parsed.mcp !== null ? parsed.mcp : {}
  const httpTools = Array.isArray(parsed.httpTools) ? parsed.httpTools : []
  return {
    screen: {
      ocrEnabled: typeof screen.ocrEnabled === 'boolean' ? screen.ocrEnabled : defaultFreeModeEnhancementSettings.screen.ocrEnabled,
      uiReadEnabled: typeof screen.uiReadEnabled === 'boolean' ? screen.uiReadEnabled : defaultFreeModeEnhancementSettings.screen.uiReadEnabled,
      defaultRegion: typeof screen.defaultRegion === 'string' ? screen.defaultRegion : defaultFreeModeEnhancementSettings.screen.defaultRegion,
      timeoutMs: clampNumber(screen.timeoutMs, defaultFreeModeEnhancementSettings.screen.timeoutMs, 1000, 60000),
    },
    vision: {
      enabled: typeof vision.enabled === 'boolean' ? vision.enabled : defaultFreeModeEnhancementSettings.vision.enabled,
      provider: normalizeVisionProvider(vision.provider),
      serviceUrl: typeof vision.serviceUrl === 'string' ? vision.serviceUrl : defaultFreeModeEnhancementSettings.vision.serviceUrl,
      stationUrl: typeof vision.stationUrl === 'string' ? vision.stationUrl : defaultFreeModeEnhancementSettings.vision.stationUrl,
      qwenUrl: typeof vision.qwenUrl === 'string' ? vision.qwenUrl : defaultFreeModeEnhancementSettings.vision.qwenUrl,
      model: typeof vision.model === 'string' ? vision.model : defaultFreeModeEnhancementSettings.vision.model,
      timeoutMs: clampNumber(vision.timeoutMs, defaultFreeModeEnhancementSettings.vision.timeoutMs, 1000, 60000),
      sendImageBase64:
        typeof vision.sendImageBase64 === 'boolean' ? vision.sendImageBase64 : defaultFreeModeEnhancementSettings.vision.sendImageBase64,
    },
    watcher: {
      enabled: typeof watcher.enabled === 'boolean' ? watcher.enabled : defaultFreeModeEnhancementSettings.watcher.enabled,
      intervalMs: clampNumber(watcher.intervalMs, defaultFreeModeEnhancementSettings.watcher.intervalMs, 3000, 8000),
      cooldownMs: clampNumber(watcher.cooldownMs, defaultFreeModeEnhancementSettings.watcher.cooldownMs, 25000, 60000),
      region: typeof watcher.region === 'string' ? watcher.region : defaultFreeModeEnhancementSettings.watcher.region,
      mode: 'gentle',
      hiddenObservation: true,
      maxVisionCallsPerHour: clampNumber(
        watcher.maxVisionCallsPerHour,
        defaultFreeModeEnhancementSettings.watcher.maxVisionCallsPerHour,
        1,
        120,
      ),
    },
    httpTools: httpTools.map((tool, index) => ({
      id: typeof tool.id === 'string' && tool.id ? tool.id : `tool-${index + 1}`,
      name: typeof tool.name === 'string' ? tool.name : `工具 ${index + 1}`,
      enabled: typeof tool.enabled === 'boolean' ? tool.enabled : false,
      url: typeof tool.url === 'string' ? tool.url : '',
      timeoutMs: clampNumber(tool.timeoutMs, 8000, 1000, 60000),
      includeScreenContext: typeof tool.includeScreenContext === 'boolean' ? tool.includeScreenContext : true,
    })),
    mcp: {
      enabled: typeof mcp.enabled === 'boolean' ? mcp.enabled : defaultFreeModeEnhancementSettings.mcp.enabled,
      defaultTimeoutMs: clampNumber(mcp.defaultTimeoutMs, defaultFreeModeEnhancementSettings.mcp.defaultTimeoutMs, 1000, 120000),
      servers: Array.isArray(mcp.servers) ? mcp.servers.filter((item): item is string => typeof item === 'string') : [],
    },
  }
}

function normalizeVisionProvider(value: unknown): FreeModeVisionProvider {
  return value === 'lm-studio' || value === 'qwen3-vl' || value === 'custom-http' || value === 'moondream-station'
    ? value
    : defaultFreeModeEnhancementSettings.vision.provider
}

export function normalizeAppSettings(settings: unknown): AppSettings {
  const parsed = typeof settings === 'object' && settings !== null ? (settings as Partial<AppSettings>) : {}
  return {
    model: typeof parsed.model === 'string' ? parsed.model : 'deepseek-v4-flash',
    scale: clampNumber(parsed.scale, 1, 0.35, 3.2),
    alwaysOnTop: typeof parsed.alwaysOnTop === 'boolean' ? parsed.alwaysOnTop : true,
    replyLimit: clampNumber(parsed.replyLimit, 100, 20, 2000),
    freeModeEnhancement: normalizeFreeModeEnhancementSettings(parsed.freeModeEnhancement),
  }
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function mergeGenieConfig(config: unknown): GenieConfig {
  const parsed = typeof config === 'object' && config !== null ? (config as Partial<GenieConfig>) : {}
  return {
    serverUrl: typeof parsed.serverUrl === 'string' ? parsed.serverUrl : defaultGenieConfig.serverUrl,
    workPath: typeof parsed.workPath === 'string' ? parsed.workPath : defaultGenieConfig.workPath,
    characterName: typeof parsed.characterName === 'string' ? parsed.characterName : defaultGenieConfig.characterName,
    onnxModelDir: typeof parsed.onnxModelDir === 'string' ? parsed.onnxModelDir : defaultGenieConfig.onnxModelDir,
    gptModelPath: typeof parsed.gptModelPath === 'string' ? parsed.gptModelPath : defaultGenieConfig.gptModelPath,
    sovitsModelPath: typeof parsed.sovitsModelPath === 'string' ? parsed.sovitsModelPath : defaultGenieConfig.sovitsModelPath,
    referenceAudioPath:
      typeof parsed.referenceAudioPath === 'string' ? parsed.referenceAudioPath : defaultGenieConfig.referenceAudioPath,
    referenceText: typeof parsed.referenceText === 'string' ? parsed.referenceText : defaultGenieConfig.referenceText,
    language: typeof parsed.language === 'string' ? parsed.language : defaultGenieConfig.language,
    referenceLanguage:
      typeof parsed.referenceLanguage === 'string' ? parsed.referenceLanguage : defaultGenieConfig.referenceLanguage,
  }
}

function normalizeTtsSettings(settings: unknown): TtsSettings {
  const parsed = typeof settings === 'object' && settings !== null ? (settings as Partial<TtsSettings>) : {}
  const engine: TtsSettings['engine'] = parsed.engine === 'piper' || parsed.engine === 'genie' ? parsed.engine : 'system'
  return {
    enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : defaultTtsSettings.enabled,
    engine,
    rate: clampNumber(parsed.rate, defaultTtsSettings.rate, 0.6, 1.8),
    volume: clampNumber(parsed.volume, defaultTtsSettings.volume, 0, 1),
    voiceURI: typeof parsed.voiceURI === 'string' ? parsed.voiceURI : defaultTtsSettings.voiceURI,
    genie: mergeGenieConfig(parsed.genie),
  }
}

function loadTtsSettings(): TtsSettings {
  try {
    const raw = window.localStorage.getItem('jingling-tts-settings')
    if (!raw) return defaultTtsSettings
    const migrated = normalizeTtsSettings(JSON.parse(raw))
    saveTtsSettings(migrated)
    return migrated
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

function loadShowMessageTimes() {
  try {
    const raw = window.localStorage.getItem('jingling-show-message-times')
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

function saveShowMessageTimes(enabled: boolean) {
  try {
    window.localStorage.setItem('jingling-show-message-times', String(enabled))
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
    freeModeEnhancement: defaultFreeModeEnhancementSettings,
  },
  ttsSettings: loadTtsSettings(),
  activeRelationship: null,
  relationshipNotice: '',
  showMessageTimes: loadShowMessageTimes(),
  showTokenStats: loadShowTokenStats(),
  hasApiKey: false,
  setMotion: (motion) => set({ motion }),
  setSettings: (settings) => set({ settings: normalizeAppSettings(settings) }),
  setTtsSettings: (ttsSettings) => {
    saveTtsSettings(ttsSettings)
    set({ ttsSettings })
  },
  setActiveRelationship: (activeRelationship) => set({ activeRelationship }),
  setRelationshipNotice: (relationshipNotice) => set({ relationshipNotice }),
  setShowMessageTimes: (showMessageTimes) => {
    saveShowMessageTimes(showMessageTimes)
    set({ showMessageTimes })
  },
  setShowTokenStats: (showTokenStats) => {
    saveShowTokenStats(showTokenStats)
    set({ showTokenStats })
  },
  setHasApiKey: (hasApiKey) => set({ hasApiKey }),
}))
