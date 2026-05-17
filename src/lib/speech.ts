import type { TtsSettings } from '../types/tauri'
import { synthesizeGenie, synthesizePiper } from './tauri'

let activeUtterance: SpeechSynthesisUtterance | null = null
let pendingSpeechTimer: number | undefined
let activeTtsAudio: HTMLAudioElement | null = null
let activeQueueId = 0
let speechQueue: QueuedSpeechItem[] = []
let speechQueueRunning = false
let pendingSpeechTimerResolve: (() => void) | undefined
const queueInterruptResolvers = new Set<() => void>()

interface SpeakOptions {
  delayMs?: number
  ignoreEnabled?: boolean
  interrupt?: boolean
  onStart?: () => void
}

export interface QuotedSpeechSegment {
  text: string
  delayMs: number
  narrationBefore: string
}

export type FullDialogueSpeechSegment = QuotedSpeechSegment

interface FullDialogueSpeechParserOptions {
  firstSegmentLength?: number
  nextSegmentLength?: number
}

interface QueuedSpeechSentence {
  text: string
  audioUrlPromise?: Promise<string | null>
}

interface QueuedSpeechItem {
  delayMs: number
  settings: TtsSettings
  voices: SpeechSynthesisVoice[]
  sentences: QueuedSpeechSentence[]
}

export interface PreparedFreeModeFrameSpeech {
  text: string
  settings: TtsSettings
  voices: SpeechSynthesisVoice[]
  audioUrlPromise?: Promise<string | null>
}

function resolveAfter<T>(ms: number, value: T) {
  return new Promise<T>((resolve) => {
    if (typeof window === 'undefined') {
      setTimeout(() => resolve(value), ms)
      return
    }
    window.setTimeout(() => resolve(value), ms)
  })
}

const quotePairs: Record<string, string> = {
  '“': '”',
  '"': '"',
  '「': '」',
  '『': '』',
}

const fullDialogueFirstSegmentLength = 25
const fullDialogueNextSegmentLength = 15
const fullDialogueInterSegmentDelayMs = 120
const poseTagKeys = [
  'pose',
  'motion',
  'expression',
  'emotion',
  'action',
  'mood',
  'sprite',
  'scene',
  'bgm',
  '表情',
  '动作',
  '姿势',
  '神态',
  '心情',
  '立绘',
  '场景',
  '音乐',
]
const poseTagKeyPattern = poseTagKeys.join('|')
const poseTagStartPattern = new RegExp(`^\\/?\\s*["']?(?:${poseTagKeyPattern})["']?(?:\\s*[:=：]|\\s|$)`, 'iu')
const sentenceBoundaryPattern = /[。！？!?；;，,、…：:]/
const strongSentenceBoundaryPattern = /[。！？!?；;…]/

function normalizeVoiceLang(lang: string) {
  return lang.trim().toLowerCase().replace('_', '-')
}

function normalizeVoiceName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/^microsoft\s+/, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(?:desktop|online|natural|neural|voice)\b/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '')
}

function voiceIdentityKey(voice: SpeechSynthesisVoice) {
  const lang = normalizeVoiceLang(voice.lang)
  const name = normalizeVoiceName(voice.name || voice.voiceURI)
  return `${lang}:${name || voice.voiceURI.toLowerCase()}`
}

export function getDistinctSpeechVoices(voices: SpeechSynthesisVoice[]) {
  const seen = new Set<string>()
  const distinct: SpeechSynthesisVoice[] = []

  for (const voice of voices) {
    const key = voiceIdentityKey(voice)
    if (seen.has(key)) continue
    seen.add(key)
    distinct.push(voice)
  }

  return distinct
}

export function pickSpeechVoice(voices: SpeechSynthesisVoice[], voiceURI: string) {
  return (
    voices.find((voice) => voice.voiceURI === voiceURI) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith('zh')) ??
    voices[0]
  )
}

export function stopSpeech() {
  activeQueueId += 1
  speechQueue = []
  for (const resolve of queueInterruptResolvers) {
    resolve()
  }
  queueInterruptResolvers.clear()
  if (pendingSpeechTimer !== undefined) {
    window.clearTimeout(pendingSpeechTimer)
    pendingSpeechTimer = undefined
    pendingSpeechTimerResolve?.()
    pendingSpeechTimerResolve = undefined
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
  if (activeTtsAudio) {
    activeTtsAudio.pause()
    activeTtsAudio.src = ''
    activeTtsAudio = null
  }
  activeUtterance = null
}

function isEscapedQuote(text: string, index: number) {
  let slashCount = 0
  for (let current = index - 1; current >= 0 && text[current] === '\\'; current -= 1) {
    slashCount += 1
  }
  return slashCount % 2 === 1
}

function effectiveNarrationLength(text: string) {
  return text.replace(/\s+/g, '').length
}

function clampPause(ms: number) {
  return Math.min(3000, Math.max(300, ms))
}

function pauseForNarration(text: string) {
  return clampPause(300 + effectiveNarrationLength(text) * 45)
}

function normalizeFullDialogueWhitespace(text: string, trim = true) {
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/ {2,}/g, ' ')
  return trim ? normalized.trim() : normalized
}

const xmlPoseBlockPattern = new RegExp(
  `<\\s*(pose|motion|expression|emotion|mood|sprite|scene|bgm|表情|姿势|神态|心情|立绘|场景|音乐)\\b[^>]*>[^<]{0,120}<\\s*\\/\\s*\\1\\s*>`,
  'giu',
)
const standalonePoseTagLinePattern = new RegExp(
  `(^|\\n)\\s*["']?(?:pose|motion|expression|emotion|mood|sprite|scene|bgm|表情|姿势|神态|心情|立绘|场景|音乐)["']?\\s*[:=：]\\s*[\\w\\u4e00-\\u9fa5 -]{1,40}\\s*(?=\\n|$)`,
  'giu',
)
const dialogueContentKeyPattern = /["']?(?:text|dialogue|content|message|line|台词|对白|内容)["']?\s*[:=：]/iu
const pairedPoseTagPatterns: RegExp[] = [
  /<([^<>]{0,120})>/gu,
  /\[([^[\]]{0,120})\]/gu,
  /【([^【】]{0,120})】/gu,
  /\{([^{}]{0,120})\}/gu,
  /（([^（）]{0,120})）/gu,
  /\(([^()]{0,120})\)/gu,
]
const incompletePoseTagPatterns = [
  new RegExp(`<\\s*\\/?\\s*["']?(?:${poseTagKeyPattern})[^>]{0,120}$`, 'iu'),
  new RegExp(`\\[\\s*["']?(?:${poseTagKeyPattern})[^\\]]{0,120}$`, 'iu'),
  new RegExp(`【\\s*["']?(?:${poseTagKeyPattern})[^】]{0,120}$`, 'iu'),
  new RegExp(`\\{\\s*["']?(?:${poseTagKeyPattern})[^}]{0,120}$`, 'iu'),
  new RegExp(`[（(]\\s*["']?(?:${poseTagKeyPattern})[^）)]{0,120}$`, 'iu'),
]

function isPoseTagBody(body: string) {
  const normalized = body.trim().replace(/^\/\s*/, '').replace(/\/$/, '').trim()
  if (!normalized || normalized.length > 120 || dialogueContentKeyPattern.test(normalized)) return false
  return poseTagStartPattern.test(normalized)
}

function cleanFullDialoguePoseTags(text: string, trim = true) {
  let stripped = text.replace(xmlPoseBlockPattern, ' ').replace(standalonePoseTagLinePattern, '$1')
  for (const pattern of pairedPoseTagPatterns) {
    stripped = stripped.replace(pattern, (match, body: string) => (isPoseTagBody(body) ? ' ' : match))
  }
  return normalizeFullDialogueWhitespace(stripped, trim)
}

export function stripFullDialoguePoseTags(text: string) {
  return cleanFullDialoguePoseTags(text)
}

function effectiveDialogueLength(text: string) {
  return text.replace(/\s+/g, '').length
}

function countDialogueChars(chars: string[], start: number, end: number) {
  let count = 0
  for (let index = start; index < end; index += 1) {
    if (!/\s/.test(chars[index])) count += 1
  }
  return count
}

function findFullDialogueCut(chars: string[], targetLength: number, force: boolean) {
  let targetIndex = -1
  let measured = 0
  for (let index = 0; index < chars.length; index += 1) {
    if (!/\s/.test(chars[index])) measured += 1
    if (measured >= targetLength) {
      targetIndex = index + 1
      break
    }
  }

  if (targetIndex < 0) {
    return force ? chars.length : -1
  }

  const remaining = countDialogueChars(chars, targetIndex, chars.length)
  const tolerance = targetLength >= 20 ? 8 : targetLength <= 14 ? 2 : 5
  if (remaining > 0 && remaining <= tolerance) {
    return chars.length
  }

  const maxLength = targetLength + tolerance
  for (let index = targetIndex; index < chars.length; index += 1) {
    const currentLength = countDialogueChars(chars, 0, index + 1)
    if (currentLength > maxLength) break
    if (sentenceBoundaryPattern.test(chars[index])) return index + 1
  }

  const minLength = Math.max(6, Math.floor(targetLength * 0.6))
  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    const currentLength = countDialogueChars(chars, 0, index + 1)
    if (currentLength < minLength) break
    if (sentenceBoundaryPattern.test(chars[index])) return index + 1
  }

  return targetIndex
}

function findEarlyFullDialogueCut(chars: string[]) {
  for (let index = 0; index < chars.length; index += 1) {
    if (strongSentenceBoundaryPattern.test(chars[index]) && countDialogueChars(chars, 0, index + 1) >= 2) {
      return index + 1
    }
  }
  return -1
}

function takeFullDialogueSegment(text: string, targetLength: number, force = false) {
  const content = normalizeFullDialogueWhitespace(text, false).trimStart()
  const readableContent = content.trim()
  const chars = Array.from(content)
  if (!readableContent) return null

  const cut = !force && effectiveDialogueLength(readableContent) < targetLength
    ? findEarlyFullDialogueCut(chars)
    : findFullDialogueCut(chars, targetLength, force)
  if (!force && effectiveDialogueLength(readableContent) < targetLength) {
    if (cut <= 0) return null
  }

  if (cut <= 0) return null
  const segment = chars.slice(0, cut).join('').trim()
  const rest = chars.slice(cut).join('').trimStart()
  return segment ? { segment, rest } : null
}

function fullDialogueParserLengths(options: FullDialogueSpeechParserOptions = {}) {
  return {
    first: options.firstSegmentLength ?? fullDialogueFirstSegmentLength,
    next: options.nextSegmentLength ?? fullDialogueNextSegmentLength,
  }
}

export function extractFullDialogueSpeechSegments(
  text: string,
  options: FullDialogueSpeechParserOptions = {},
): FullDialogueSpeechSegment[] {
  const lengths = fullDialogueParserLengths(options)
  const segments: FullDialogueSpeechSegment[] = []
  let rest = stripFullDialoguePoseTags(text)

  while (rest) {
    const targetLength = segments.length ? lengths.next : lengths.first
    const taken = takeFullDialogueSegment(rest, targetLength, true)
    if (!taken) break
    segments.push({
      text: taken.segment,
      delayMs: segments.length ? fullDialogueInterSegmentDelayMs : 0,
      narrationBefore: '',
    })
    rest = taken.rest
  }

  return segments
}

function findIncompletePoseTagStart(text: string) {
  const tailStart = Math.max(0, text.length - 160)
  const tail = text.slice(tailStart)
  let bestIndex = -1
  for (const pattern of incompletePoseTagPatterns) {
    const match = pattern.exec(tail)
    if (!match) continue
    const candidate = tailStart + match.index
    if (bestIndex < 0 || candidate < bestIndex) {
      bestIndex = candidate
    }
  }
  return bestIndex
}

export function createFullDialogueSpeechStreamParser(options: FullDialogueSpeechParserOptions = {}) {
  const lengths = fullDialogueParserLengths(options)
  let rawBuffer = ''
  let pendingText = ''
  let emittedAny = false

  function appendCleanedRaw(force = false) {
    if (!rawBuffer) return
    const holdIndex = force ? -1 : findIncompletePoseTagStart(rawBuffer)
    const stableRaw = holdIndex >= 0 ? rawBuffer.slice(0, holdIndex) : rawBuffer
    rawBuffer = holdIndex >= 0 ? rawBuffer.slice(holdIndex) : ''
    const cleaned = cleanFullDialoguePoseTags(stableRaw, false)
    if (cleaned) {
      pendingText = normalizeFullDialogueWhitespace(`${pendingText}${cleaned}`, false)
    }
  }

  function emitReadySegments(force = false) {
    const segments: FullDialogueSpeechSegment[] = []
    while (pendingText.trim()) {
      const targetLength = emittedAny || segments.length ? lengths.next : lengths.first
      const taken = takeFullDialogueSegment(pendingText, targetLength, force)
      if (!taken) break
      segments.push({
        text: taken.segment,
        delayMs: emittedAny || segments.length > 0 ? fullDialogueInterSegmentDelayMs : 0,
        narrationBefore: '',
      })
      emittedAny = true
      pendingText = taken.rest
    }
    return segments
  }

  return {
    feed(chunk: string) {
      rawBuffer += chunk
      appendCleanedRaw()
      return emitReadySegments()
    },
    flush() {
      appendCleanedRaw(true)
      const segments = emitReadySegments(true)
      rawBuffer = ''
      pendingText = ''
      emittedAny = false
      return segments
    },
    reset() {
      rawBuffer = ''
      pendingText = ''
      emittedAny = false
    },
  }
}

export function extractQuotedSpeechSegments(text: string): QuotedSpeechSegment[] {
  const segments: QuotedSpeechSegment[] = []
  let lastQuoteEnd = 0
  let index = 0

  while (index < text.length) {
    const open = text[index]
    const close = quotePairs[open]
    if (!close) {
      index += 1
      continue
    }

    let closeIndex = index + 1
    while (closeIndex < text.length) {
      if (text[closeIndex] === close && (close !== '"' || !isEscapedQuote(text, closeIndex))) {
        break
      }
      closeIndex += 1
    }

    if (closeIndex >= text.length) {
      break
    }

    const spokenText = text.slice(index + 1, closeIndex).trim()
    if (spokenText) {
      const narrationBefore = text.slice(lastQuoteEnd, index)
      segments.push({
        text: spokenText,
        delayMs: segments.length ? pauseForNarration(narrationBefore) : 0,
        narrationBefore,
      })
    }
    lastQuoteEnd = closeIndex + 1
    index = closeIndex + 1
  }

  return segments
}

export function createQuotedSpeechStreamParser() {
  let inQuote = false
  let closeQuote = ''
  let quotedText = ''
  let narrationBuffer = ''
  let emittedAny = false
  let quoteSlashRun = 0

  function emitSegment(): QuotedSpeechSegment[] {
    const spokenText = quotedText.trim()
    const result: QuotedSpeechSegment[] = []
    if (spokenText) {
      result.push({
        text: spokenText,
        delayMs: emittedAny ? pauseForNarration(narrationBuffer) : 0,
        narrationBefore: narrationBuffer,
      })
      emittedAny = true
      narrationBuffer = ''
    }
    quotedText = ''
    inQuote = false
    closeQuote = ''
    quoteSlashRun = 0
    return result
  }

  return {
    feed(chunk: string) {
      const segments: QuotedSpeechSegment[] = []
      for (let index = 0; index < chunk.length; index += 1) {
        const char = chunk[index]
        if (inQuote) {
          const escapedAsciiQuote = closeQuote === '"' && quoteSlashRun % 2 === 1
          if (char === closeQuote && !escapedAsciiQuote) {
            segments.push(...emitSegment())
          } else {
            quotedText += char
            quoteSlashRun = char === '\\' ? quoteSlashRun + 1 : 0
          }
          continue
        }

        const close = quotePairs[char]
        if (close) {
          inQuote = true
          closeQuote = close
          quotedText = ''
          quoteSlashRun = 0
        } else {
          narrationBuffer += char
        }
      }
      return segments
    },
    flush() {
      inQuote = false
      closeQuote = ''
      quotedText = ''
      narrationBuffer = ''
      emittedAny = false
      quoteSlashRun = 0
      return [] as QuotedSpeechSegment[]
    },
    reset() {
      inQuote = false
      closeQuote = ''
      quotedText = ''
      narrationBuffer = ''
      emittedAny = false
      quoteSlashRun = 0
    },
  }
}

export function splitSpeechSentences(text: string) {
  const content = text.replace(/\s+/g, ' ').trim()
  if (!content) return []
  const parts = content.match(/[^。！？!?；;]+[。！？!?；;]?/g) ?? [content]
  const merged: string[] = []
  for (const part of parts.map((item) => item.trim()).filter(Boolean)) {
    const previous = merged[merged.length - 1]
    if (previous && previous.length < 12) {
      merged[merged.length - 1] = `${previous}${part}`
    } else {
      merged.push(part)
    }
  }
  return merged.slice(0, 8)
}

function waitMs(ms: number, queueId: number) {
  return new Promise<void>((resolve) => {
    if (ms <= 0 || queueId !== activeQueueId) {
      resolve()
      return
    }
    pendingSpeechTimerResolve = () => {
      pendingSpeechTimerResolve = undefined
      resolve()
    }
    pendingSpeechTimer = window.setTimeout(() => {
      pendingSpeechTimer = undefined
      pendingSpeechTimerResolve = undefined
      resolve()
    }, ms)
  })
}

async function waitForCurrentQueue<T>(promise: Promise<T>, queueId: number) {
  if (queueId !== activeQueueId) return undefined
  let resolveInterrupt: (() => void) | undefined
  const interrupted = new Promise<undefined>((resolve) => {
    resolveInterrupt = () => resolve(undefined)
    queueInterruptResolvers.add(resolveInterrupt)
  })
  const result = await Promise.race([promise.then((value) => ({ value })), interrupted])
  if (resolveInterrupt) {
    queueInterruptResolvers.delete(resolveInterrupt)
  }
  if (!result || queueId !== activeQueueId) return undefined
  return result.value
}

export function currentSpeechQueueId() {
  return activeQueueId
}

function waitForSpeechIdle(timeoutMs: number) {
  return new Promise<void>((resolve) => {
    if (typeof window === 'undefined') {
      resolve()
      return
    }
    const started = Date.now()
    const timer = window.setInterval(() => {
      const synthBusy = 'speechSynthesis' in window && window.speechSynthesis.speaking
      const busy = synthBusy || Boolean(activeUtterance || activeTtsAudio)
      if (!busy || Date.now() - started > timeoutMs) {
        window.clearInterval(timer)
        resolve()
      }
    }, 120)
  })
}

function once(callback?: () => void) {
  let called = false
  return () => {
    if (called) return
    called = true
    callback?.()
  }
}

function makeQueueItem(
  segment: QuotedSpeechSegment,
  settings: TtsSettings,
  voices: SpeechSynthesisVoice[],
  options: { splitSentences?: boolean } = {},
): QueuedSpeechItem | null {
  const sentences = options.splitSentences === false ? [segment.text.trim()].filter(Boolean) : splitSpeechSentences(segment.text)
  if (!sentences.length) return null
  const settingsSnapshot = { ...settings }
  return {
    delayMs: segment.delayMs,
    settings: settingsSnapshot,
    voices: [...voices],
    sentences: sentences.map((sentence) => ({
      text: sentence,
      audioUrlPromise:
        settingsSnapshot.engine === 'piper'
          ? synthesizePiper(sentence, settingsSnapshot.rate).catch(() => null)
          : settingsSnapshot.engine === 'genie'
            ? synthesizeGenie(sentence, settingsSnapshot).catch(() => null)
          : undefined,
    })),
  }
}

async function runSpeechQueue(queueId: number) {
  if (speechQueueRunning) return
  speechQueueRunning = true
  try {
    while (queueId === activeQueueId && speechQueue.length) {
      const item = speechQueue.shift()
      if (!item) break
      await waitMs(item.delayMs, queueId)
      if (queueId !== activeQueueId) break

      for (let index = 0; index < item.sentences.length; index += 1) {
        if (queueId !== activeQueueId) break
        if (index > 0) {
          await waitMs(120, queueId)
        }
        if (queueId !== activeQueueId) break

        const sentence = item.sentences[index]
        if (item.settings.engine === 'piper' || item.settings.engine === 'genie') {
          const audioUrl = sentence.audioUrlPromise ? await waitForCurrentQueue(sentence.audioUrlPromise, queueId) : null
          if (!audioUrl || queueId !== activeQueueId) continue
          const started = startTtsAudio(audioUrl, item.settings, { ignoreEnabled: true, interrupt: false })
          if (started) {
            await waitForSpeechIdle(45_000)
          }
        } else {
          const started = speakLocalText(sentence.text, item.settings, item.voices, {
            ignoreEnabled: true,
            interrupt: false,
          })
          if (started) {
            await waitForSpeechIdle(Math.max(6_000, sentence.text.length * 420))
          }
        }
      }
    }
  } finally {
    speechQueueRunning = false
    if (speechQueue.length) {
      void runSpeechQueue(activeQueueId)
    }
  }
}

function enqueueSpeechSegments(
  segments: QuotedSpeechSegment[],
  settings: TtsSettings,
  voices: SpeechSynthesisVoice[],
  options: { append?: boolean; splitSentences?: boolean } = {},
) {
  if (!options.append) {
    stopSpeech()
  }
  if (!settings.enabled || !segments.length) return false

  const queueId = activeQueueId
  const items = segments
    .map((segment) => makeQueueItem(segment, settings, voices, { splitSentences: options.splitSentences }))
    .filter((item): item is QueuedSpeechItem => item !== null)
  if (!items.length) return false

  speechQueue.push(...items)
  void runSpeechQueue(queueId)
  return true
}

export async function speakQuotedDialogueQueue(
  input: string | QuotedSpeechSegment[],
  settings: TtsSettings,
  voices: SpeechSynthesisVoice[],
  options: { append?: boolean } = {},
) {
  const segments = typeof input === 'string' ? extractQuotedSpeechSegments(input) : input
  return enqueueSpeechSegments(segments, settings, voices, options)
}

export async function speakFullDialogueQueue(
  input: string | FullDialogueSpeechSegment[],
  settings: TtsSettings,
  voices: SpeechSynthesisVoice[],
  options: { append?: boolean } = {},
) {
  const segments = typeof input === 'string' ? extractFullDialogueSpeechSegments(input) : input
  return enqueueSpeechSegments(segments, settings, voices, { ...options, splitSentences: false })
}

export async function speakFreeModeFullTextQueue(
  input: string | FullDialogueSpeechSegment[],
  settings: TtsSettings,
  voices: SpeechSynthesisVoice[],
  options: { append?: boolean } = {},
) {
  return speakFullDialogueQueue(input, settings, voices, options)
}

export async function speakFreeModeFrameText(
  text: string,
  settings: TtsSettings,
  voices: SpeechSynthesisVoice[],
  options: { queueId?: number } = {},
) {
  const prepared = prepareFreeModeFrameSpeech(text, settings, voices)
  if (!prepared) return false
  return playPreparedFreeModeFrameSpeech(prepared, options)
}

export function prepareFreeModeFrameSpeech(
  text: string,
  settings: TtsSettings,
  voices: SpeechSynthesisVoice[],
): PreparedFreeModeFrameSpeech | null {
  const content = text.trim()
  if (!content || !settings.enabled) return null
  const settingsSnapshot: TtsSettings = {
    ...settings,
    genie: { ...settings.genie },
  }

  return {
    text: content,
    settings: settingsSnapshot,
    voices: [...voices],
    audioUrlPromise:
      settingsSnapshot.engine === 'piper'
        ? synthesizePiper(content, settingsSnapshot.rate).catch(() => null)
        : settingsSnapshot.engine === 'genie'
          ? synthesizeGenie(content, settingsSnapshot).catch(() => null)
          : undefined,
  }
}

export async function playPreparedFreeModeFrameSpeech(
  prepared: PreparedFreeModeFrameSpeech,
  options: { queueId?: number; onStart?: () => void; audioReadyTimeoutMs?: number } = {},
) {
  const content = prepared.text.trim()
  if (!content || !prepared.settings.enabled) return false
  const queueId = options.queueId ?? activeQueueId
  if (queueId !== activeQueueId) return false

  if (prepared.settings.engine === 'piper' || prepared.settings.engine === 'genie') {
    const audioUrlPromise = prepared.audioUrlPromise ?? Promise.resolve(null)
    const audioReadyPromise = options.audioReadyTimeoutMs && options.audioReadyTimeoutMs > 0
      ? Promise.race([audioUrlPromise, resolveAfter(options.audioReadyTimeoutMs, null)])
      : audioUrlPromise
    const audioUrl = await waitForCurrentQueue(
      audioReadyPromise,
      queueId,
    )
    if (!audioUrl || queueId !== activeQueueId) return false
    const started = startTtsAudio(audioUrl, prepared.settings, { ignoreEnabled: true, interrupt: false, onStart: options.onStart })
    if (started) {
      await waitForSpeechIdle(45_000)
    }
    return started
  }

  const started = speakLocalText(content, prepared.settings, prepared.voices, {
    ignoreEnabled: true,
    interrupt: false,
    onStart: options.onStart,
  })
  if (started) {
    await waitForSpeechIdle(Math.max(4_000, content.length * 360))
  }
  return started
}

export async function speakSentenceQueue(text: string, settings: TtsSettings, voices: SpeechSynthesisVoice[]) {
  const sentences = splitSpeechSentences(text)
  if (!sentences.length || !settings.enabled) return false
  stopSpeech()
  const queueId = activeQueueId

  for (const sentence of sentences) {
    if (queueId !== activeQueueId) return false
    if (settings.engine === 'piper' || settings.engine === 'genie') {
      const started =
        settings.engine === 'piper'
          ? await speakPiperText(sentence, settings, { ignoreEnabled: true, interrupt: false }).catch(() => false)
          : await speakGenieText(sentence, settings, { ignoreEnabled: true, interrupt: false }).catch(() => false)
      if (started) await waitForSpeechIdle(45_000)
    } else {
      const started = speakLocalText(sentence, settings, voices, { ignoreEnabled: true, interrupt: false })
      if (started) await waitForSpeechIdle(Math.max(6_000, sentence.length * 420))
    }
    await waitMs(120, queueId)
  }
  return true
}

function startTtsAudio(
  audioUrl: string,
  settings: TtsSettings,
  options: Pick<SpeakOptions, 'ignoreEnabled' | 'interrupt' | 'onStart'> = {},
) {
  if (!options.ignoreEnabled && !settings.enabled) return false
  if (options.interrupt !== false) {
    stopSpeech()
  }
  const audio = new Audio(audioUrl)
  const notifyStart = once(options.onStart)
  activeTtsAudio = audio
  audio.volume = settings.volume
  audio.onplaying = notifyStart
  audio.onended = () => {
    if (activeTtsAudio === audio) {
      activeTtsAudio = null
    }
  }
  audio.onerror = () => {
    if (activeTtsAudio === audio) {
      activeTtsAudio = null
    }
  }
  void audio.play().catch(() => {
    if (activeTtsAudio === audio) {
      activeTtsAudio = null
    }
  })
  window.setTimeout(notifyStart, 180)
  return true
}

export async function speakPiperText(
  text: string,
  settings: TtsSettings,
  options: Pick<SpeakOptions, 'ignoreEnabled' | 'interrupt'> = {},
) {
  const content = text.trim()
  if (!content || settings.engine !== 'piper') return false
  if (!options.ignoreEnabled && !settings.enabled) return false

  const wavUrl = await synthesizePiper(content, settings.rate)
  if (!wavUrl) return false

  return startTtsAudio(wavUrl, settings, options)
}

export async function speakGenieText(
  text: string,
  settings: TtsSettings,
  options: Pick<SpeakOptions, 'ignoreEnabled' | 'interrupt'> = {},
) {
  const content = text.trim()
  if (!content || settings.engine !== 'genie') return false
  if (!options.ignoreEnabled && !settings.enabled) return false

  const wavUrl = await synthesizeGenie(content, settings)
  if (!wavUrl) return false

  return startTtsAudio(wavUrl, settings, options)
}

export function speakLocalText(
  text: string,
  settings: TtsSettings,
  voices: SpeechSynthesisVoice[],
  options: SpeakOptions = {},
) {
  const content = text.trim()
  if (!content || typeof window === 'undefined' || !('speechSynthesis' in window)) return false
  if (!options.ignoreEnabled && !settings.enabled) return false
  if (settings.engine === 'piper' || settings.engine === 'genie') return false

  const synth = window.speechSynthesis
  const availableVoices = voices.length ? voices : synth.getVoices()
  const voice = pickSpeechVoice(availableVoices, settings.voiceURI)
  const utterance = new SpeechSynthesisUtterance(content)

  utterance.rate = settings.rate
  utterance.volume = settings.volume
  utterance.lang = voice?.lang || 'zh-CN'
  if (voice) {
    utterance.voice = voice
  }

  const notifyStart = once(options.onStart)
  utterance.onstart = notifyStart
  utterance.onend = () => {
    if (activeUtterance === utterance) {
      activeUtterance = null
    }
  }
  utterance.onerror = utterance.onend

  if (options.interrupt !== false) {
    stopSpeech()
  }
  activeUtterance = utterance

  const startSpeaking = () => {
    pendingSpeechTimer = undefined
    synth.resume()
    synth.speak(utterance)
    window.setTimeout(() => synth.resume(), 120)
    window.setTimeout(notifyStart, 180)
  }

  if (options.delayMs && options.delayMs > 0) {
    pendingSpeechTimer = window.setTimeout(startSpeaking, options.delayMs)
  } else {
    startSpeaking()
  }

  return true
}
