import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow, Window } from '@tauri-apps/api/window'
import { defaultRelationshipStagePrompts } from '../types/tauri'
import type {
  AppSettings,
  CharacterRelationship,
  ChatMemoryCompactResult,
  ChatChunkPayload,
  ChatDonePayload,
  ChatErrorPayload,
  HolidayRule,
  Persona,
  PiperStatus,
  PiperSynthesisResult,
  PromptBuildResult,
  PromptPreset,
  ProviderConfig,
  RelationshipChangedPayload,
  RelationshipPreferences,
  TavernCharacter,
  TavernChatListItem,
  TavernChatSession,
  Worldbook,
  WorldbookMatch,
} from '../types/tauri'

export const runningInTauri = () => isTauri()

function setPreviewView(view: 'pet' | 'chat' | 'tavern') {
  const params = new URLSearchParams(window.location.search)
  params.set('view', view)
  window.history.pushState(null, '', `?${params.toString()}`)
  window.dispatchEvent(new CustomEvent('preview:view-changed', { detail: view }))
}

export async function getWindowLabel() {
  if (!runningInTauri()) {
    return new URLSearchParams(window.location.search).get('view') ?? 'chat'
  }
  return getCurrentWindow().label
}

export async function startWindowDrag() {
  if (!runningInTauri()) return
  await getCurrentWindow().startDragging()
}

export async function hideCurrentWindow() {
  if (!runningInTauri()) {
    setPreviewView('pet')
    return
  }
  await getCurrentWindow().hide()
}

export async function toggleChatWindow() {
  if (!runningInTauri()) {
    const current = new URLSearchParams(window.location.search).get('view') ?? 'chat'
    setPreviewView(current === 'chat' ? 'pet' : 'chat')
    return
  }
  await invoke('toggle_chat_window')
}

export async function showChatWindow() {
  if (!runningInTauri()) {
    setPreviewView('chat')
    return
  }
  await invoke('show_chat_window')
}

export async function showTavernWindow() {
  if (!runningInTauri()) {
    setPreviewView('tavern')
    return
  }
  await invoke('show_tavern_window')
}

export async function hideTavernWindow() {
  if (!runningInTauri()) {
    setPreviewView('pet')
    return
  }
  await invoke('hide_tavern_window')
}

export async function toggleTavernWindow() {
  if (!runningInTauri()) {
    const current = new URLSearchParams(window.location.search).get('view') ?? 'chat'
    setPreviewView(current === 'tavern' ? 'pet' : 'tavern')
    return
  }
  await invoke('toggle_tavern_window')
}

export async function focusPetWindow() {
  if (!runningInTauri()) {
    setPreviewView('pet')
    return
  }
  const pet = await Window.getByLabel('pet')
  await pet?.show()
  await pet?.setFocus()
}

export interface SendMessageOptions {
  model?: string
  chatId?: string
  characterId?: string
  presetId?: string
  providerId?: string
  clientNow?: string
  userCreatedAt?: string
}

export async function sendMessage(message: string, options: SendMessageOptions = {}) {
  if (!runningInTauri()) {
    return mockStream()
  }
  await invoke('send_message', {
    message,
    model: options.model,
    chatId: options.chatId,
    characterId: options.characterId,
    presetId: options.presetId,
    providerId: options.providerId,
    clientNow: options.clientNow,
    userCreatedAt: options.userCreatedAt,
  })
}

export async function cancelMessage() {
  if (!runningInTauri()) return
  await invoke('cancel_message')
}

export async function saveApiKey(apiKey: string) {
  if (!runningInTauri()) return
  await invoke('save_api_key', { apiKey })
}

export async function hasApiKey() {
  if (!runningInTauri()) return false
  return invoke<boolean>('has_api_key')
}

export async function getSettings() {
  if (!runningInTauri()) {
    return {
      model: 'deepseek-v4-flash',
      scale: 1,
      alwaysOnTop: true,
      replyLimit: 100,
    } satisfies AppSettings
  }
  return invoke<AppSettings>('get_settings')
}

export async function updateSettings(settings: AppSettings) {
  if (!runningInTauri()) {
    emitMockSettingsChanged(settings)
    return settings
  }
  return invoke<AppSettings>('update_settings', { settings })
}

export async function setPetScale(scale: number) {
  if (!runningInTauri()) {
    const settings = {
      model: 'deepseek-v4-flash',
      scale,
      alwaysOnTop: true,
      replyLimit: 100,
    } satisfies AppSettings
    emitMockSettingsChanged(settings)
    return scale
  }
  return invoke<number>('set_pet_scale', { scale })
}

export async function listenToSettingsChanges(handler: (settings: AppSettings) => void) {
  if (!runningInTauri()) {
    const listener = (event: Event) => handler((event as CustomEvent<AppSettings>).detail)
    window.addEventListener('settings:changed', listener)
    return () => window.removeEventListener('settings:changed', listener)
  }

  const unlisten = await listen<AppSettings>('settings:changed', (event) => handler(event.payload))
  return () => unlisten()
}

function emitMockSettingsChanged(settings: AppSettings) {
  if (runningInTauri()) return
  window.dispatchEvent(
    new CustomEvent<AppSettings>('settings:changed', {
      detail: settings,
    }),
  )
}

function pickBrowserImageFile() {
  return new Promise<string | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp,image/gif'
    input.onchange = () => {
      const file = input.files?.[0]
      resolve(file ? URL.createObjectURL(file) : null)
    }
    input.click()
  })
}

export async function pickAvatarFile() {
  if (!runningInTauri()) return pickBrowserImageFile()
  const selected = await open({
    multiple: false,
    filters: [
      {
        name: 'Image',
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
      },
    ],
  })
  if (typeof selected !== 'string') return null
  return invoke<string>('import_avatar_image', { path: selected })
}

export async function setAlwaysOnTop(enabled: boolean) {
  if (!runningInTauri()) return enabled
  return invoke<boolean>('set_always_on_top', { enabled })
}

export async function toggleAutostart(enabled: boolean) {
  if (!runningInTauri()) return false
  return invoke<boolean>('toggle_autostart', { enabled })
}

export async function speakText(
  text: string,
  options: {
    voiceName?: string
    lang?: string
    rate: number
    volume: number
  },
) {
  if (!runningInTauri()) return false
  await invoke('speak_text_command', {
    text,
    voiceName: options.voiceName,
    lang: options.lang,
    rate: options.rate,
    volume: options.volume,
  })
  return true
}

export async function getPiperStatus() {
  if (!runningInTauri()) {
    return {
      available: false,
      message: '浏览器预览不启动本地 Piper。',
      piperPath: null,
      modelPath: null,
      configPath: null,
      modelBytes: 0,
    } satisfies PiperStatus
  }
  return invoke<PiperStatus>('piper_status')
}

export async function synthesizePiper(text: string, rate: number) {
  if (!runningInTauri()) return null
  const result = await invoke<PiperSynthesisResult>('synthesize_piper_command', { text, rate })
  return convertFileSrc(result.wavPath)
}

export async function clearMemory() {
  if (!runningInTauri()) return
  await invoke('clear_memory_command')
}

export async function listenToChatEvents(handlers: {
  onChunk: (payload: ChatChunkPayload) => void
  onDone: (payload: ChatDonePayload) => void
  onError: (payload: ChatErrorPayload) => void
}) {
  if (!runningInTauri()) {
    return () => {}
  }

  const unlisteners: UnlistenFn[] = []
  unlisteners.push(await listen<ChatChunkPayload>('chat:chunk', (event) => handlers.onChunk(event.payload)))
  unlisteners.push(await listen<ChatDonePayload>('chat:done', (event) => handlers.onDone(event.payload)))
  unlisteners.push(await listen<ChatErrorPayload>('chat:error', (event) => handlers.onError(event.payload)))

  return () => unlisteners.forEach((unlisten) => unlisten())
}

export interface ChatListChangedPayload {
  chats: TavernChatListItem[]
  activeChatId?: string | null
  deletedChatId?: string | null
  reason: string
}

export async function listenToChatListChanges(handler: (payload: ChatListChangedPayload) => void) {
  if (!runningInTauri()) {
    const listener = (event: Event) => handler((event as CustomEvent<ChatListChangedPayload>).detail)
    window.addEventListener('tavern:chats-changed', listener)
    return () => window.removeEventListener('tavern:chats-changed', listener)
  }

  const unlisten = await listen<ChatListChangedPayload>('tavern:chats-changed', (event) => handler(event.payload))
  return () => unlisten()
}

export interface PresetsChangedPayload {
  presets: PromptPreset[]
  activePresetId?: string | null
  reason: string
}

export interface CharactersChangedPayload {
  characters: TavernCharacter[]
  activeCharacterId?: string | null
  reason: string
}

export interface PersonasChangedPayload {
  personas: Persona[]
  activePersonaId?: string | null
  reason: string
}

export async function listenToPresetChanges(handler: (payload: PresetsChangedPayload) => void) {
  if (!runningInTauri()) {
    const listener = (event: Event) => handler((event as CustomEvent<PresetsChangedPayload>).detail)
    window.addEventListener('tavern:presets-changed', listener)
    return () => window.removeEventListener('tavern:presets-changed', listener)
  }

  const unlisten = await listen<PresetsChangedPayload>('tavern:presets-changed', (event) => handler(event.payload))
  return () => unlisten()
}

export async function listenToCharacterChanges(handler: (payload: CharactersChangedPayload) => void) {
  if (!runningInTauri()) {
    const listener = (event: Event) => handler((event as CustomEvent<CharactersChangedPayload>).detail)
    window.addEventListener('tavern:characters-changed', listener)
    return () => window.removeEventListener('tavern:characters-changed', listener)
  }

  const unlisten = await listen<CharactersChangedPayload>('tavern:characters-changed', (event) => handler(event.payload))
  return () => unlisten()
}

export async function listenToPersonaChanges(handler: (payload: PersonasChangedPayload) => void) {
  if (!runningInTauri()) {
    const listener = (event: Event) => handler((event as CustomEvent<PersonasChangedPayload>).detail)
    window.addEventListener('tavern:personas-changed', listener)
    return () => window.removeEventListener('tavern:personas-changed', listener)
  }

  const unlisten = await listen<PersonasChangedPayload>('tavern:personas-changed', (event) => handler(event.payload))
  return () => unlisten()
}

export async function listenToRelationshipChanges(handler: (payload: RelationshipChangedPayload) => void) {
  if (!runningInTauri()) {
    const listener = (event: Event) => handler((event as CustomEvent<RelationshipChangedPayload>).detail)
    window.addEventListener('relationship:changed', listener)
    return () => window.removeEventListener('relationship:changed', listener)
  }

  const unlisten = await listen<RelationshipChangedPayload>('relationship:changed', (event) => handler(event.payload))
  return () => unlisten()
}

function emitMockChatListChanged(payload: Omit<ChatListChangedPayload, 'chats'>) {
  if (runningInTauri()) return
  window.dispatchEvent(
    new CustomEvent<ChatListChangedPayload>('tavern:chats-changed', {
      detail: {
        chats: mockChats,
        ...payload,
      },
    }),
  )
}

function emitMockPresetsChanged(payload: Omit<PresetsChangedPayload, 'presets'>) {
  if (runningInTauri()) return
  window.dispatchEvent(
    new CustomEvent<PresetsChangedPayload>('tavern:presets-changed', {
      detail: {
        presets: mockPresets,
        ...payload,
      },
    }),
  )
}

function emitMockCharactersChanged(payload: Omit<CharactersChangedPayload, 'characters'>) {
  if (runningInTauri()) return
  window.dispatchEvent(
    new CustomEvent<CharactersChangedPayload>('tavern:characters-changed', {
      detail: {
        characters: mockCharacters,
        ...payload,
      },
    }),
  )
}

function emitMockPersonasChanged(payload: Omit<PersonasChangedPayload, 'personas'>) {
  if (runningInTauri()) return
  window.dispatchEvent(
    new CustomEvent<PersonasChangedPayload>('tavern:personas-changed', {
      detail: {
        personas: mockPersonas,
        ...payload,
      },
    }),
  )
}

function emitMockRelationshipChanged(payload: RelationshipChangedPayload) {
  if (runningInTauri()) return
  window.dispatchEvent(new CustomEvent<RelationshipChangedPayload>('relationship:changed', { detail: payload }))
}

export async function listCharacters() {
  if (!runningInTauri()) return mockCharacters
  return invoke<TavernCharacter[]>('list_characters')
}

export async function saveCharacter(character: TavernCharacter) {
  if (!runningInTauri()) return mockSaveCharacter(character)
  return invoke<TavernCharacter>('save_character', { character })
}

export async function getRelationship(characterId: string) {
  if (!runningInTauri()) return mockGetRelationship(characterId)
  return invoke<CharacterRelationship>('get_relationship', { characterId })
}

export async function listRelationships() {
  if (!runningInTauri()) return mockCharacters.map((character) => mockGetRelationship(character.id))
  return invoke<CharacterRelationship[]>('list_relationships')
}

export async function resetRelationship(characterId: string) {
  if (!runningInTauri()) return mockResetRelationship(characterId)
  return invoke<CharacterRelationship>('reset_relationship', { characterId })
}

export async function getRelationshipPreferences(characterId: string) {
  if (!runningInTauri()) return mockGetRelationshipPreferences(characterId)
  return invoke<RelationshipPreferences>('get_relationship_preferences', { characterId })
}

export async function saveRelationshipPreferences(characterId: string, preferences: RelationshipPreferences) {
  if (!runningInTauri()) return mockSaveRelationshipPreferences(characterId, preferences)
  return invoke<RelationshipPreferences>('save_relationship_preferences', { characterId, preferences })
}

export async function importCharacterCard(path: string) {
  if (!runningInTauri()) return mockImportCharacterCard(path)
  return invoke<TavernCharacter>('import_character_card', { path })
}

export async function exportCharacterCard(characterId: string, path: string) {
  if (!runningInTauri()) return path
  return invoke<string>('export_character_card', { characterId, path })
}

export async function listPersonas() {
  if (!runningInTauri()) return mockPersonas
  return invoke<Persona[]>('list_personas')
}

export async function savePersona(persona: Persona) {
  if (!runningInTauri()) return mockSavePersona(persona)
  return invoke<Persona>('save_persona', { persona })
}

export async function importPersona(path: string) {
  if (!runningInTauri()) return mockImportPersona(path)
  return invoke<Persona>('import_persona', { path })
}

export async function exportPersona(personaId: string, path: string) {
  if (!runningInTauri()) return path
  return invoke<string>('export_persona', { personaId, path })
}

export async function createChat(characterId?: string) {
  if (!runningInTauri()) return mockCreateChat(characterId)
  return invoke<TavernChatSession>('create_chat', { characterId })
}

export async function listChats() {
  if (!runningInTauri()) return mockChats
  return invoke<TavernChatListItem[]>('list_chats')
}

export async function loadChat(chatId: string) {
  if (!runningInTauri()) return mockLoadChat(chatId)
  return invoke<TavernChatSession>('load_chat_command', { chatId })
}

export async function updateChatSettings(
  chatId: string,
  settings: {
    characterId?: string
    personaId?: string
    presetId?: string
    providerId?: string
  },
) {
  if (!runningInTauri()) return mockUpdateChatSettings(chatId, settings)
  return invoke<TavernChatSession>('update_chat_settings', {
    chatId,
    characterId: settings.characterId,
    personaId: settings.personaId,
    presetId: settings.presetId,
    providerId: settings.providerId,
  })
}

export async function deleteChat(chatId: string) {
  if (!runningInTauri()) return mockDeleteChat(chatId)
  return invoke<TavernChatListItem[]>('delete_chat_command', { chatId })
}

export async function searchChats(query: string) {
  if (!runningInTauri()) return searchMockChats(query)
  return invoke<TavernChatListItem[]>('search_chats', { query })
}

export async function bookmarkMessage(chatId: string, messageId: string, bookmarked: boolean) {
  if (!runningInTauri()) return mockBookmarkMessage(chatId, messageId, bookmarked)
  return invoke<TavernChatSession>('bookmark_message', { chatId, messageId, bookmarked })
}

export async function clearChatMessages(chatId: string) {
  if (!runningInTauri()) return mockClearChatMessages(chatId)
  return invoke<TavernChatSession>('clear_chat_messages', { chatId })
}

export async function saveChatSummary(chatId: string, summary: string) {
  if (!runningInTauri()) return mockSaveChatSummary(chatId, summary)
  return invoke<TavernChatSession>('save_chat_summary', { chatId, summary })
}

export async function compactChatMemory(chatId: string) {
  if (!runningInTauri()) return mockCompactChatMemory(chatId)
  return invoke<ChatMemoryCompactResult>('compact_chat_memory_command', { chatId })
}

export async function listWorldbooks() {
  if (!runningInTauri()) return mockWorldbooks
  return invoke<Worldbook[]>('list_worldbooks')
}

export async function saveWorldbook(worldbook: Worldbook) {
  if (!runningInTauri()) return mockSaveWorldbook(worldbook)
  return invoke<Worldbook>('save_worldbook', { worldbook })
}

export async function importWorldbook(path: string) {
  if (!runningInTauri()) return mockImportWorldbook(path)
  return invoke<Worldbook>('import_worldbook', { path })
}

export async function exportWorldbook(worldbookId: string, path: string) {
  if (!runningInTauri()) return path
  return invoke<string>('export_worldbook', { worldbookId, path })
}

export async function testWorldbookMatch(text: string) {
  if (!runningInTauri()) return []
  return invoke<WorldbookMatch[]>('test_worldbook_match', { text })
}

export async function listPresets() {
  if (!runningInTauri()) return mockPresets
  return invoke<PromptPreset[]>('list_presets')
}

export async function savePreset(preset: PromptPreset) {
  if (!runningInTauri()) return mockSavePreset(preset)
  return invoke<PromptPreset>('save_preset', { preset })
}

export async function importPreset(path: string) {
  if (!runningInTauri()) return mockImportPreset(path)
  return invoke<PromptPreset>('import_preset', { path })
}

export async function exportPreset(presetId: string, path: string) {
  if (!runningInTauri()) return path
  return invoke<string>('export_preset', { presetId, path })
}

export async function listProviders() {
  if (!runningInTauri()) return mockProviders
  return invoke<ProviderConfig[]>('list_providers')
}

export async function saveProviderKey(providerId: string, apiKey: string) {
  if (!runningInTauri()) return
  return invoke<void>('save_provider_key', { providerId, apiKey })
}

export async function previewPrompt(params: {
  chatId?: string
  characterId?: string
  presetId?: string
  providerId?: string
  message?: string
  clientNow?: string
}) {
  if (!runningInTauri()) {
    return {
      ...mockPromptPreview,
      messages: [
        {
          role: 'system' as const,
          content: `${mockPromptPreview.messages[0].content}\n\n当前本地时间：${params.clientNow || '预览时间未知'}`,
        },
        {
          role: 'user' as const,
          content: params.message?.trim() || mockPromptPreview.messages[1].content,
        },
      ],
    }
  }
  return invoke<PromptBuildResult>('preview_prompt', {
    chatId: params.chatId,
    characterId: params.characterId,
    presetId: params.presetId,
    providerId: params.providerId,
    message: params.message,
    clientNow: params.clientNow,
  })
}

export async function exportChat(chatId: string, path: string) {
  if (!runningInTauri()) return path
  return invoke<string>('export_chat', { chatId, path })
}

export async function importChat(path: string) {
  if (!runningInTauri()) return mockImportChat(path)
  return invoke<TavernChatSession>('import_chat', { path })
}

async function mockStream() {
  await new Promise((resolve) => window.setTimeout(resolve, 300))
  return '我先在预览模式陪你说话。接入 Tauri 后，就会换成 DeepSeek 的流式回复。呼噜。'
}

function toChatListItem(chat: TavernChatSession): TavernChatListItem {
  const lastMessage = chat.messages.at(-1)?.content ?? ''
  return {
    id: chat.id,
    title: chat.title,
    characterId: chat.characterId,
    updatedAt: chat.updatedAt,
    messageCount: chat.messages.length,
    lastMessage: lastMessage.length > 72 ? `${lastMessage.slice(0, 69)}...` : lastMessage,
    tags: chat.tags,
  }
}

function syncMockChatList() {
  mockChats = mockChatSessions.map(toChatListItem)
}

function searchMockChats(query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return mockChats
  return mockChats.filter((chat) => {
    const session = mockChatSessions.find((item) => item.id === chat.id)
    const haystack = [
      chat.title,
      chat.lastMessage,
      chat.tags.join(' '),
      session?.messages.map((message) => message.content).join(' ') ?? '',
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(needle)
  })
}

function mockLoadChat(chatId: string) {
  const chat = mockChatSessions.find((item) => item.id === chatId)
  if (!chat) throw new Error('没有找到聊天')
  return { ...chat, messages: chat.messages.map((message) => ({ ...message })) }
}

function mockCreateChat(characterId?: string) {
  const character = mockCharacters.find((item) => item.id === characterId) ?? mockCharacters[0]
  const id = `mock-chat-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const now = String(Date.now())
  const chat: TavernChatSession = {
    id,
    title: `和${character.name}的聊天`,
    characterId: character.id,
    personaId: 'default-user',
    presetId: character.defaultPresetId || 'healing-short-chat',
    providerId: character.defaultProviderId || 'deepseek',
    summary: '',
    tags: [],
    createdAt: now,
    updatedAt: now,
    messages: character.firstMes
      ? [
          {
            id: `mock-msg-${Date.now()}`,
            role: 'assistant',
            content: character.firstMes,
            createdAt: now,
            bookmarked: false,
            compacted: false,
            compactedAt: null,
            summaryBatchId: null,
          },
        ]
      : [],
  }
  mockChatSessions = [chat, ...mockChatSessions]
  syncMockChatList()
  emitMockChatListChanged({ activeChatId: id, reason: 'create' })
  return mockLoadChat(id)
}

function mockDeleteChat(chatId: string) {
  const nextSessions = mockChatSessions.filter((chat) => chat.id !== chatId)
  if (nextSessions.length === mockChatSessions.length) {
    throw new Error('没有找到要删除的聊天')
  }
  mockChatSessions = nextSessions
  syncMockChatList()
  emitMockChatListChanged({ deletedChatId: chatId, reason: 'delete' })
  return mockChats
}

function mockBookmarkMessage(chatId: string, messageId: string, bookmarked: boolean) {
  const chat = mockChatSessions.find((item) => item.id === chatId)
  if (!chat) throw new Error('没有找到聊天')
  chat.messages = chat.messages.map((message) =>
    message.id === messageId
      ? {
          ...message,
          bookmarked,
          compacted: bookmarked ? false : message.compacted,
          compactedAt: bookmarked ? null : message.compactedAt,
          summaryBatchId: bookmarked ? null : message.summaryBatchId,
        }
      : message,
  )
  chat.updatedAt = String(Date.now())
  syncMockChatList()
  emitMockChatListChanged({ activeChatId: chatId, reason: 'bookmark' })
  return mockLoadChat(chatId)
}

function mockClearChatMessages(chatId: string) {
  const chat = mockChatSessions.find((item) => item.id === chatId)
  if (!chat) throw new Error('没有找到聊天')
  chat.messages = []
  chat.summary = ''
  chat.updatedAt = String(Date.now())
  syncMockChatList()
  emitMockChatListChanged({ activeChatId: chatId, reason: 'clear' })
  return mockLoadChat(chatId)
}

function mockSaveChatSummary(chatId: string, summary: string) {
  const chat = mockChatSessions.find((item) => item.id === chatId)
  if (!chat) throw new Error('没有找到聊天')
  chat.summary = summary.trim()
  chat.updatedAt = String(Date.now())
  syncMockChatList()
  emitMockChatListChanged({ activeChatId: chatId, reason: 'summary' })
  return mockLoadChat(chatId)
}

function mockCompactChatMemory(chatId: string): ChatMemoryCompactResult {
  const chat = mockChatSessions.find((item) => item.id === chatId)
  if (!chat) throw new Error('没有找到聊天')
  const preset = mockPresets.find((item) => item.id === chat.presetId) ?? mockPresets[0]
  const keepRawCount = Math.max(2, preset?.contextMessages ?? 24)
  const batchSize = Math.max(1, Math.floor(keepRawCount / 2))
  const activeMessages = chat.messages.filter((message) => !message.compacted)
  const olderMessages = activeMessages.slice(0, Math.max(0, activeMessages.length - keepRawCount))
  const skippedBookmarkedCount = olderMessages.filter((message) => message.bookmarked).length
  const selected = olderMessages.filter((message) => !message.bookmarked).slice(0, batchSize)
  if (activeMessages.length <= keepRawCount || selected.length === 0) {
    return {
      chat: mockLoadChat(chatId),
      compactedCount: 0,
      skippedBookmarkedCount,
      summaryUpdated: false,
      message: '还没有达到需要整理的上下文上限',
    }
  }
  const now = String(Date.now())
  const batchId = `mock-summary-${now}`
  const selectedIds = new Set(selected.map((message) => message.id))
  const digest = selected
    .map((message) => `${message.role === 'user' ? '用户' : '角色'}: ${message.content}`)
    .join('\n')
  chat.summary = [
    chat.summary.trim(),
    `已发生的重要事件:\n- 预览整理了 ${selected.length} 条旧消息。\n${digest}`,
  ]
    .filter(Boolean)
    .join('\n\n')
  chat.messages = chat.messages.map((message) =>
    selectedIds.has(message.id)
      ? { ...message, compacted: true, compactedAt: now, summaryBatchId: batchId }
      : message,
  )
  chat.updatedAt = now
  syncMockChatList()
  emitMockChatListChanged({ activeChatId: chatId, reason: 'compact' })
  return {
    chat: mockLoadChat(chatId),
    compactedCount: selected.length,
    skippedBookmarkedCount,
    summaryUpdated: true,
    message: `已整理 ${selected.length} 条旧消息进长期摘要`,
  }
}

function mockUpdateChatSettings(
  chatId: string,
  settings: {
    characterId?: string
    personaId?: string
    presetId?: string
    providerId?: string
  },
) {
  const chat = mockChatSessions.find((item) => item.id === chatId)
  if (!chat) throw new Error('没有找到聊天')
  if (settings.characterId) chat.characterId = settings.characterId
  if (settings.personaId !== undefined) chat.personaId = settings.personaId || null
  if (settings.presetId !== undefined) chat.presetId = settings.presetId || null
  if (settings.providerId !== undefined) chat.providerId = settings.providerId || null
  chat.updatedAt = String(Date.now())
  syncMockChatList()
  emitMockChatListChanged({ activeChatId: chatId, reason: 'settings' })
  return mockLoadChat(chatId)
}

function mockId(prefix: string, label: string) {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'item'
  return `${prefix}-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function baseNameFromPath(path: string, fallback: string) {
  const fileName = path.trim().split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '')
  return fileName || fallback
}

function mockSaveCharacter(character: TavernCharacter) {
  const now = String(Date.now())
  const saved: TavernCharacter = {
    ...character,
    id: character.id.trim() || mockId('mock-character', character.name),
    name: character.name.trim() || '未命名角色',
    enabled: character.enabled !== false,
    tags: character.tags || [],
    useCustomRelationshipPrompts: Boolean(character.useCustomRelationshipPrompts),
    relationshipStagePrompts: {
      ...defaultRelationshipStagePrompts,
      ...character.relationshipStagePrompts,
    },
    createdAt: character.createdAt || now,
    updatedAt: now,
  }
  const index = mockCharacters.findIndex((item) => item.id === saved.id)
  if (index >= 0) {
    mockCharacters[index] = saved
  } else {
    mockCharacters.push(saved)
  }
  emitMockCharactersChanged({ activeCharacterId: saved.id, reason: 'save' })
  return saved
}

function mockImportCharacterCard(path: string) {
  return mockSaveCharacter({
    ...mockCharacters[0],
    id: '',
    name: baseNameFromPath(path, '预览导入角色'),
    enabled: true,
    tags: ['预览导入'],
    createdAt: '',
    updatedAt: '',
  })
}

function relationshipStageForAffection(affection: number): CharacterRelationship['stage'] {
  if (affection <= -50) return 'guarded'
  if (affection <= -15) return 'distant'
  if (affection < 35) return 'neutral'
  if (affection < 75) return 'close'
  return 'trusted'
}

function relationshipStageLabel(stage: CharacterRelationship['stage']) {
  return (
    {
      guarded: '戒备',
      distant: '疏离',
      neutral: '普通',
      close: '亲近',
      trusted: '信赖',
    } satisfies Record<CharacterRelationship['stage'], string>
  )[stage]
}

function relationshipMoodLabel(mood: number) {
  if (mood <= -45) return '心情很差'
  if (mood <= -15) return '有点低落'
  if (mood < 15) return '心情平稳'
  if (mood < 45) return '心情不错'
  return '很开心'
}

function normalizeMockRelationship(relationship: CharacterRelationship): CharacterRelationship {
  const affection = Math.min(100, Math.max(-100, relationship.affection))
  const mood = Math.min(100, Math.max(-100, relationship.mood))
  const stage = relationshipStageForAffection(affection)
  const nicknameSettings = relationship.nicknameSettings ?? {
    enabled: false,
    userNickname: '',
    characterNickname: '',
    minimumStage: 'close' as const,
  }
  const idleLines = relationship.idleLines?.length
    ? relationship.idleLines
    : [
        {
          id: 'idle-neutral',
          text: '我在这里，慢慢来就好。',
          minimumStage: 'neutral' as const,
          enabled: true,
          weight: 1,
          note: '普通阶段默认待机台词',
        },
        {
          id: 'idle-close',
          text: '要不要歇一小会儿？我陪你。',
          minimumStage: 'close' as const,
          enabled: true,
          weight: 1,
          note: '亲近阶段默认待机台词',
        },
        {
          id: 'idle-trusted',
          text: '今天也在你身边，放心。',
          minimumStage: 'trusted' as const,
          enabled: true,
          weight: 1,
          note: '信赖阶段默认待机台词',
        },
      ]
  return {
    ...relationship,
    affection,
    mood,
    stage,
    stageLabel: relationshipStageLabel(stage),
    moodLabel: relationshipMoodLabel(mood),
    events: relationship.events.slice(-20),
    unlocks: {
      specialGreeting: affection >= 35,
      nickname: affection >= 55,
      idleLines: affection >= 75,
      holidayReaction: affection >= 75,
    },
    lastPassiveDecayAt: relationship.lastPassiveDecayAt ?? '',
    warmStreak: relationship.warmStreak ?? 0,
    lastWarmInteractionAt: relationship.lastWarmInteractionAt ?? '',
    nicknameSettings,
    idleLines,
  }
}

function mockGetRelationship(characterId: string) {
  const existing = mockRelationships.find((item) => item.characterId === characterId)
  if (existing) return normalizeMockRelationship(existing)
  const relationship = normalizeMockRelationship({
    characterId,
    affection: 0,
    mood: 0,
    stage: 'neutral',
    stageLabel: '普通',
    moodLabel: '心情平稳',
    events: [],
    unlocks: {
      specialGreeting: false,
      nickname: false,
      idleLines: false,
      holidayReaction: false,
    },
    lastPassiveDecayAt: '',
    warmStreak: 0,
    lastWarmInteractionAt: '',
    nicknameSettings: {
      enabled: false,
      userNickname: '',
      characterNickname: '',
      minimumStage: 'close',
    },
    idleLines: [],
    updatedAt: String(Date.now()),
  })
  mockRelationships.push(relationship)
  return relationship
}

function mockResetRelationship(characterId: string) {
  const reset = normalizeMockRelationship({
    ...mockGetRelationship(characterId),
    affection: 0,
    mood: 0,
    events: [],
    updatedAt: String(Date.now()),
  })
  const index = mockRelationships.findIndex((item) => item.characterId === characterId)
  if (index >= 0) {
    mockRelationships[index] = reset
  } else {
    mockRelationships.push(reset)
  }
  emitMockRelationshipChanged({
    relationship: reset,
    delta: 0,
    moodDelta: 0,
    reason: '关系已重置',
    source: 'system',
  })
  return reset
}

function mockGetRelationshipPreferences(characterId: string): RelationshipPreferences {
  const relationship = mockGetRelationship(characterId)
  return {
    characterId,
    nicknameSettings: relationship.nicknameSettings,
    idleLines: relationship.idleLines,
    holidays: mockHolidays,
  }
}

function mockSaveRelationshipPreferences(characterId: string, preferences: RelationshipPreferences) {
  const relationship = mockGetRelationship(characterId)
  const savedRelationship = normalizeMockRelationship({
    ...relationship,
    nicknameSettings: preferences.nicknameSettings,
    idleLines: preferences.idleLines,
    updatedAt: String(Date.now()),
  })
  const index = mockRelationships.findIndex((item) => item.characterId === characterId)
  if (index >= 0) mockRelationships[index] = savedRelationship
  mockHolidays = preferences.holidays
  emitMockRelationshipChanged({
    relationship: savedRelationship,
    delta: 0,
    moodDelta: 0,
    reason: '关系设置已保存',
    source: 'system',
  })
  return mockGetRelationshipPreferences(characterId)
}

function mockSavePersona(persona: Persona) {
  const now = String(Date.now())
  const saved: Persona = {
    ...persona,
    id: persona.id.trim() || mockId('mock-persona', persona.name),
    name: persona.name.trim() || '未命名 Persona',
    avatar: persona.avatar || null,
    createdAt: persona.createdAt || now,
    updatedAt: now,
  }
  if (saved.isDefault) {
    mockPersonas.forEach((item) => {
      if (item.id !== saved.id) item.isDefault = false
    })
  }
  const index = mockPersonas.findIndex((item) => item.id === saved.id)
  if (index >= 0) {
    mockPersonas[index] = saved
  } else {
    mockPersonas.push(saved)
  }
  if (!mockPersonas.some((item) => item.isDefault)) {
    mockPersonas[0].isDefault = true
  }
  emitMockPersonasChanged({ activePersonaId: saved.id, reason: 'save' })
  return saved
}

function mockImportPersona(path: string) {
  return mockSavePersona({
    id: '',
    name: baseNameFromPath(path, '预览导入 Persona'),
    avatar: null,
    description: '这是预览端生成的 Persona 占位数据，桌面端会读取真实 JSON 文件。',
    isDefault: false,
    createdAt: '',
    updatedAt: '',
  })
}

function mockSaveWorldbook(worldbook: Worldbook) {
  const now = String(Date.now())
  const saved: Worldbook = {
    ...worldbook,
    id: worldbook.id.trim() || mockId('mock-worldbook', worldbook.name),
    name: worldbook.name.trim() || '未命名世界书',
    enabled: worldbook.enabled !== false,
    entries: (worldbook.entries.length ? worldbook.entries : [mockWorldbooks[0].entries[0]]).map((entry) => ({
      ...entry,
      id: entry.id.trim() || mockId('mock-entry', entry.title),
      title: entry.title.trim() || '未命名条目',
      enabled: entry.enabled !== false,
      position: entry.position || 'system',
    })),
    createdAt: worldbook.createdAt || now,
    updatedAt: now,
  }
  const index = mockWorldbooks.findIndex((item) => item.id === saved.id)
  if (index >= 0) {
    mockWorldbooks[index] = saved
  } else {
    mockWorldbooks.push(saved)
  }
  return saved
}

function mockImportWorldbook(path: string) {
  return mockSaveWorldbook({
    id: '',
    name: baseNameFromPath(path, '预览导入世界书'),
    enabled: true,
    entries: [
      {
        id: '',
        title: '预览条目',
        keys: ['预览'],
        content: '这是预览端生成的世界书占位条目，桌面端会读取真实 JSON 文件。',
        enabled: true,
        priority: 10,
        position: 'system',
      },
    ],
    createdAt: '',
    updatedAt: '',
  })
}

function mockSavePreset(preset: PromptPreset) {
  const now = String(Date.now())
  const saved: PromptPreset = {
    ...preset,
    id: preset.id.trim() || `mock-preset-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: preset.name.trim() || '未命名预设',
    enabled: preset.enabled !== false,
    contextMessages: Math.min(80, Math.max(2, preset.contextMessages)),
    maxInputChars: Math.min(100_000, Math.max(1200, preset.maxInputChars)),
    maxOutputTokens: Math.min(8192, Math.max(32, preset.maxOutputTokens)),
    temperature: Math.min(2, Math.max(0, preset.temperature)),
    replyLimit: Math.min(2000, Math.max(20, preset.replyLimit)),
    createdAt: preset.createdAt || now,
    updatedAt: now,
  }
  const index = mockPresets.findIndex((item) => item.id === saved.id)
  if (index >= 0) {
    mockPresets[index] = saved
  } else {
    mockPresets.push(saved)
  }
  emitMockPresetsChanged({ activePresetId: saved.id, reason: 'save' })
  return saved
}

function mockImportPreset(path: string) {
  return mockSavePreset({
    ...mockPresets[0],
    id: '',
    name: baseNameFromPath(path, '预览导入预设'),
    enabled: true,
    createdAt: '',
    updatedAt: '',
  })
}

function mockImportChat(path: string) {
  const id = `mock-import-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const now = String(Date.now())
  const chat: TavernChatSession = {
    ...mockChatSessionTemplate,
    id,
    title: path.trim() ? '导入聊天' : '导入聊天',
    createdAt: now,
    updatedAt: now,
    messages: mockChatSessionTemplate.messages.map((message) => ({
      ...message,
      id: `${message.id}-${Date.now()}`,
      createdAt: now,
    })),
  }
  mockChatSessions = [chat, ...mockChatSessions]
  syncMockChatList()
  emitMockChatListChanged({ activeChatId: id, reason: 'import' })
  return mockLoadChat(id)
}

const mockCharacters: TavernCharacter[] = [
  {
    id: 'jingling',
    name: '鲸灵',
    enabled: true,
    avatar: null,
    description: '一只温柔治愈的鲸灵桌宠。',
    personality: '亲切、短句、轻快。',
    scenario: '鲸灵住在桌面上。',
    firstMes: '呼噜，我在这里。',
    mesExample: '<START>\n{{user}}: 我累了。\n{{char}}: 先松口气，我们慢慢来。',
    tags: ['桌宠', '治愈'],
    defaultPresetId: 'healing-short-chat',
    defaultProviderId: 'deepseek',
    useCustomRelationshipPrompts: false,
    relationshipStagePrompts: defaultRelationshipStagePrompts,
    createdAt: '0',
    updatedAt: '0',
  },
]

const mockRelationships: CharacterRelationship[] = [
  {
    characterId: 'jingling',
    affection: 0,
    mood: 0,
    stage: 'neutral',
    stageLabel: '普通',
    moodLabel: '心情平稳',
    events: [],
    unlocks: {
      specialGreeting: false,
      nickname: false,
      idleLines: false,
      holidayReaction: false,
    },
    lastPassiveDecayAt: '',
    warmStreak: 0,
    lastWarmInteractionAt: '',
    nicknameSettings: {
      enabled: false,
      userNickname: '',
      characterNickname: '',
      minimumStage: 'close',
    },
    idleLines: [],
    updatedAt: '0',
  },
]

let mockHolidays: HolidayRule[] = [
  {
    id: 'new-year',
    name: '元旦',
    month: 1,
    day: 1,
    enabled: true,
    scope: 'all',
    minimumStage: 'neutral' as const,
    prompt: '今天是元旦，可以自然地给出新年问候。',
    builtIn: true,
  },
  {
    id: 'valentine',
    name: '情人节',
    month: 2,
    day: 14,
    enabled: true,
    scope: 'all',
    minimumStage: 'close' as const,
    prompt: '今天是情人节；如果关系足够亲近，可以温柔回应节日氛围。',
    builtIn: true,
  },
  {
    id: 'children-day',
    name: '儿童节',
    month: 6,
    day: 1,
    enabled: true,
    scope: 'all',
    minimumStage: 'neutral' as const,
    prompt: '今天是儿童节，可以用轻快可爱的语气祝福一下。',
    builtIn: true,
  },
  {
    id: 'qixi-placeholder',
    name: '七夕占位',
    month: 0,
    day: 0,
    enabled: false,
    scope: 'manual',
    minimumStage: 'close' as const,
    prompt: '七夕相关反应入口；v1 不做农历自动换算。',
    builtIn: true,
  },
  {
    id: 'christmas',
    name: '圣诞',
    month: 12,
    day: 25,
    enabled: true,
    scope: 'all',
    minimumStage: 'neutral' as const,
    prompt: '今天是圣诞，可以自然地给出节日问候。',
    builtIn: true,
  },
  {
    id: 'character-birthday',
    name: '角色生日入口',
    month: 0,
    day: 0,
    enabled: false,
    scope: 'manual',
    minimumStage: 'neutral' as const,
    prompt: '角色生日反应入口；填入月日后启用。',
    builtIn: true,
  },
]

const mockPersonas: Persona[] = [
  {
    id: 'default-user',
    name: '默认我',
    avatar: null,
    description: '希望得到简短、亲切、实用的陪伴。',
    isDefault: true,
    createdAt: '0',
    updatedAt: '0',
  },
]

const mockChatSessionTemplate: TavernChatSession = {
  id: 'jingling-first-chat',
  title: '和鲸灵的聊天',
  characterId: 'jingling',
  personaId: 'default-user',
  presetId: 'healing-short-chat',
  providerId: 'deepseek',
  summary: '',
  tags: ['默认'],
  createdAt: '0',
  updatedAt: '0',
  messages: [
    {
      id: 'first',
      role: 'assistant',
      content: '呼噜，我在这里。',
      createdAt: '0',
      bookmarked: false,
      compacted: false,
      compactedAt: null,
      summaryBatchId: null,
    },
  ],
}

let mockChatSessions: TavernChatSession[] = [mockChatSessionTemplate]
let mockChats: TavernChatListItem[] = mockChatSessions.map(toChatListItem)

const mockWorldbooks: Worldbook[] = [
  {
    id: 'jingling-worldbook',
    name: '鲸灵世界书',
    enabled: true,
    entries: [
      {
        id: 'catchphrase',
        title: '口头禅',
        keys: ['鲸灵', '呼噜'],
        content: '鲸灵的口头禅是“呼噜，慢慢来就好。”',
        enabled: true,
        priority: 10,
        position: 'system',
      },
    ],
    createdAt: '0',
    updatedAt: '0',
  },
]

const mockPresets: PromptPreset[] = [
  {
    id: 'healing-short-chat',
    name: '治愈短聊',
    enabled: true,
    systemPrompt: '你是{{char}}，治愈系温柔桌面助手。',
    instructTemplate: '保持简短。',
    authorNote: '桌宠快捷聊天。',
    contextMessages: 24,
    maxInputChars: 8000,
    maxOutputTokens: 220,
    temperature: 0.8,
    replyLimit: 100,
    createdAt: '0',
    updatedAt: '0',
  },
]

const mockProviders: ProviderConfig[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    providerType: 'deepseek',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-v4-flash',
    enabled: true,
    keySaved: false,
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI 兼容接口',
    providerType: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4.1-mini',
    enabled: true,
    keySaved: false,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    providerType: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'deepseek/deepseek-chat',
    enabled: true,
    keySaved: false,
  },
  {
    id: 'ollama',
    name: 'Ollama 本地模型',
    providerType: 'ollama',
    baseUrl: 'http://localhost:11434/v1/chat/completions',
    defaultModel: 'qwen3',
    enabled: true,
    keySaved: false,
  },
]

const mockPromptPreview: PromptBuildResult = {
  chatId: 'jingling-first-chat',
  characterId: 'jingling',
  presetId: 'healing-short-chat',
  providerId: 'deepseek',
  model: 'deepseek-v4-flash',
  messages: [
    {
      role: 'system',
      content: '你是鲸灵，治愈系温柔桌面助手。',
    },
    {
      role: 'user',
      content: '你好',
    },
  ],
  matchedWorldbookEntries: [],
  estimatedChars: 18,
  budgetChars: 8000,
  maxOutputTokens: 220,
  temperature: 0.8,
  replyLimit: 100,
  memorySummaryUsed: false,
  recentMessageCount: 0,
  bookmarkedMessageCount: 0,
  compactedMessageCount: 0,
}
