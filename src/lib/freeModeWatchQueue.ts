import type {
  FreeModeWatchEvent,
  FreeModeWatchEventStatus,
  FreeModeWatchEventType,
} from '../types/tauri'

const defaultMaxItems = 12
const defaultSimilarityThreshold = 0.86
const maxReactionKeys = 12
const eventTypes = new Set<FreeModeWatchEventType>([
  'window-change',
  'ocr-change',
  'ui-change',
  'visual-change',
  'screen-motion',
])

const priorities: Record<FreeModeWatchEventType, number> = {
  'window-change': 95,
  'visual-change': 85,
  'ocr-change': 55,
  'ui-change': 50,
  'screen-motion': 20,
}

export interface FreeModeWatchQueueOptions {
  maxItems?: number
  now?: () => Date
  similarityThreshold?: number
}

export interface FreeModeWatchSnapshot {
  title?: string
  processName?: string
  ocrText?: string
  uiText?: string
  visionText?: string
  imageHash?: string
  screenMotion?: boolean
  motionScore?: number
}

export interface FreeModeWatchQueueSummary {
  total: number
  pending: number
  processing: number
  ignored: number
  responded: number
  lastObservationSummary: string
  recentReactionKeys: string[]
}

export interface FreeModeWatchQueue {
  observe: (snapshot: FreeModeWatchSnapshot) => FreeModeWatchEvent[]
  next: () => FreeModeWatchEvent | null
  mark: (id: string, status: FreeModeWatchEventStatus, summary?: string) => FreeModeWatchEvent | null
  summary: () => FreeModeWatchQueueSummary
  recentReactionSummary: () => string
  recordReaction: (event: FreeModeWatchEvent, prompt: string) => void
  items: () => FreeModeWatchEvent[]
}

interface LastTextKeys {
  ocr: string
  ui: string
  visual: string
  imageHash: string
}

interface ReactionRecord {
  key: string
  title: string
  prompt: string
  createdAt: string
}

export function createFreeModeWatchQueue(options: FreeModeWatchQueueOptions = {}): FreeModeWatchQueue {
  const maxItems = clampInteger(options.maxItems ?? defaultMaxItems, 1, defaultMaxItems)
  const similarityThreshold = clampNumber(options.similarityThreshold ?? defaultSimilarityThreshold, 0.5, 0.98)
  const getNow = options.now ?? (() => new Date())
  const queue: FreeModeWatchEvent[] = []
  const recentReactionKeys: string[] = []
  const reactionRecords: ReactionRecord[] = []
  const lastTextKeys: LastTextKeys = {
    ocr: '',
    ui: '',
    visual: '',
    imageHash: '',
  }

  let lastObservationSummary = ''
  let lastWindowKey = ''
  let sequence = 0

  function observe(snapshot: FreeModeWatchSnapshot) {
    const normalizedSnapshot = normalizeSnapshot(snapshot)
    const created: FreeModeWatchEvent[] = []
    const windowKey = buildWindowKey(normalizedSnapshot)

    if (windowKey && windowKey !== lastWindowKey) {
      lastWindowKey = windowKey
      created.push(enqueue(buildEvent('window-change', normalizedSnapshot, describeWindowChange(normalizedSnapshot), getNow(), sequence)))
      sequence += 1
    }

    if (shouldEnqueueTextChange('ocr-change', normalizedSnapshot.ocrText, lastTextKeys.ocr, normalizedSnapshot)) {
      lastTextKeys.ocr = normalizeComparableText(normalizedSnapshot.ocrText)
      created.push(enqueue(buildEvent('ocr-change', normalizedSnapshot, summarizeTextChange('OCR', normalizedSnapshot.ocrText), getNow(), sequence)))
      sequence += 1
    }

    if (shouldEnqueueTextChange('ui-change', normalizedSnapshot.uiText, lastTextKeys.ui, normalizedSnapshot)) {
      lastTextKeys.ui = normalizeComparableText(normalizedSnapshot.uiText)
      created.push(enqueue(buildEvent('ui-change', normalizedSnapshot, summarizeTextChange('UI', normalizedSnapshot.uiText), getNow(), sequence)))
      sequence += 1
    }

    if (shouldEnqueueVisualChange(normalizedSnapshot)) {
      lastTextKeys.visual = normalizeComparableText(normalizedSnapshot.visionText)
      lastTextKeys.imageHash = normalizedSnapshot.imageHash
      created.push(enqueue(buildEvent('visual-change', normalizedSnapshot, summarizeVisualChange(normalizedSnapshot), getNow(), sequence)))
      sequence += 1
    }

    if (normalizedSnapshot.screenMotion && !hasSimilarRecentEvent('screen-motion', reactionKey('screen-motion', normalizedSnapshot))) {
      created.push(enqueue(buildEvent('screen-motion', normalizedSnapshot, 'Screen motion detected.', getNow(), sequence)))
      sequence += 1
    }

    if (created.length > 0) {
      lastObservationSummary = created.map((event) => `${event.type}: ${event.summary}`).join('\n')
    }

    return created
  }

  function next() {
    const nextEvent = queue
      .filter((event) => event.status === 'pending')
      .sort((left, right) => right.priority - left.priority || left.createdAt.localeCompare(right.createdAt))[0]

    if (!nextEvent) return null
    nextEvent.status = 'processing'
    return { ...nextEvent }
  }

  function mark(id: string, status: FreeModeWatchEventStatus, summary?: string) {
    const event = queue.find((item) => item.id === id)
    if (!event || !isWatchStatus(status)) return null
    event.status = status
    if (typeof summary === 'string') event.summary = limitText(summary, 240)
    return { ...event }
  }

  function summary(): FreeModeWatchQueueSummary {
    return {
      total: queue.length,
      pending: queue.filter((event) => event.status === 'pending').length,
      processing: queue.filter((event) => event.status === 'processing').length,
      ignored: queue.filter((event) => event.status === 'ignored').length,
      responded: queue.filter((event) => event.status === 'responded').length,
      lastObservationSummary,
      recentReactionKeys: [...recentReactionKeys],
    }
  }

  function recentReactionSummary() {
    return reactionRecords
      .slice(-5)
      .map((record) => `${record.createdAt} ${record.title}: ${limitText(record.prompt, 120)}`)
      .join('\n')
  }

  function recordReaction(event: FreeModeWatchEvent, prompt: string) {
    if (!eventTypes.has(event.type)) return
    const key = reactionKey(event.type, event)
    pushUnique(recentReactionKeys, key, maxReactionKeys)
    reactionRecords.push({
      key,
      title: event.title || event.type,
      prompt: prompt.trim(),
      createdAt: getNow().toISOString(),
    })
    while (reactionRecords.length > maxReactionKeys) reactionRecords.shift()
  }

  function items() {
    return queue.map((event) => ({ ...event }))
  }

  function shouldEnqueueTextChange(
    type: Extract<FreeModeWatchEventType, 'ocr-change' | 'ui-change'>,
    text: string,
    lastKey: string,
    snapshot: Required<FreeModeWatchSnapshot>,
  ) {
    const key = normalizeComparableText(text)
    if (!key || isSimilarText(key, lastKey, similarityThreshold)) return false
    return !hasSimilarRecentEvent(type, reactionKey(type, snapshot))
  }

  function shouldEnqueueVisualChange(snapshot: Required<FreeModeWatchSnapshot>) {
    const visualKey = normalizeComparableText(snapshot.visionText)
    const imageChanged = Boolean(snapshot.imageHash && snapshot.imageHash !== lastTextKeys.imageHash)
    const textChanged = Boolean(visualKey && !isSimilarText(visualKey, lastTextKeys.visual, similarityThreshold))
    if (!imageChanged && !textChanged) return false
    return !hasSimilarRecentEvent('visual-change', reactionKey('visual-change', snapshot))
  }

  function hasSimilarRecentEvent(type: FreeModeWatchEventType, key: string) {
    if (recentReactionKeys.some((recentKey) => isSimilarKey(recentKey, key, similarityThreshold))) return true
    return queue.some((event) => event.type === type && event.status === 'pending' && isSimilarKey(reactionKey(event.type, event), key, similarityThreshold))
  }

  function enqueue(event: FreeModeWatchEvent) {
    queue.push(event)
    while (queue.length > maxItems) queue.shift()
    return { ...event }
  }

  return {
    observe,
    next,
    mark,
    summary,
    recentReactionSummary,
    recordReaction,
    items,
  }
}

function normalizeSnapshot(snapshot: FreeModeWatchSnapshot): Required<FreeModeWatchSnapshot> {
  const motionScore = typeof snapshot.motionScore === 'number' && Number.isFinite(snapshot.motionScore)
    ? snapshot.motionScore
    : 0

  return {
    title: safeText(snapshot.title),
    processName: safeText(snapshot.processName),
    ocrText: safeText(snapshot.ocrText),
    uiText: safeText(snapshot.uiText),
    visionText: safeText(snapshot.visionText),
    imageHash: safeText(snapshot.imageHash),
    screenMotion: Boolean(snapshot.screenMotion) || motionScore > 0.2,
    motionScore,
  }
}

function buildEvent(
  type: FreeModeWatchEventType,
  snapshot: Required<FreeModeWatchSnapshot>,
  summary: string,
  now: Date,
  sequence: number,
): FreeModeWatchEvent {
  return {
    id: `${now.getTime().toString(36)}-${sequence.toString(36)}-${type}`,
    type,
    priority: priorities[type],
    title: eventTitle(type, snapshot),
    processName: snapshot.processName,
    ocrText: snapshot.ocrText,
    uiText: snapshot.uiText,
    visionText: snapshot.visionText,
    imageHash: snapshot.imageHash,
    summary,
    createdAt: now.toISOString(),
    status: 'pending',
  }
}

function eventTitle(type: FreeModeWatchEventType, snapshot: Required<FreeModeWatchSnapshot>) {
  if (type === 'window-change') return snapshot.title || snapshot.processName || 'Window changed'
  if (type === 'visual-change') return 'Visual change'
  if (type === 'ocr-change') return 'OCR change'
  if (type === 'ui-change') return 'UI change'
  return 'Screen motion'
}

function describeWindowChange(snapshot: Required<FreeModeWatchSnapshot>) {
  const target = [snapshot.processName, snapshot.title].filter(Boolean).join(' - ')
  return target ? `Active window changed: ${target}` : 'Active window changed.'
}

function summarizeTextChange(label: string, text: string) {
  return `${label} changed: ${limitText(text, 180)}`
}

function summarizeVisualChange(snapshot: Required<FreeModeWatchSnapshot>) {
  const text = limitText(snapshot.visionText, 160)
  if (text && snapshot.imageHash) return `Visual changed: ${text} (${snapshot.imageHash})`
  if (text) return `Visual changed: ${text}`
  if (snapshot.imageHash) return `Visual image changed: ${snapshot.imageHash}`
  return 'Visual changed.'
}

function buildWindowKey(snapshot: Required<FreeModeWatchSnapshot>) {
  return normalizeComparableText(`${snapshot.processName}\n${snapshot.title}`)
}

function reactionKey(type: FreeModeWatchEventType, input: Pick<FreeModeWatchEvent, 'processName' | 'title' | 'ocrText' | 'uiText' | 'visionText' | 'imageHash'>) {
  const text = [
    input.processName,
    input.title,
    type === 'ocr-change' ? input.ocrText : '',
    type === 'ui-change' ? input.uiText : '',
    type === 'visual-change' ? `${input.visionText} ${input.imageHash}` : '',
  ].join('\n')

  return `${type}:${normalizeComparableText(text)}`
}

function normalizeComparableText(text: string) {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/https?:\/\/\S+/gu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function isSimilarKey(left: string, right: string, threshold: number) {
  if (!left || !right) return false
  if (left === right) return true
  const leftParts = left.split(':')
  const rightParts = right.split(':')
  if (leftParts[0] !== rightParts[0]) return false
  return isSimilarText(leftParts.slice(1).join(':'), rightParts.slice(1).join(':'), threshold)
}

function isSimilarText(left: string, right: string, threshold: number) {
  if (!left || !right) return false
  if (left === right) return true
  if (left.includes(right) || right.includes(left)) {
    const shorter = Math.min(left.length, right.length)
    const longer = Math.max(left.length, right.length)
    return shorter / Math.max(1, longer) >= 0.72
  }

  const leftTokens = new Set(left.split(' ').filter(Boolean))
  const rightTokens = new Set(right.split(' ').filter(Boolean))
  if (!leftTokens.size || !rightTokens.size) return false

  let overlap = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1
  }

  return overlap / (leftTokens.size + rightTokens.size - overlap) >= threshold
}

function safeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function limitText(text: string, maxLength: number) {
  const trimmed = text.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trim()}...`
}

function pushUnique(values: string[], value: string, limit: number) {
  const existingIndex = values.indexOf(value)
  if (existingIndex >= 0) values.splice(existingIndex, 1)
  values.push(value)
  while (values.length > limit) values.shift()
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return max
  return Math.max(min, Math.min(max, Math.round(value)))
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function isWatchStatus(value: string): value is FreeModeWatchEventStatus {
  return value === 'pending' || value === 'processing' || value === 'ignored' || value === 'responded'
}
