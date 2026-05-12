import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  AudioLines,
  ChevronDown,
  ChevronUp,
  Clock3,
  DatabaseZap,
  Gauge,
  Hash,
  KeyRound,
  Pin,
  Power,
  RotateCcw,
  Save,
  Server,
  SlidersHorizontal,
  Volume2,
} from 'lucide-react'
import { getDistinctSpeechVoices, pickSpeechVoice, speakLocalText, speakPiperText } from '../lib/speech'
import { getPiperStatus, runningInTauri, saveApiKey, speakText, toggleAutostart } from '../lib/tauri'
import { usePetStore } from '../stores/petStore'
import type { AppSettings, PiperStatus, ProviderConfig, TtsSettings } from '../types/tauri'

interface SettingsPanelProps {
  settings: AppSettings
  ttsSettings: TtsSettings
  voices: SpeechSynthesisVoice[]
  providers: ProviderConfig[]
  activeProviderId: string
  onSettingsChange: (settings: AppSettings) => void
  onTtsSettingsChange: (settings: TtsSettings) => void
  onProviderChange: (providerId: string) => void | Promise<void>
  onClear: () => void | Promise<void>
}

function voiceLabel(voice: SpeechSynthesisVoice) {
  return `${voice.name}${voice.lang ? ` / ${voice.lang}` : ''}`
}

export function SettingsPanel({
  settings,
  ttsSettings,
  voices,
  providers,
  activeProviderId,
  onSettingsChange,
  onTtsSettingsChange,
  onProviderChange,
  onClear,
}: SettingsPanelProps) {
  const [apiKey, setApiKey] = useState('')
  const [autostart, setAutostart] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [piperStatus, setPiperStatus] = useState<PiperStatus | null>(null)
  const [ttsStatus, setTtsStatus] = useState('')
  const hasKey = usePetStore((state) => state.hasApiKey)
  const showMessageTimes = usePetStore((state) => state.showMessageTimes)
  const showTokenStats = usePetStore((state) => state.showTokenStats)
  const setHasApiKey = usePetStore((state) => state.setHasApiKey)
  const setShowMessageTimes = usePetStore((state) => state.setShowMessageTimes)
  const setShowTokenStats = usePetStore((state) => state.setShowTokenStats)
  const activeProvider = providers.find((provider) => provider.id === activeProviderId)
  const isWebBridge = activeProvider?.providerType === 'web-bridge'

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    onSettingsChange({ ...settings, [key]: value })
  }

  function updateTts<K extends keyof TtsSettings>(key: K, value: TtsSettings[K]) {
    onTtsSettingsChange({ ...ttsSettings, [key]: value })
  }

  async function refreshPiperStatus() {
    const status = await getPiperStatus()
    setPiperStatus(status)
    return status
  }

  useEffect(() => {
    refreshPiperStatus().catch(() => undefined)
  }, [])

  function previewVoice(nextSettings = ttsSettings, delayMs = 0) {
    if (nextSettings.engine === 'piper') {
      window.setTimeout(() => {
        void speakPiperText('你好啊，呼噜。', nextSettings, { ignoreEnabled: true })
          .then((ok) => setTtsStatus(ok ? 'Piper 已试听' : 'Piper 未启动'))
          .catch((error) => setTtsStatus(String(error)))
      }, delayMs)
      return
    }

    const availableVoices =
      voices.length || typeof window === 'undefined' || !('speechSynthesis' in window)
        ? voices
        : getDistinctSpeechVoices(window.speechSynthesis.getVoices())
    const voice = pickSpeechVoice(availableVoices, nextSettings.voiceURI)
    const previewText = voice?.lang.toLowerCase().startsWith('zh') ? '你好啊' : 'Hello'

    const spokenInWebView = speakLocalText(previewText, nextSettings, availableVoices, {
      delayMs,
      ignoreEnabled: true,
    })
    if (spokenInWebView || !runningInTauri()) return

    if (runningInTauri()) {
      window.setTimeout(() => {
        void speakText(previewText, {
          voiceName: voice?.voiceURI || voice?.name,
          lang: voice?.lang || (previewText === '你好啊' ? 'zh-CN' : 'en-US'),
          rate: nextSettings.rate,
          volume: nextSettings.volume,
        }).catch(() => {
          speakLocalText(previewText, nextSettings, availableVoices, { ignoreEnabled: true })
        })
      }, delayMs)
      return
    }
  }

  function changeVoice(voiceURI: string) {
    const nextSettings = { ...ttsSettings, voiceURI }
    onTtsSettingsChange(nextSettings)
    previewVoice(nextSettings, 180)
  }

  function changeTtsEngine(engine: TtsSettings['engine']) {
    const nextSettings = { ...ttsSettings, engine }
    onTtsSettingsChange(nextSettings)
    if (engine === 'piper') {
      void refreshPiperStatus().then((status) => setTtsStatus(status.message)).catch((error) => setTtsStatus(String(error)))
    } else {
      setTtsStatus('已切换到系统语音')
    }
  }

  async function saveKey() {
    if (isWebBridge) return
    await saveApiKey(apiKey)
    setHasApiKey(apiKey.trim().length > 0)
    setApiKey('')
  }

  async function toggleBoot(enabled: boolean) {
    setAutostart(enabled)
    const actual = await toggleAutostart(enabled).catch(() => false)
    setAutostart(actual)
  }

  return (
    <div className={`settings-drawer ${expanded ? 'settings-drawer--expanded' : ''}`} data-no-window-drag="true">
      <button
        className="settings-toggle-button"
        type="button"
        title={expanded ? '收起设置' : '展开设置'}
        aria-expanded={expanded}
        aria-label={expanded ? '收起设置' : '展开设置'}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
      </button>

      <div className="settings">
        <div className="settings-row">
          <label htmlFor="chat-provider">
            <Server size={14} />
            Provider
          </label>
          <select
            id="chat-provider"
            value={activeProviderId}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => void onProviderChange(event.target.value)}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
          <span>{isWebBridge ? '网页桥' : activeProvider?.keySaved ? 'Key 已存' : activeProvider?.authType === 'none' ? '本地' : 'API'}</span>
        </div>

        <div className="settings-row">
          <label htmlFor="api-key">
            <KeyRound size={14} />
            API Key
          </label>
          <input
            id="api-key"
            type="password"
            value={apiKey}
            disabled={isWebBridge}
            placeholder={isWebBridge ? '网页桥不需要 API Key' : hasKey ? '已保存到系统凭据' : 'sk-...'}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <button className="icon-button" title="保存" type="button" disabled={isWebBridge} onClick={() => void saveKey()}>
            <Save size={15} />
          </button>
        </div>

        <div className="settings-row">
          <label htmlFor="model">
            <DatabaseZap size={14} />
            {isWebBridge ? '网页端模式' : '模型'}
          </label>
          {isWebBridge ? (
            <input id="model" value="由 DeepSeek 网页端按钮决定" disabled readOnly />
          ) : (
            <select
              id="model"
              value={settings.model}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => update('model', event.target.value)}
            >
              <option value="deepseek-v4-flash">deepseek-v4-flash</option>
              <option value="deepseek-v4-pro">deepseek-v4-pro</option>
            </select>
          )}
          <span />
        </div>

        {isWebBridge ? (
          <p className="settings-note settings-note--bridge">
            当前聊天会走本地网页桥；请保持扩展页 bridge 已启动，且 DeepSeek 网页端脚本在线。
          </p>
        ) : null}

        <div className="settings-row">
          <label htmlFor="scale">
            <SlidersHorizontal size={14} />
            缩放
          </label>
          <input
            id="scale"
            type="range"
            min="0.35"
            max="3.2"
            step="0.05"
            value={settings.scale}
            onChange={(event) => update('scale', Number(event.target.value))}
          />
          <span>{Math.round(settings.scale * 100)}%</span>
        </div>

        <div className="settings-row">
          <label>
            <Volume2 size={14} />
            播报
          </label>
          <button
            className={`toggle ${ttsSettings.enabled ? 'toggle--on' : ''}`}
            type="button"
            onClick={() => updateTts('enabled', !ttsSettings.enabled)}
            title="语音播报"
          >
            <span />
          </button>
          <span />
        </div>

        <div className="settings-row">
          <label htmlFor="tts-engine">
            <AudioLines size={14} />
            引擎
          </label>
          <select
            id="tts-engine"
            value={ttsSettings.engine}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              changeTtsEngine(event.target.value === 'piper' ? 'piper' : 'system')
            }
          >
            <option value="system">系统语音</option>
            <option value="piper">Piper 中文 medium</option>
          </select>
          <button
            className="secondary-button sample-button"
            type="button"
            onClick={() => void refreshPiperStatus().then((status) => setTtsStatus(status.message))}
            title="检测 Piper"
          >
            检测
          </button>
        </div>

        <div className="settings-row">
          <label>
            <Clock3 size={14} />
            时间
          </label>
          <button
            className={`toggle ${showMessageTimes ? 'toggle--on' : ''}`}
            type="button"
            onClick={() => setShowMessageTimes(!showMessageTimes)}
            title="显示对话时间"
          >
            <span />
          </button>
          <span />
        </div>

        <div className="settings-row">
          <label>
            <Hash size={14} />
            Token
          </label>
          <button
            className={`toggle ${showTokenStats ? 'toggle--on' : ''}`}
            type="button"
            onClick={() => setShowTokenStats(!showTokenStats)}
            title="显示 Token 统计"
          >
            <span />
          </button>
          <span />
        </div>

        <div className="settings-row">
          <label htmlFor="voice">
            <AudioLines size={14} />
            音色
          </label>
          <select
            id="voice"
            value={ttsSettings.voiceURI}
            disabled={ttsSettings.engine === 'piper'}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => changeVoice(event.target.value)}
          >
            <option value="">{ttsSettings.engine === 'piper' ? '固定：zh_CN huayan medium' : '系统默认中文'}</option>
            {voices.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voiceLabel(voice)}
              </option>
            ))}
          </select>
          <button className="secondary-button sample-button" type="button" onClick={() => previewVoice()} title="试听音色">
            试听
          </button>
        </div>

        <div className="settings-row">
          <label htmlFor="voice-rate">
            <Gauge size={14} />
            语速
          </label>
          <input
            id="voice-rate"
            type="range"
            min="0.6"
            max="1.8"
            step="0.05"
            value={ttsSettings.rate}
            onChange={(event) => updateTts('rate', Number(event.target.value))}
          />
          <span>{ttsSettings.rate.toFixed(2)}x</span>
        </div>

        <div className="settings-row">
          <label htmlFor="voice-volume">
            <Volume2 size={14} />
            音量
          </label>
          <input
            id="voice-volume"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={ttsSettings.volume}
            onChange={(event) => updateTts('volume', Number(event.target.value))}
          />
          <span>{Math.round(ttsSettings.volume * 100)}%</span>
        </div>

        <div className="settings-row">
          <label>
            <Pin size={14} />
            置顶
          </label>
          <button
            className={`toggle ${settings.alwaysOnTop ? 'toggle--on' : ''}`}
            type="button"
            onClick={() => update('alwaysOnTop', !settings.alwaysOnTop)}
            title="置顶"
          >
            <span />
          </button>
          <span />
        </div>

        <div className="settings-row">
          <label>
            <Power size={14} />
            自启
          </label>
          <button
            className={`toggle ${autostart ? 'toggle--on' : ''}`}
            type="button"
            onClick={() => void toggleBoot(!autostart)}
            title="开机自启"
          >
            <span />
          </button>
          <span />
        </div>

        <div className="settings-row">
          <label>
            <RotateCcw size={14} />
            记忆
          </label>
          <button className="secondary-button" type="button" onClick={onClear}>
            清空当前聊天
          </button>
          <span />
        </div>

        <p className="settings-note">
          {ttsSettings.engine === 'piper'
            ? piperStatus?.message || ttsStatus || 'Piper 只使用中文 medium；模型没下完时不会启动。'
            : ttsStatus || '口头禅：呼噜，慢慢来就好。'}
        </p>
      </div>
    </div>
  )
}
