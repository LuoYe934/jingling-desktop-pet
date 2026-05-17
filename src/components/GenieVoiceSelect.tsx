import { AudioLines } from 'lucide-react'
import { applyGenieVoicePreset, findGenieVoicePreset, genieVoicePresets } from '../lib/genieVoicePresets'
import { stopSpeech } from '../lib/speech'
import type { TtsSettings } from '../types/tauri'

interface GenieVoiceSelectProps {
  settings: TtsSettings
  onChange: (settings: TtsSettings) => void
  compact?: boolean
}

export function GenieVoiceSelect({ settings, onChange, compact = false }: GenieVoiceSelectProps) {
  const activePreset = settings.engine === 'genie' ? findGenieVoicePreset(settings.genie) : undefined
  const value = activePreset?.id || ''

  function selectPreset(presetId: string) {
    if (!presetId) return
    stopSpeech()
    onChange(applyGenieVoicePreset(settings, presetId))
  }

  return (
    <label
      className={`genie-voice-select ${compact ? 'genie-voice-select--compact' : ''}`}
      data-active={Boolean(activePreset)}
      title={`Genie 角色声：${activePreset?.label || '沿用设置'}；自由模式按演出分段朗读`}
    >
      <AudioLines size={14} />
      <select aria-label="Genie 角色声" value={value} onChange={(event) => selectPreset(event.target.value)}>
        <option value="">沿用设置</option>
        {genieVoicePresets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
      </select>
    </label>
  )
}
