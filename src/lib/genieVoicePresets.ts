import type { GenieConfig, TtsSettings } from '../types/tauri'

const GENIE_WORK_PATH =
  'C:\\Game\\Shinsekai\\Shinsekai 1.6.4-dev\\Shinsekai\\data\\tts_bundles\\installed\\genie_tts_server\\Genie-TTS Server'

export interface GenieVoicePreset {
  id: string
  label: string
  description: string
  config: GenieConfig
}

export const genieVoicePresets: GenieVoicePreset[] = [
  {
    id: 'sakura',
    label: '间桐樱',
    description: '日语 / Fate',
    config: {
      serverUrl: 'http://127.0.0.1:9880/',
      workPath: GENIE_WORK_PATH,
      characterName: '间桐樱',
      onnxModelDir: 'C:\\Game\\character\\_work\\onnx\\sakura_149afd6316',
      gptModelPath: 'C:\\Game\\character\\_work\\extracted\\sakura_149afd6316\\models\\sakura-e15.ckpt',
      sovitsModelPath: 'C:\\Game\\character\\_work\\extracted\\sakura_149afd6316\\models\\sakura_e8_s376.pth',
      referenceAudioPath:
        'C:\\Game\\character\\_work\\extracted\\sakura_149afd6316\\models\\sakura.wav_0000532160_0000657920.wav',
      referenceText: 'おかえりなさい、先輩キリツグさん',
      language: 'ja',
      referenceLanguage: 'ja',
    },
  },
  {
    id: 'azusa_zibaizhou',
    label: '梓（日配）',
    description: '日语 / 蔚蓝档案',
    config: {
      serverUrl: 'http://127.0.0.1:9880/',
      workPath: GENIE_WORK_PATH,
      characterName: 'azusa_zibaizhou',
      onnxModelDir: 'C:\\Game\\character\\_work\\onnx\\azusa_zibaizhou',
      gptModelPath:
        'C:\\Game\\character\\voice-models\\gpt-sovits\\blue-archive\\azusa\\日配数据集制\\成品模型\\GPT_weights_v2\\Zi_BaiZhou-e15.ckpt',
      sovitsModelPath:
        'C:\\Game\\character\\voice-models\\gpt-sovits\\blue-archive\\azusa\\日配数据集制\\成品模型\\SoVITS_weights_v2\\Zi_BaiZhou_e16_s256.pth',
      referenceAudioPath:
        'C:\\Game\\character\\voice-models\\gpt-sovits\\blue-archive\\azusa\\日配数据集制\\参考音频\\Azusa_Battle_TSA_1.wav',
      referenceText: '戦術支援兵器到着、今から敵の殲滅作戦に入る。',
      language: 'Japanese',
      referenceLanguage: 'Japanese',
    },
  },
  {
    id: 'elysia',
    label: '爱莉希雅',
    description: '中文 / 崩坏3',
    config: {
      serverUrl: 'http://127.0.0.1:9880/',
      workPath: GENIE_WORK_PATH,
      characterName: '爱莉希雅',
      onnxModelDir: 'C:\\Game\\character\\_work\\onnx\\elysia_gpt_sovits_20',
      gptModelPath:
        'C:\\Game\\character\\voice-models\\gpt-sovits\\honkai-impact-3rd\\elysia\\gpt-sovits-2.0\\GPT_weights_v2\\【GPT2.0】Elysia-e20.ckpt',
      sovitsModelPath:
        'C:\\Game\\character\\voice-models\\gpt-sovits\\honkai-impact-3rd\\elysia\\gpt-sovits-2.0\\SoVITS_weights_v2\\【GPT2.0】Elysia_e24_s13080.pth',
      referenceAudioPath:
        'C:\\Game\\character\\voice-models\\gpt-sovits\\honkai-impact-3rd\\elysia\\gpt-sovits-2.0\\参考音频\\【普通】嗨想我了吗？不论何时何地，爱莉希雅都会回应你的期待。.wav',
      referenceText: '嗨想我了吗？不论何时何地，爱莉希雅都会回应你的期待。',
      language: 'zh',
      referenceLanguage: 'zh',
    },
  },
]

export function findGenieVoicePreset(config: GenieConfig) {
  return genieVoicePresets.find((preset) => {
    return (
      preset.config.characterName === config.characterName &&
      preset.config.onnxModelDir === config.onnxModelDir &&
      preset.config.referenceAudioPath === config.referenceAudioPath
    )
  })
}

export function applyGenieVoicePreset(settings: TtsSettings, presetId: string): TtsSettings {
  const preset = genieVoicePresets.find((item) => item.id === presetId)
  if (!preset) return settings
  return {
    ...settings,
    enabled: true,
    engine: 'genie',
    genie: {
      ...settings.genie,
      ...preset.config,
    },
  }
}
