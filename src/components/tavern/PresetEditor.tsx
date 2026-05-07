import { Download, FileUp, Plus, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { estimatePresetBaseTokens } from '../../lib/tokenEstimate'
import { usePetStore } from '../../stores/petStore'
import type { PromptPreset } from '../../types/tauri'

interface PresetEditorProps {
  presets: PromptPreset[]
  onSave: (preset: PromptPreset) => Promise<PromptPreset | undefined>
  onImport: (path: string) => Promise<void>
  onExport: (presetId: string, path: string) => Promise<void>
}

function emptyPreset(): PromptPreset {
  return {
    id: '',
    name: '新预设',
    enabled: true,
    systemPrompt: '你是{{char}}，请保持角色一致。',
    instructTemplate: '',
    authorNote: '',
    contextMessages: 24,
    maxInputChars: 8000,
    maxOutputTokens: 220,
    temperature: 0.8,
    replyLimit: 100,
    createdAt: '',
    updatedAt: '',
  }
}

export function PresetEditor({ presets, onSave, onImport, onExport }: PresetEditorProps) {
  const [draft, setDraft] = useState<PromptPreset>(emptyPreset())
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [importPath, setImportPath] = useState('')
  const [exportPath, setExportPath] = useState('')
  const showTokenStats = usePetStore((state) => state.showTokenStats)

  useEffect(() => {
    if (!presets.length) return
    setDraft((current) => {
      const wantedId = selectedPresetId || current.id
      const matched = presets.find((preset) => preset.id === wantedId)
      if (matched) return matched
      if (isCreating) return current
      return presets[0]
    })
  }, [isCreating, presets, selectedPresetId])

  function update<K extends keyof PromptPreset>(key: K, value: PromptPreset[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function saveDraft() {
    const saved = await onSave(draft)
    if (!saved) return
    setIsCreating(false)
    setSelectedPresetId(saved.id)
    setDraft(saved)
  }

  function selectPreset(preset: PromptPreset) {
    setIsCreating(false)
    setSelectedPresetId(preset.id)
    setDraft(preset)
  }

  function createPreset() {
    setIsCreating(true)
    setSelectedPresetId('')
    setDraft(emptyPreset())
  }

  return (
    <div className="tavern-grid tavern-grid--editor">
      <aside className="tavern-list">
        <div className="tavern-list__head">
          <strong>预设</strong>
          <button className="icon-button" title="新预设" type="button" onClick={createPreset}>
            <Plus size={15} />
          </button>
        </div>
        {presets.map((preset) => (
          <button
            key={preset.id}
            className={`tavern-list-item ${preset.id === draft.id ? 'tavern-list-item--active' : ''}`}
            type="button"
            onClick={() => selectPreset(preset)}
          >
            <span>{preset.name}</span>
            <small>
              {preset.enabled ? '' : '已禁用 / '}
              {preset.contextMessages} 条上下文 / {preset.maxInputChars} 预算 / {preset.maxOutputTokens} 输出
            </small>
          </button>
        ))}
      </aside>

      <section className="tavern-editor">
        {showTokenStats && (
          <div className="preset-budget-strip">
            <span>
              当前上下文预算占用约 {estimatePresetBaseTokens(draft)} / {draft.maxInputChars} tokens
            </span>
            <span>{draft.contextMessages} 条上下文</span>
            <span>最大输出 {draft.maxOutputTokens} tokens</span>
          </div>
        )}
        <div className="tavern-form-grid tavern-form-grid--three">
          <label>
            名称
            <input value={draft.name} onChange={(event) => update('name', event.target.value)} />
          </label>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => update('enabled', event.target.checked)}
            />
            启用预设
          </label>
          <label>
            上下文条数
            <input
              type="number"
              value={draft.contextMessages}
              onChange={(event) => update('contextMessages', Number(event.target.value))}
            />
          </label>
          <label>
            输入预算 tokens
            <input
              type="number"
              value={draft.maxInputChars}
              onChange={(event) => update('maxInputChars', Number(event.target.value))}
            />
          </label>
          <label>
            最大输出
            <input
              type="number"
              value={draft.maxOutputTokens}
              onChange={(event) => update('maxOutputTokens', Number(event.target.value))}
            />
          </label>
          <label>
            温度
            <input
              type="number"
              min="0"
              max="2"
              step="0.05"
              value={draft.temperature}
              onChange={(event) => update('temperature', Number(event.target.value))}
            />
          </label>
          <label>
            回复字数
            <input
              type="number"
              value={draft.replyLimit}
              onChange={(event) => update('replyLimit', Number(event.target.value))}
            />
          </label>
        </div>
        <label>
          System Prompt
          <textarea
            className="tavern-large-textarea"
            value={draft.systemPrompt}
            onChange={(event) => update('systemPrompt', event.target.value)}
          />
        </label>
        <label>
          Instruct 模板
          <textarea value={draft.instructTemplate} onChange={(event) => update('instructTemplate', event.target.value)} />
        </label>
        <label>
          作者注释
          <textarea value={draft.authorNote} onChange={(event) => update('authorNote', event.target.value)} />
        </label>

        <div className="tavern-actions">
          <button className="primary-button" type="button" onClick={() => void saveDraft()}>
            <Save size={16} />
            保存预设
          </button>
          <input
            value={importPath}
            placeholder="C:\\预设.json"
            onChange={(event) => setImportPath(event.target.value)}
          />
          <button className="secondary-button" type="button" onClick={() => void onImport(importPath)}>
            <FileUp size={16} />
            导入
          </button>
          <input
            value={exportPath}
            placeholder="C:\\导出\\预设.json"
            onChange={(event) => setExportPath(event.target.value)}
          />
          <button className="secondary-button" type="button" onClick={() => void onExport(draft.id, exportPath)}>
            <Download size={16} />
            导出
          </button>
        </div>
      </section>
    </div>
  )
}
