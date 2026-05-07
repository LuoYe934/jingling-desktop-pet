import { Eye } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { PromptBuildResult, PromptPreset, TavernCharacter, TavernChatListItem } from '../../types/tauri'
import { previewPrompt } from '../../lib/tauri'
import { estimateMessagesTokens } from '../../lib/tokenEstimate'
import { usePetStore } from '../../stores/petStore'

interface PromptPreviewProps {
  characters: TavernCharacter[]
  chats: TavernChatListItem[]
  presets: PromptPreset[]
}

export function PromptPreview({ characters, chats, presets }: PromptPreviewProps) {
  const [characterId, setCharacterId] = useState('')
  const [chatId, setChatId] = useState('')
  const [presetId, setPresetId] = useState('')
  const [message, setMessage] = useState('你好，今天陪我聊聊。')
  const [result, setResult] = useState<PromptBuildResult | null>(null)
  const showTokenStats = usePetStore((state) => state.showTokenStats)
  const selectableCharacters = useMemo(() => {
    const enabled = characters.filter((character) => character.enabled)
    return enabled.length ? enabled : characters
  }, [characters])
  const selectablePresets = useMemo(() => {
    const enabled = presets.filter((preset) => preset.enabled)
    return enabled.length ? enabled : presets
  }, [presets])

  async function runPreview() {
    setResult(
      await previewPrompt({
        characterId: characterId || undefined,
        chatId: chatId || undefined,
        presetId: presetId || undefined,
        message,
      }),
    )
  }

  return (
    <div className="prompt-preview">
      <div className="tavern-form-grid tavern-form-grid--three">
        <label>
          角色
          <select value={characterId} onChange={(event) => setCharacterId(event.target.value)}>
            <option value="">默认</option>
            {selectableCharacters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          聊天
          <select value={chatId} onChange={(event) => setChatId(event.target.value)}>
            <option value="">自动</option>
            {chats.map((chat) => (
              <option key={chat.id} value={chat.id}>
                {chat.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          预设
          <select value={presetId} onChange={(event) => setPresetId(event.target.value)}>
            <option value="">默认</option>
            {selectablePresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        测试输入
        <textarea value={message} onChange={(event) => setMessage(event.target.value)} />
      </label>
      <div className="tavern-actions">
        <button className="primary-button" type="button" onClick={() => void runPreview()}>
          <Eye size={16} />
          生成预览
        </button>
      </div>

      {result && (
        <>
          <div className="metric-grid">
            {showTokenStats && (
              <div>
                <strong>{estimateMessagesTokens(result.messages)}</strong>
                <span>约 tokens</span>
              </div>
            )}
            <div>
              <strong>{result.estimatedChars}</strong>
              <span>输入 tokens</span>
            </div>
            <div>
              <strong>{result.budgetChars}</strong>
              <span>预算</span>
            </div>
            <div>
              <strong>{result.maxOutputTokens}</strong>
              <span>最大输出</span>
            </div>
            <div>
              <strong>{result.temperature}</strong>
              <span>温度</span>
            </div>
          </div>

          <div className="match-strip">
            {result.matchedWorldbookEntries.length
              ? result.matchedWorldbookEntries.map((entry) => <span key={entry.entryId}>{entry.title}</span>)
              : <span>无世界书触发</span>}
          </div>

          <div className="prompt-message-list">
            {result.messages.map((item, index) => (
              <article key={`${item.role}-${index}`} className="prompt-message">
                <strong>{item.role}</strong>
                <pre>{item.content}</pre>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
