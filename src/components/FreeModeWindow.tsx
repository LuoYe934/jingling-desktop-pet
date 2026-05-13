import { Eye, Heart, Minus, Search, Send, Sparkles, Square, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { avatarImageSrc } from '../lib/avatar'
import { getDistinctSpeechVoices, speakSentenceQueue, stopSpeech } from '../lib/speech'
import { formatLocalDateTime, nowStamp } from '../lib/time'
import {
  cancelMessage,
  getActiveWindowContext,
  hideCurrentWindow,
  listenToChatEvents,
  listCharacters,
  openBrowserSearch,
  saveMemoryCard,
  sendMessage,
  startWindowDrag,
} from '../lib/tauri'
import { usePetStore } from '../stores/petStore'
import type { ChatMessage, TavernCharacter } from '../types/tauri'

const freeModeChatIdStorageKey = 'jingling-free-mode-chat-id'

function makeId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function readFreeModeChatId() {
  try {
    return window.localStorage.getItem(freeModeChatIdStorageKey) || ''
  } catch {
    return ''
  }
}

function saveFreeModeChatId(chatId: string) {
  if (!chatId) return
  try {
    window.localStorage.setItem(freeModeChatIdStorageKey, chatId)
  } catch {
    // Local storage may be unavailable in locked-down WebViews.
  }
}

function isMemoryHint(text: string) {
  return /记住|我喜欢|我不喜欢|以后|偏好|不要忘|别忘/.test(text)
}

function isInteractiveTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  if (!element) return false
  return Boolean(element.closest('button, input, textarea, select, option, a, [role="button"], [data-no-window-drag="true"]'))
}

export function FreeModeWindow() {
  const [characters, setCharacters] = useState<TavernCharacter[]>([])
  const [activeCharacterId, setActiveCharacterId] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'welcome', role: 'assistant', content: '我在桌面边上。你可以直接问，也可以让我看看当前窗口。' },
  ])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState('自由模式 QA')
  const [activeWindowLabel, setActiveWindowLabel] = useState('')
  const [chatId, setChatId] = useState(readFreeModeChatId)
  const [isStreaming, setIsStreaming] = useState(false)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const requestIdRef = useRef('')
  const currentReplyRef = useRef('')
  const ttsSettings = usePetStore((state) => state.ttsSettings)
  const setTtsSettings = usePetStore((state) => state.setTtsSettings)
  const activeCharacter = useMemo(
    () => characters.find((character) => character.id === activeCharacterId) ?? characters.find((character) => character.enabled) ?? characters[0],
    [activeCharacterId, characters],
  )
  const portraitSrc = avatarImageSrc(activeCharacter?.avatar) || '/assets/jingling-placeholder.png'
  const VoiceIcon = ttsSettings.enabled ? Volume2 : VolumeX

  useEffect(() => {
    listCharacters()
      .then((items) => {
        setCharacters(items)
        setActiveCharacterId(items.find((item) => item.enabled)?.id || items[0]?.id || '')
      })
      .catch((error) => setStatus(String(error)))
  }, [])

  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const loadVoices = () => setVoices(getDistinctSpeechVoices(window.speechSynthesis.getVoices()))
    loadVoices()
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices)
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices)
      stopSpeech()
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    listenToChatEvents({
      onChunk: ({ content, eventScope = 'chat', requestId }) => {
        if (eventScope !== 'free-mode' || requestId !== requestIdRef.current) return
        currentReplyRef.current += content
        setIsStreaming(true)
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
      onDone: ({ content, chatId: nextChatId, eventScope = 'chat', requestId, cancelled }) => {
        if (eventScope !== 'free-mode' || requestId !== requestIdRef.current) return
        setIsStreaming(false)
        if (nextChatId) {
          setChatId(nextChatId)
          saveFreeModeChatId(nextChatId)
        }
        const finalContent = content || currentReplyRef.current
        setMessages((current) => {
          const next = [...current]
          const last = next[next.length - 1]
          if (last?.role === 'assistant' && last.streaming) {
            next[next.length - 1] = { ...last, content: finalContent, streaming: false, createdAt: nowStamp() }
            return next
          }
          return finalContent ? [...next, { id: makeId(), role: 'assistant', content: finalContent, createdAt: nowStamp() }] : next
        })
        setStatus(cancelled ? '已停止' : '回复完成')
        if (!cancelled && finalContent.trim()) {
          void speakSentenceQueue(finalContent, ttsSettings, voices)
        }
        currentReplyRef.current = ''
      },
      onError: ({ message, eventScope = 'chat', requestId }) => {
        if (eventScope !== 'free-mode' || requestId !== requestIdRef.current) return
        setIsStreaming(false)
        setStatus(message)
        setMessages((current) => [...current.filter((item) => !item.streaming), { id: makeId(), role: 'system', content: message }])
      },
    }).then((unlisten) => {
      if (disposed) {
        unlisten()
        return
      }
      cleanup = unlisten
    }).catch((error) => setStatus(String(error)))
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [ttsSettings, voices])

  async function rememberPreference(text: string) {
    const content = text.trim()
    if (!content || !activeCharacter?.id) return
    try {
      await saveMemoryCard({
        id: '',
        scope: 'character',
        characterId: activeCharacter.id,
        chatId: chatId || null,
        type: 'preference',
        content,
        importance: 7,
        confidence: 0.85,
        status: 'active',
        sourceMessageIds: [],
        createdAt: '',
        updatedAt: '',
        lastUsedAt: '',
      })
      setStatus('已记住这个偏好')
    } catch (error) {
      setStatus(String(error))
    }
  }

  async function inspectActiveWindow() {
    try {
      const context = await getActiveWindowContext()
      const label = [context.processName, context.title].filter(Boolean).join(' - ') || '当前窗口暂时没有标题'
      setActiveWindowLabel(label)
      setInput((current) => {
        const prefix = `我当前窗口是：${label}。`
        return current.trim() ? `${prefix}\n${current}` : `${prefix}\n你能根据这个判断我在做什么，并给一点建议吗？`
      })
      setStatus('已读取当前窗口标题')
    } catch (error) {
      setStatus(String(error))
    }
  }

  async function searchInput() {
    const query = input.trim() || activeWindowLabel
    if (!query) {
      setStatus('先输入要搜索的内容')
      return
    }
    await openBrowserSearch(query)
    setStatus('已打开浏览器搜索')
  }

  async function stopCurrentResponse() {
    await cancelMessage().catch(() => undefined)
    setIsStreaming(false)
    stopSpeech()
    setStatus('已停止')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (isStreaming) {
      await stopCurrentResponse()
      return
    }
    const content = input.trim()
    if (!content) return
    const requestId = makeId()
    requestIdRef.current = requestId
    currentReplyRef.current = ''
    setInput('')
    setIsStreaming(true)
    setStatus(isMemoryHint(content) ? '我会顺手记住这个偏好' : '思考中')
    setMessages((current) => [
      ...current,
      { id: makeId(), role: 'user', content, createdAt: nowStamp() },
      { id: makeId(), role: 'assistant', content: '', streaming: true },
    ])
    if (isMemoryHint(content)) void rememberPreference(content)

    const modePrompt = [
      '【自由模式】你现在是一个轻量桌面 AI 助手，有角色形象，会陪用户工作。',
      '回复要短、自然、低打扰。可以根据用户提供的当前窗口标题推断他在做什么，但不要假装已经读取屏幕截图。',
      content,
    ].join('\n')

    await sendMessage(modePrompt, {
      chatId: chatId || undefined,
      characterId: activeCharacter?.id,
      providerId: activeCharacter?.defaultProviderId || undefined,
      clientNow: `${formatLocalDateTime()} ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
      userCreatedAt: nowStamp(),
      eventScope: 'free-mode',
      requestId,
    }).catch((error) => {
      setIsStreaming(false)
      setStatus(String(error))
      setMessages((current) => [...current.filter((item) => !item.streaming), { id: makeId(), role: 'system', content: String(error) }])
    })
  }

  return (
    <section className="free-mode-window">
      <div
        className="free-mode-stage"
        onPointerDown={(event) => {
          if (event.button !== 0 || isInteractiveTarget(event.target)) return
          void startWindowDrag()
        }}
      >
        <header className="free-mode-toolbar" data-no-window-drag="true">
          <select value={activeCharacterId} onChange={(event) => setActiveCharacterId(event.target.value)} title="角色">
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </select>
          <span>{status}</span>
          <button type="button" title={ttsSettings.enabled ? '关闭语音' : '开启语音'} onClick={() => setTtsSettings({ ...ttsSettings, enabled: !ttsSettings.enabled })}>
            <VoiceIcon size={16} />
          </button>
          <button type="button" title="隐藏" onClick={() => void hideCurrentWindow()}>
            <Minus size={16} />
          </button>
        </header>

        <div className="free-mode-portrait-wrap">
          <img className="free-mode-portrait" src={portraitSrc} alt="" />
        </div>

        <div className="free-mode-dialog" data-no-window-drag="true">
          <div className="free-mode-bubble">
            {messages.slice(-3).map((message) => (
              <p key={message.id} className={`free-mode-message free-mode-message--${message.role}`}>
                {message.content}
                {message.streaming && <span className="caret" />}
              </p>
            ))}
          </div>
          <form className="free-mode-composer" onSubmit={submit}>
            <textarea
              value={input}
              placeholder="直接问我，或者让我看看当前窗口..."
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submit(event)
                }
              }}
            />
            <div className="free-mode-actions">
              <button type="button" title="读取当前窗口标题" onClick={() => void inspectActiveWindow()}>
                <Eye size={16} />
              </button>
              <button type="button" title="浏览器搜索" onClick={() => void searchInput()}>
                <Search size={16} />
              </button>
              <button type="button" title="记住输入内容" onClick={() => void rememberPreference(input)}>
                <Heart size={16} />
              </button>
              <button className="free-mode-primary" type="submit" title={isStreaming ? '停止' : '发送'}>
                {isStreaming ? <Square size={16} /> : <Send size={16} />}
              </button>
            </div>
          </form>
          <small>
            <Sparkles size={13} />
            {activeWindowLabel || '当前版本读取窗口标题；截图/OCR/MCP 读屏留给下一版。'}
          </small>
        </div>
      </div>
    </section>
  )
}
