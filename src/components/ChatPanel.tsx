import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { Ban, BookOpen, Brain, Mic, Plus, Send, Square } from 'lucide-react'
import { usePetStore } from '../stores/petStore'
import { formatChatOption, normalizeChatList } from '../lib/chatList'
import { getDistinctSpeechVoices, pickSpeechVoice, speakLocalText, speakPiperText, stopSpeech } from '../lib/speech'
import { formatLocalDateTime, nowStamp } from '../lib/time'
import { estimatePromptTokens, estimateTokenCount } from '../lib/tokenEstimate'
import {
  cancelMessage,
  clearChatMessages,
  clearMemory,
  createChat,
  getRelationship,
  getSettings,
  hasApiKey,
  listenToCharacterChanges,
  listenToChatListChanges,
  listenToChatEvents,
  listenToPersonaChanges,
  listenToPresetChanges,
  listenToRelationshipChanges,
  listenToSettingsChanges,
  listCharacters,
  listChats,
  listPersonas,
  listPresets,
  listProviders,
  loadChat,
  runningInTauri,
  saveMemoryCard,
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
const chatMessageFontSizeStorageKey = 'jingling-chat-message-font-size'
const defaultChatMessageFontSize = 14
const minChatMessageFontSize = 9
const maxChatMessageFontSize = 22

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<{
    isFinal: boolean
    0?: {
      transcript: string
    }
  }>
}

type SpeechRecognitionErrorEventLike = {
  error?: string
  message?: string
}

type SpeechRecognitionWindow = Window &
  typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }

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

function clampChatMessageFontSize(value: number) {
  return Math.min(maxChatMessageFontSize, Math.max(minChatMessageFontSize, value))
}

function readChatMessageFontSize() {
  try {
    const stored = Number(window.localStorage.getItem(chatMessageFontSizeStorageKey))
    if (Number.isFinite(stored)) return clampChatMessageFontSize(stored)
  } catch {
    // Local storage can be unavailable in locked-down WebViews.
  }
  return defaultChatMessageFontSize
}

function saveChatMessageFontSize(size: number) {
  try {
    window.localStorage.setItem(chatMessageFontSizeStorageKey, String(size))
  } catch {
    // Local storage can be unavailable in locked-down WebViews.
  }
}

function appendSpeechText(current: string, addition: string) {
  const text = addition.trim()
  if (!text) return current
  const trimmedCurrent = current.trimEnd()
  if (!trimmedCurrent) return text
  return `${trimmedCurrent} ${text}`
}

function getSpeechRecognitionConstructor() {
  const speechWindow = window as SpeechRecognitionWindow
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
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

function messageMetaLabel(message: ChatMessage, showTokenStats: boolean, showMessageTimes: boolean) {
  const parts = []
  const time = message.createdAt ? formatLocalDateTime(message.createdAt) : ''
  if (showMessageTimes && time) parts.push(time)
  if (showTokenStats) parts.push(tokenLabel(message))
  if (message.compacted) parts.push('已纳入长期摘要')
  return parts.join(' · ')
}

function cacheStatsLabel(stats: { hit: number; miss: number; rate: number | null } | null) {
  if (!stats) return '缓存指标：当前模型未返回'
  const rate = stats.rate === null ? '' : ` · 命中率 ${(stats.rate * 100).toFixed(1)}%`
  return `缓存命中 ${stats.hit} / 未命中 ${stats.miss}${rate}`
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
  const [messageFontSize, setMessageFontSize] = useState(readChatMessageFontSize)
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [characters, setCharacters] = useState<TavernCharacter[]>([])
  const [chats, setChats] = useState<TavernChatListItem[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [presets, setPresets] = useState<PromptPreset[]>([])
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [lastReplyTokens, setLastReplyTokens] = useState(0)
  const [lastCacheStats, setLastCacheStats] = useState<{ hit: number; miss: number; rate: number | null } | null>(null)
  const [activeCharacterId, setActiveCharacterId] = useState('')
  const [activeChatId, setActiveChatId] = useState('')
  const [activePersonaId, setActivePersonaId] = useState('')
  const [activePresetId, setActivePresetId] = useState('')
  const [activeProviderId, setActiveProviderId] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const speechStartingRef = useRef(false)
  const ctrlPressedRef = useRef(false)
  const lastPointerRef = useRef({ x: -1, y: -1 })
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
  const showMessageTimes = usePetStore((state) => state.showMessageTimes)
  const showTokenStats = usePetStore((state) => state.showTokenStats)
  const setSettings = usePetStore((state) => state.setSettings)
  const setTtsSettings = usePetStore((state) => state.setTtsSettings)
  const setMotion = usePetStore((state) => state.setMotion)
  const setActiveRelationship = usePetStore((state) => state.setActiveRelationship)
  const setRelationshipNotice = usePetStore((state) => state.setRelationshipNotice)
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
            compacted: message.compacted,
            compactedAt: message.compactedAt,
            summaryBatchId: message.summaryBatchId,
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
    if (!activeCharacterId) {
      setActiveRelationship(null)
      return
    }
    getRelationship(activeCharacterId)
      .then(setActiveRelationship)
      .catch(() => setActiveRelationship(null))
  }, [activeCharacterId, setActiveRelationship])

  useEffect(() => {
    activePersonaIdRef.current = activePersonaId
  }, [activePersonaId])

  useEffect(() => {
    activePresetIdRef.current = activePresetId
  }, [activePresetId])

  useEffect(() => {
    setSpeechSupported(Boolean(getSpeechRecognitionConstructor()))
    return () => {
      speechRecognitionRef.current?.abort()
      speechRecognitionRef.current = null
      speechStartingRef.current = false
    }
  }, [])

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
    listenToRelationshipChanges(({ relationship, delta, moodDelta, reason }) => {
      if (relationship.characterId !== activeCharacterIdRef.current) return
      setActiveRelationship(relationship)
      if (delta !== 0 || moodDelta !== 0) {
        const affectionPart = delta !== 0 ? `好感 ${delta > 0 ? '+' : ''}${delta}` : ''
        const moodPart = moodDelta !== 0 ? `心情 ${moodDelta > 0 ? '+' : ''}${moodDelta}` : ''
        setRelationshipNotice([affectionPart, moodPart, reason].filter(Boolean).join(' · '))
        window.setTimeout(() => setRelationshipNotice(''), 3600)
      } else if (reason) {
        setRelationshipNotice(reason)
        window.setTimeout(() => setRelationshipNotice(''), 2600)
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
  }, [setActiveRelationship, setRelationshipNotice])

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    listenToChatEvents({
      onChunk: ({ content, eventScope = 'chat' }) => {
        if (eventScope !== 'chat') return
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
      onDone: ({
        content,
        chatId,
        completionTokens,
        assistantCreatedAt,
        cancelled,
        promptCacheHitTokens,
        promptCacheMissTokens,
        promptCacheHitRate,
        eventScope = 'chat',
      }) => {
        if (eventScope !== 'chat') return
        setIsStreaming(false)
        setMotion(cancelled ? 'idle' : 'happy')
        if (chatId) {
          saveLastChatId(chatId)
          setActiveChatId(chatId)
          void listChats().then((items) => setChats(normalizeChatList(items))).catch(() => undefined)
        }
        const hasApiCompletionTokens = completionTokens !== null && completionTokens !== undefined
        const replyTokens = hasApiCompletionTokens ? completionTokens : estimateTokenCount(content)
        const tokenSource = hasApiCompletionTokens ? 'api' : 'estimate'
        setLastReplyTokens(replyTokens)
        if (promptCacheHitTokens !== null && promptCacheHitTokens !== undefined && promptCacheMissTokens !== null && promptCacheMissTokens !== undefined) {
          setLastCacheStats({
            hit: promptCacheHitTokens,
            miss: promptCacheMissTokens,
            rate: promptCacheHitRate ?? null,
          })
        } else {
          setLastCacheStats(null)
        }
        if (!cancelled) {
          speakAssistantReply(content, chatId)
        }
        setMessages((current) => {
          const next = [...current]
          const last = next[next.length - 1]
          if (last?.role === 'assistant' && last.streaming) {
            const finalContent = content || last.content
            if (cancelled && !finalContent.trim()) {
              return next.slice(0, -1)
            }
            next[next.length - 1] = {
              ...last,
              content: finalContent,
              streaming: false,
              tokenCount: hasApiCompletionTokens ? replyTokens : estimateTokenCount(finalContent),
              tokenSource,
              createdAt: assistantCreatedAt,
            }
            return next
          }
          if (content) {
            return [...next, { id: makeId(), role: 'assistant', content, tokenCount: replyTokens, tokenSource, createdAt: assistantCreatedAt }]
          }
          return next
        })
        if (!cancelled) {
          window.setTimeout(() => setMotion('idle'), 1200)
        }
      },
      onError: ({ message, eventScope = 'chat' }) => {
        if (eventScope !== 'chat') return
        setIsStreaming(false)
        setMotion('error')
        setMessages((current) => [
          ...current.filter((item) => !item.streaming),
          { id: makeId(), role: 'system', content: message },
        ])
        window.setTimeout(() => setMotion('idle'), 1200)
      },
      onCompacted: (payload) => {
        if (payload.chatId !== activeChatIdRef.current) return
        void refreshLists(payload.chatId).catch(() => undefined)
        const triggerLabel = payload.trigger === 'token-threshold' ? 'token 超过一半' : '上下文条数超限'
        const skipped = payload.skippedBookmarkedCount ? `，跳过 ${payload.skippedBookmarkedCount} 条收藏` : ''
        setRelationshipNotice(`${triggerLabel}，已整理 ${payload.compactedCount} 条旧消息${skipped}`)
        window.setTimeout(() => setRelationshipNotice(''), 4200)
      },
      onCompactError: (payload) => {
        if (payload.chatId !== activeChatIdRef.current) return
        setRelationshipNotice(`长期摘要整理失败：${payload.message}`)
        window.setTimeout(() => setRelationshipNotice(''), 5200)
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

  useEffect(() => {
    const messagesElement = messagesRef.current
    if (!messagesElement) return

    const isInsideMessages = (event: WheelEvent) => {
      const rect = messagesElement.getBoundingClientRect()
      const fallbackPoint = lastPointerRef.current
      const useFallbackPoint = event.clientX === 0 && event.clientY === 0 && fallbackPoint.x >= 0 && fallbackPoint.y >= 0
      const x = useFallbackPoint ? fallbackPoint.x : event.clientX
      const y = useFallbackPoint ? fallbackPoint.y : event.clientY
      return (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      )
    }

    const handlePointerMove = (event: MouseEvent | PointerEvent) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Control') ctrlPressedRef.current = true
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control') ctrlPressedRef.current = false
    }

    const handleBlur = () => {
      ctrlPressedRef.current = false
    }

    const handleNativeWheel = (event: Event) => {
      const wheelEvent = event as WheelEvent & { detail?: number; wheelDelta?: number }
      if (!wheelEvent.ctrlKey && !ctrlPressedRef.current) return
      if (!isInsideMessages(wheelEvent)) return
      event.preventDefault()
      event.stopPropagation()
      const delta = wheelEvent.deltaY || -(wheelEvent.wheelDelta ?? 0) || wheelEvent.detail || 0
      setMessageFontSize((current) => {
        const next = clampChatMessageFontSize(current + (delta > 0 ? -1 : 1))
        if (next !== current) saveChatMessageFontSize(next)
        return next
      })
    }

    window.addEventListener('pointermove', handlePointerMove, { capture: true })
    window.addEventListener('mousemove', handlePointerMove, { capture: true })
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('keyup', handleKeyUp, { capture: true })
    window.addEventListener('blur', handleBlur)
    window.addEventListener('wheel', handleNativeWheel, { capture: true, passive: false })
    window.addEventListener('mousewheel', handleNativeWheel, { capture: true, passive: false })
    window.addEventListener('DOMMouseScroll', handleNativeWheel, { capture: true, passive: false })
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, { capture: true })
      window.removeEventListener('mousemove', handlePointerMove, { capture: true })
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      window.removeEventListener('keyup', handleKeyUp, { capture: true })
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('wheel', handleNativeWheel, { capture: true })
      window.removeEventListener('mousewheel', handleNativeWheel, { capture: true })
      window.removeEventListener('DOMMouseScroll', handleNativeWheel, { capture: true })
    }
  }, [])

  const canSend = useMemo(
    () => input.trim().length > 0 && !isStreaming && !isBootstrapping && (Boolean(activeChatId) || chats.length === 0),
    [activeChatId, chats.length, input, isBootstrapping, isStreaming],
  )
  const canUseVoiceInput = speechSupported && !isStreaming && !isBootstrapping
  const voiceButtonTitle = !speechSupported
    ? '当前环境不支持内置语音输入，可使用系统/豆包输入法'
    : isStreaming
      ? '回复中不能语音输入'
      : isListening
        ? '停止语音输入'
        : '开始语音输入'
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
  const messageFontStyle = {
    '--chat-message-font-size': `${messageFontSize}px`,
    '--chat-message-meta-font-size': `${clampChatMessageFontSize(messageFontSize - 3)}px`,
    '--chat-message-system-font-size': `${clampChatMessageFontSize(messageFontSize - 2)}px`,
  } as CSSProperties

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
    if (isStreaming) {
      await stopCurrentResponse()
      return
    }
    await sendCurrent()
  }

  async function stopCurrentResponse() {
    if (!isStreaming) return
    await cancelMessage().catch(() => undefined)
    if (!runningInTauri()) {
      setMessages((current) => {
        const next = [...current]
        const last = next[next.length - 1]
        if (last?.role === 'assistant' && last.streaming) {
          if (!last.content.trim()) return next.slice(0, -1)
          next[next.length - 1] = { ...last, streaming: false }
          return next
        }
        return current
      })
    }
    setIsStreaming(false)
    setMotion('idle')
  }

  function stopVoiceInput() {
    speechStartingRef.current = false
    speechRecognitionRef.current?.stop()
    setIsListening(false)
  }

  function startVoiceInput() {
    if (isStreaming || isBootstrapping) return
    const SpeechRecognition = getSpeechRecognitionConstructor()
    if (!SpeechRecognition) {
      setSpeechSupported(false)
      setRelationshipNotice('当前环境不支持内置语音输入，可使用系统/豆包输入法')
      window.setTimeout(() => setRelationshipNotice(''), 3200)
      return
    }

    speechRecognitionRef.current?.abort()
    const recognition = new SpeechRecognition()
    speechRecognitionRef.current = recognition
    speechStartingRef.current = true
    recognition.lang = 'zh-CN'
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.onresult = (event) => {
      let finalText = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const transcript = result[0]?.transcript ?? ''
        if (result.isFinal) finalText += transcript
      }
      if (finalText.trim()) {
        setInput((current) => appendSpeechText(current, finalText))
      }
    }
    recognition.onerror = (event) => {
      const reason = event.message || event.error || '语音输入失败'
      setRelationshipNotice(reason === 'not-allowed' ? '麦克风权限被拒绝' : `语音输入失败：${reason}`)
      window.setTimeout(() => setRelationshipNotice(''), 3000)
    }
    recognition.onend = () => {
      speechStartingRef.current = false
      setIsListening(false)
      if (speechRecognitionRef.current === recognition) {
        speechRecognitionRef.current = null
      }
    }

    try {
      recognition.start()
      setIsListening(true)
    } catch (error) {
      speechStartingRef.current = false
      setIsListening(false)
      speechRecognitionRef.current = null
      setRelationshipNotice(`语音输入启动失败：${String(error)}`)
      window.setTimeout(() => setRelationshipNotice(''), 3000)
    }
  }

  function toggleVoiceInput() {
    if (isListening || speechStartingRef.current) {
      stopVoiceInput()
      return
    }
    startVoiceInput()
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
    const userCreatedAt = nowStamp()
    setMessages((current) => [
      ...current,
      {
        id: makeId(),
        role: 'user',
        content,
        tokenCount: estimateTokenCount(content),
        tokenSource: 'estimate',
        createdAt: userCreatedAt,
      },
      { id: makeId(), role: 'assistant', content: '', streaming: true },
    ])

    try {
      const previewReply = await sendMessage(content, {
        model: activeProviderId === 'deepseek' ? settings.model : undefined,
        chatId: activeChatId || undefined,
        characterId: activeCharacterId || undefined,
        presetId: activePresetId || undefined,
        providerId: activeProviderId || undefined,
        clientNow: `${formatLocalDateTime(userCreatedAt)} ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
        userCreatedAt,
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
              createdAt: nowStamp(),
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
              createdAt: nowStamp(),
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

  async function markMessageMemory(message: ChatMessage, archived = false) {
    const content = message.content.trim()
    if (!content || message.streaming) return
    try {
      await saveMemoryCard({
        id: '',
        scope: activeChatId ? 'chat' : 'character',
        characterId: activeCharacterId || null,
        chatId: activeChatId || null,
        type: 'note',
        content: archived ? `不要把这句作为长期记忆：${content}` : content,
        importance: archived ? 1 : 6,
        confidence: 1,
        status: archived ? 'archived' : 'active',
        sourceMessageIds: [message.id],
        createdAt: '',
        updatedAt: '',
        lastUsedAt: '',
      })
      setRelationshipNotice(archived ? '这句已标记为不自动记忆' : '已记住这句')
    } catch (error) {
      setRelationshipNotice(String(error))
    }
    window.setTimeout(() => setRelationshipNotice(''), 2200)
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

      <div
        ref={messagesRef}
        className={`messages ${showTokenStats ? 'messages--token-stats' : ''}`}
        style={messageFontStyle}
        aria-live="polite"
      >
        {messages.map((message) => {
          const speaker = speakerForMessage(message)
          const metaLabel = message.content.trim() ? messageMetaLabel(message, showTokenStats, showMessageTimes) : ''
          return (
            <div
              key={message.id}
              className={`message-row message-row--${message.role} ${message.compacted ? 'message-row--compacted' : ''}`}
            >
              {message.role !== 'system' && (
                <AvatarBadge name={speaker.name} avatar={speaker.avatar} className="message-avatar" />
              )}
              <div className={`message message--${message.role}`}>
                {message.content}
                {message.streaming && <span className="caret" />}
                {metaLabel && <small className="message-token-count">{metaLabel}</small>}
                {message.role !== 'system' && message.content.trim() && !message.streaming && (
                  <div className="message-memory-actions" data-no-window-drag="true">
                    <button type="button" title="记住这句" onClick={() => void markMessageMemory(message)}>
                      <Brain size={12} />
                    </button>
                    <button type="button" title="不要记这句" onClick={() => void markMessageMemory(message, true)}>
                      <Ban size={12} />
                    </button>
                  </div>
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
            <span>{cacheStatsLabel(lastCacheStats)}</span>
          </div>
        )}
        <form className="composer" onSubmit={submit}>
          <textarea
            value={input}
            maxLength={1200}
            placeholder={isListening ? '正在听…' : '和鲸灵说点什么...'}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (!isStreaming) void sendCurrent()
              }
            }}
          />
          <div className="send-stack">
            <button className="primary-button" type="submit" disabled={isStreaming ? false : !canSend} title={isStreaming ? '停止生成' : '发送'}>
              {isStreaming ? <Square size={15} /> : <Send size={17} />}
            </button>
            <button
              className={isListening ? 'secondary-button voice-button--on' : 'secondary-button'}
              type="button"
              disabled={!canUseVoiceInput && !isListening}
              title={voiceButtonTitle}
              onClick={toggleVoiceInput}
            >
              <Mic size={15} />
            </button>
          </div>
        </form>
      </div>

      <SettingsPanel
        settings={settings}
        ttsSettings={ttsSettings}
        voices={voices}
        providers={providers}
        activeProviderId={activeProviderId}
        onClear={clearAll}
        onProviderChange={(providerId) => updateActiveChatSettings({ providerId })}
        onSettingsChange={(next) => {
          setSettings(next)
          void updateSettings(next).then(setSettings).catch(() => undefined)
        }}
        onTtsSettingsChange={setTtsSettings}
      />
    </>
  )
}
