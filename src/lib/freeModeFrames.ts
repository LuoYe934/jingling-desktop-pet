import type {
  FreeModeFrameEffect,
  FreeModePerformanceCue,
  FreeModePerformanceFrame,
  FreeModePerformancePayload,
  FreeModeAction,
  FreeModeChoice,
  FreeModeCg,
  FreeModePose,
  ResolvedFreeModeFrame,
  StageBgm,
  StageScene,
} from '../types/tauri'

const legacyOpeningPoseRe = /^\s*\[pose\s*:\s*([^\]\s]+)\]\s*/i
const allowedEffects = new Set(['none', 'soft-pop', 'shake', 'blush'])
const allowedActions = new Set(['none', 'lean-forward', 'nod', 'step-back', 'shake'])
const defaultCuePauseMs = 130
const malformedJsonFallbackText = '我刚才有点乱，重新整理一下再说。'

interface ResolveFreeModeFramesOptions {
  poses: FreeModePose[]
  scenes?: StageScene[]
  bgms?: StageBgm[]
  cgs?: FreeModeCg[]
  defaultPoseId?: string
  currentPoseId?: string
  defaultSpeaker?: string
}

export function extractFirstJsonObject(text: string): string {
  const source = stripJsonFence(text.trim())
  const start = source.indexOf('{')
  if (start < 0) return ''

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }

  return ''
}

export function stripLegacyOpeningPoseTag(text: string): { text: string; poseId: string } {
  const match = text.match(legacyOpeningPoseRe)
  if (!match) return { text, poseId: '' }

  return {
    text: text.slice(match[0].length),
    poseId: match[1] ?? '',
  }
}

export function splitFreeModeFrameCues(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  if (normalized.length <= 16) return [normalized]

  const cues: string[] = []
  let remaining = normalized
  let target = 12

  while (remaining.length > 0) {
    if (remaining.length <= target + 6) {
      cues.push(remaining.trim())
      break
    }

    const splitIndex = findCueSplitIndex(remaining, target)
    const cue = remaining.slice(0, splitIndex).trim()
    if (cue) cues.push(cue)

    remaining = remaining.slice(splitIndex).trim()
    target = 16
  }

  return cues.filter(Boolean)
}

export function createFreeModeFrameStreamParser() {
  let buffer = ''
  let frameArrayCursor = -1
  let emittedCount = 0

  function consumeCompleteFrames() {
    if (frameArrayCursor < 0) {
      frameArrayCursor = findFrameArrayContentStart(buffer)
      if (frameArrayCursor < 0) return []
    }

    const frames: FreeModePerformanceFrame[] = []
    let objectStart = -1
    let depth = 0
    let inString = false
    let escaped = false

    for (let index = frameArrayCursor; index < buffer.length; index += 1) {
      const char = buffer[index]

      if (inString) {
        if (escaped) {
          escaped = false
        } else if (char === '\\') {
          escaped = true
        } else if (char === '"') {
          inString = false
        }
        continue
      }

      if (char === '"') {
        inString = true
      } else if (char === '{') {
        if (depth === 0) objectStart = index
        depth += 1
      } else if (char === '}') {
        if (depth > 0) depth -= 1
        if (depth === 0 && objectStart >= 0) {
          const fragment = buffer.slice(objectStart, index + 1)
          try {
            const parsed = JSON.parse(fragment) as unknown
            const parsedFrames = framesFromParsedValue(parsed)
            frames.push(...parsedFrames)
            emittedCount += parsedFrames.length
          } catch {
            // In streaming mode we only emit fully valid frame objects.
          }
          frameArrayCursor = index + 1
          objectStart = -1
        }
      } else if (depth === 0 && char === ']') {
        frameArrayCursor = index + 1
        break
      }
    }

    return frames
  }

  return {
    push(chunk: string) {
      buffer += chunk
      return consumeCompleteFrames()
    },
    flush() {
      return consumeCompleteFrames()
    },
    reset() {
      buffer = ''
      frameArrayCursor = -1
      emittedCount = 0
    },
    get emittedCount() {
      return emittedCount
    },
  }
}

export function resolveFreeModeFrames(input: string | FreeModePerformancePayload, options: ResolveFreeModeFramesOptions): ResolvedFreeModeFrame[] {
  const defaultPoseId = resolvePoseId('', options)
  const parsedFrames = typeof input === 'string' ? parsePerformanceFrames(input) : framesFromParsedValue(input)
  const fallbackInput = typeof input === 'string' ? input : ''
  const frames = parsedFrames.length > 0 ? parsedFrames : [fallbackTextFrame(fallbackInput)]
  const resolved = frames.map((frame, index) => {
    const stripped = stripLegacyOpeningPoseTag(toText(frame.text))
    const poseId = resolvePoseId(stripped.poseId || toText(frame.poseId), options)
    const text = sanitizeDialogueText(stripped.text)
    const bgmDirective = resolveOptionalAssetDirective(frame, 'bgmId', options.bgms)
    const sceneDirective = resolveOptionalAssetDirective(frame, 'sceneId', options.scenes)
    const cgDirective = resolveOptionalAssetDirective(frame, 'cgId', options.cgs)
    const frameDefaults = {
      poseId: poseId || defaultPoseId,
      effect: normalizeEffect(frame.effect),
      action: normalizeAction(frame.action),
      bgmDirective,
      sceneDirective,
      cgDirective,
    }
    const cues = normalizeFreeModeCues(frame, text, frameDefaults, options, `frame-${index}`)
    const resolvedText = text || cues.map((cue) => cue.text).join('')

    return {
      id: `frame-${index}`,
      speaker: toText(frame.speaker).trim() || options.defaultSpeaker || '',
      text: resolvedText,
      poseId: frameDefaults.poseId,
      effect: frameDefaults.effect,
      hasBgmDirective: bgmDirective.hasDirective,
      ...(bgmDirective.id ? { bgmId: bgmDirective.id } : {}),
      hasSceneDirective: sceneDirective.hasDirective,
      ...(sceneDirective.id ? { sceneId: sceneDirective.id } : {}),
      hasCgDirective: cgDirective.hasDirective,
      ...(cgDirective.id ? { cgId: cgDirective.id } : {}),
      action: frameDefaults.action,
      choices: normalizeFreeModeChoices(frame.choices),
      cues,
    }
  })

  const visibleFrames = resolved.filter((frame) => frame.text || frame.cues.length)
  return visibleFrames.length ? visibleFrames : [fallbackResolvedFrame(fallbackInput, options, defaultPoseId)]
}

function stripJsonFence(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match?.[1]?.trim() ?? text
}

function parsePerformanceFrames(input: string): FreeModePerformanceFrame[] {
  const source = stripJsonFence(input.trim())
  const candidates = [
    source.trim().startsWith('{') || source.trim().startsWith('[') ? source.trim() : '',
    repairJsonCandidate(source),
    extractFirstJsonValue(source),
  ].filter(Boolean)

  for (const candidate of candidates) {
    const frames = parseJsonCandidate(candidate)
    if (frames.length) return frames
  }

  return extractFramesFromMalformedJson(source)
}

function extractFirstJsonValue(text: string): string {
  const source = stripJsonFence(text.trim())
  const start = source.search(/[{\x5b]/u)
  if (start < 0) return ''

  const opening = source[start]
  const closing = opening === '[' ? ']' : '}'
  const stack: string[] = []
  let inString = false
  let escaped = false

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      stack.push('}')
    } else if (char === '[') {
      stack.push(']')
    } else if ((char === '}' || char === ']') && stack.at(-1) === char) {
      stack.pop()
      if (stack.length === 0) return source.slice(start, index + 1)
    }
  }

  return source.slice(start).includes(closing) ? '' : repairJsonCandidate(source.slice(start))
}

function findFrameArrayContentStart(input: string): number {
  const framesKey = input.search(/"frames"\s*:/u)
  if (framesKey < 0) return -1
  const arrayStart = input.indexOf('[', framesKey)
  return arrayStart >= 0 ? arrayStart + 1 : -1
}

function fallbackTextFrame(input: string): FreeModePerformanceFrame {
  const stripped = stripLegacyOpeningPoseTag(input)
  return {
    text: looksLikePerformanceJson(stripped.text) ? malformedJsonFallbackText : stripped.text,
    poseId: stripped.poseId,
  }
}

function fallbackResolvedFrame(
  input: string,
  options: ResolveFreeModeFramesOptions,
  defaultPoseId: string,
): ResolvedFreeModeFrame {
  const stripped = stripLegacyOpeningPoseTag(input)
  const text = looksLikePerformanceJson(stripped.text) ? malformedJsonFallbackText : stripped.text.trim()
  const poseId = resolvePoseId(stripped.poseId, options) || defaultPoseId

  return {
    id: 'frame-0',
    speaker: options.defaultSpeaker || '',
    text,
    poseId,
    effect: 'none',
    hasBgmDirective: false,
    hasSceneDirective: false,
    hasCgDirective: false,
    action: 'none',
    choices: [],
    cues: splitFreeModeFrameCues(text).map((cue, index) => ({
      id: `frame-0:cue-${index}`,
      text: cue,
      poseId,
      effect: 'none',
      hasBgmDirective: false,
      hasSceneDirective: false,
      hasCgDirective: false,
      action: 'none',
      pauseMs: defaultCuePauseMs,
    })),
  }
}

function resolvePoseId(poseId: string, options: ResolveFreeModeFramesOptions): string {
  const availablePoseIds = new Set(options.poses.map((pose) => pose.id))
  const candidates = [
    poseId,
    options.currentPoseId ?? '',
    options.defaultPoseId ?? '',
    options.poses[0]?.id ?? '',
  ]

  return candidates.find((candidate) => candidate && availablePoseIds.has(candidate)) ?? ''
}

function parseJsonCandidate(candidate: string): FreeModePerformanceFrame[] {
  if (!candidate.trim()) return []
  try {
    const parsed = JSON.parse(candidate) as FreeModePerformancePayload | FreeModePerformanceFrame | FreeModePerformanceFrame[]
    return framesFromParsedValue(parsed)
  } catch {
    const repaired = repairJsonCandidate(candidate)
    if (!repaired || repaired === candidate) return []
    try {
      const parsed = JSON.parse(repaired) as FreeModePerformancePayload | FreeModePerformanceFrame | FreeModePerformanceFrame[]
      return framesFromParsedValue(parsed)
    } catch {
      return []
    }
  }
}

function framesFromParsedValue(value: unknown): FreeModePerformanceFrame[] {
  if (isFramePayload(value)) return value.frames.filter(isFrameObject)
  if (Array.isArray(value)) return value.filter(isFrameObject)
  if (isFrameLikeObject(value)) return [value]
  return []
}

function repairJsonCandidate(input: string): string {
  const source = stripJsonFence(input.trim())
  const objectStart = source.search(/[{\x5b]/u)
  if (objectStart < 0) return ''

  let repaired = source.slice(objectStart).trim()
  const fenceIndex = repaired.indexOf('```')
  if (fenceIndex >= 0) repaired = repaired.slice(0, fenceIndex).trim()

  repaired = closeJsonDelimiters(repaired)
  return repaired.replace(/,\s*([}\]])/gu, '$1')
}

function closeJsonDelimiters(input: string): string {
  const stack: string[] = []
  let output = ''
  let inString = false
  let escaped = false

  for (const char of input) {
    output += char

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      stack.push('}')
    } else if (char === '[') {
      stack.push(']')
    } else if (char === '}' || char === ']') {
      const expected = stack[stack.length - 1]
      if (expected === char) {
        stack.pop()
      }
    }
  }

  if (inString) output += '"'
  while (stack.length) output += stack.pop()
  return output
}

function extractFramesFromMalformedJson(input: string): FreeModePerformanceFrame[] {
  if (!looksLikePerformanceJson(input)) return []

  const source = stripJsonFence(input.trim())
  const fragments = extractJsonObjectFragments(source)
  for (const fragment of fragments) {
    const frames = parseJsonCandidate(fragment)
    if (frames.length) return frames
  }

  const textFieldMatches = [...source.matchAll(/"text"\s*:\s*"/gu)]
  if (!textFieldMatches.length) return []

  return textFieldMatches
    .filter((match) => !isInsideChoicesArray(source, match.index ?? 0))
    .map((match, index, matches) => {
      const matchIndex = match.index ?? 0
      const nextIndex = matches[index + 1]?.index ?? source.length
      const frameStart = Math.max(0, source.lastIndexOf('{', matchIndex))
      const segment = source.slice(frameStart, nextIndex)
      return extractMalformedFrameFields(segment)
    })
    .filter((frame): frame is FreeModePerformanceFrame => Boolean(frame?.text?.trim()))
}

function isInsideChoicesArray(source: string, index: number): boolean {
  const choicesIndex = source.lastIndexOf('"choices"', index)
  if (choicesIndex < 0) return false

  const arrayStart = source.indexOf('[', choicesIndex)
  if (arrayStart < 0 || arrayStart > index) return false

  let depth = 0
  let inString = false
  let escaped = false

  for (let cursor = arrayStart; cursor < index; cursor += 1) {
    const char = source[cursor]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '[') {
      depth += 1
    } else if (char === ']') {
      depth = Math.max(0, depth - 1)
      if (depth === 0) return false
    }
  }

  return depth > 0
}

function extractJsonObjectFragments(input: string): string[] {
  const fragments: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0 && start >= 0) {
        fragments.push(input.slice(start, index + 1))
        start = -1
      }
    }
  }

  if (start >= 0 && depth > 0) {
    fragments.push(repairJsonCandidate(input.slice(start)))
  }

  return fragments
}

function extractMalformedFrameFields(segment: string): FreeModePerformanceFrame | null {
  const text = decodeJsonishString(extractStringField(segment, 'text')).trim()
  if (!text) return null

  return {
    speaker: decodeJsonishString(extractStringField(segment, 'speaker')),
    text,
    poseId: decodeJsonishString(extractStringField(segment, 'poseId')),
    effect: decodeJsonishString(extractStringField(segment, 'effect')) as FreeModeFrameEffect,
    bgmId: decodeJsonishString(extractStringField(segment, 'bgmId')),
    sceneId: decodeJsonishString(extractStringField(segment, 'sceneId')),
    cgId: decodeJsonishString(extractStringField(segment, 'cgId')),
    action: decodeJsonishString(extractStringField(segment, 'action')) as FreeModeAction,
    choices: extractChoicesFromMalformedFrame(segment),
  }
}

function normalizeFreeModeCues(
  frame: FreeModePerformanceFrame,
  frameText: string,
  frameDefaults: {
    poseId: string
    effect: FreeModeFrameEffect
    action: FreeModeAction
    bgmDirective: { hasDirective: boolean; id: string }
    sceneDirective: { hasDirective: boolean; id: string }
    cgDirective: { hasDirective: boolean; id: string }
  },
  options: ResolveFreeModeFramesOptions,
  frameId: string,
) {
  const rawCues: Array<string | FreeModePerformanceCue> = Array.isArray(frame.cues) && frame.cues.length
    ? frame.cues
    : splitFreeModeFrameCues(frameText).map((text) => ({ text }))

  return rawCues
    .map((rawCue, index) => {
      const cueObject: FreeModePerformanceCue = typeof rawCue === 'string' ? { text: rawCue } : rawCue
      if (!cueObject || typeof cueObject !== 'object') return null
      const stripped = stripLegacyOpeningPoseTag(toText(cueObject.text))
      const text = sanitizeDialogueText(stripped.text)
      if (!text) return null

      const bgmDirective = resolveOptionalAssetDirective(cueObject, 'bgmId', options.bgms)
      const sceneDirective = resolveOptionalAssetDirective(cueObject, 'sceneId', options.scenes)
      const cgDirective = resolveOptionalAssetDirective(cueObject, 'cgId', options.cgs)
      const resolvedBgmDirective = bgmDirective.hasDirective ? bgmDirective : frameDefaults.bgmDirective
      const resolvedSceneDirective = sceneDirective.hasDirective ? sceneDirective : frameDefaults.sceneDirective
      const resolvedCgDirective = cgDirective.hasDirective ? cgDirective : frameDefaults.cgDirective
      const pauseMs = typeof cueObject.pauseMs === 'number' && Number.isFinite(cueObject.pauseMs)
        ? Math.min(1200, Math.max(0, Math.round(cueObject.pauseMs)))
        : defaultCuePauseMs

      return {
        id: `${frameId}:cue-${index}`,
        text,
        poseId: resolvePoseId(stripped.poseId || toText(cueObject.poseId), {
          ...options,
          currentPoseId: frameDefaults.poseId || options.currentPoseId,
        }) || frameDefaults.poseId,
        effect: Object.prototype.hasOwnProperty.call(cueObject, 'effect') ? normalizeEffect(cueObject.effect) : frameDefaults.effect,
        hasBgmDirective: resolvedBgmDirective.hasDirective,
        ...(resolvedBgmDirective.id ? { bgmId: resolvedBgmDirective.id } : {}),
        hasSceneDirective: resolvedSceneDirective.hasDirective,
        ...(resolvedSceneDirective.id ? { sceneId: resolvedSceneDirective.id } : {}),
        hasCgDirective: resolvedCgDirective.hasDirective,
        ...(resolvedCgDirective.id ? { cgId: resolvedCgDirective.id } : {}),
        action: Object.prototype.hasOwnProperty.call(cueObject, 'action') ? normalizeAction(cueObject.action) : frameDefaults.action,
        pauseMs,
      }
    })
    .filter((cue): cue is NonNullable<typeof cue> => cue !== null)
}

function extractStringField(segment: string, key: string): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = segment.match(new RegExp(`"${escapedKey}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`, 'u'))
  return match?.[1] ?? ''
}

function extractChoicesFromMalformedFrame(segment: string): Array<string | FreeModeChoice> {
  const choicesIndex = segment.search(/"choices"\s*:/u)
  if (choicesIndex < 0) return []
  const arrayStart = segment.indexOf('[', choicesIndex)
  if (arrayStart < 0) return []

  const repaired = repairJsonCandidate(segment.slice(arrayStart))
  try {
    const parsed = JSON.parse(repaired) as unknown
    if (Array.isArray(parsed)) return parsed.filter((choice) => typeof choice === 'string' || isFrameObject(choice)) as Array<string | FreeModeChoice>
  } catch {
    return [...segment.slice(arrayStart).matchAll(/"label"\s*:\s*"((?:\\.|[^"\\])*)/gu)]
      .map((match) => decodeJsonishString(match[1] ?? '').trim())
      .filter(Boolean)
  }
  return []
}

function decodeJsonishString(value: string): string {
  if (!value) return ''
  try {
    return JSON.parse(`"${value.replace(/\r?\n/gu, '\\n')}"`) as string
  } catch {
    return value
      .replace(/\\"/gu, '"')
      .replace(/\\n/gu, '\n')
      .replace(/\\r/gu, '\r')
      .replace(/\\t/gu, '\t')
      .replace(/\\\\/gu, '\\')
  }
}

function sanitizeDialogueText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  if (!looksLikePerformanceJson(trimmed)) return trimmed

  const extracted = extractFramesFromMalformedJson(trimmed)
    .map((frame) => toText(frame.text).trim())
    .filter(Boolean)
  return extracted.length ? extracted.join('\n') : ''
}

function looksLikePerformanceJson(input: string): boolean {
  const text = stripJsonFence(input.trim())
  return (
    /^[{\x5b]/u.test(text) ||
    /```(?:json)?/iu.test(input) ||
    /[{,]\s*"[^"]+"\s*:/u.test(text) ||
    /"frames"\s*:/u.test(text) ||
    /"(?:speaker|text|cues|poseId|effect|action|choices)"\s*:/u.test(text)
  )
}

function normalizeEffect(effect: FreeModeFrameEffect | undefined): FreeModeFrameEffect {
  return effect && allowedEffects.has(effect) ? effect : 'none'
}

function normalizeAction(action: FreeModeAction | undefined): FreeModeAction {
  return action && allowedActions.has(action) ? action : 'none'
}

function resolveAssetId<T extends { id: string }>(id: unknown, assets: T[] | undefined): string {
  if (typeof id !== 'string' || !id.trim() || !assets?.length) return ''
  const trimmed = id.trim()
  return assets.some((asset) => asset.id === trimmed) ? trimmed : ''
}

function resolveOptionalAssetDirective<T extends { id: string }>(
  frame: Partial<FreeModePerformanceFrame>,
  key: 'bgmId' | 'sceneId' | 'cgId',
  assets: T[] | undefined,
): { hasDirective: boolean; id: string } {
  const hasDirective = Object.prototype.hasOwnProperty.call(frame, key)
  if (!hasDirective) return { hasDirective: false, id: '' }
  const rawValue = frame[key]
  if (typeof rawValue !== 'string') return { hasDirective: false, id: '' }
  if (!rawValue.trim()) return { hasDirective: true, id: '' }
  const id = resolveAssetId(rawValue, assets)
  return { hasDirective: Boolean(id), id }
}

export function normalizeFreeModeChoices(raw: unknown): FreeModeChoice[] {
  if (!Array.isArray(raw)) return []

  const choices = raw
    .map<FreeModeChoice | null>((choice, index) => {
      if (typeof choice === 'string') {
        const label = choice.trim()
        return label ? { id: `choice-${index}`, label, prompt: label } : null
      }
      if (!choice || typeof choice !== 'object') return null
      const item = choice as Record<string, unknown>
      const label = toText(item.label || item.text).trim()
      if (!label) return null
      const prompt = toText(item.prompt).trim()
      const id = toText(item.id).trim()
      return {
        id: id || `choice-${index}`,
        label,
        prompt: prompt || label,
      }
    })
    .filter((choice): choice is FreeModeChoice => choice !== null)

  return choices.slice(0, 4)
}

function findCueSplitIndex(text: string, target: number): number {
  const sentenceIndex = findPreferredBoundary(text, target, /[\u3002\uff01\uff1f.!?\u2026]/u)
  if (sentenceIndex > 0) return sentenceIndex

  const softIndex = findPreferredBoundary(text, target, /[\uff0c\u3001\uff1b;,:]/u)
  if (softIndex > 0) return softIndex

  const windowStart = Math.max(1, target - 5)
  const windowEnd = Math.min(text.length - 1, target + 5)

  for (let index = windowEnd; index >= windowStart; index -= 1) {
    if (/\s/u.test(text[index] ?? '')) return index + 1
  }

  return Math.min(text.length, target)
}

function findPreferredBoundary(text: string, target: number, pattern: RegExp): number {
  const min = Math.max(0, target - 8)
  const max = Math.min(text.length - 1, target + 8)

  for (let index = max; index >= min; index -= 1) {
    if (pattern.test(text[index] ?? '')) return index + 1
  }

  return -1
}

function isFramePayload(value: unknown): value is { frames: FreeModePerformanceFrame[] } {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as { frames?: unknown }).frames))
}

function isFrameObject(value: unknown): value is FreeModePerformanceFrame {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isFrameLikeObject(value: unknown): value is FreeModePerformanceFrame {
  if (!isFrameObject(value)) return false
  return ['speaker', 'text', 'cues', 'poseId', 'effect', 'bgmId', 'sceneId', 'cgId', 'action', 'choices'].some((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  )
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
