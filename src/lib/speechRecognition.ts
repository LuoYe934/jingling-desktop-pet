type SpeechRecognitionResultLike = {
  isFinal: boolean
  0?: {
    transcript: string
  }
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}

type SpeechRecognitionErrorEventLike = {
  error?: string
  message?: string
}

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

type SpeechRecognitionWindow = Window &
  typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }

export interface SpeechRecognitionController {
  supported: boolean
  isListening: () => boolean
  start: () => boolean
  stop: () => void
  abort: () => void
}

interface SpeechRecognitionControllerOptions {
  lang?: string
  continuous?: boolean
  interimResults?: boolean
  onFinalText: (text: string) => void
  onListeningChange?: (listening: boolean) => void
  onError?: (message: string, code?: string) => void
}

export function getSpeechRecognitionConstructor() {
  if (typeof window === 'undefined') return undefined
  const speechWindow = window as SpeechRecognitionWindow
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
}

export function appendSpeechText(current: string, incoming: string) {
  const next = incoming.trim()
  if (!next) return current
  const prefix = current.trim()
  return prefix ? `${prefix}${/[，。！？,.!?]$/.test(prefix) ? '' : ' '}${next}` : next
}

export function createSpeechRecognitionController(
  options: SpeechRecognitionControllerOptions,
): SpeechRecognitionController {
  let recognition: SpeechRecognitionLike | null = null
  let listening = false
  let starting = false

  const setListening = (next: boolean) => {
    listening = next
    options.onListeningChange?.(next)
  }

  const cleanup = (target: SpeechRecognitionLike) => {
    starting = false
    if (recognition === target) {
      recognition = null
    }
    setListening(false)
  }

  return {
    supported: Boolean(getSpeechRecognitionConstructor()),
    isListening: () => listening || starting,
    start: () => {
      const SpeechRecognition = getSpeechRecognitionConstructor()
      if (!SpeechRecognition) {
        options.onError?.('当前环境不支持内置语音输入，可使用系统输入法')
        return false
      }

      recognition?.abort()
      const instance = new SpeechRecognition()
      recognition = instance
      starting = true
      instance.lang = options.lang || 'zh-CN'
      instance.continuous = options.continuous ?? false
      instance.interimResults = options.interimResults ?? true
      instance.maxAlternatives = 1
      instance.onresult = (event) => {
        let finalText = ''
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index]
          const transcript = result[0]?.transcript ?? ''
          if (result.isFinal) finalText += transcript
        }
        if (finalText.trim()) {
          options.onFinalText(finalText)
        }
      }
      instance.onerror = (event) => {
        const reason = event.message || event.error || '语音输入失败'
        options.onError?.(reason === 'not-allowed' ? '麦克风权限被拒绝' : `语音输入失败：${reason}`, event.error)
      }
      instance.onend = () => cleanup(instance)

      try {
        instance.start()
        starting = false
        setListening(true)
        return true
      } catch (error) {
        starting = false
        recognition = null
        setListening(false)
        options.onError?.(`语音输入启动失败：${String(error)}`)
        return false
      }
    },
    stop: () => {
      starting = false
      recognition?.stop()
      setListening(false)
    },
    abort: () => {
      starting = false
      recognition?.abort()
      recognition = null
      setListening(false)
    },
  }
}
