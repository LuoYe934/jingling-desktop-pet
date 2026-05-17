import { ChevronRight, Minus, Send, SkipForward, Square, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { avatarImageSrc, localMediaSrc } from '../lib/avatar'
import { getDistinctSpeechVoices, speakQuotedDialogueQueue, stopSpeech } from '../lib/speech'
import { formatLocalDateTime, nowStamp } from '../lib/time'
import {
  cancelMessage,
  hideCurrentWindow,
  listenToChatEvents,
  listCharacters,
  sendMessage,
  startWindowDrag,
} from '../lib/tauri'
import { usePetStore } from '../stores/petStore'
import type { TavernCharacter } from '../types/tauri'
import { GenieVoiceSelect } from './GenieVoiceSelect'

const storyModeChatIdStorageKey = 'jingling-story-mode-chat-id'

interface StoryChoice {
  id?: string
  label: string
  prompt?: string
}

interface StoryFrame {
  text: string
  speaker?: string
  background?: string
  sprite?: string
  expression?: string
  spriteId?: string
  expressionId?: string
  sceneId?: string
  bgmId?: string
  sfx?: string
  bgm?: string
  mood?: string
}

interface StoryPayload {
  frames: StoryFrame[]
  choices: StoryChoice[]
  parseError?: string
}

function makeId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function readStoryModeChatId() {
  try {
    return window.localStorage.getItem(storyModeChatIdStorageKey) || ''
  } catch {
    return ''
  }
}

function saveStoryModeChatId(chatId: string) {
  if (!chatId) return
  try {
    window.localStorage.setItem(storyModeChatIdStorageKey, chatId)
  } catch {
    // Local storage may be unavailable in locked-down WebViews.
  }
}

function firstJsonObject(text: string) {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  return ''
}

function normalizeChoices(raw: unknown): StoryChoice[] {
  return Array.isArray(raw)
    ? raw
        .map<StoryChoice | null>((choice, index) => {
          if (typeof choice === 'string') return { id: `choice-${index}`, label: choice, prompt: choice }
          if (!choice || typeof choice !== 'object') return null
          const item = choice as Record<string, unknown>
          const label = typeof item.label === 'string' ? item.label : typeof item.text === 'string' ? item.text : ''
          if (!label.trim()) return null
          return {
            id: typeof item.id === 'string' ? item.id : `choice-${index}`,
            label,
            prompt: typeof item.prompt === 'string' ? item.prompt : label,
          }
        })
        .filter((choice): choice is StoryChoice => choice !== null)
    : []
}

function normalizeStoryFrame(raw: unknown, fallbackText: string): StoryFrame {
  if (!raw || typeof raw !== 'object') return { text: fallbackText }
  const data = raw as Record<string, unknown>
  return {
    text: typeof data.text === 'string' && data.text.trim() ? data.text : fallbackText,
    speaker: typeof data.speaker === 'string' ? data.speaker : undefined,
    background: typeof data.background === 'string' ? data.background : undefined,
    sprite: typeof data.sprite === 'string' ? data.sprite : undefined,
    expression: typeof data.expression === 'string' ? data.expression : undefined,
    spriteId: typeof data.spriteId === 'string' ? data.spriteId : undefined,
    expressionId: typeof data.expressionId === 'string' ? data.expressionId : undefined,
    sceneId: typeof data.sceneId === 'string' ? data.sceneId : undefined,
    bgmId: typeof data.bgmId === 'string' ? data.bgmId : undefined,
    sfx: typeof data.sfx === 'string' ? data.sfx : undefined,
    bgm: typeof data.bgm === 'string' ? data.bgm : undefined,
    mood: typeof data.mood === 'string' ? data.mood : undefined,
  }
}

function parseStoryPayload(text: string): StoryPayload {
  const json = firstJsonObject(text)
  if (!json) return { frames: [{ speaker: '系统', text }], choices: [], parseError: '未解析到 JSON，已显示原文。' }
  try {
    const parsed = JSON.parse(json) as unknown
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).frames)) {
      const data = parsed as Record<string, unknown>
      const frames = (data.frames as unknown[])
        .map((item) => normalizeStoryFrame(item, text))
        .filter((item) => item.text.trim())
      return {
        frames: frames.length ? frames : [{ text }],
        choices: normalizeChoices(data.choices),
      }
    }
    return {
      frames: [normalizeStoryFrame(parsed, text)],
      choices: normalizeChoices((parsed as Record<string, unknown>)?.choices),
    }
  } catch {
    return { frames: [{ speaker: '系统', text }], choices: [], parseError: 'JSON 解析失败，已显示原文。' }
  }
}

function storyBackground(background?: string) {
  if (!background) return 'linear-gradient(135deg, #182033, #314450 48%, #18211c)'
  if (/^(https?:|data:|blob:|asset:|\/)/i.test(background)) return `url("${background}")`
  if (/^[a-z]:[\\/]/i.test(background)) return `url("${localMediaSrc(background)}")`
  if (background.includes('class') || background.includes('教室')) {
    return 'linear-gradient(135deg, #23324f, #6d817c 52%, #e8b66f)'
  }
  if (background.includes('court') || background.includes('审判')) {
    return 'linear-gradient(135deg, #171923, #3c3145 50%, #8a6242)'
  }
  return 'linear-gradient(135deg, #182033, #314450 48%, #18211c)'
}

function isInteractiveTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  if (!element) return false
  return Boolean(element.closest('button, input, textarea, select, option, a, [role="button"], [data-no-window-drag="true"]'))
}

export function StoryModeWindow() {
  const [characters, setCharacters] = useState<TavernCharacter[]>([])
  const [activeCharacterId, setActiveCharacterId] = useState('')
  const [chatId, setChatId] = useState(readStoryModeChatId)
  const [input, setInput] = useState('')
  const [status, setStatus] = useState('剧情模式 QA')
  const [isStreaming, setIsStreaming] = useState(false)
  const [rawReply, setRawReply] = useState('')
  const [frames, setFrames] = useState<StoryFrame[]>([
    {
      speaker: '旁白',
      text: '选择一个开场，或直接输入行动。AI 会返回多帧 JSON，用来驱动画面、表情、背景和 BGM。',
      mood: '开场',
    },
  ])
  const [frameIndex, setFrameIndex] = useState(0)
  const [choices, setChoices] = useState<StoryChoice[]>([
    { id: 'start-school', label: '从教室醒来', prompt: '我在陌生教室里醒来，观察四周并和角色对话。' },
    { id: 'start-trial', label: '进入审判庭', prompt: '我走进昏暗的审判庭，请角色引导下一幕。' },
  ])
  const [parseError, setParseError] = useState('')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const requestIdRef = useRef('')
  const replyBufferRef = useRef('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const ttsSettings = usePetStore((state) => state.ttsSettings)
  const setTtsSettings = usePetStore((state) => state.setTtsSettings)
  const activeCharacter = useMemo(
    () => characters.find((character) => character.id === activeCharacterId) ?? characters.find((character) => character.enabled) ?? characters[0],
    [activeCharacterId, characters],
  )
  const frame = frames[Math.min(frameIndex, Math.max(frames.length - 1, 0))] ?? { text: '' }
  const stageConfig = activeCharacter?.stageConfig
  const activeScene = stageConfig?.scenes.find((scene) => scene.id === frame.sceneId) ?? stageConfig?.scenes.find((scene) => scene.id === stageConfig.defaultSceneId)
  const activeExpression =
    stageConfig?.expressions.find((expression) => expression.id === frame.expressionId) ??
    stageConfig?.expressions.find((expression) => expression.id === stageConfig.defaultExpressionId)
  const activeSprite =
    stageConfig?.sprites.find((sprite) => sprite.id === frame.spriteId) ??
    stageConfig?.sprites.find((sprite) => sprite.id === activeExpression?.spriteId) ??
    stageConfig?.sprites[0]
  const activeBgm = stageConfig?.bgms.find((bgm) => bgm.id === frame.bgmId)
  const backgroundValue = activeScene?.background || frame.background || ''
  const spriteSrc = localMediaSrc(frame.sprite || activeSprite?.image) || avatarImageSrc(activeCharacter?.avatar) || '/assets/builtin-cards/risu-hot-nelly.png'
  const bgmSrc = localMediaSrc(activeBgm?.audio || frame.bgm)
  const VoiceIcon = ttsSettings.enabled ? Volume2 : VolumeX

  function toggleTts() {
    if (ttsSettings.enabled) {
      stopSpeech()
    }
    setTtsSettings({ ...ttsSettings, enabled: !ttsSettings.enabled })
  }

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
    const audio = audioRef.current
    if (!audio) return
    if (!bgmSrc) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      return
    }
    if (audio.src !== bgmSrc) {
      audio.src = bgmSrc
    }
    audio.loop = true
    audio.volume = 0.42
    audio.play().catch(() => undefined)
  }, [bgmSrc])

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    listenToChatEvents({
      onChunk: ({ content, eventScope = 'chat', requestId }) => {
        if (eventScope !== 'story-mode' || requestId !== requestIdRef.current) return
        replyBufferRef.current += content
        setRawReply(replyBufferRef.current)
        setIsStreaming(true)
      },
      onDone: ({ content, chatId: nextChatId, eventScope = 'chat', requestId, cancelled }) => {
        if (eventScope !== 'story-mode' || requestId !== requestIdRef.current) return
        setIsStreaming(false)
        if (nextChatId) {
          setChatId(nextChatId)
          saveStoryModeChatId(nextChatId)
        }
        const finalContent = content || replyBufferRef.current
        const payload = parseStoryPayload(finalContent)
        setFrames(payload.frames)
        setFrameIndex(0)
        setChoices(payload.choices)
        setParseError(payload.parseError || '')
        setRawReply('')
        const firstFrame = payload.frames[0]
        const frameStatus = [firstFrame?.mood, firstFrame?.sfx, firstFrame?.bgmId || firstFrame?.bgm].filter(Boolean).join(' / ')
        setStatus(cancelled ? '已停止' : payload.parseError || frameStatus || '剧情已推进')
        if (cancelled) {
          stopSpeech()
        } else if (firstFrame?.text.trim()) {
          void speakQuotedDialogueQueue(firstFrame.text, ttsSettings, voices).catch(() => undefined)
        }
      },
      onError: ({ message, eventScope = 'chat', requestId }) => {
        if (eventScope !== 'story-mode' || requestId !== requestIdRef.current) return
        stopSpeech()
        setIsStreaming(false)
        setStatus(message)
        setFrames([{ speaker: '系统', text: message }])
        setFrameIndex(0)
        setChoices([])
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

  async function stopCurrentResponse() {
    await cancelMessage().catch(() => undefined)
    setIsStreaming(false)
    stopSpeech()
    setStatus('已停止')
  }

  async function advance(promptText: string) {
    const content = promptText.trim()
    if (!content || isStreaming) return
    const requestId = makeId()
    requestIdRef.current = requestId
    replyBufferRef.current = ''
    setRawReply('')
    setIsStreaming(true)
    setParseError('')
    setStatus('生成剧情 JSON 中...')

    await sendMessage(content, {
      chatId: chatId || undefined,
      characterId: activeCharacter?.id,
      providerId: activeCharacter?.defaultProviderId || undefined,
      clientNow: `${formatLocalDateTime()} ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
      userCreatedAt: nowStamp(),
      eventScope: 'story-mode',
      requestId,
    }).catch((error) => {
      stopSpeech()
      setIsStreaming(false)
      setStatus(String(error))
      setFrames([{ speaker: '系统', text: String(error) }])
      setFrameIndex(0)
      setChoices([])
    })
  }

  function nextFrame() {
    setFrameIndex((current) => {
      const next = Math.min(current + 1, frames.length - 1)
      const target = frames[next]
      if (target?.text.trim()) void speakQuotedDialogueQueue(target.text, ttsSettings, voices).catch(() => undefined)
      return next
    })
  }


  function submit(event: FormEvent) {
    event.preventDefault()
    if (isStreaming) {
      void stopCurrentResponse()
      return
    }
    const content = input.trim()
    if (!content) return
    setInput('')
    void advance(content)
  }

  return (
    <section className="story-mode-window">
      <div
        className="story-stage"
        style={{ backgroundImage: storyBackground(backgroundValue) }}
        onPointerDown={(event) => {
          if (event.button !== 0 || isInteractiveTarget(event.target)) return
          void startWindowDrag()
        }}
      >
        <audio ref={audioRef} aria-hidden="true" />
        <header className="story-toolbar" data-no-window-drag="true">
          <select value={activeCharacterId} onChange={(event) => setActiveCharacterId(event.target.value)} title="角色">
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </select>
          <GenieVoiceSelect settings={ttsSettings} onChange={setTtsSettings} compact />
          <span>{status}</span>
          <button
            type="button"
            title={ttsSettings.enabled ? '关闭引号对白朗读' : '开启引号对白朗读'}
            onClick={toggleTts}
          >
            <VoiceIcon size={16} />
          </button>
          <button type="button" title="隐藏" onClick={() => void hideCurrentWindow()}>
            <Minus size={16} />
          </button>
        </header>

        <div className="story-character-layer">
          <img className={`story-sprite story-sprite--${frame.expressionId || frame.expression || 'neutral'}`} src={spriteSrc} alt="" />
        </div>

        <div className="story-dialogue" data-no-window-drag="true">
          <div className="story-dialogue-head">
            <strong>{frame.speaker || activeCharacter?.name || '鲸灵'}</strong>
            <span>
              {activeScene?.name || frame.sceneId || frame.background || '默认舞台'}
              {activeExpression?.name || frame.expressionId || frame.expression ? ` / ${activeExpression?.name || frame.expressionId || frame.expression}` : ''}
              {activeBgm?.name || frame.bgmId ? ` / ${activeBgm?.name || frame.bgmId}` : ''}
              {frames.length > 1 ? ` / ${frameIndex + 1}-${frames.length}` : ''}
            </span>
          </div>
          <p>
            {isStreaming ? rawReply || '生成中...' : frame.text}
            {isStreaming && <span className="caret" />}
          </p>
          {parseError && !isStreaming && <small className="story-parse-error">{parseError}</small>}
          {frameIndex < frames.length - 1 && !isStreaming && (
            <button className="story-next-button" type="button" onClick={nextFrame}>
              <SkipForward size={15} />
              下一句
            </button>
          )}
          {Boolean(choices.length) && frameIndex >= frames.length - 1 && !isStreaming && (
            <div className="story-choices">
              {choices.map((choice, index) => (
                <button key={choice.id || `${choice.label}-${index}`} type="button" onClick={() => void advance(choice.prompt || choice.label)}>
                  <ChevronRight size={15} />
                  {choice.label}
                </button>
              ))}
            </div>
          )}
          <form className="story-composer" onSubmit={submit}>
            <input value={input} placeholder="输入行动，或继续推进剧情..." onChange={(event) => setInput(event.target.value)} />
            <button type="submit" title={isStreaming ? '停止生成' : '发送'}>
              {isStreaming ? <Square size={16} /> : <Send size={16} />}
            </button>
          </form>
        </div>
      </div>
    </section>
  )
}
