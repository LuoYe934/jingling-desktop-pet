export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  streaming?: boolean
  bookmarked?: boolean
  createdAt?: string
  tokenCount?: number
  tokenSource?: 'api' | 'estimate'
}

export interface LlmMessage {
  role: string
  content: string
}

export interface AppSettings {
  model: string
  scale: number
  alwaysOnTop: boolean
  replyLimit: number
}

export interface TtsSettings {
  enabled: boolean
  engine: 'system' | 'piper'
  rate: number
  volume: number
  voiceURI: string
}

export interface PiperStatus {
  available: boolean
  message: string
  piperPath?: string | null
  modelPath?: string | null
  configPath?: string | null
  modelBytes: number
}

export interface PiperSynthesisResult {
  wavPath: string
}

export interface ChatChunkPayload {
  content: string
}

export interface ChatDonePayload {
  content: string
  chatId: string
  promptTokens?: number | null
  completionTokens?: number | null
  totalTokens?: number | null
}

export interface ChatErrorPayload {
  message: string
}

export interface TavernCharacter {
  id: string
  name: string
  enabled: boolean
  avatar?: string | null
  description: string
  personality: string
  scenario: string
  firstMes: string
  mesExample: string
  tags: string[]
  defaultPresetId?: string | null
  defaultProviderId?: string | null
  createdAt: string
  updatedAt: string
}

export interface Persona {
  id: string
  name: string
  avatar?: string | null
  description: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface TavernChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: string
  bookmarked: boolean
}

export interface TavernChatSession {
  id: string
  title: string
  characterId: string
  personaId?: string | null
  presetId?: string | null
  providerId?: string | null
  summary: string
  tags: string[]
  createdAt: string
  updatedAt: string
  messages: TavernChatMessage[]
}

export interface TavernChatListItem {
  id: string
  title: string
  characterId: string
  updatedAt: string
  messageCount: number
  lastMessage: string
  tags: string[]
}

export interface WorldbookEntry {
  id: string
  title: string
  keys: string[]
  content: string
  enabled: boolean
  priority: number
  position: string
}

export interface Worldbook {
  id: string
  name: string
  enabled: boolean
  entries: WorldbookEntry[]
  createdAt: string
  updatedAt: string
}

export interface PromptPreset {
  id: string
  name: string
  enabled: boolean
  systemPrompt: string
  instructTemplate: string
  authorNote: string
  contextMessages: number
  maxInputChars: number
  maxOutputTokens: number
  temperature: number
  replyLimit: number
  createdAt: string
  updatedAt: string
}

export interface ProviderConfig {
  id: string
  name: string
  providerType: string
  baseUrl: string
  defaultModel: string
  enabled: boolean
  keySaved: boolean
}

export interface WorldbookMatch {
  worldbookId: string
  entryId: string
  title: string
  keys: string[]
  content: string
  priority: number
  position: string
}

export interface PromptBuildResult {
  chatId: string
  characterId: string
  presetId: string
  providerId: string
  model: string
  messages: LlmMessage[]
  matchedWorldbookEntries: WorldbookMatch[]
  estimatedChars: number
  budgetChars: number
  maxOutputTokens: number
  temperature: number
  replyLimit: number
}
