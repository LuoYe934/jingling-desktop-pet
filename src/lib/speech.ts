import type { TtsSettings } from '../types/tauri'
import { synthesizePiper } from './tauri'

let activeUtterance: SpeechSynthesisUtterance | null = null
let pendingSpeechTimer: number | undefined
let activePiperAudio: HTMLAudioElement | null = null

interface SpeakOptions {
  delayMs?: number
  ignoreEnabled?: boolean
}

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
  if (pendingSpeechTimer !== undefined) {
    window.clearTimeout(pendingSpeechTimer)
    pendingSpeechTimer = undefined
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
  if (activePiperAudio) {
    activePiperAudio.pause()
    activePiperAudio.src = ''
    activePiperAudio = null
  }
  activeUtterance = null
}

export async function speakPiperText(
  text: string,
  settings: TtsSettings,
  options: Pick<SpeakOptions, 'ignoreEnabled'> = {},
) {
  const content = text.trim()
  if (!content || settings.engine !== 'piper') return false
  if (!options.ignoreEnabled && !settings.enabled) return false

  const wavUrl = await synthesizePiper(content, settings.rate)
  if (!wavUrl) return false

  stopSpeech()
  const audio = new Audio(wavUrl)
  activePiperAudio = audio
  audio.volume = settings.volume
  audio.onended = () => {
    if (activePiperAudio === audio) {
      activePiperAudio = null
    }
  }
  audio.onerror = () => {
    if (activePiperAudio === audio) {
      activePiperAudio = null
    }
  }
  await audio.play()
  return true
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
  if (settings.engine === 'piper') return false

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

  utterance.onend = () => {
    if (activeUtterance === utterance) {
      activeUtterance = null
    }
  }
  utterance.onerror = utterance.onend

  stopSpeech()
  activeUtterance = utterance

  const startSpeaking = () => {
    pendingSpeechTimer = undefined
    synth.resume()
    synth.speak(utterance)
    window.setTimeout(() => synth.resume(), 120)
  }

  if (options.delayMs && options.delayMs > 0) {
    pendingSpeechTimer = window.setTimeout(startSpeaking, options.delayMs)
  } else {
    startSpeaking()
  }

  return true
}
