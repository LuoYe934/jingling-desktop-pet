export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  streaming?: boolean
  bookmarked?: boolean
  compacted?: boolean
  compactedAt?: string | null
  summaryBatchId?: string | null
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

export type RelationshipStage = 'guarded' | 'distant' | 'neutral' | 'close' | 'trusted'

export interface RelationshipStagePrompts {
  guarded: string
  distant: string
  neutral: string
  close: string
  trusted: string
}

export const relationshipStageLabels: Record<RelationshipStage, string> = {
  guarded: '戒备',
  distant: '疏离',
  neutral: '普通',
  close: '亲近',
  trusted: '信赖',
}

export const defaultRelationshipStagePrompts: RelationshipStagePrompts = {
  guarded:
    '关系阶段: 戒备。{{char}}对{{user}}保持明显距离，语气谨慎、冷淡，不轻易亲近；如果用户真诚道歉或温和交流，可以出现一点缓和。',
  distant: '关系阶段: 疏离。{{char}}愿意正常回应{{user}}，但仍保留边界，少用亲昵称呼，先观察用户是否可靠。',
  neutral: '关系阶段: 普通。{{char}}自然、礼貌、轻松地陪伴{{user}}，不刻意暧昧，也不过分冷淡。',
  close: '关系阶段: 亲近。{{char}}对{{user}}更放松、更主动，语气可以更柔软亲昵，会记得对方的善意和相处感。',
  trusted:
    '关系阶段: 信赖。{{char}}很信任{{user}}，语气亲近、有安全感，可以出现专属问候、昵称倾向和更坦率的情绪表达。',
}

export interface RelationshipUnlocks {
  specialGreeting: boolean
  nickname: boolean
  idleLines: boolean
  holidayReaction: boolean
}

export interface RelationshipNicknameSettings {
  enabled: boolean
  userNickname: string
  characterNickname: string
  minimumStage: RelationshipStage
}

export interface RelationshipIdleLine {
  id: string
  text: string
  minimumStage: RelationshipStage
  enabled: boolean
  weight: number
  note: string
}

export interface RelationshipKeywordRule {
  id: string
  keyword: string
  weight: number
  enabled: boolean
  note: string
}

export interface RelationshipRulePreferences {
  initialized: boolean
  enabled: boolean
  positiveKeywords: RelationshipKeywordRule[]
  negativeKeywords: RelationshipKeywordRule[]
}

export interface HolidayRule {
  id: string
  name: string
  month: number
  day: number
  enabled: boolean
  scope: string
  minimumStage: RelationshipStage
  prompt: string
  builtIn: boolean
}

export interface RelationshipPreferences {
  characterId: string
  nicknameSettings: RelationshipNicknameSettings
  idleLines: RelationshipIdleLine[]
  rulePreferences: RelationshipRulePreferences
  holidays: HolidayRule[]
}

export interface RelationshipEvent {
  id: string
  createdAt: string
  delta: number
  moodDelta: number
  reason: string
  source: string
  confidence: number
  userExcerpt: string
  assistantExcerpt: string
}

export interface CharacterRelationship {
  characterId: string
  affection: number
  mood: number
  stage: RelationshipStage
  stageLabel: string
  moodLabel: string
  events: RelationshipEvent[]
  unlocks: RelationshipUnlocks
  lastPassiveDecayAt: string
  warmStreak: number
  lastWarmInteractionAt: string
  nicknameSettings: RelationshipNicknameSettings
  idleLines: RelationshipIdleLine[]
  rulePreferences: RelationshipRulePreferences
  updatedAt: string
}

export interface RelationshipChangedPayload {
  relationship: CharacterRelationship
  delta: number
  moodDelta: number
  reason: string
  source: string
}

export type MemoryCardScope = 'global' | 'character' | 'chat'
export type MemoryCardType = 'preference' | 'boundary' | 'profile' | 'promise' | 'note'
export type MemoryCardStatus = 'active' | 'pending' | 'archived'

export interface MemoryCard {
  id: string
  scope: MemoryCardScope
  characterId?: string | null
  chatId?: string | null
  type: MemoryCardType
  content: string
  importance: number
  confidence: number
  status: MemoryCardStatus
  sourceMessageIds: string[]
  createdAt: string
  updatedAt: string
  lastUsedAt: string
}

export interface MemoryChangedPayload {
  cards: MemoryCard[]
  reason: string
  activeCardId?: string | null
}

export interface MemoryExtractionSummary {
  created: MemoryCard[]
  updated: MemoryCard[]
  archived: MemoryCard[]
  conflicts: MemoryCard[]
}

export type BuiltinAssetKind = 'character' | 'worldbook' | 'preset'

export interface BuiltinAssetSummary {
  id: string
  name: string
  kind: BuiltinAssetKind
  tags: string[]
  description: string
  installed: boolean
}

export interface BuiltinInstallResult {
  installedCharacters: number
  installedWorldbooks: number
  installedPresets: number
  skipped: number
  installed: BuiltinAssetSummary[]
  skippedAssets: BuiltinAssetSummary[]
}

export interface ChatChunkPayload {
  content: string
}

export interface ChatDonePayload {
  content: string
  chatId: string
  assistantCreatedAt: string
  cancelled?: boolean
  promptTokens?: number | null
  completionTokens?: number | null
  totalTokens?: number | null
  promptCacheHitTokens?: number | null
  promptCacheMissTokens?: number | null
  promptCacheHitRate?: number | null
}

export interface ChatCompactedPayload {
  chatId: string
  compactedCount: number
  skippedBookmarkedCount: number
  summaryUpdated: boolean
  message: string
  trigger: string
  activeMessageCount: number
  activeTokenEstimate: number
  thresholdTokens: number
}

export interface ChatCompactErrorPayload {
  chatId: string
  message: string
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
  useCustomRelationshipPrompts: boolean
  relationshipStagePrompts: RelationshipStagePrompts
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
  compacted: boolean
  compactedAt?: string | null
  summaryBatchId?: string | null
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

export interface ChatMemoryCompactResult {
  chat: TavernChatSession
  compactedCount: number
  skippedBookmarkedCount: number
  summaryUpdated: boolean
  message: string
  trigger: string
  activeMessageCount: number
  activeTokenEstimate: number
  thresholdTokens: number
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
  authType: 'bearer' | 'api-key' | 'none'
  maxTokensField: 'max_tokens' | 'max_completion_tokens'
  builtIn: boolean
  editable: boolean
  enabled: boolean
  keySaved: boolean
}

export interface ProviderConnectionTestResult {
  ok: boolean
  message: string
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
  memorySummaryUsed: boolean
  recentMessageCount: number
  bookmarkedMessageCount: number
  compactedMessageCount: number
  memoryCardCount: number
  memoryCardsUsed: MemoryCard[]
  stablePrefixTokens: number
  dynamicContextTokens: number
  promptLayoutVersion: string
  promptCacheHitTokens?: number | null
  promptCacheMissTokens?: number | null
  promptCacheHitRate?: number | null
}
