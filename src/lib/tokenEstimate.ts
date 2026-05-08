import type { ChatMessage, LlmMessage, Persona, PromptPreset, TavernCharacter } from '../types/tauri'

interface PromptEstimateInput {
  messages: ChatMessage[]
  input: string
  preset?: PromptPreset
  character?: TavernCharacter
  persona?: Persona
}

function replacePresetVars(text: string, character?: TavernCharacter, persona?: Persona, preset?: PromptPreset) {
  return text
    .replaceAll('{{char}}', character?.name || '鲸灵')
    .replaceAll('{{user}}', persona?.name || '我')
    .replaceAll('{{replyLimit}}', String(preset?.replyLimit ?? 100))
}

function isCjk(char: string) {
  const code = char.codePointAt(0) ?? 0
  return (
    (code >= 0x3400 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  )
}

function isAsciiWord(char: string) {
  return /[A-Za-z0-9_]/.test(char)
}

function isPunctuationOrSymbol(char: string) {
  return /[^\p{L}\p{N}\s]/u.test(char)
}

export function estimateTokenCount(text: string) {
  const content = text.trim()
  if (!content) return 0

  let tokens = 0

  for (const char of content) {
    if (/\s/.test(char)) {
      continue
    }
    if (isCjk(char)) {
      tokens += 0.6
    } else if (isAsciiWord(char)) {
      tokens += 0.3
    } else if (isPunctuationOrSymbol(char)) {
      tokens += 1
    } else {
      tokens += 0.6
    }
  }

  return Math.max(1, Math.ceil(tokens))
}

export function estimateMessagesTokens(messages: Array<Pick<LlmMessage, 'role' | 'content'>>) {
  if (!messages.length) return 0
  return messages.reduce((total, message) => total + estimateTokenCount(message.content) + 4, 2)
}

export function estimatePromptTokens({ messages, input, preset, character, persona }: PromptEstimateInput) {
  const recentMessages = messages
    .filter((message) => !message.compacted && message.role !== 'system' && message.content.trim())
    .slice(-(preset?.contextMessages ?? 24))

  const systemParts = [
    replacePresetVars(preset?.systemPrompt || '你是{{char}}，请保持角色一致。', character, persona, preset),
    character
      ? `角色卡:\n名字: ${character.name}\n描述: ${character.description}\n性格: ${character.personality}\n场景: ${character.scenario}`
      : '',
    character?.mesExample?.trim() ? `示例对话:\n${character.mesExample}` : '',
    persona?.description?.trim() ? `用户 Persona:\n${persona.description}` : '',
    preset?.authorNote?.trim() ? `作者注释:\n${replacePresetVars(preset.authorNote, character, persona, preset)}` : '',
    preset?.instructTemplate?.trim()
      ? `输出规则:\n${replacePresetVars(preset.instructTemplate, character, persona, preset)}`
      : '',
  ].filter(Boolean)

  return estimateMessagesTokens([
    { role: 'system', content: systemParts.join('\n\n') },
    ...recentMessages.map((message) => ({ role: message.role, content: message.content })),
    { role: 'user', content: input },
  ])
}

export function estimatePresetBaseTokens(preset: PromptPreset) {
  return estimatePromptTokens({
    messages: [],
    input: '',
    preset,
  })
}
