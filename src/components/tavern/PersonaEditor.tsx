import { Download, FileUp, ImagePlus, Plus, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { pickAvatarFile } from '../../lib/tauri'
import type { Persona } from '../../types/tauri'
import { AvatarBadge } from '../AvatarBadge'

interface PersonaEditorProps {
  personas: Persona[]
  onSave: (persona: Persona) => Promise<Persona | undefined>
  onImport: (path: string) => Promise<void>
  onExport: (personaId: string, path: string) => Promise<void>
}

function emptyPersona(): Persona {
  return {
    id: '',
    name: '新 Persona',
    avatar: null,
    description: '',
    isDefault: false,
    createdAt: '',
    updatedAt: '',
  }
}

export function PersonaEditor({ personas, onSave, onImport, onExport }: PersonaEditorProps) {
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState<Persona>(emptyPersona())
  const [isCreating, setIsCreating] = useState(false)
  const [importPath, setImportPath] = useState('')
  const [exportPath, setExportPath] = useState('')

  useEffect(() => {
    if (isCreating) return
    const next = personas.find((persona) => persona.id === selectedId) ?? personas[0]
    if (next) {
      setSelectedId(next.id)
      setDraft(next)
      return
    }
    setSelectedId('')
    setDraft(emptyPersona())
  }, [isCreating, personas, selectedId])

  function update<K extends keyof Persona>(key: K, value: Persona[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function uploadAvatar() {
    const path = await pickAvatarFile()
    if (!path) return
    const nextDraft = { ...draft, avatar: path }
    setDraft(nextDraft)
    if (nextDraft.id) {
      const saved = await onSave(nextDraft)
      if (saved) setDraft(saved)
    }
  }

  function createPersona() {
    setIsCreating(true)
    setSelectedId('')
    setDraft(emptyPersona())
  }

  async function saveDraft() {
    const saved = await onSave(draft)
    if (!saved) return
    setIsCreating(false)
    setSelectedId(saved.id)
    setDraft(saved)
  }

  return (
    <div className="tavern-grid tavern-grid--editor">
      <aside className="tavern-list">
        <div className="tavern-list__head">
          <strong>Persona</strong>
          <button className="icon-button" title="新 Persona" type="button" onClick={createPersona}>
            <Plus size={15} />
          </button>
        </div>
        {personas.map((persona) => (
          <button
            key={persona.id}
            className={`tavern-list-item ${persona.id === draft.id ? 'tavern-list-item--active' : ''}`}
            type="button"
            onClick={() => {
              setIsCreating(false)
              setSelectedId(persona.id)
              setDraft(persona)
            }}
          >
            <span>{persona.name}</span>
            <small>{persona.isDefault ? '默认身份' : '可选身份'}</small>
          </button>
        ))}
      </aside>

      <section className="tavern-editor">
        <div className="tavern-form-grid">
          <label>
            名字
            <input value={draft.name} onChange={(event) => update('name', event.target.value)} />
          </label>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={draft.isDefault}
              onChange={(event) => update('isDefault', event.target.checked)}
            />
            默认 Persona
          </label>
          <div className="avatar-field">
            <AvatarBadge name={draft.name} avatar={draft.avatar} className="editor-avatar" />
            <label>
              头像路径
              <input value={draft.avatar || ''} onChange={(event) => update('avatar', event.target.value || null)} />
            </label>
            <button className="secondary-button" type="button" onClick={() => void uploadAvatar()}>
              <ImagePlus size={16} />
              上传头像
            </button>
          </div>
        </div>
        <label>
          身份设定
          <textarea
            className="tavern-large-textarea"
            value={draft.description}
            onChange={(event) => update('description', event.target.value)}
          />
        </label>
        <div className="tavern-actions">
          <button className="primary-button" type="button" onClick={() => void saveDraft()}>
            <Save size={16} />
            保存 Persona
          </button>
          <input
            value={importPath}
            placeholder="C:\\Persona.json"
            onChange={(event) => setImportPath(event.target.value)}
          />
          <button className="secondary-button" type="button" onClick={() => void onImport(importPath)}>
            <FileUp size={16} />
            导入
          </button>
          <input
            value={exportPath}
            placeholder="C:\\导出\\Persona.json"
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
