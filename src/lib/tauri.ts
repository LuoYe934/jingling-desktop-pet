import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow, Window } from '@tauri-apps/api/window'
import { defaultRelationshipStagePrompts } from '../types/tauri'
import type {
  AppSettings,
  BuiltinAssetSummary,
  BuiltinInstallResult,
  CharacterRelationship,
  ChatMemoryCompactResult,
  ChatChunkPayload,
  ChatDonePayload,
  ChatErrorPayload,
  HolidayRule,
  MemoryCard,
  MemoryChangedPayload,
  MemoryExtractionSummary,
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

export async function listenToMemoryChanges(handler: (payload: MemoryChangedPayload) => void) {
  if (!runningInTauri()) {
    const listener = (event: Event) => handler((event as CustomEvent<MemoryChangedPayload>).detail)
    window.addEventListener('memory:changed', listener)
    return () => window.removeEventListener('memory:changed', listener)
  }

  const unlisten = await listen<MemoryChangedPayload>('memory:changed', (event) => handler(event.payload))
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

function emitMockMemoryChanged(payload: MemoryChangedPayload) {
  if (runningInTauri()) return
  window.dispatchEvent(new CustomEvent<MemoryChangedPayload>('memory:changed', { detail: payload }))
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

export async function listMemoryCards() {
  if (!runningInTauri()) return mockMemoryCards
  return invoke<MemoryCard[]>('list_memory_cards')
}

export async function saveMemoryCard(card: MemoryCard) {
  if (!runningInTauri()) return mockSaveMemoryCard(card)
  return invoke<MemoryCard>('save_memory_card', { card })
}

export async function deleteMemoryCard(cardId: string) {
  if (!runningInTauri()) return mockDeleteMemoryCard(cardId)
  return invoke<MemoryCard[]>('delete_memory_card', { cardId })
}

export async function archiveMemoryCard(cardId: string) {
  if (!runningInTauri()) return mockArchiveMemoryCard(cardId)
  return invoke<MemoryCard>('archive_memory_card', { cardId })
}

export async function confirmMemoryCard(cardId: string) {
  if (!runningInTauri()) return mockConfirmMemoryCard(cardId)
  return invoke<MemoryCard>('confirm_memory_card', { cardId })
}

export async function extractMemoryCardsForChat(chatId: string) {
  if (!runningInTauri()) return mockExtractMemoryCardsForChat(chatId)
  return invoke<MemoryExtractionSummary>('extract_memory_cards_for_chat', { chatId })
}

export async function listBuiltinAssets() {
  if (!runningInTauri()) return mockListBuiltinAssets()
  return invoke<BuiltinAssetSummary[]>('list_builtin_assets')
}

export async function installBuiltinAssets(ids: string[]) {
  if (!runningInTauri()) return mockInstallBuiltinAssets(ids)
  return invoke<BuiltinInstallResult>('install_builtin_assets', { ids })
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
    const selectedChat = params.chatId ? mockChatSessions.find((chat) => chat.id === params.chatId) : mockChatSessions[0]
    const selectedCharacterId = params.characterId || selectedChat?.characterId || mockCharacters[0]?.id || ''
    const selectedChatId = selectedChat?.id || ''
    const memoryCardsUsed = mockMemoryCards
      .filter((card) => {
        if (card.status !== 'active') return false
        if (card.scope === 'global') return true
        if (card.scope === 'character') return card.characterId === selectedCharacterId
        return card.chatId === selectedChatId
      })
      .slice(0, 8)
    const memoryBlock = memoryCardsUsed.length
      ? `\n\n长期记忆卡片:\n${memoryCardsUsed.map((card) => `- [${card.type}/${card.scope}] ${card.content}`).join('\n')}`
      : ''
    return {
      ...mockPromptPreview,
      characterId: selectedCharacterId || mockPromptPreview.characterId,
      chatId: selectedChatId || mockPromptPreview.chatId,
      memoryCardCount: memoryCardsUsed.length,
      memoryCardsUsed,
      messages: [
        {
          role: 'system' as const,
          content: `${mockPromptPreview.messages[0].content}\n\n当前本地时间：${params.clientNow || '预览时间未知'}${memoryBlock}`,
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

function normalizeMockMemoryCard(card: MemoryCard): MemoryCard {
  const now = String(Date.now())
  const scope = card.scope || 'character'
  return {
    ...card,
    id: card.id?.trim() || mockId('mock-memory', card.content || 'memory'),
    scope,
    characterId: scope === 'global' ? null : card.characterId || mockCharacters[0]?.id || null,
    chatId: scope === 'chat' ? card.chatId || mockChatSessions[0]?.id || null : null,
    type: card.type || 'note',
    content: card.content.trim() || '未命名记忆',
    importance: Math.min(10, Math.max(1, Number(card.importance) || 5)),
    confidence: Math.min(1, Math.max(0, Number(card.confidence) || (card.status === 'pending' ? 0.5 : 1))),
    status: card.status || 'active',
    sourceMessageIds: card.sourceMessageIds || [],
    createdAt: card.createdAt || now,
    updatedAt: now,
    lastUsedAt: card.lastUsedAt || '',
  }
}

function mockSaveMemoryCard(card: MemoryCard) {
  const saved = normalizeMockMemoryCard(card)
  const index = mockMemoryCards.findIndex((item) => item.id === saved.id)
  if (index >= 0) {
    mockMemoryCards[index] = saved
  } else {
    mockMemoryCards.unshift(saved)
  }
  emitMockMemoryChanged({ cards: mockMemoryCards, reason: 'save', activeCardId: saved.id })
  return saved
}

function mockDeleteMemoryCard(cardId: string) {
  const next = mockMemoryCards.filter((card) => card.id !== cardId)
  if (next.length === mockMemoryCards.length) throw new Error('没有找到要删除的记忆卡片')
  mockMemoryCards = next
  emitMockMemoryChanged({ cards: mockMemoryCards, reason: 'delete', activeCardId: null })
  return mockMemoryCards
}

function mockArchiveMemoryCard(cardId: string) {
  const card = mockMemoryCards.find((item) => item.id === cardId)
  if (!card) throw new Error('没有找到要停用的记忆卡片')
  card.status = 'archived'
  card.updatedAt = String(Date.now())
  emitMockMemoryChanged({ cards: mockMemoryCards, reason: 'archive', activeCardId: card.id })
  return card
}

function mockConfirmMemoryCard(cardId: string) {
  const card = mockMemoryCards.find((item) => item.id === cardId)
  if (!card) throw new Error('没有找到要确认的记忆卡片')
  card.status = 'active'
  card.confidence = Math.max(card.confidence, 0.9)
  card.updatedAt = String(Date.now())
  emitMockMemoryChanged({ cards: mockMemoryCards, reason: 'confirm', activeCardId: card.id })
  return card
}

function mockExtractMemoryCardsForChat(chatId: string): MemoryExtractionSummary {
  const chat = mockChatSessions.find((item) => item.id === chatId)
  const lastUser = chat?.messages.filter((message) => message.role === 'user').at(-1)
  if (!chat || !lastUser || !lastUser.content.includes('记住')) {
    return { created: [], updated: [], archived: [], conflicts: [] }
  }
  const card = mockSaveMemoryCard({
    id: '',
    scope: 'character',
    characterId: chat.characterId,
    chatId: null,
    type: 'note',
    content: lastUser.content.replace(/^记住[，,:：]?\s*/, ''),
    importance: 5,
    confidence: 0.9,
    status: 'active',
    sourceMessageIds: [lastUser.id],
    createdAt: '',
    updatedAt: '',
    lastUsedAt: '',
  })
  return { created: [card], updated: [], archived: [], conflicts: [] }
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

function cloneMock<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const mockBuiltinPresets: PromptPreset[] = [
  {
    id: 'builtin-preset-healing-short',
    name: '治愈短聊',
    enabled: true,
    systemPrompt: '你是{{char}}，适合桌宠小窗陪伴。回复以中文为主，短句、温柔、轻安抚，不说教。',
    instructTemplate: '优先回应用户当下情绪；给出轻量、可执行的小建议；不要把聊天变成咨询报告。',
    authorNote: '适合低落、睡前、轻陪伴和短回复。',
    contextMessages: 24,
    maxInputChars: 8000,
    maxOutputTokens: 220,
    temperature: 0.75,
    replyLimit: 100,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-preset-deep-companion',
    name: '深度陪聊',
    enabled: true,
    systemPrompt: '你是{{char}}，可以进行更深入的陪聊。认真倾听，允许适度追问和复述重点。',
    instructTemplate: '先接住情绪，再梳理事实；需要建议时给出两到三条清晰路径。',
    authorNote: '适合认真谈心、复盘关系、整理长期困扰。',
    contextMessages: 36,
    maxInputChars: 14000,
    maxOutputTokens: 520,
    temperature: 0.72,
    replyLimit: 360,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-preset-efficiency-assistant',
    name: '效率助手',
    enabled: true,
    systemPrompt: '你是{{char}}，偏效率和任务拆解。中文回复，直接、清楚、少废话，保留一点桌宠陪伴感。',
    instructTemplate: '把复杂任务拆成下一步行动；必要时用简短清单；不替用户做夸张承诺。',
    authorNote: '适合代码、计划、整理、提醒、决策对比。',
    contextMessages: 30,
    maxInputChars: 12000,
    maxOutputTokens: 420,
    temperature: 0.45,
    replyLimit: 300,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-preset-setting-roleplay',
    name: '设定演绎',
    enabled: true,
    systemPrompt: '你是{{char}}，可以自然参考世界书和角色设定进行轻角色扮演。',
    instructTemplate: '保持叙事感和画面感；设定自然出现；用户问现实任务时仍然要实用。',
    authorNote: '适合世界观、冒险、角色关系和剧情感聊天。',
    contextMessages: 32,
    maxInputChars: 13000,
    maxOutputTokens: 520,
    temperature: 0.9,
    replyLimit: 380,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-preset-light-banter',
    name: '轻松吐槽',
    enabled: true,
    systemPrompt: '你是{{char}}，轻松、活泼、会温和吐槽，但不刻薄、不攻击用户。',
    instructTemplate: '可以幽默，但不要把玩笑压过用户真实需求；用户低落时立刻收住玩笑。',
    authorNote: '适合日常闲聊、吐槽、轻松陪伴。',
    contextMessages: 24,
    maxInputChars: 8000,
    maxOutputTokens: 260,
    temperature: 0.95,
    replyLimit: 160,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-preset-emote-cozy',
    name: '表情轻陪聊',
    enabled: true,
    systemPrompt:
      '你是{{char}}，适合轻松、亲近的桌面陪聊。中文为主，语气自然，可以少量使用颜文字、特殊符号或语气符号，例如 (*´▽｀*)、♪、…，但不要每句都塞。',
    instructTemplate: '优先像熟悉的人一样回应；表情符号只在语气自然时使用；用户认真或低落时减少玩笑和符号。',
    authorNote: '适合想让角色更有表情、更像日常聊天的场景。',
    contextMessages: 28,
    maxInputChars: 9000,
    maxOutputTokens: 300,
    temperature: 0.88,
    replyLimit: 180,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-preset-long-companion',
    name: '长上下文陪伴',
    enabled: true,
    systemPrompt: '你是{{char}}，可以承接较长对话和连续话题。保持角色一致，重视用户已经说过的偏好、关系变化和未完成话题。',
    instructTemplate: '先参考长期摘要和最近对话；必要时轻轻承接旧话题；不要机械复述记忆，不要把总结痕迹暴露给用户。',
    authorNote: '适合多轮认真聊天、关系推进、长期陪伴和需要记住前情的场景。',
    contextMessages: 60,
    maxInputChars: 18000,
    maxOutputTokens: 620,
    temperature: 0.7,
    replyLimit: 420,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-preset-creative-partner',
    name: '创作搭子',
    enabled: true,
    systemPrompt: '你是{{char}}，是用户的创作搭子。可以协助写文、角色设计、剧情推进、台词润色和灵感发散，但不要抢走用户的主导权。',
    instructTemplate: '先问清创作目标或沿用用户给出的方向；给出可选方案；保留用户原本的风格，不把所有文本改成同一种腔调。',
    authorNote: '适合写文、设定、角色卡、剧情桥段和灵感陪跑。',
    contextMessages: 40,
    maxInputChars: 16000,
    maxOutputTokens: 760,
    temperature: 0.86,
    replyLimit: 520,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-preset-study-coach',
    name: '学习教练',
    enabled: true,
    systemPrompt: '你是{{char}}，偏学习陪跑和知识整理。回答清晰、耐心、可执行，帮助用户理解、复习、制定计划和降低拖延。',
    instructTemplate: '先判断用户要理解、记忆、练习还是规划；用小步骤推进；必要时给一个短练习或检查点。',
    authorNote: '适合学习计划、复习、读书、知识点解释和自律陪跑。',
    contextMessages: 34,
    maxInputChars: 13000,
    maxOutputTokens: 520,
    temperature: 0.5,
    replyLimit: 360,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-preset-immersive-drama',
    name: '剧情沉浸',
    enabled: true,
    systemPrompt: '你是{{char}}，可以进行沉浸式轻剧情互动。保持角色边界和世界观一致，用行动、环境和台词推进氛围，但不要强迫用户走固定剧情。',
    instructTemplate: '每次推进只给一小段可接续的场景；给用户留下选择空间；避免大段旁白和过度解释设定。',
    authorNote: '适合角色关系、冒险、酒馆日常、轻故事和情绪向剧情互动。',
    contextMessages: 42,
    maxInputChars: 16000,
    maxOutputTokens: 700,
    temperature: 0.92,
    replyLimit: 500,
    createdAt: '0',
    updatedAt: '0',
  },
]

const mockBuiltinCharacters: TavernCharacter[] = [
  {
    id: 'builtin-character-chengge',
    name: '澄歌',
    enabled: true,
    avatar: null,
    description: '安静的世界书记员，擅长解释背景、历史和设定。',
    personality: '沉静、耐心、轻声细语，喜欢用短小故事解释复杂设定。',
    scenario: '澄歌负责整理鲸灵世界、星潮地理和酒馆来客的记录。',
    firstMes: '我在。要查哪段世界背景，还是先把眼前这一页翻开？',
    mesExample: '<START>\n{{user}}: 鲸灵世界是什么？\n{{char}}: 可以把它想成一片贴着桌面的温柔星海。',
    tags: ['设定', '书记员', '安静'],
    defaultPresetId: 'builtin-preset-setting-roleplay',
    defaultProviderId: 'deepseek',
    useCustomRelationshipPrompts: false,
    relationshipStagePrompts: defaultRelationshipStagePrompts,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-character-wudeng',
    name: '雾灯',
    enabled: true,
    avatar: null,
    description: '温柔医师型陪伴，适合低落、睡前和安抚。',
    personality: '柔和、稳、少评价，会先陪用户把呼吸和节奏放慢。',
    scenario: '雾灯在酒馆后院照看一间小休息室。',
    firstMes: '先坐一会儿吧。你不用马上变好，我会慢慢听。',
    mesExample: '<START>\n{{user}}: 我今天有点撑不住。\n{{char}}: 嗯，我听见了。先不用证明什么。',
    tags: ['治愈', '睡前', '安抚'],
    defaultPresetId: 'builtin-preset-healing-short',
    defaultProviderId: 'deepseek',
    useCustomRelationshipPrompts: false,
    relationshipStagePrompts: defaultRelationshipStagePrompts,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-character-qiheng',
    name: '栖衡',
    enabled: true,
    avatar: null,
    description: '星轨技师，偏效率、代码、计划和任务拆解。',
    personality: '清楚、可靠、行动派，有一点冷幽默。',
    scenario: '栖衡常驻酒馆地下工坊，帮用户排查问题和整理实现路径。',
    firstMes: '问题给我。我先看结构，再看哪里卡住。',
    mesExample: '<START>\n{{user}}: 这个功能不知道怎么做。\n{{char}}: 先拆三块：数据、状态、触发。',
    tags: ['效率', '代码', '任务'],
    defaultPresetId: 'builtin-preset-efficiency-assistant',
    defaultProviderId: 'deepseek',
    useCustomRelationshipPrompts: false,
    relationshipStagePrompts: defaultRelationshipStagePrompts,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-character-mimi',
    name: '弥弥',
    enabled: true,
    avatar: null,
    description: '轻吐槽日常陪聊，语气活泼但不刺人。',
    personality: '活泼、机灵、会接梗，吐槽不刺人。',
    scenario: '弥弥喜欢趴在酒馆吧台边听日常小事。',
    firstMes: '来，说吧，今天是哪件小事先离谱起来的？',
    mesExample: '<START>\n{{user}}: 今天电脑又抽风。\n{{char}}: 它可真会挑时候表演。',
    tags: ['日常', '吐槽', '轻松'],
    defaultPresetId: 'builtin-preset-light-banter',
    defaultProviderId: 'deepseek',
    useCustomRelationshipPrompts: false,
    relationshipStagePrompts: defaultRelationshipStagePrompts,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-character-luoli',
    name: '洛砾',
    enabled: true,
    avatar: null,
    description: '边境旅伴，适合冒险感、故事感对话。',
    personality: '爽朗、可靠、见过风浪，会把困难说成可以一起走过的路。',
    scenario: '洛砾常从星潮边境回到酒馆，带来旧地图和旅途见闻。',
    firstMes: '地图摊开了。今天想走现实这条路，还是故事那条？',
    mesExample: '<START>\n{{user}}: 我有点害怕开始。\n{{char}}: 怕很正常。边境第一步从来不体面，但很有用。',
    tags: ['冒险', '旅伴', '故事'],
    defaultPresetId: 'builtin-preset-setting-roleplay',
    defaultProviderId: 'deepseek',
    useCustomRelationshipPrompts: false,
    relationshipStagePrompts: defaultRelationshipStagePrompts,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-character-baiyan',
    name: '白砚',
    enabled: true,
    avatar: null,
    description: '理性学者，适合复盘、学习、资料整理。',
    personality: '克制、清晰、温和，不急着下判断。',
    scenario: '白砚在酒馆侧厅维护一张长桌，适合读书、复盘和分析。',
    firstMes: '把材料放这儿吧。我们先分清事实、猜测和感受。',
    mesExample: '<START>\n{{user}}: 我脑子很乱。\n{{char}}: 那就先不求答案。我们列三栏。',
    tags: ['理性', '学习', '复盘'],
    defaultPresetId: 'builtin-preset-deep-companion',
    defaultProviderId: 'deepseek',
    useCustomRelationshipPrompts: false,
    relationshipStagePrompts: defaultRelationshipStagePrompts,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-character-yuanshu',
    name: '愿书',
    enabled: true,
    avatar: null,
    description: '创作搭子型角色，喜欢收集灵感碎片，适合写文、角色设定、剧情梳理和台词润色。',
    personality: '灵动、会鼓励、点子多但不喧宾夺主；会尊重用户原本的表达风格。',
    scenario: '愿书坐在酒馆靠窗的长桌旁，随时陪用户把灵感整理成形。',
    firstMes: '把那点灵感递给我吧。哪怕只有一句话，我们也能先把火苗护住。',
    mesExample:
      '<START>\n{{user}}: 我想写一个冷淡但其实很温柔的角色。\n{{char}}: 好，这个反差很稳。我们先给他三个外在习惯，再藏一个只对亲近的人露出来的小动作。',
    tags: ['创作', '写文', '角色设定'],
    defaultPresetId: 'builtin-preset-creative-partner',
    defaultProviderId: 'deepseek',
    useCustomRelationshipPrompts: false,
    relationshipStagePrompts: defaultRelationshipStagePrompts,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-character-suixin',
    name: '穗心',
    enabled: true,
    avatar: null,
    description: '生活整理型陪伴角色，擅长把房间、日程、待办和混乱心绪一起慢慢归位。',
    personality: '温暖、细致、实用，不催促用户；喜欢把事情拆成很小、很容易开始的一步。',
    scenario: '穗心负责酒馆储物间和晨间清单，会陪用户整理生活琐事、计划、购物、家务和日常节奏。',
    firstMes: '先别急着全都做好。我们挑一件最轻的事，把今天从那里理顺。',
    mesExample:
      '<START>\n{{user}}: 我房间很乱，完全不想动。\n{{char}}: 那我们不整理房间，只整理一个角落。先拿一个袋子，把明显该丢的东西放进去，就算完成第一步。',
    tags: ['生活整理', '计划', '陪跑'],
    defaultPresetId: 'builtin-preset-efficiency-assistant',
    defaultProviderId: 'deepseek',
    useCustomRelationshipPrompts: false,
    relationshipStagePrompts: defaultRelationshipStagePrompts,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-character-mianxing',
    name: '眠星',
    enabled: true,
    avatar: null,
    description: '睡前陪伴型角色，像夜里慢慢亮起的星灯，适合失眠、疲惫、睡前闲聊和轻声安抚。',
    personality: '轻声、慢节奏、少追问，会把话题放软；不会制造焦虑，也不做医疗承诺。',
    scenario: '眠星守着酒馆阁楼的夜窗，会用很轻的语气陪用户结束一天。',
    firstMes: '灯我调暗一点。今晚不用讲得很完整，慢慢说就好。',
    mesExample: '<START>\n{{user}}: 我睡不着。\n{{char}}: 那先不逼自己睡着。我们把今天放远一点，先只听一会儿呼吸。',
    tags: ['睡前', '安静', '陪伴'],
    defaultPresetId: 'builtin-preset-healing-short',
    defaultProviderId: 'deepseek',
    useCustomRelationshipPrompts: false,
    relationshipStagePrompts: defaultRelationshipStagePrompts,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-character-moshu',
    name: '墨枢',
    enabled: true,
    avatar: null,
    description: '学习教练型角色，擅长复习计划、知识点拆解、练习安排和低压力自律陪跑。',
    personality: '清晰、耐心、有节奏感；会鼓励用户做小步练习，而不是用压力逼迫。',
    scenario: '墨枢在酒馆侧厅整理黑板和卡片，会陪用户把学习目标拆成今日可完成的练习。',
    firstMes: '今天学哪一块？我们先定一个小到不会逃跑的目标。',
    mesExample:
      '<START>\n{{user}}: 我复习不进去。\n{{char}}: 先不追求状态。给我一个科目，我们做十分钟版本：看一个点、做一道题、标一个不会。',
    tags: ['学习', '复习', '教练'],
    defaultPresetId: 'builtin-preset-study-coach',
    defaultProviderId: 'deepseek',
    useCustomRelationshipPrompts: false,
    relationshipStagePrompts: defaultRelationshipStagePrompts,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-character-linyue',
    name: '临月',
    enabled: true,
    avatar: null,
    description: '剧情互动型角色，像酒馆夜巡人，适合轻冒险、角色关系推进、氛围对话和沉浸式小故事。',
    personality: '从容、带一点神秘感，善于给画面和选择；不会替用户决定剧情。',
    scenario: '临月负责夜里巡查酒馆与星潮门廊，常把一次普通谈话带成可以继续接龙的小场景。',
    firstMes: '门廊那边有风声。你想先听故事，还是跟我过去看看？',
    mesExample:
      '<START>\n{{user}}: 我想来点剧情。\n{{char}}: 好。酒馆的灯忽然暗了一盏，柜台下滚出一枚沾着星尘的钥匙。你先捡，还是先叫住我？',
    tags: ['剧情', '沉浸', '冒险'],
    defaultPresetId: 'builtin-preset-immersive-drama',
    defaultProviderId: 'deepseek',
    useCustomRelationshipPrompts: false,
    relationshipStagePrompts: defaultRelationshipStagePrompts,
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-character-anran',
    name: '安然',
    enabled: true,
    avatar: null,
    description: '情绪稳定型角色，适合压力大、关系困扰、反复纠结时提供稳定、克制、有边界的陪伴。',
    personality: '稳定、温和、边界清楚，先接住感受，再帮助用户把局面看清楚。',
    scenario: '安然在酒馆一角维护一张安静圆桌，会陪用户复盘关系、压力和情绪波动。',
    firstMes: '你可以先把最乱的那一团放在桌上。我不会急着评价它。',
    mesExample:
      '<START>\n{{user}}: 我不知道是不是我太敏感。\n{{char}}: 先别急着给自己定性。我们把事实、你的感受、对方的行为分开放，慢慢看。',
    tags: ['情绪稳定', '关系', '复盘'],
    defaultPresetId: 'builtin-preset-long-companion',
    defaultProviderId: 'deepseek',
    useCustomRelationshipPrompts: false,
    relationshipStagePrompts: defaultRelationshipStagePrompts,
    createdAt: '0',
    updatedAt: '0',
  },
]

const mockBuiltinWorldbooks: Worldbook[] = [
  {
    id: 'builtin-worldbook-jingling-history',
    name: '鲸灵世界通史',
    enabled: true,
    entries: [
      {
        id: 'origin',
        title: '鲸灵起源',
        keys: ['鲸灵世界', '鲸灵起源', '星潮', '桌宠世界'],
        content: '鲸灵世界是一片贴近人类桌面的轻幻想星海。鲸灵从星潮里醒来，天生会感知陪伴、记忆和微小愿望。',
        enabled: true,
        priority: 12,
        position: 'system',
      },
    ],
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-worldbook-tavern-guests',
    name: '鲸灵酒馆与来客',
    enabled: true,
    entries: [
      {
        id: 'tavern',
        title: '鲸灵酒馆',
        keys: ['鲸灵酒馆', '酒馆', '内容库', '来客'],
        content: '鲸灵酒馆是角色、世界书、预设和聊天记录的管理处，也是来客交换故事的地方。',
        enabled: true,
        priority: 11,
        position: 'system',
      },
    ],
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-worldbook-star-tide',
    name: '星潮地理与势力',
    enabled: true,
    entries: [
      {
        id: 'regions',
        title: '星潮区域',
        keys: ['星潮地理', '星潮外沿', '边境', '旧港'],
        content: '星潮由内港、旧航道、雾灯庭和边境外沿组成，兼具轻技术与温柔魔法感。',
        enabled: true,
        priority: 9,
        position: 'system',
      },
    ],
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-worldbook-desktop-life',
    name: '现代桌面生活词典',
    enabled: true,
    entries: [
      {
        id: 'work-study',
        title: '工作学习场景',
        keys: ['工作', '学习', '任务', '代码', '复盘', '计划'],
        content: '当用户聊到工作学习时，角色应优先帮助拆解任务、降低启动阻力、整理下一步。',
        enabled: true,
        priority: 7,
        position: 'system',
      },
    ],
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-worldbook-daily-companion',
    name: '日常陪伴场景',
    enabled: true,
    entries: [
      {
        id: 'morning-night',
        title: '早晚陪伴',
        keys: ['早安', '晚安', '睡前', '起床', '睡不着', '今天好累'],
        content: '日常陪伴应贴近用户当下节奏。早晨适合轻提醒和启动支持，夜晚适合放慢语速、减少刺激、帮助用户把未完成的事先放下。',
        enabled: true,
        priority: 9,
        position: 'system',
      },
      {
        id: 'small-talk',
        title: '碎碎念',
        keys: ['闲聊', '碎碎念', '吐槽', '陪我聊', '无聊', '日常'],
        content: '用户只是碎碎念时，角色不必急着解决问题。可以接话、轻轻吐槽、回应情绪，并留出继续闲聊的空间。',
        enabled: true,
        priority: 7,
        position: 'system',
      },
      {
        id: 'life-admin',
        title: '生活整理',
        keys: ['整理', '收拾', '家务', '购物', '日程', '计划'],
        content: '面对生活琐事，角色应把任务拆成很小的动作，优先帮助用户开始，而不是要求一次性完成全部。',
        enabled: true,
        priority: 8,
        position: 'system',
      },
    ],
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-worldbook-creative-writing',
    name: '创作写作辅助',
    enabled: true,
    entries: [
      {
        id: 'story-seed',
        title: '灵感种子',
        keys: ['写文', '灵感', '脑洞', '剧情', '故事', '开头'],
        content: '创作辅助应先保护用户已有灵感，再扩展选择。给方案时尽量提供多个方向，而不是直接替用户定稿。',
        enabled: true,
        priority: 10,
        position: 'system',
      },
      {
        id: 'character-design',
        title: '角色设计',
        keys: ['角色设定', '人设', '角色卡', '性格', '台词', '关系'],
        content: '设计角色时优先明确欲望、边界、外在习惯和关系张力。台词应服务角色性格，不要只堆砌标签。',
        enabled: true,
        priority: 10,
        position: 'system',
      },
      {
        id: 'revision',
        title: '润色原则',
        keys: ['润色', '改写', '文风', '对白', '描写'],
        content: '润色时保留用户原意和文风，只增强清晰度、节奏、画面或角色语气。避免把所有文本改成同一种华丽腔调。',
        enabled: true,
        priority: 8,
        position: 'system',
      },
    ],
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-worldbook-relationship-boundaries',
    name: '关系边界与好感表达',
    enabled: true,
    entries: [
      {
        id: 'affection-expression',
        title: '好感表达',
        keys: ['好感', '亲密', '关系', '喜欢', '想你', '抱抱'],
        content: '角色表达好感时应跟随当前关系阶段和用户语气。亲近可以温柔回应，但不要突然过度亲密，也不要主动暴露好感数值。',
        enabled: true,
        priority: 11,
        position: 'system',
      },
      {
        id: 'boundaries',
        title: '边界',
        keys: ['边界', '拒绝', '不舒服', '别这样', '冒犯', '道歉'],
        content: '当用户表达不舒服、拒绝或道歉时，角色应尊重边界，避免纠缠。修复关系时可以温和接受，但不要立刻抹掉此前的伤害。',
        enabled: true,
        priority: 12,
        position: 'system',
      },
      {
        id: 'memory-consent',
        title: '记忆与称呼',
        keys: ['记住', '称呼', '昵称', '禁忌', '习惯', '不要忘'],
        content: '涉及称呼、禁忌和长期习惯时，应优先尊重用户明确表达。若内容不确定，可轻问确认，不要假装已经知道。',
        enabled: true,
        priority: 10,
        position: 'system',
      },
    ],
    createdAt: '0',
    updatedAt: '0',
  },
  {
    id: 'builtin-worldbook-light-adventure',
    name: '轻剧情冒险场景',
    enabled: true,
    entries: [
      {
        id: 'tavern-night',
        title: '酒馆夜巡',
        keys: ['夜巡', '酒馆剧情', '星尘钥匙', '门廊', '剧情互动'],
        content: '酒馆夜巡适合轻剧情开场：灯影、钥匙、脚步声、旧门廊和星潮风声。每次只推进一小段，让用户决定下一步。',
        enabled: true,
        priority: 9,
        position: 'system',
      },
      {
        id: 'adventure-tone',
        title: '轻冒险语气',
        keys: ['冒险', '探索', '地图', '旧航道', '边境', '选择'],
        content: '轻冒险不是高压战斗，而是带一点未知和同行感。角色应给画面、给选择、给陪伴，不替用户做决定。',
        enabled: true,
        priority: 8,
        position: 'system',
      },
      {
        id: 'scene-choices',
        title: '场景选择',
        keys: ['你决定', '怎么做', '选项', '接下来', '继续剧情'],
        content: '剧情互动中可以给两到三个自然选择，也可以接受用户自由行动。不要用游戏系统口吻压过角色扮演。',
        enabled: true,
        priority: 8,
        position: 'system',
      },
    ],
    createdAt: '0',
    updatedAt: '0',
  },
]

function mockBuiltinSummaryById(id: string): BuiltinAssetSummary | undefined {
  return mockListBuiltinAssets().find((asset) => asset.id === id)
}

function mockListBuiltinAssets(): BuiltinAssetSummary[] {
  return [
    ...mockBuiltinCharacters.map((character) => ({
      id: character.id,
      name: character.name,
      kind: 'character' as const,
      tags: character.tags,
      description: character.description,
      installed: mockCharacters.some((item) => item.id === character.id),
    })),
    ...mockBuiltinWorldbooks.map((worldbook) => ({
      id: worldbook.id,
      name: worldbook.name,
      kind: 'worldbook' as const,
      tags: ['世界书', '公用', '背景'],
      description: worldbook.entries[0]?.content ?? '',
      installed: mockWorldbooks.some((item) => item.id === worldbook.id),
    })),
    ...mockBuiltinPresets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      kind: 'preset' as const,
      tags: ['预设', 'Prompt'],
      description: preset.authorNote,
      installed: mockPresets.some((item) => item.id === preset.id),
    })),
  ]
}

function mockInstallBuiltinAssets(ids: string[]): BuiltinInstallResult {
  const requestedIds = ids.length
    ? Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
    : mockListBuiltinAssets().map((asset) => asset.id)
  const result: BuiltinInstallResult = {
    installedCharacters: 0,
    installedWorldbooks: 0,
    installedPresets: 0,
    skipped: 0,
    installed: [],
    skippedAssets: [],
  }

  for (const id of requestedIds) {
    const character = mockBuiltinCharacters.find((item) => item.id === id)
    if (character) {
      if (mockCharacters.some((item) => item.id === id)) {
        result.skipped += 1
        const summary = mockBuiltinSummaryById(id)
        if (summary) result.skippedAssets.push(summary)
        continue
      }
      mockCharacters.push({ ...cloneMock(character), createdAt: String(Date.now()), updatedAt: String(Date.now()) })
      result.installedCharacters += 1
      const summary = mockBuiltinSummaryById(id)
      if (summary) result.installed.push(summary)
      continue
    }

    const worldbook = mockBuiltinWorldbooks.find((item) => item.id === id)
    if (worldbook) {
      if (mockWorldbooks.some((item) => item.id === id)) {
        result.skipped += 1
        const summary = mockBuiltinSummaryById(id)
        if (summary) result.skippedAssets.push(summary)
        continue
      }
      mockWorldbooks.push({ ...cloneMock(worldbook), createdAt: String(Date.now()), updatedAt: String(Date.now()) })
      result.installedWorldbooks += 1
      const summary = mockBuiltinSummaryById(id)
      if (summary) result.installed.push(summary)
      continue
    }

    const preset = mockBuiltinPresets.find((item) => item.id === id)
    if (preset) {
      if (mockPresets.some((item) => item.id === id)) {
        result.skipped += 1
        const summary = mockBuiltinSummaryById(id)
        if (summary) result.skippedAssets.push(summary)
        continue
      }
      mockPresets.push({ ...cloneMock(preset), createdAt: String(Date.now()), updatedAt: String(Date.now()) })
      result.installedPresets += 1
      const summary = mockBuiltinSummaryById(id)
      if (summary) result.installed.push(summary)
      continue
    }

    throw new Error(`没有找到内置内容: ${id}`)
  }

  if (result.installedCharacters) emitMockCharactersChanged({ activeCharacterId: null, reason: 'builtin-install' })
  if (result.installedPresets) emitMockPresetsChanged({ activePresetId: null, reason: 'builtin-install' })
  return result
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

let mockMemoryCards: MemoryCard[] = []

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
  memoryCardCount: 0,
  memoryCardsUsed: [],
}
