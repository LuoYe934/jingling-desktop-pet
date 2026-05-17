import { Heart, Mic, MicOff, Minus, Send, SlidersHorizontal, Sparkles, Square, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { avatarImageSrc, localMediaSrc } from '../lib/avatar'
import { applyGenieVoicePreset, findGenieVoicePreset } from '../lib/genieVoicePresets'
import { directFreeModeFrames } from '../lib/freeModeDirector'
import { createFreeModeFrameStreamParser, resolveFreeModeFrames } from '../lib/freeModeFrames'
import { createFreeModeWatchQueue } from '../lib/freeModeWatchQueue'
import type { FreeModeWatchSnapshot } from '../lib/freeModeWatchQueue'
import {
  currentSpeechQueueId,
  getDistinctSpeechVoices,
  playPreparedFreeModeFrameSpeech,
  prepareFreeModeFrameSpeech,
  stopSpeech,
} from '../lib/speech'
import type { PreparedFreeModeFrameSpeech } from '../lib/speech'
import { appendSpeechText, createSpeechRecognitionController } from '../lib/speechRecognition'
import { formatLocalDateTime, nowStamp } from '../lib/time'
import {
  cancelMessage,
  captureFreeModeContext,
  evaluateFreeModeWatchEvent,
  hideCurrentWindow,
  listenToChatEvents,
  listCharacters,
  saveMemoryCard,
  sendMessage,
  startWindowDrag,
} from '../lib/tauri'
import { usePetStore } from '../stores/petStore'
import type {
  ChatMessage,
  FreeModeAction,
  FreeModeChoice,
  FreeModeFrameEffect,
  FreeModeContextResult,
  FreeModePose,
  FreeModeWatchEvent,
  ResolvedFreeModeCue,
  ResolvedFreeModeFrame,
  ScreenContextResult,
  TavernCharacter,
} from '../types/tauri'
import { GenieVoiceSelect } from './GenieVoiceSelect'
import { FreeModeEnhancementPanel } from './FreeModeEnhancementPanel'

const freeModeChatIdStorageKey = 'jingling-free-mode-chat-id'
const typewriterIntervalMs = 9
const typewriterChunkSize = 2
const cuePauseMs = 70
const bgmVolume = 0.28
const preferredFreeModeCharacterId = 'builtin-character-kaelenyssa-arumorael'
const autoScreenContextTimeoutMs = 4_500
const cueAudioReadyTimeoutMs = 2_200
const watcherDecisionTimeoutMs = 18_000
const freeModeTtsTouchedStorageKey = 'jingling-free-mode-tts-touched'

type PerformanceState = 'idle' | 'generating' | 'playing' | 'waiting-choice'
type PreparedCueSpeechMap = Map<string, PreparedFreeModeFrameSpeech | null>

interface PendingFrameBatch {
  frames: ResolvedFreeModeFrame[]
  preparedSpeech: PreparedCueSpeechMap
}

interface ResolveFrameOptions {
  poses: FreeModePose[]
  scenes: NonNullable<TavernCharacter['stageConfig']>['scenes']
  bgms: NonNullable<TavernCharacter['stageConfig']>['bgms']
  cgs: NonNullable<NonNullable<TavernCharacter['freeModeStage']>['cgs']>
  defaultPoseId?: string
  currentPoseId?: string
  defaultSpeaker?: string
}

interface FreeModeStage {
  poseId: string
  effect: FreeModeFrameEffect
  action: FreeModeAction
  sceneId: string
  cgId: string
  bgmId: string
}

interface VisualContextSnapshot {
  screenContext: ScreenContextResult | null
  freeModeContext?: FreeModeContextResult | null
  requestedLook?: RequestedScreenLook
}

interface WatcherSnapshot {
  title: string
  processName: string
  text: string
  uiText: string
  imageHash: string
  capturedAt: string
  regionLabel: string
}

interface WatcherQueuedContext {
  event: FreeModeWatchEvent
  screenContext: ScreenContextResult
  freeModeContext: FreeModeContextResult
  visualContext: string
  requestedLook: RequestedScreenLook
}

interface SendFreeModeOptions {
  hiddenObservation?: boolean
  visualSnapshot?: VisualContextSnapshot
  statusText?: string
  skipPreference?: boolean
}

type ScreenCaptureRegionKind =
  | 'full'
  | 'active-window'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'mouse'

interface RequestedScreenLook {
  shouldCapture: boolean
  region: ScreenCaptureRegionKind
  label: string
  reason: string
}

function makeId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function hasFreeModeStage(character?: TavernCharacter) {
  return Boolean(character?.freeModeStage?.enabled && character.freeModeStage.poses.length)
}

function pickInitialFreeModeCharacter(items: TavernCharacter[]) {
  return (
    items.find((item) => item.id === preferredFreeModeCharacterId && hasFreeModeStage(item)) ??
    items.find((item) => item.enabled && hasFreeModeStage(item)) ??
    items.find((item) => item.enabled) ??
    items[0]
  )
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

function appendAssistantChunk(messages: ChatMessage[], chunk: string, speaker: string): ChatMessage[] {
  const next = [...messages]
  const last = next[next.length - 1]
  if (last?.role === 'assistant' && last.streaming) {
    next[next.length - 1] = { ...last, content: last.content + chunk, name: speaker || last.name }
    return next
  }
  return [...next, { id: makeId(), role: 'assistant', name: speaker || undefined, content: chunk, streaming: true }]
}

function replaceCurrentAssistant(messages: ChatMessage[], content: string, speaker: string, streaming = true): ChatMessage[] {
  const next = [...messages]
  const last = next[next.length - 1]
  if (last?.role === 'assistant') {
    next[next.length - 1] = { ...last, name: speaker || last.name, content, streaming }
    return next
  }
  return [...next, { id: makeId(), role: 'assistant', name: speaker || undefined, content, streaming }]
}

function finalizeCurrentAssistant(messages: ChatMessage[]): ChatMessage[] {
  const next = [...messages]
  const last = next[next.length - 1]
  if (last?.role === 'assistant') {
    next[next.length - 1] = { ...last, streaming: false, createdAt: nowStamp() }
  }
  return next
}

function wait(ms: number, requestId: string, requestIdRef: React.MutableRefObject<string>) {
  return new Promise<void>((resolve) => {
    if (ms <= 0 || requestIdRef.current !== requestId) {
      resolve()
      return
    }
    window.setTimeout(resolve, ms)
  })
}

function waitForCueStart(speechTask: Promise<boolean>, onStartPromise: Promise<void>, timeoutMs = 360) {
  return Promise.race([
    onStartPromise,
    speechTask.then(() => undefined).catch(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ])
}

function prepareFrameSpeech(frames: ResolvedFreeModeFrame[], settings: ReturnType<typeof usePetStore.getState>['ttsSettings'], voices: SpeechSynthesisVoice[]) {
  const preparedSpeech: PreparedCueSpeechMap = new Map()
  for (const frame of frames) {
    const cues = frame.cues.length ? frame.cues : []
    cues.forEach((cue, cueIndex) => {
      preparedSpeech.set(cue.id || `${frame.id}:cue-${cueIndex}`, prepareFreeModeFrameSpeech(cue.text, settings, voices))
    })
  }
  return preparedSpeech
}

function stageBackground(background?: string) {
  if (!background) return undefined
  if (/^(https?:|data:|blob:|asset:|\/)/i.test(background)) return `url("${background}")`
  if (/^[a-z]:[\\/]/i.test(background)) return `url("${localMediaSrc(background)}")`
  return background
}

function limitContextText(text: string, limit = 1600) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized
}

function isUsableVisionText(text: string) {
  const compact = text.replace(/\s+/g, '').trim()
  if (!compact) return false
  if (/^视觉服务(?:未调用|不可用|调用失败)/.test(text)) return false
  if (/LMStudiocouldnotreadthisscreenshot|无法识别(?:图片|图像|截图)?(?:中)?(?:的)?内容|无法判断图片内容|无法理解图片|无法读取图片|看不清(?:图片|截图|图像)?内容|不能识别(?:图片|图像|截图)?内容|识别不出来/.test(compact)) {
    return false
  }
  return true
}

function normalizeWatcherText(text: string, limit = 1800) {
  return text.replace(/\s+/g, ' ').trim().slice(0, limit)
}

function watcherTextChanged(previous: string, next: string, threshold = 24) {
  if (previous === next) return false
  if (!previous || !next) return Math.abs(previous.length - next.length) >= threshold
  if (Math.abs(previous.length - next.length) >= threshold) return true
  let changed = 0
  const limit = Math.min(Math.max(previous.length, next.length), 600)
  for (let index = 0; index < limit; index += 1) {
    if (previous[index] !== next[index]) changed += 1
    if (changed >= threshold) return true
  }
  return false
}

function watcherSnapshotFrom(context: FreeModeContextResult): WatcherSnapshot {
  return {
    title: context.screen.title || '',
    processName: context.screen.processName || '',
    text: normalizeWatcherText(context.screen.text || ''),
    uiText: normalizeWatcherText(context.uiText || ''),
    imageHash: context.screen.imageHash || '',
    capturedAt: context.screen.capturedAt || '',
    regionLabel: context.screen.regionLabel || context.screen.region || '',
  }
}

function watchQueueSnapshotFrom(context: FreeModeContextResult): FreeModeWatchSnapshot {
  return {
    title: context.screen.title || '',
    processName: context.screen.processName || '',
    ocrText: context.screen.text || '',
    uiText: context.uiText || '',
    visionText: context.visionText || '',
    imageHash: context.screen.imageHash || '',
    screenMotion: Boolean(context.screen.imageHash && !context.screen.text.trim()),
  }
}

function watcherChangeReason(previous: WatcherSnapshot | null, next: WatcherSnapshot) {
  if (!previous) return ''
  if (previous.processName !== next.processName || previous.title !== next.title) {
    return `窗口变化：${activeWindowLabelFrom(previous)} -> ${activeWindowLabelFrom(next)}`
  }
  if (watcherTextChanged(previous.text, next.text)) return 'OCR 文字有明显变化'
  if (watcherTextChanged(previous.uiText, next.uiText)) return 'UI 读屏文字有明显变化'
  if (!next.text && previous.imageHash && next.imageHash && previous.imageHash !== next.imageHash) return '截图画面变化'
  return ''
}

function watcherEventReason(event: FreeModeWatchEvent) {
  switch (event.type) {
    case 'window-change':
      return `窗口变化：${activeWindowLabelFrom(event, event.title)}`
    case 'ocr-change':
      return 'OCR 文字有明显变化'
    case 'ui-change':
      return 'UI 读屏文字有明显变化'
    case 'visual-change':
      return '视觉描述有明显变化'
    case 'screen-motion':
      return '截图画面变化'
    default:
      return event.summary || '屏幕变化'
  }
}

function pruneRecentTimes(items: number[], now: number, windowMs: number) {
  return items.filter((item) => now - item < windowMs)
}

function activeWindowLabelFrom(context: { processName?: string | null; title?: string | null }, fallback = '') {
  return [context.processName, context.title].filter(Boolean).join(' - ') || fallback
}

function screenContextStatusLabel(context: ScreenContextResult) {
  if (context.text.trim()) return 'OCR 已读取'
  if (context.imagePath) return '已截图，OCR 未读到文字'
  return context.message || '未读取到屏幕文字'
}

function freeModeContextStatusLabel(context: FreeModeContextResult) {
  const parts = [
    context.screen.regionLabel,
    context.screen.processName,
    context.screen.title,
    context.screen.text.trim() ? 'OCR 已读取' : '',
    context.visionText.trim() ? '视觉已返回' : '',
    context.toolText.trim() ? '工具已返回' : '',
  ].filter(Boolean)
  return parts.join(' / ') || context.message
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timeoutId: number | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timeoutId = window.setTimeout(() => resolve(undefined), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
  })
}

function detectRequestedScreenLook(text: string): RequestedScreenLook {
  const compact = text.replace(/\s+/g, '')
  const hasLookVerb = /看|看看|瞧|观察|扫|读|识别|辨认|盯|注意/.test(compact)
  const hasScreenTarget = /屏幕|画面|窗口|这里|这边|这个位置|那个位置|位置|鼠标|光标|左上|右上|左下|右下|左边|右边|上面|下面|中间|中央|当前/.test(compact)
  const shouldCapture = hasLookVerb && hasScreenTarget
  let region: ScreenCaptureRegionKind = 'full'

  if (/当前窗口|这个窗口|活动窗口/.test(compact)) {
    region = 'active-window'
  } else if (/左上|左上角/.test(compact)) {
    region = 'top-left'
  } else if (/右上|右上角/.test(compact)) {
    region = 'top-right'
  } else if (/左下|左下角/.test(compact)) {
    region = 'bottom-left'
  } else if (/右下|右下角/.test(compact)) {
    region = 'bottom-right'
  } else if (/中间|中央|正中/.test(compact)) {
    region = 'center'
  } else if (/鼠标|光标|这个位置|那个位置|这里|这边/.test(compact)) {
    region = 'mouse'
  } else if (/左边|左侧/.test(compact)) {
    region = 'left'
  } else if (/右边|右侧/.test(compact)) {
    region = 'right'
  } else if (/上面|上方|顶部/.test(compact)) {
    region = 'top'
  } else if (/下面|下方|底部/.test(compact)) {
    region = 'bottom'
  }

  return {
    shouldCapture,
    region,
    label: screenRegionLabel(region),
    reason: text.trim(),
  }
}

function screenRegionLabel(region: ScreenCaptureRegionKind) {
  switch (region) {
    case 'active-window':
      return '当前窗口'
    case 'top-left':
      return '屏幕左上角'
    case 'top-right':
      return '屏幕右上角'
    case 'bottom-left':
      return '屏幕左下角'
    case 'bottom-right':
      return '屏幕右下角'
    case 'center':
      return '屏幕中间'
    case 'left':
      return '屏幕左侧'
    case 'right':
      return '屏幕右侧'
    case 'top':
      return '屏幕上方'
    case 'bottom':
      return '屏幕下方'
    case 'mouse':
      return '鼠标附近'
    default:
      return '整个屏幕'
  }
}

function isLoopbackVisionUrl(url: string) {
  const value = url.trim().toLowerCase()
  return value.startsWith('http://127.0.0.1') || value.startsWith('http://localhost') || value.startsWith('http://[::1]')
}

function hasTouchedFreeModeTts() {
  try {
    return window.localStorage.getItem(freeModeTtsTouchedStorageKey) === 'true'
  } catch {
    return true
  }
}

function markFreeModeTtsTouched() {
  try {
    window.localStorage.setItem(freeModeTtsTouchedStorageKey, 'true')
  } catch {
    // Local storage may be unavailable in locked-down WebViews.
  }
}

export function FreeModeWindow() {
  const [characters, setCharacters] = useState<TavernCharacter[]>([])
  const [activeCharacterId, setActiveCharacterId] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'welcome', role: 'assistant', content: '我在桌面旁边。你可以直接问我，也可以让我看看当前窗口。' },
  ])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState('自由模式 QA')
  const [screenContext, setScreenContext] = useState<ScreenContextResult | null>(null)
  const [freeModeContext, setFreeModeContext] = useState<FreeModeContextResult | null>(null)
  const [enhancementOpen, setEnhancementOpen] = useState(false)
  const [chatId, setChatId] = useState(readFreeModeChatId)
  const [performanceState, setPerformanceState] = useState<PerformanceState>('idle')
  const [freeModeStage, setFreeModeStage] = useState<FreeModeStage>({
    poseId: '',
    effect: 'none',
    action: 'none',
    sceneId: '',
    cgId: '',
    bgmId: '',
  })
  const [choices, setChoices] = useState<FreeModeChoice[]>([])
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [isListening, setIsListening] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)
  const [isCapturingScreen, setIsCapturingScreen] = useState(false)
  const pendingScreenContextRef = useRef<{ key: string; promise: Promise<FreeModeContextResult> } | null>(null)
  const requestIdRef = useRef('')
  const rawReplyRef = useRef('')
  const streamedFrameParserRef = useRef(createFreeModeFrameStreamParser())
  const pendingFrameBatchesRef = useRef<PendingFrameBatch[]>([])
  const playbackRunningRef = useRef(false)
  const streamedFrameCountRef = useRef(0)
  const finalChoicesRef = useRef<FreeModeChoice[]>([])
  const streamDoneRef = useRef(false)
  const typewriterTimerRef = useRef<number | undefined>(undefined)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const shouldResumeAsrRef = useRef(false)
  const ttsSettingsRef = useRef(usePetStore.getState().ttsSettings)
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])
  const inputRef = useRef('')
  const performanceStateRef = useRef<PerformanceState>('idle')
  const choicesRef = useRef<FreeModeChoice[]>([])
  const watchQueueRef = useRef(createFreeModeWatchQueue())
  const lastWatcherSnapshotRef = useRef<WatcherSnapshot | null>(null)
  const lastWatcherVisionContextRef = useRef('')
  const lastWatcherResponseAtRef = useRef(0)
  const watcherVisionCallsRef = useRef<number[]>([])
  const watcherRunningRef = useRef(false)
  const watcherProcessingRef = useRef(false)
  const isCapturingScreenRef = useRef(false)
  const sendFreeModeMessageRef = useRef<((content: string, options?: SendFreeModeOptions) => Promise<void>) | null>(null)
  const resolveFrameOptionsRef = useRef<ResolveFrameOptions>({
    poses: [],
    scenes: [],
    bgms: [],
    cgs: [],
    defaultSpeaker: '自由模式',
  })
  const speechControllerRef = useRef<ReturnType<typeof createSpeechRecognitionController> | null>(null)
  const ttsSettings = usePetStore((state) => state.ttsSettings)
  const setTtsSettings = usePetStore((state) => state.setTtsSettings)
  const settings = usePetStore((state) => state.settings)
  const setSettings = usePetStore((state) => state.setSettings)
  const isBusy = performanceState === 'generating' || performanceState === 'playing'
  const activeCharacter = useMemo(
    () => characters.find((character) => character.id === activeCharacterId) ?? characters.find((character) => character.enabled) ?? characters[0],
    [activeCharacterId, characters],
  )
  const stageConfig = activeCharacter?.stageConfig
  const freeModeStageConfig = activeCharacter?.freeModeStage
  const stageEnabled = Boolean(freeModeStageConfig?.enabled && freeModeStageConfig.poses.length)
  const stagePoses = useMemo(() => freeModeStageConfig?.poses || [], [freeModeStageConfig?.poses])
  const stageCgs = useMemo(() => freeModeStageConfig?.cgs || [], [freeModeStageConfig?.cgs])
  const stageScenes = useMemo(() => stageConfig?.scenes || [], [stageConfig?.scenes])
  const stageBgms = useMemo(() => stageConfig?.bgms || [], [stageConfig?.bgms])
  const defaultPose =
    stagePoses.find((pose) => pose.id === freeModeStageConfig?.defaultPoseId) ?? stagePoses[0]
  const activePose =
    stagePoses.find((pose) => pose.id === freeModeStage.poseId) ??
    stagePoses.find((pose) => pose.id === defaultPose?.id)
  const activeScene =
    stageScenes.find((scene) => scene.id === freeModeStage.sceneId) ??
    stageScenes.find((scene) => scene.id === stageConfig?.defaultSceneId)
  const activeCg = stageCgs.find((cg) => cg.id === freeModeStage.cgId)
  const activeBgm = stageBgms.find((bgm) => bgm.id === freeModeStage.bgmId)
  const currentAssistantMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'assistant'),
    [messages],
  )
  const portraitSrc =
    (stageEnabled ? localMediaSrc(activePose?.image) : '') || avatarImageSrc(activeCharacter?.avatar) || '/assets/jingling-placeholder.png'
  const cgSrc = localMediaSrc(activeCg?.image)
  const bgmSrc = localMediaSrc(activeBgm?.audio)
  const poseStatus = activePose?.name || activePose?.id || ''
  const VoiceIcon = ttsSettings.enabled ? Volume2 : VolumeX
  const MicIcon = isListening ? MicOff : Mic
  const activeGeniePreset = ttsSettings.engine === 'genie' ? findGenieVoicePreset(ttsSettings.genie) : undefined
  const ttsStatusLabel = ttsSettings.enabled
    ? ttsSettings.engine === 'genie'
      ? `Genie ${activeGeniePreset?.label || '未选声'}`
      : ttsSettings.engine === 'piper'
        ? 'Piper 语音'
        : '系统语音'
    : '语音关'
  const voiceButtonTitle = ttsSettings.enabled
    ? `关闭同步语音（当前：${ttsStatusLabel}）`
    : '开启同步语音：自由模式会按演出分段播放 TTS'
  const toolbarVoiceButtonTitle = ttsSettings.enabled
    ? `顶部语音开关：关闭同步语音（当前：${ttsStatusLabel}）`
    : '顶部语音开关：开启同步语音'
  const screenContextSummary = screenContext
    ? freeModeContext
      ? freeModeContextStatusLabel(freeModeContext)
      : [screenContext.regionLabel, screenContext.processName, screenContext.title, screenContextStatusLabel(screenContext)].filter(Boolean).join(' / ')
    : ''

  const clearTypewriterTimer = useCallback(() => {
    if (typewriterTimerRef.current !== undefined) {
      window.clearTimeout(typewriterTimerRef.current)
      typewriterTimerRef.current = undefined
    }
  }, [])

  const pauseAsrForPlayback = useCallback(() => {
    const controller = speechControllerRef.current
    const wasListening = Boolean(controller?.isListening())
    if (wasListening) {
      controller?.stop()
    }
    shouldResumeAsrRef.current = wasListening
  }, [])

  const resumeAsrAfterPlayback = useCallback((manualStop = false) => {
    if (!manualStop && shouldResumeAsrRef.current) {
      window.setTimeout(() => speechControllerRef.current?.start(), 120)
    }
    shouldResumeAsrRef.current = false
  }, [])

  const cancelPerformance = useCallback((manualStop = true) => {
    requestIdRef.current = ''
    rawReplyRef.current = ''
    streamedFrameParserRef.current.reset()
    pendingFrameBatchesRef.current = []
    playbackRunningRef.current = false
    streamedFrameCountRef.current = 0
    finalChoicesRef.current = []
    streamDoneRef.current = false
    clearTypewriterTimer()
    stopSpeech()
    setMessages((current) => finalizeCurrentAssistant(current))
    setChoices([])
    setFreeModeStage((current) => ({
      ...current,
      effect: 'none',
      action: 'none',
      cgId: '',
      bgmId: manualStop ? '' : current.bgmId,
    }))
    setPerformanceState('idle')
    resumeAsrAfterPlayback(manualStop)
  }, [clearTypewriterTimer, resumeAsrAfterPlayback])

  const typeCue = useCallback(
    (cue: string, speaker: string, requestId: string) => {
      return new Promise<void>((resolve) => {
        let index = 0
        const tick = () => {
          if (requestIdRef.current !== requestId) {
            typewriterTimerRef.current = undefined
            resolve()
            return
          }
          const chunk = cue.slice(index, index + typewriterChunkSize)
          if (chunk) {
            setMessages((current) => appendAssistantChunk(current, chunk, speaker))
          }
          index += typewriterChunkSize
          if (index >= cue.length) {
            typewriterTimerRef.current = undefined
            resolve()
            return
          }
          typewriterTimerRef.current = window.setTimeout(tick, typewriterIntervalMs)
        }
        typewriterTimerRef.current = window.setTimeout(tick, typewriterIntervalMs)
      })
    },
    [],
  )

  const applyCueStage = useCallback((frame: ResolvedFreeModeFrame, cue: ResolvedFreeModeCue) => {
    setFreeModeStage((current) => ({
      poseId: cue.poseId || frame.poseId || current.poseId,
      effect: cue.effect || frame.effect || 'none',
      action: cue.action || frame.action || 'none',
      sceneId: cue.hasSceneDirective ? cue.sceneId ?? '' : frame.hasSceneDirective ? frame.sceneId ?? '' : current.sceneId,
      cgId: cue.hasCgDirective ? cue.cgId ?? '' : frame.hasCgDirective ? frame.cgId ?? '' : '',
      bgmId: cue.hasBgmDirective ? cue.bgmId ?? '' : frame.hasBgmDirective ? frame.bgmId ?? '' : current.bgmId,
    }))
  }, [])

  const playFrameBatch = useCallback(
    async (frames: ResolvedFreeModeFrame[], requestId: string, preparedSpeech: PreparedCueSpeechMap) => {
      const queueId = currentSpeechQueueId()
      for (const frame of frames) {
        if (requestIdRef.current !== requestId) return
        finalChoicesRef.current = frame.choices
        const speaker = frame.speaker || activeCharacter?.name || '自由模式'
        setMessages((current) => replaceCurrentAssistant(current, '', speaker, true))

        const cues = frame.cues.length
          ? frame.cues
          : frame.text
            ? [{
                id: `${frame.id}:cue-0`,
                text: frame.text,
                poseId: frame.poseId,
                effect: frame.effect,
                hasBgmDirective: frame.hasBgmDirective,
                ...(frame.bgmId ? { bgmId: frame.bgmId } : {}),
                hasSceneDirective: frame.hasSceneDirective,
                ...(frame.sceneId ? { sceneId: frame.sceneId } : {}),
                hasCgDirective: frame.hasCgDirective,
                ...(frame.cgId ? { cgId: frame.cgId } : {}),
                action: frame.action,
                pauseMs: cuePauseMs,
              }]
            : []
        for (const [cueIndex, cue] of cues.entries()) {
          if (requestIdRef.current !== requestId) return
          applyCueStage(frame, cue)
          const cueKey = cue.id || `${frame.id}:cue-${cueIndex}`
          const prepared = preparedSpeech.get(cueKey) ?? prepareFreeModeFrameSpeech(cue.text, ttsSettingsRef.current, voicesRef.current)
          setStatus(prepared ? '语音准备中' : '字幕播放中（语音关）')
          let speechStarted = false
          let notifyCueStarted: (() => void) | undefined
          const cueStarted = new Promise<void>((resolve) => {
            notifyCueStarted = () => {
              speechStarted = true
              setStatus('语音同步播放中')
              resolve()
            }
          })
          const speechTask = prepared
            ? playPreparedFreeModeFrameSpeech(prepared, { queueId, onStart: notifyCueStarted, audioReadyTimeoutMs: cueAudioReadyTimeoutMs }).catch(() => false)
            : Promise.resolve(false)
          await waitForCueStart(speechTask, cueStarted)
          if (requestIdRef.current !== requestId) return
          if (!speechStarted) {
            setStatus(prepared ? '语音不可用，继续字幕' : '字幕播放中（语音关）')
          }
          const typeTask = typeCue(cue.text, speaker, requestId)
          await Promise.all([speechTask, typeTask])
          await wait(cue.pauseMs ?? cuePauseMs, requestId, requestIdRef)
        }

        setMessages((current) => finalizeCurrentAssistant(current))
        await wait(120, requestId, requestIdRef)
      }
    },
    [activeCharacter?.name, applyCueStage, typeCue],
  )

  const drainFrameQueue = useCallback(
    async (requestId: string) => {
      if (playbackRunningRef.current || requestIdRef.current !== requestId) return
      playbackRunningRef.current = true
      setPerformanceState('playing')
      setChoices([])
      setStatus('演出播放中')

      try {
        while (requestIdRef.current === requestId) {
          const batch = pendingFrameBatchesRef.current.shift()
          if (!batch) break
          await playFrameBatch(batch.frames, requestId, batch.preparedSpeech)
        }
      } finally {
        playbackRunningRef.current = false
      }

      if (requestIdRef.current !== requestId) return
      if (!streamDoneRef.current) {
        setPerformanceState('generating')
        setStatus('继续生成演出帧中')
        return
      }

      rawReplyRef.current = ''
      requestIdRef.current = ''
      setChoices(finalChoicesRef.current)
      setPerformanceState(finalChoicesRef.current.length ? 'waiting-choice' : 'idle')
      setStatus(finalChoicesRef.current.length ? '等待选择' : '演出完成')
      resumeAsrAfterPlayback()
    },
    [playFrameBatch, resumeAsrAfterPlayback],
  )

  const enqueueFrames = useCallback(
    (frames: ResolvedFreeModeFrame[], requestId: string) => {
      if (!frames.length || requestIdRef.current !== requestId) return
      const directedFrames = directFreeModeFrames(frames, {
        poses: resolveFrameOptionsRef.current.poses,
        defaultPoseId: resolveFrameOptionsRef.current.defaultPoseId,
        currentPoseId: resolveFrameOptionsRef.current.currentPoseId,
      })
      const preparedSpeech = prepareFrameSpeech(directedFrames, ttsSettingsRef.current, voicesRef.current)
      pendingFrameBatchesRef.current.push({ frames: directedFrames, preparedSpeech })
      void drainFrameQueue(requestId)
    },
    [drainFrameQueue],
  )

  useEffect(() => {
    ttsSettingsRef.current = ttsSettings
  }, [ttsSettings])

  useEffect(() => {
    if (hasTouchedFreeModeTts()) return
    const currentSettings = usePetStore.getState().ttsSettings
    if (!currentSettings.enabled) {
      setTtsSettings(applyGenieVoicePreset(currentSettings, 'elysia'))
    }
  }, [setTtsSettings])

  useEffect(() => {
    voicesRef.current = voices
  }, [voices])

  useEffect(() => {
    inputRef.current = input
  }, [input])

  useEffect(() => {
    performanceStateRef.current = performanceState
  }, [performanceState])

  useEffect(() => {
    choicesRef.current = choices
  }, [choices])

  useEffect(() => {
    isCapturingScreenRef.current = isCapturingScreen
  }, [isCapturingScreen])

  useEffect(() => {
    resolveFrameOptionsRef.current = {
      poses: stagePoses,
      scenes: stageScenes,
      bgms: stageBgms,
      cgs: stageCgs,
      defaultPoseId: defaultPose?.id || stagePoses[0]?.id || '',
      currentPoseId: freeModeStage.poseId,
      defaultSpeaker: activeCharacter?.name || '自由模式',
    }
  }, [activeCharacter?.name, defaultPose?.id, freeModeStage.poseId, stageBgms, stageCgs, stagePoses, stageScenes])

  useEffect(() => {
    const fallbackPoseId = defaultPose?.id || ''
    setFreeModeStage((current) => ({
      ...current,
      poseId: current.poseId && stagePoses.some((pose) => pose.id === current.poseId) ? current.poseId : fallbackPoseId,
    }))
  }, [activeCharacter?.id, defaultPose?.id, stagePoses])

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
    audio.volume = bgmVolume
    audio.play().catch(() => undefined)
  }, [bgmSrc])

  useEffect(() => {
    const presetId = activeCharacter?.voiceProfile?.freeModeGeniePresetId
    if (!presetId) return
    const currentSettings = usePetStore.getState().ttsSettings
    const activePreset = currentSettings.engine === 'genie' ? findGenieVoicePreset(currentSettings.genie) : undefined
    if (activePreset?.id === presetId) return
    stopSpeech()
    setTtsSettings(applyGenieVoicePreset(currentSettings, presetId))
  }, [activeCharacter?.id, activeCharacter?.voiceProfile?.freeModeGeniePresetId, setTtsSettings])

  useEffect(() => {
    listCharacters()
      .then((items) => {
        setCharacters(items)
        setActiveCharacterId(pickInitialFreeModeCharacter(items)?.id || '')
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
      cancelPerformance(true)
    }
  }, [cancelPerformance])

  useEffect(() => {
    const controller = createSpeechRecognitionController({
      onFinalText: (text) => setInput((current) => appendSpeechText(current, text)),
      onListeningChange: setIsListening,
      onError: (message) => {
        setStatus(message)
        window.setTimeout(() => setStatus('自由模式 QA'), 3000)
      },
    })
    speechControllerRef.current = controller
    setSpeechSupported(controller.supported)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    listenToChatEvents({
      onChunk: ({ content, eventScope = 'chat', requestId }) => {
        if (eventScope !== 'free-mode' || requestId !== requestIdRef.current) return
        rawReplyRef.current += content
        const streamedFrames = streamedFrameParserRef.current.push(content)
        if (streamedFrames.length) {
          const frames = resolveFreeModeFrames({ frames: streamedFrames }, resolveFrameOptionsRef.current)
          streamedFrameCountRef.current += frames.length
          enqueueFrames(frames, requestId)
        }
        setPerformanceState('generating')
        setStatus(streamedFrameCountRef.current ? '边生成边播放' : '生成演出帧中')
      },
      onDone: ({ content, chatId: nextChatId, eventScope = 'chat', requestId, cancelled }) => {
        if (eventScope !== 'free-mode' || requestId !== requestIdRef.current) return
        if (nextChatId) {
          setChatId(nextChatId)
          saveFreeModeChatId(nextChatId)
        }

        const finalContent = content || rawReplyRef.current
        if (cancelled) {
          cancelPerformance(true)
          setStatus('已停止')
          if (finalContent.trim()) {
            const frames = resolveFreeModeFrames(finalContent, resolveFrameOptionsRef.current)
            const fallbackText = frames.map((frame) => frame.text).filter(Boolean).join('\n')
            setMessages((current) => replaceCurrentAssistant(current, fallbackText, resolveFrameOptionsRef.current.defaultSpeaker || '自由模式', false))
          }
          return
        }

        streamDoneRef.current = true
        const flushedFrames = streamedFrameParserRef.current.flush()
        if (flushedFrames.length) {
          const frames = resolveFreeModeFrames({ frames: flushedFrames }, resolveFrameOptionsRef.current)
          streamedFrameCountRef.current += frames.length
          enqueueFrames(frames, requestId)
        }

        if (!streamedFrameCountRef.current) {
          const frames = resolveFreeModeFrames(finalContent, resolveFrameOptionsRef.current)
          enqueueFrames(frames, requestId)
          if (frames.length) {
            void drainFrameQueue(requestId)
          } else if (requestIdRef.current === requestId) {
            requestIdRef.current = ''
            setPerformanceState('idle')
            setStatus('演出完成')
            resumeAsrAfterPlayback()
          }
          return
        }

        void drainFrameQueue(requestId)
      },
      onError: ({ message, eventScope = 'chat', requestId }) => {
        if (eventScope !== 'free-mode' || requestId !== requestIdRef.current) return
        cancelPerformance(true)
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
      clearTypewriterTimer()
      cleanup?.()
    }
  }, [cancelPerformance, clearTypewriterTimer, drainFrameQueue, enqueueFrames, resumeAsrAfterPlayback])

  function toggleTts() {
    markFreeModeTtsTouched()
    if (ttsSettings.enabled) {
      stopSpeech()
    }
    setTtsSettings({ ...ttsSettings, enabled: !ttsSettings.enabled })
  }

  function toggleVoiceInput() {
    if (!speechSupported) {
      setStatus('当前环境不支持内置语音输入')
      return
    }
    if (isListening) {
      speechControllerRef.current?.stop()
    } else {
      speechControllerRef.current?.start()
    }
  }

  function updateScreenContext(result: ScreenContextResult) {
    setScreenContext(result)
  }

  const captureScreenContextOnce = useCallback(async (requestedLook: RequestedScreenLook) => {
    const key = `${requestedLook.region}:${requestedLook.reason}`
    if (!pendingScreenContextRef.current || pendingScreenContextRef.current.key !== key) {
      pendingScreenContextRef.current = {
        key,
        promise: captureFreeModeContext({
          userInput: requestedLook.reason,
          prompt: requestedLook.reason,
          region: requestedLook.region,
          regionLabel: requestedLook.label,
          reason: requestedLook.reason,
          hideOverlay: true,
        }, settings.freeModeEnhancement).finally(() => {
          pendingScreenContextRef.current = null
        }),
      }
    }
    return pendingScreenContextRef.current.promise
  }, [settings.freeModeEnhancement])

  const captureWatcherContext = useCallback(async (includeVision: boolean, reason: string) => {
    const region = settings.freeModeEnhancement.watcher.region || settings.freeModeEnhancement.screen.defaultRegion || 'active-window'
    return captureFreeModeContext({
      userInput: reason,
      prompt: reason,
      region,
      regionLabel: screenRegionLabel(region as ScreenCaptureRegionKind),
      reason,
      includeVision,
      includeHttpTools: false,
      hideOverlay: false,
    }, settings.freeModeEnhancement)
  }, [settings.freeModeEnhancement])

  const buildVisualContext = useCallback((snapshot: VisualContextSnapshot) => {
    if (snapshot.screenContext) {
      const context = snapshot.screenContext
      const freeContext = snapshot.freeModeContext
      const ocrText = context.text.trim()
      const visionText = freeContext?.visionText.trim() || ''
      const usableVisionText = isUsableVisionText(visionText)
      const uiText = freeContext?.uiText.trim() || ''
      const toolText = freeContext?.toolText.trim() || ''
      const visionLine = usableVisionText
        ? `视觉模型描述：${limitContextText(visionText, 1200)}`
        : visionText
          ? `视觉模型状态：${limitContextText(visionText, 500)}`
          : ''
      return [
        '【屏幕/窗口上下文】',
        '硬性规则：用户正在询问当前电脑屏幕时，必须优先回答屏幕/窗口内容；禁止把问题演成角色剧情，禁止编造雪地、身体状态、幻觉或现实中不存在的画面。',
        usableVisionText
          ? '外部视觉服务已接收截图并返回文字描述；可以依据“视觉模型描述”回答。'
          : '视觉模型没有返回可用图像描述；只能根据窗口标题、OCR、UI 读屏回答，并明确说明哪里没看清。',
        snapshot.requestedLook ? `用户要求：${snapshot.requestedLook.reason}` : '',
        `观察区域：${context.regionLabel || snapshot.requestedLook?.label || '整个屏幕'}`,
        `窗口：${activeWindowLabelFrom(context, '未知')}`,
        `时间：${context.capturedAt}`,
        ocrText ? `OCR：${limitContextText(ocrText)}` : `OCR：${context.message || '未读到可用文字'}`,
        uiText ? `UI读屏：${limitContextText(uiText, 900)}` : '',
        visionLine,
        toolText ? `外部工具：${limitContextText(toolText, 1200)}` : '',
        !ocrText && context.imagePath && !usableVisionText ? `截图：已保存到 ${context.imagePath}，但没有得到可用视觉描述。` : '',
      ].filter(Boolean).join('\n')
    }
    if (snapshot.requestedLook) {
      return [
        '【屏幕/窗口上下文】',
        '硬性规则：用户正在询问当前电脑屏幕时，但本次没有成功读取屏幕。必须明确说没能看清/没能读取当前屏幕；禁止把问题演成角色剧情，禁止编造雪地、身体状态、幻觉或现实中不存在的画面。',
        `用户要求：${snapshot.requestedLook.reason}`,
        `观察区域：${snapshot.requestedLook.label}`,
      ].filter(Boolean).join('\n')
    }
    return ''
  }, [])

  const buildQueuedWatcherContext = useCallback((
    event: FreeModeWatchEvent,
    fullContext: FreeModeContextResult,
    watcherRegion: string,
  ): WatcherQueuedContext => {
    const region = (watcherRegion || 'active-window') as ScreenCaptureRegionKind
    const requestedLook = {
      shouldCapture: true,
      region,
      label: screenRegionLabel(region),
      reason: `主动观察：${watcherEventReason(event)}`,
    }
    const visualContext = buildVisualContext({
      screenContext: fullContext.screen,
      freeModeContext: fullContext,
      requestedLook,
    })
    return {
      event,
      screenContext: fullContext.screen,
      freeModeContext: fullContext,
      visualContext,
      requestedLook,
    }
  }, [buildVisualContext])

  const ensureVisualContextBeforeSend = useCallback(async (content: string): Promise<VisualContextSnapshot> => {
    const requestedLook = detectRequestedScreenLook(content)
    if (!requestedLook.shouldCapture) {
      return {
        screenContext: null,
      }
    }

    setStatus(`正在看${requestedLook.label}`)
    setIsCapturingScreen(true)
    const timeoutMs = settings.freeModeEnhancement.screen.timeoutMs || autoScreenContextTimeoutMs
    const capturedContext = await withTimeout(captureScreenContextOnce(requestedLook), timeoutMs).catch(() => undefined)
    if (capturedContext) {
      const captured = capturedContext.screen
      updateScreenContext(captured)
      setFreeModeContext(capturedContext)
      setIsCapturingScreen(false)
      setStatus(
        captured.text.trim() || capturedContext.visionText.trim() || capturedContext.toolText.trim()
          ? `已读取${requestedLook.label}上下文`
          : `已截图${requestedLook.label}，但没读到文字`,
      )
      return {
        screenContext: captured,
        freeModeContext: capturedContext,
        requestedLook,
      }
    }
    setIsCapturingScreen(false)
    setStatus(`没能读取${requestedLook.label}`)

    return {
      screenContext: null,
      requestedLook,
    }
  }, [captureScreenContextOnce, settings.freeModeEnhancement.screen.timeoutMs])

  const rememberPreference = useCallback(async (text: string) => {
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
  }, [activeCharacter, chatId])

  async function stopCurrentResponse() {
    await cancelMessage().catch(() => undefined)
    cancelPerformance(true)
    setStatus('已停止')
  }

  const sendFreeModeMessage = useCallback(async (content: string, options: SendFreeModeOptions = {}) => {
    const requestId = makeId()
    const isHiddenObservation = Boolean(options.hiddenObservation)
    requestIdRef.current = requestId
    rawReplyRef.current = ''
    streamedFrameParserRef.current.reset()
    pendingFrameBatchesRef.current = []
    playbackRunningRef.current = false
    streamedFrameCountRef.current = 0
    finalChoicesRef.current = []
    streamDoneRef.current = false
    stopSpeech()
    clearTypewriterTimer()
    pauseAsrForPlayback()
    if (!isHiddenObservation) setInput('')
    setChoices([])
    setPerformanceState('generating')
    setStatus(options.statusText || (isMemoryHint(content) && !options.skipPreference ? '我会顺手记住这个偏好' : '生成演出帧中'))
    setMessages((current) => {
      const next: ChatMessage[] = isHiddenObservation
        ? current.filter((item) => !item.streaming)
        : [
            ...current,
            { id: makeId(), role: 'user' as const, content, createdAt: nowStamp() },
          ]
      return [
        ...next,
        { id: makeId(), role: 'assistant' as const, name: activeCharacter?.name || undefined, content: '', streaming: true },
      ]
    })
    if (!options.skipPreference && isMemoryHint(content)) void rememberPreference(content)

    const visualSnapshot = options.visualSnapshot ?? await ensureVisualContextBeforeSend(content)
    if (requestIdRef.current !== requestId) return
    setStatus(options.statusText || (isMemoryHint(content) && !options.skipPreference ? '我会顺手记住这个偏好' : '生成演出帧中'))

    const visualContext = buildVisualContext(visualSnapshot)
    await sendMessage(JSON.stringify({ userInput: content, visualContext }), {
      chatId: chatId || undefined,
      characterId: activeCharacter?.id,
      providerId: activeCharacter?.defaultProviderId || undefined,
      clientNow: `${formatLocalDateTime()} ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
      userCreatedAt: nowStamp(),
      eventScope: 'free-mode',
      requestId,
    }).catch((error) => {
      cancelPerformance(true)
      setStatus(String(error))
      setMessages((current) => [...current.filter((item) => !item.streaming), { id: makeId(), role: 'system', content: String(error) }])
    })
  }, [
    activeCharacter?.defaultProviderId,
    activeCharacter?.id,
    activeCharacter?.name,
    buildVisualContext,
    cancelPerformance,
    chatId,
    clearTypewriterTimer,
    ensureVisualContextBeforeSend,
    pauseAsrForPlayback,
    rememberPreference,
  ])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (isBusy) {
      await stopCurrentResponse()
      return
    }
    const content = input.trim()
    if (!content) return
    await sendFreeModeMessage(content)
  }

  async function chooseOption(choice: FreeModeChoice) {
    if (isBusy) return
    setChoices([])
    await sendFreeModeMessage(choice.prompt || choice.label)
  }

  useEffect(() => {
    sendFreeModeMessageRef.current = sendFreeModeMessage
  }, [sendFreeModeMessage])

  useEffect(() => {
    const watcher = settings.freeModeEnhancement.watcher
    const vision = settings.freeModeEnhancement.vision
    if (!watcher.enabled) {
      watcherRunningRef.current = false
      watcherProcessingRef.current = false
      return
    }

    const intervalMs = Math.max(3000, Math.min(watcher.intervalMs || 5000, 8000))
    let disposed = false
    let timer: number | undefined

    const schedule = (delay = intervalMs) => {
      if (disposed) return
      timer = window.setTimeout(() => {
        void tick()
      }, delay)
    }

    const tick = async () => {
      if (disposed) return
      if (watcherRunningRef.current) {
        schedule()
        return
      }

      watcherRunningRef.current = true
      try {
        setStatus((current) => current === '自由模式 QA' || current === '演出完成' ? '观察中' : current)
        const lightContext = await withTimeout(
          captureWatcherContext(false, '自由模式 watcher 轻量观察'),
          Math.min(settings.freeModeEnhancement.screen.timeoutMs || autoScreenContextTimeoutMs, 5000),
        )
        if (!lightContext || disposed) return
        const nextSnapshot = watcherSnapshotFrom(lightContext)
        const reason = watcherChangeReason(lastWatcherSnapshotRef.current, nextSnapshot)
        lastWatcherSnapshotRef.current = nextSnapshot
        const createdEvents = watchQueueRef.current.observe(watchQueueSnapshotFrom(lightContext))
        if (createdEvents.length) {
          setStatus(`发现变化：${createdEvents[0]?.summary || reason || '屏幕变化'}`)
        }
        if (
          performanceStateRef.current !== 'idle' ||
          inputRef.current.trim() ||
          choicesRef.current.length ||
          isCapturingScreenRef.current ||
          requestIdRef.current
        ) {
          return
        }

        const now = Date.now()
        if (now - lastWatcherResponseAtRef.current < Math.max(25000, Math.min(watcher.cooldownMs || 45000, 60000))) {
          if (createdEvents.length) setStatus('发现变化，冷却中')
          return
        }

        watcherVisionCallsRef.current = pruneRecentTimes(watcherVisionCallsRef.current, now, 60 * 60 * 1000)
        const maxCalls = Math.max(1, Math.min(watcher.maxVisionCallsPerHour || 60, 120))
        if (watcherVisionCallsRef.current.length >= maxCalls) {
          setStatus('Watcher 已达到每小时视觉上限')
          return
        }

        const event = watchQueueRef.current.next()
        if (!event) return
        watcherProcessingRef.current = true
        const includeVision = vision.enabled && isLoopbackVisionUrl(vision.serviceUrl) && event.priority >= 50
        if (includeVision) watcherVisionCallsRef.current.push(now)
        setStatus(includeVision ? '正在判断屏幕变化' : '正在判断 OCR/UI 变化')
        const fullContext = includeVision
          ? await withTimeout(
              captureWatcherContext(true, `主动观察：${watcherEventReason(event)}`),
              Math.max(6000, Math.min(vision.timeoutMs || 12000, 30000)),
            )
          : lightContext
        if (!fullContext || disposed) {
          watchQueueRef.current.mark(event.id, 'ignored', '观察上下文不可用')
          return
        }
        const observedEvents = includeVision ? watchQueueRef.current.observe(watchQueueSnapshotFrom(fullContext)) : []
        const selectedEvent = observedEvents.find((item) => item.type === 'visual-change') ?? event
        if (selectedEvent.id !== event.id) {
          watchQueueRef.current.mark(event.id, 'ignored', `Upgraded to ${selectedEvent.type}`)
        }
        const queuedContext = buildQueuedWatcherContext(selectedEvent, fullContext, watcher.region)
        setScreenContext(queuedContext.screenContext)
        setFreeModeContext(queuedContext.freeModeContext)
        const queueSummary = watchQueueRef.current.summary()
        const decision = await withTimeout(evaluateFreeModeWatchEvent({
            characterId: activeCharacter?.id,
            providerId: activeCharacter?.defaultProviderId || undefined,
            visualContext: queuedContext.visualContext,
            previousSummary: queueSummary.lastObservationSummary || lastWatcherVisionContextRef.current,
            eventSummary: selectedEvent.summary,
            recentReactionSummary: watchQueueRef.current.recentReactionSummary(),
            reason: watcherEventReason(selectedEvent),
            clientNow: `${formatLocalDateTime()} ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
          }),
          watcherDecisionTimeoutMs,
        ).catch((error) => {
          setStatus(`Watcher 判定失败：${String(error)}`)
          watchQueueRef.current.mark(selectedEvent.id, 'ignored', String(error))
          return null
        })
        lastWatcherVisionContextRef.current = limitContextText(queuedContext.visualContext, 800)
        if (!decision) {
          setStatus('Watcher：判定超时或失败')
          watchQueueRef.current.mark(selectedEvent.id, 'ignored', '判定超时或失败')
          return
        }
        if (!decision || !decision.shouldRespond || !decision.prompt.trim()) {
          setStatus(decision?.reason ? `Watcher：${decision.reason}` : 'Watcher：变化不足以打扰')
          watchQueueRef.current.mark(selectedEvent.id, 'ignored', decision?.reason || '变化不足以打扰')
          return
        }
        if (
          disposed ||
          performanceStateRef.current !== 'idle' ||
          inputRef.current.trim() ||
          choicesRef.current.length ||
          isCapturingScreenRef.current ||
          requestIdRef.current
        ) {
          watchQueueRef.current.mark(selectedEvent.id, 'ignored', '演出开始前状态变忙')
          return
        }
        lastWatcherResponseAtRef.current = Date.now()
        watchQueueRef.current.recordReaction(selectedEvent, decision.prompt)
        watchQueueRef.current.mark(selectedEvent.id, 'responded', decision.reason || decision.prompt)
        setStatus('她注意到了屏幕变化')
        await sendFreeModeMessageRef.current?.(decision.prompt, {
          hiddenObservation: watcher.hiddenObservation,
          visualSnapshot: {
            screenContext: queuedContext.screenContext,
            freeModeContext: queuedContext.freeModeContext,
            requestedLook: queuedContext.requestedLook,
          },
          statusText: '根据屏幕变化生成演出帧中',
          skipPreference: true,
        })
      } finally {
        watcherProcessingRef.current = false
        watcherRunningRef.current = false
        schedule()
      }
    }

    schedule(1200)
    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
      watcherRunningRef.current = false
    }
  }, [
    activeCharacter?.defaultProviderId,
    activeCharacter?.id,
    buildVisualContext,
    buildQueuedWatcherContext,
    captureWatcherContext,
    settings.freeModeEnhancement,
  ])

  return (
    <section className="free-mode-window">
      <div
        className={`free-mode-stage free-mode-stage--${freeModeStage.effect || 'none'} free-mode-stage--${freeModeStage.action || 'none'} ${
          cgSrc ? 'free-mode-stage--cg-active' : ''
        }`}
        onPointerDown={(event) => {
          if (event.button !== 0 || isInteractiveTarget(event.target)) return
          void startWindowDrag()
        }}
      >
        <audio ref={audioRef} aria-hidden="true" />
        {activeScene?.background && (
          <div className="free-mode-background-scene" style={{ '--free-mode-scene-background': stageBackground(activeScene.background) } as React.CSSProperties} />
        )}
        {cgSrc && (
          <div className="free-mode-cg-overlay free-mode-cg-overlay--active">
            <img src={cgSrc} alt={activeCg?.name || ''} />
          </div>
        )}
        <header className="free-mode-toolbar" data-no-window-drag="true">
          <select value={activeCharacterId} onChange={(event) => setActiveCharacterId(event.target.value)} title="角色" disabled={isBusy}>
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
            title="自由模式增强：截图 OCR、外部视觉、HTTP 工具"
            aria-label="自由模式增强"
            onClick={() => setEnhancementOpen((current) => !current)}
            data-active={enhancementOpen || settings.freeModeEnhancement.vision.enabled || settings.freeModeEnhancement.httpTools.some((tool) => tool.enabled)}
          >
            <SlidersHorizontal size={16} />
          </button>
          <button
            type="button"
            title={toolbarVoiceButtonTitle}
            aria-label="顶部语音开关"
            onClick={toggleTts}
          >
            <VoiceIcon size={16} />
          </button>
          <button type="button" title="隐藏" onClick={() => void hideCurrentWindow()}>
            <Minus size={16} />
          </button>
        </header>
        <FreeModeEnhancementPanel
          open={enhancementOpen}
          settings={settings}
          onClose={() => setEnhancementOpen(false)}
          onSettingsChange={setSettings}
          onStatus={setStatus}
        />

        <div className="free-mode-portrait-wrap">
          <div className={`free-mode-stage__pose free-mode-stage__pose--${freeModeStage.effect || 'none'} free-mode-stage__pose--${freeModeStage.action || 'none'}`}>
            <img
              className={`free-mode-portrait action-${freeModeStage.action || 'none'}`}
              src={portraitSrc}
              alt={poseStatus}
              key={`${activePose?.id || portraitSrc}-${freeModeStage.effect}-${freeModeStage.action}`}
            />
          </div>
        </div>

        <div className="free-mode-dialog" data-no-window-drag="true">
          <div className="free-mode-speaker">
            <span>{currentAssistantMessage?.name || activeCharacter?.name || '自由模式'}</span>
            {poseStatus && <small>{poseStatus}</small>}
            <small>{ttsStatusLabel}</small>
            {activeBgm && <small>{activeBgm.name}</small>}
          </div>
          <div className="free-mode-bubble">
            {currentAssistantMessage && (
              <p
                key={currentAssistantMessage.id}
                className={`free-mode-message free-mode-message--${currentAssistantMessage.role}`}
              >
                {currentAssistantMessage.content}
                {currentAssistantMessage.streaming && <span className="caret" />}
              </p>
            )}
          </div>
          {choices.length > 0 && (
            <div className="free-mode-choices">
              {choices.map((choice, index) => (
                <button key={choice.id || `${choice.label}-${index}`} type="button" onClick={() => void chooseOption(choice)}>
                  {choice.label}
                </button>
              ))}
            </div>
          )}
          <form className={`free-mode-composer ${input.trim() ? 'free-mode-composer--active' : ''}`} onSubmit={submit}>
            <textarea
              value={input}
              placeholder={isBusy ? '演出播放中，可以点击停止跳过' : '直接问我，或让我看屏幕某个位置...'}
              disabled={isBusy}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submit(event)
                }
              }}
            />
            <div className="free-mode-actions">
              <button
                type="button"
                title={voiceButtonTitle}
                onClick={toggleTts}
                data-active={ttsSettings.enabled}
                aria-pressed={ttsSettings.enabled}
                aria-label={ttsSettings.enabled ? '关闭同步语音' : '开启同步语音'}
              >
                <VoiceIcon size={16} />
              </button>
              <button type="button" title={isListening ? '停止语音输入' : '开始语音输入'} onClick={toggleVoiceInput} disabled={isBusy || !speechSupported} data-active={isListening} data-state={isListening ? 'listening' : undefined}>
                <MicIcon size={16} />
              </button>
              <button type="button" title="记住输入内容" onClick={() => void rememberPreference(input)} disabled={isBusy}>
                <Heart size={16} />
              </button>
              <button className="free-mode-primary" type="submit" title={isBusy ? '停止 / 跳过' : '发送'}>
                {isBusy ? <Square size={16} /> : <Send size={16} />}
              </button>
            </div>
          </form>
          <small className="free-mode-context">
            <Sparkles size={13} />
            {isCapturingScreen
              ? '正在按你的话读取屏幕...'
              : screenContextSummary || '你说“看屏幕左上角 / 看右下角”，她会自动截图并把 OCR 文字交给 DeepSeek；图片本身不会被发送。按钮：语音、听写、记忆、发送。'}
          </small>
        </div>
      </div>
    </section>
  )
}
