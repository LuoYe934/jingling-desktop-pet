import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { BookOpen, Plus, Send, Square } from 'lucide-react'
import { usePetStore } from '../stores/petStore'
import { formatChatOption, normalizeChatList } from '../lib/chatList'
import { getDistinctSpeechVoices, pickSpeechVoice, speakLocalText, speakPiperText, stopSpeech } from '../lib/speech'
import { estimatePromptTokens, estimateTokenCount } from '../lib/tokenEstimate'
import {
  cancelMessage,
  clearChatMessages,
  clearMemory,
  createChat,
  getSettings,
  hasApiKey,
  listenToCharacterChanges,
  listenToChatListChanges,
  listenToChatEvents,
  listenToPersonaChanges,
  listenToPresetChanges,
  listenToSettingsChanges,
  listCharacters,
  listChats,
  listPersonas,
  listPresets,
  listProviders,
  loadChat,
  runningInTauri,
  sendMessage,
  showTavernWindow,
  updateChatSettings,
  updateSettings,
} from '../lib/tauri'
import type {
  ChatMessage,
  Persona,
  PromptPreset,
  ProviderConfig,
  TavernCharacter,
  TavernChatListItem,
  TavernChatSession,
} from '../types/tauri'
import { AvatarBadge } from './AvatarBadge'
import { SettingsPanel } from './SettingsPanel'

const welcomeMessage: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: '我在呀。今天想慢一点聊，还是一起把事情理清楚？呼噜。',
}

const lastChatIdStorageKey = 'jingling-last-chat-id'

function makeId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function readLastChatId() {
  try {
    return window.localStorage.getItem(lastChatIdStorageKey) || ''
  } catch {
    return ''
  }
}

function saveLastChatId(chatId: string) {
  if (!chatId) return
  try {
    window.localStorage.setItem(lastChatIdStorageKey, chatId)
  } catch {
    // Local storage can be unavailable in locked-down WebViews.
  }
}

function clearLastChatId() {
  try {
    window.localStorage.removeItem(lastChatIdStorageKey)
  } catch {
    // Local storage can be unavailable in locked-down WebViews.
  }
}

function tokenLabel(message: ChatMessage) {
  const tokens = message.tokenCount ?? estimateTokenCount(message.content)
  return `${message.tokenSource === 'api' ? '' : '约 '}${tokens} tokens`
}

function enabledWithActive<T extends { id: string; enabled: boolean }>(items: T[], activeId: string) {
  const enabled = items.filter((item) => item.enabled)
  const active = items.find((item) => item.id === activeId)
  if (active && !enabled.some((item) => item.id === active.id)) {
    return [active, ...enabled]
  }
  return enabled.length ? enabled : items
}

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [characters, setCharacters] = useState<TavernCharacter[]>([])
  const [chats, setChats] = useState<TavernChatListItem[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [presets, setPresets] = useState<PromptPreset[]>([])
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [lastReplyTokens, setLastReplyTokens] = useState(0)
  const [activeCharacterId, setActiveCharacterId] = useState('')
  const [activeChatId, setActiveChatId] = useState('')
  const [activePersonaId, setActivePersonaId] = useState('')
  const [activePresetId, setActivePresetId] = useState('')
  const [activeProviderId, setActiveProviderId] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const activeChatIdRef = useRef('')
  const activeCharacterIdRef = useRef('')
  const activePersonaIdRef = useRef('')
  const activePresetIdRef = useRef('')
  const ttsSettingsRef = useRef(usePetStore.getState().ttsSettings)
  const wasTtsEnabledRef = useRef(usePetStore.getState().ttsSettings.enabled)
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])
  const lastSpokenReplyRef = useRef<{ key: string; at: number } | null>(null)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const settings = usePetStore((state) => state.settings)
  const ttsSettings = usePetStore((state) => state.ttsSettings)
  const showTokenStats = usePetStore((state) => state.showTokenStats)
  const setSettings = usePetStore((state) => state.setSettings)
  const setTtsSettings = usePetStore((state) => state.setTtsSettings)
  const setMotion = usePetStore((state) => state.setMotion)
  const setHasApiKey = usePetStore((state) => state.setHasApiKey)

  function syncChatState(
    chat: TavernChatSession,
    nextPersonas = personas,
    nextPresets = presets,
    nextProviders = providers,
    ) {
    const nextEnabledPresets = nextPresets.filter((preset) => preset.enabled)
    saveLastChatId(chat.id)
    setActiveChatId(chat.id)
    setActiveCharacterId(chat.characterId)
    setActivePersonaId(chat.personaId || nextPersonas.find((persona) => persona.isDefault)?.id || nextPersonas[0]?.id || '')
    setActivePresetId(chat.presetId || nextEnabledPresets[0]?.id || nextPresets[0]?.id || '')
    setActiveProviderId(chat.providerId || nextProviders[0]?.id || 'deepseek')
    setMessages(
      chat.messages.length
        ? chat.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            bookmarked: message.bookmarked,
            createdAt: message.createdAt,
          }))
        : [welcomeMessage],
    )
  }

  function syncEmptyChatState(
    nextCharacters = characters,
    nextPersonas = personas,
    nextPresets = presets,
    nextProviders = providers,
  ) {
    const nextEnabledCharacters = nextCharacters.filter((character) => character.enabled)
    const nextEnabledPresets = nextPresets.filter((preset) => preset.enabled)
    const fallbackCharacterId =
      nextEnabledCharacters.find((character) => character.id === activeCharacterId)?.id ||
      nextEnabledCharacters[0]?.id ||
      nextCharacters[0]?.id ||
      ''
    setActiveChatId('')
    setActiveCharacterId(fallbackCharacterId)
    setActivePersonaId(nextPersonas.find((persona) => persona.isDefault)?.id || nextPersonas[0]?.id || '')
    setActivePresetId(nextEnabledPresets[0]?.id || nextPresets[0]?.id || '')
    setActiveProviderId(nextProviders[0]?.id || 'deepseek')
    setMessages([welcomeMessage])
    clearLastChatId()
  }

  async function refreshLists(nextChatId?: string | null) {
    const [nextCharacters, rawChats, nextPersonas, nextPresets, nextProviders] = await Promise.all([
      listCharacters(),
      listChats(),
      listPersonas(),
      listPresets(),
      listProviders(),
    ])
    const nextChats = normalizeChatList(rawChats)
    setCharacters(nextCharacters)
    setChats(nextChats)
    setPersonas(nextPersonas)
    setPresets(nextPresets)
    setProviders(nextProviders)

    const selectedChatId =
      nextChatId === null
        ? nextChats[0]?.id
        : [nextChatId, activeChatIdRef.current, readLastChatId(), nextChats[0]?.id].find((chatId) =>
            nextChats.some((chat) => chat.id === chatId),
          )
    if (selectedChatId) {
      const chat = await loadChat(selectedChatId)
      syncChatState(chat, nextPersonas, nextPresets, nextProviders)
      return
    }

    syncEmptyChatState(nextCharacters, nextPersonas, nextPresets, nextProviders)
  }

  useEffect(() => {
    getSettings().then(setSettings).catch(() => undefined)
    hasApiKey().then(setHasApiKey).catch(() => setHasApiKey(false))
    refreshLists()
      .catch(() => undefined)
      .finally(() => setIsBootstrapping(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setHasApiKey, setSettings])

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    listenToSettingsChanges((nextSettings) => {
      setSettings(nextSettings)
    }).then((unlisten) => {
      if (disposed) {
        unlisten()
        return
      }
      cleanup = unlisten
    }).catch(() => undefined)
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [setSettings])

  useEffect(() => {
    activeChatIdRef.current = activeChatId
  }, [activeChatId])

  useEffect(() => {
    activeCharacterIdRef.current = activeCharacterId
  }, [activeCharacterId])

  useEffect(() => {
    activePersonaIdRef.current = activePersonaId
  }, [activePersonaId])

  useEffect(() => {
    activePresetIdRef.current = activePresetId
  }, [activePresetId])

  useEffect(() => {
    const wasEnabled = wasTtsEnabledRef.current
    ttsSettingsRef.current = ttsSettings
    wasTtsEnabledRef.current = ttsSettings.enabled
    if (wasEnabled && !ttsSettings.enabled) {
      stopSpeech()
    }
  }, [ttsSettings])

  useEffect(() => {
    if (!('speechSynthesis' in window)) return

    const loadVoices = () => {
      const nextVoices = getDistinctSpeechVoices(window.speechSynthesis.getVoices())
      voicesRef.current = nextVoices
      setVoices(nextVoices)

      const currentTtsSettings = usePetStore.getState().ttsSettings
      const selectedVoiceStillVisible =
        !currentTtsSettings.voiceURI || nextVoices.some((voice) => voice.voiceURI === currentTtsSettings.voiceURI)
      if (!selectedVoiceStillVisible) {
        const replacementVoice = pickSpeechVoice(nextVoices, currentTtsSettings.voiceURI)
        setTtsSettings({ ...currentTtsSettings, voiceURI: replacementVoice?.voiceURI ?? '' })
      }
    }

    loadVoices()
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices)
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices)
      stopSpeech()
    }
  }, [setTtsSettings])

  function speakAssistantReply(text: string, chatId = activeChatIdRef.current) {
    const content = text.trim()
    if (!content) return

    const key = `${chatId || 'pending'}:${content}`
    const now = Date.now()
    const lastSpokenReply = lastSpokenReplyRef.current
    if (lastSpokenReply?.key === key && now - lastSpokenReply.at < 10_000) {
      return
    }

    lastSpokenReplyRef.current = { key, at: now }
    const currentTtsSettings = ttsSettingsRef.current
    if (!currentTtsSettings.enabled) return
    if (currentTtsSettings.engine === 'piper') {
      void speakPiperText(content, currentTtsSettings).catch(() => undefined)
      return
    }

    speakLocalText(content, currentTtsSettings, voicesRef.current)
  }

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    listenToChatListChanges((payload) => {
      const nextChats = normalizeChatList(payload.chats)
      const currentChatId = activeChatIdRef.current
      const currentStillExists = nextChats.some((chat) => chat.id === currentChatId)
      if (payload.deletedChatId === currentChatId || payload.activeChatId || !currentStillExists) {
        void refreshLists(payload.activeChatId ?? null).catch(() => undefined)
        return
      }
      setChats(nextChats)
    }).then((unlisten) => {
      if (disposed) {
        unlisten()
        return
      }
      cleanup = unlisten
    }).catch(() => undefined)
    return () => {
      disposed = true
      cleanup?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    listenToPresetChanges((payload) => {
      setPresets(payload.presets)
      const currentPresetId = activePresetIdRef.current
      const currentPreset = payload.presets.find((preset) => preset.id === currentPresetId)
      const savedPreset = payload.presets.find((preset) => preset.id === payload.activePresetId)
      const fallbackPresetId = payload.presets.find((preset) => preset.enabled)?.id || payload.presets[0]?.id || ''
      if (savedPreset?.enabled) {
        setActivePresetId(savedPreset.id)
      } else if (!currentPreset?.enabled) {
        setActivePresetId(fallbackPresetId)
      }
    }).then((unlisten) => {
      if (disposed) {
        unlisten()
        return
      }
      cleanup = unlisten
    }).catch(() => undefined)
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    listenToCharacterChanges((payload) => {
      setCharacters(payload.characters)
      const currentCharacterId = activeCharacterIdRef.current
      const currentCharacter = payload.characters.find((character) => character.id === currentCharacterId)
      const savedCharacter = payload.characters.find((character) => character.id === payload.activeCharacterId)
      const fallbackCharacterId =
        payload.characters.find((character) => character.enabled)?.id || payload.characters[0]?.id || ''
      if (savedCharacter?.enabled && savedCharacter.id === currentCharacterId) {
        setActiveCharacterId(savedCharacter.id)
      } else if (!currentCharacter?.enabled) {
        setActiveCharacterId(fallbackCharacterId)
      }
    }).then((unlisten) => {
      if (disposed) {
        unlisten()
        return
      }
      cleanup = unlisten
    }).catch(() => undefined)
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    listenToPersonaChanges((payload) => {
      setPersonas(payload.personas)
      const currentPersonaId = activePersonaIdRef.current
      const currentPersona = payload.personas.find((persona) => persona.id === currentPersonaId)
      const savedPersona = payload.personas.find((persona) => persona.id === payload.activePersonaId)
      if (savedPersona?.id === currentPersonaId) {
        setActivePersonaId(savedPersona.id)
      } else if (!currentPersona) {
        setActivePersonaId(payload.personas.find((persona) => persona.isDefault)?.id || payload.personas[0]?.id || '')
      }
    }).then((unlisten) => {
      if (disposed) {
        unlisten()
        return
      }
      cleanup = unlisten
    }).catch(() => undefined)
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    listenToChatEvents({
      onChunk: ({ content }) => {
        setIsStreaming(true)
        setMotion('thinking')
        setMessages((current) => {
          const next = [...current]
          const last = next[next.length - 1]
          if (last?.role === 'assistant' && last.streaming) {
            next[next.length - 1] = { ...last, content: last.content + content }
            return next
          }
          return [...next, { id: makeId(), role: 'assistant', content, streaming: true }]
        })
      },
      onDone: ({ content, chatId, completionTokens }) => {
        setIsStreaming(false)
        setMotion('happy')
        if (chatId) {
          saveLastChatId(chatId)
          setActiveChatId(chatId)
          void listChats().then((items) => setChats(normalizeChatList(items))).catch(() => undefined)
        }
        const hasApiCompletionTokens = completionTokens !== null && completionTokens !== undefined
        const replyTokens = hasApiCompletionTokens ? completionTokens : estimateTokenCount(content)
        const tokenSource = hasApiCompletionTokens ? 'api' : 'estimate'
        setLastReplyTokens(replyTokens)
        speakAssistantReply(content, chatId)
        setMessages((current) => {
          const next = [...current]
          const last = next[next.length - 1]
          if (last?.role === 'assistant' && last.streaming) {
            next[next.length - 1] = {
              ...last,
              content: content || last.content,
              streaming: false,
              tokenCount: replyTokens,
              tokenSource,
            }
            return next
          }
          if (content) {
            return [...next, { id: makeId(), role: 'assistant', content, tokenCount: replyTokens, tokenSource }]
          }
          return next
        })
        window.setTimeout(() => setMotion('idle'), 1200)
      },
      onError: ({ message }) => {
        setIsStreaming(false)
        setMotion('error')
        setMessages((current) => [
          ...current.filter((item) => !item.streaming),
          { id: makeId(), role: 'system', content: message },
        ])
        window.setTimeout(() => setMotion('idle'), 1200)
      },
    }).then((unlisten) => {
      if (disposed) {
        unlisten()
        return
      }
      cleanup = unlisten
    }).catch(() => undefined)
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [setMotion])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  const canSend = useMemo(
    () => input.trim().length > 0 && !isStreaming && !isBootstrapping && (Boolean(activeChatId) || chats.length === 0),
    [activeChatId, chats.length, input, isBootstrapping, isStreaming],
  )
  const activePreset = useMemo(
    () => presets.find((preset) => preset.id === activePresetId) ?? presets.find((preset) => preset.enabled) ?? presets[0],
    [activePresetId, presets],
  )
  const activeCharacter = useMemo(
    () =>
      characters.find((character) => character.id === activeCharacterId) ??
      characters.find((character) => character.enabled) ??
      characters[0],
    [activeCharacterId, characters],
  )
  const selectableCharacters = useMemo(
    () => enabledWithActive(characters, activeCharacterId),
    [activeCharacterId, characters],
  )
  const selectablePresets = useMemo(
    () => enabledWithActive(presets, activePresetId),
    [activePresetId, presets],
  )
  const activePersona = useMemo(
    () =>
      personas.find((persona) => persona.id === activePersonaId) ??
      personas.find((persona) => persona.isDefault) ??
      personas[0],
    [activePersonaId, personas],
  )
  const promptTokens = useMemo(
    () =>
      estimatePromptTokens({
        messages,
        input,
        preset: activePreset,
        character: activeCharacter,
        persona: activePersona,
      }),
    [activeCharacter, activePersona, activePreset, input, messages],
  )
  const promptBudget = activePreset?.maxInputChars ?? 8000

  function speakerForMessage(message: ChatMessage) {
    if (message.role === 'user') {
      return {
        name: activePersona?.name || '我',
        avatar: activePersona?.avatar,
      }
    }
    if (message.role === 'assistant') {
      return {
        name: activeCharacter?.name || '鲸灵',
        avatar: activeCharacter?.avatar,
      }
    }
    return {
      name: '系统',
      avatar: null,
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    await sendCurrent()
  }

  async function sendCurrent() {
    const content = input.trim()
    if (!content || isStreaming || isBootstrapping) return
    if (!activeChatId && chats.length > 0) {
      await refreshLists(readLastChatId() || null).catch(() => undefined)
      return
    }

    setInput('')
    setIsStreaming(true)
    setMotion('thinking')
    setMessages((current) => [
      ...current,
      { id: makeId(), role: 'user', content, tokenCount: estimateTokenCount(content), tokenSource: 'estimate' },
      { id: makeId(), role: 'assistant', content: '', streaming: true },
    ])

    try {
      const previewReply = await sendMessage(content, {
        model: activeProviderId === 'deepseek' ? settings.model : undefined,
        chatId: activeChatId || undefined,
        characterId: activeCharacterId || undefined,
        presetId: activePresetId || undefined,
        providerId: activeProviderId || undefined,
      })
      if (!runningInTauri() && typeof previewReply === 'string') {
        setMessages((current) => {
          const next = [...current]
          const last = next[next.length - 1]
          if (last?.role === 'assistant' && last.streaming) {
            next[next.length - 1] = {
              ...last,
              content: previewReply,
              streaming: false,
              tokenCount: estimateTokenCount(previewReply),
              tokenSource: 'estimate',
            }
            return next
          }
          return [
            ...next,
            {
              id: makeId(),
              role: 'assistant',
              content: previewReply,
              tokenCount: estimateTokenCount(previewReply),
              tokenSource: 'estimate',
            },
          ]
        })
        setLastReplyTokens(estimateTokenCount(previewReply))
        speakAssistantReply(previewReply)
        setIsStreaming(false)
        setMotion('happy')
        window.setTimeout(() => setMotion('idle'), 1200)
      }
    } catch (error) {
      setIsStreaming(false)
      setMotion('error')
      setMessages((current) => [
        ...current.filter((item) => !item.streaming),
        { id: makeId(), role: 'system', content: String(error) },
      ])
    }
  }

  async function clearAll() {
    if (activeChatId) {
      const chat = await clearChatMessages(activeChatId)
      setMessages(chat.messages.length ? chat.messages : [welcomeMessage])
      setChats(normalizeChatList(await listChats()))
      return
    }
    await clearMemory()
    setMessages([welcomeMessage])
  }

  async function selectChat(chatId: string) {
    const chat = await loadChat(chatId)
    syncChatState(chat)
  }

  async function selectCharacter(characterId: string) {
    setActiveCharacterId(characterId)
    const chat = await createChat(characterId)
    syncChatState(chat)
    setChats(normalizeChatList(await listChats()))
  }

  async function updateActiveChatSettings(next: {
    personaId?: string
    presetId?: string
    providerId?: string
  }) {
    if (!activeChatId) {
      if (next.personaId !== undefined) setActivePersonaId(next.personaId)
      if (next.presetId !== undefined) setActivePresetId(next.presetId)
      if (next.providerId !== undefined) setActiveProviderId(next.providerId)
      return
    }

    const chat = await updateChatSettings(activeChatId, next)
    syncChatState(chat)
    setChats(normalizeChatList(await listChats()))
  }

  async function newChat() {
    const characterId =
      characters.find((character) => character.id === activeCharacterId && character.enabled)?.id ||
      selectableCharacters.find((character) => character.enabled)?.id ||
      characters[0]?.id
    const chat = await createChat(characterId)
    syncChatState(chat)
    setChats(normalizeChatList(await listChats()))
  }

  return (
    <>
      <div className="chat-context-bar" data-no-window-drag="true">
        <select value={activeCharacterId} title="角色" onChange={(event) => void selectCharacter(event.target.value)}>
          {selectableCharacters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.enabled ? character.name : `${character.name}（已禁用）`}
            </option>
          ))}
        </select>
        <select value={activeChatId} title="聊天" onChange={(event) => void selectChat(event.target.value)}>
          {chats.map((chat) => (
            <option key={chat.id} value={chat.id}>
              {formatChatOption(chat)}
            </option>
          ))}
        </select>
        <select
          value={activePersonaId}
          title="Persona"
          onChange={(event) => void updateActiveChatSettings({ personaId: event.target.value })}
        >
          {personas.map((persona) => (
            <option key={persona.id} value={persona.id}>
              {persona.name}
            </option>
          ))}
        </select>
        <select
          value={activePresetId}
          title="预设"
          onChange={(event) => void updateActiveChatSettings({ presetId: event.target.value })}
        >
          {selectablePresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.enabled ? preset.name : `${preset.name}（已禁用）`}
            </option>
          ))}
        </select>
        <select
          value={activeProviderId}
          title="Provider"
          onChange={(event) => void updateActiveChatSettings({ providerId: event.target.value })}
        >
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
        <button className="icon-button" title="新聊天" type="button" onClick={() => void newChat()}>
          <Plus size={15} />
        </button>
        <button className="icon-button" title="酒馆管理器" type="button" onClick={() => void showTavernWindow()}>
          <BookOpen size={15} />
        </button>
      </div>

      <div className={`messages ${showTokenStats ? 'messages--token-stats' : ''}`} aria-live="polite">
        {messages.map((message) => {
          const speaker = speakerForMessage(message)
          return (
            <div key={message.id} className={`message-row message-row--${message.role}`}>
              {message.role !== 'system' && (
                <AvatarBadge name={speaker.name} avatar={speaker.avatar} className="message-avatar" />
              )}
              <div className={`message message--${message.role}`}>
                {message.content}
                {message.streaming && <span className="caret" />}
                {showTokenStats && message.content.trim() && (
                  <small className="message-token-count">{tokenLabel(message)}</small>
                )}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="composer-block" data-no-window-drag="true">
        {showTokenStats && (
          <div className="chat-token-status">
            <span>
              本轮上下文约 {promptTokens} / {promptBudget} tokens
            </span>
            <span>{lastReplyTokens ? `上次回复 ${lastReplyTokens} tokens` : '回复完成后显示输出 tokens'}</span>
          </div>
        )}
        <form className="composer" onSubmit={submit}>
          <textarea
            value={input}
            maxLength={1200}
            placeholder="和鲸灵说点什么..."
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void sendCurrent()
              }
            }}
          />
          <div className="send-stack">
            <button className="primary-button" type="submit" disabled={!canSend} title="发送">
              <Send size={17} />
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!isStreaming}
              title="停止"
              onClick={() => {
                void cancelMessage()
                setIsStreaming(false)
              }}
            >
              <Square size={14} />
            </button>
          </div>
        </form>
      </div>

      <SettingsPanel
        settings={settings}
        ttsSettings={ttsSettings}
        voices={voices}
        onClear={clearAll}
        onSettingsChange={(next) => {
          setSettings(next)
          void updateSettings(next).then(setSettings).catch(() => undefined)
        }}
        onTtsSettingsChange={setTtsSettings}
      />
    </>
  )
}
