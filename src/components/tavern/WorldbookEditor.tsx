import { Download, FileUp, Plus, Save, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Worldbook, WorldbookEntry, WorldbookMatch } from '../../types/tauri'
import { testWorldbookMatch } from '../../lib/tauri'

interface WorldbookEditorProps {
  worldbooks: Worldbook[]
  onSave: (worldbook: Worldbook) => Promise<Worldbook | undefined>
  onImport: (path: string) => Promise<void>
  onExport: (worldbookId: string, path: string) => Promise<void>
}

function emptyEntry(): WorldbookEntry {
  return {
    id: '',
    title: '新条目',
    keys: [],
    content: '',
    enabled: true,
    priority: 10,
    position: 'system',
  }
}

function emptyWorldbook(): Worldbook {
  return {
    id: '',
    name: '新世界书',
    enabled: true,
    entries: [emptyEntry()],
    createdAt: '',
    updatedAt: '',
  }
}

export function WorldbookEditor({ worldbooks, onSave, onImport, onExport }: WorldbookEditorProps) {
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState<Worldbook>(emptyWorldbook())
  const [isCreating, setIsCreating] = useState(false)
  const [entryIndex, setEntryIndex] = useState(0)
  const [keysText, setKeysText] = useState('')
  const [testText, setTestText] = useState('')
  const [importPath, setImportPath] = useState('')
  const [exportPath, setExportPath] = useState('')
  const [matches, setMatches] = useState<WorldbookMatch[]>([])
  const entry = useMemo(() => draft.entries[entryIndex] || emptyEntry(), [draft.entries, entryIndex])

  useEffect(() => {
    if (isCreating) return
    const next = worldbooks.find((worldbook) => worldbook.id === selectedId) ?? worldbooks[0]
    if (next) {
      setSelectedId(next.id)
      setDraft(next)
      setEntryIndex(0)
      setKeysText(next.entries[0]?.keys.join(', ') || '')
      return
    }
    const empty = emptyWorldbook()
    setSelectedId('')
    setDraft(empty)
    setEntryIndex(0)
    setKeysText(empty.entries[0]?.keys.join(', ') || '')
  }, [isCreating, selectedId, worldbooks])

  function updateEntry(next: WorldbookEntry) {
    setDraft((current) => ({
      ...current,
      entries: current.entries.map((item, index) => (index === entryIndex ? next : item)),
    }))
  }

  function chooseEntry(index: number) {
    setEntryIndex(index)
    setKeysText(draft.entries[index]?.keys.join(', ') || '')
  }

  async function save() {
    const saved = await onSave({
      ...draft,
      entries: draft.entries.map((item, index) =>
        index === entryIndex
          ? {
              ...item,
              keys: keysText
                .split(',')
                .map((key) => key.trim())
                .filter(Boolean),
            }
          : item,
      ),
    })
    if (!saved) return
    const nextEntryIndex = Math.min(entryIndex, Math.max(0, saved.entries.length - 1))
    setIsCreating(false)
    setSelectedId(saved.id)
    setDraft(saved)
    setEntryIndex(nextEntryIndex)
    setKeysText(saved.entries[nextEntryIndex]?.keys.join(', ') || '')
  }

  async function runMatch() {
    setMatches(await testWorldbookMatch(testText))
  }

  function createWorldbook() {
    const empty = emptyWorldbook()
    setIsCreating(true)
    setSelectedId('')
    setDraft(empty)
    setEntryIndex(0)
    setKeysText(empty.entries[0]?.keys.join(', ') || '')
  }

  return (
    <div className="tavern-grid tavern-grid--editor">
      <aside className="tavern-list">
        <div className="tavern-list__head">
          <strong>世界书</strong>
          <button className="icon-button" title="新世界书" type="button" onClick={createWorldbook}>
            <Plus size={15} />
          </button>
        </div>
        {worldbooks.map((worldbook) => (
          <button
            key={worldbook.id}
            className={`tavern-list-item ${worldbook.id === draft.id ? 'tavern-list-item--active' : ''}`}
            type="button"
            onClick={() => {
              setIsCreating(false)
              setSelectedId(worldbook.id)
              setDraft(worldbook)
              setEntryIndex(0)
              setKeysText(worldbook.entries[0]?.keys.join(', ') || '')
            }}
          >
            <span>{worldbook.name}</span>
            <small>{worldbook.enabled ? `${worldbook.entries.length} 条目` : `已禁用 / ${worldbook.entries.length} 条目`}</small>
          </button>
        ))}
      </aside>

      <section className="tavern-editor">
        <div className="tavern-form-grid">
          <label>
            名称
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            />
            启用世界书
          </label>
        </div>

        <div className="worldbook-layout">
          <div className="worldbook-entry-list">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setDraft((current) => ({ ...current, entries: [...current.entries, emptyEntry()] }))
                setEntryIndex(draft.entries.length)
                setKeysText('')
              }}
            >
              <Plus size={15} />
              新条目
            </button>
            {draft.entries.map((item, index) => (
              <button
                key={`${item.id}-${index}`}
                className={`tavern-list-item ${index === entryIndex ? 'tavern-list-item--active' : ''}`}
                type="button"
                onClick={() => chooseEntry(index)}
              >
                <span>{item.title || '未命名条目'}</span>
                <small>{item.keys.join(' / ') || '无关键词'}</small>
              </button>
            ))}
          </div>

          <div className="worldbook-entry-editor">
            <div className="tavern-form-grid">
              <label>
                标题
                <input value={entry.title} onChange={(event) => updateEntry({ ...entry, title: event.target.value })} />
              </label>
              <label>
                优先级
                <input
                  type="number"
                  value={entry.priority}
                  onChange={(event) => updateEntry({ ...entry, priority: Number(event.target.value) })}
                />
              </label>
              <label>
                插入位置
                <select value={entry.position} onChange={(event) => updateEntry({ ...entry, position: event.target.value })}>
                  <option value="system">系统提示</option>
                  <option value="authorNote">作者注释</option>
                </select>
              </label>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={entry.enabled}
                  onChange={(event) => updateEntry({ ...entry, enabled: event.target.checked })}
                />
                启用条目
              </label>
            </div>
            <label>
              关键词
              <input value={keysText} onChange={(event) => setKeysText(event.target.value)} />
            </label>
            <label>
              内容
              <textarea
                className="tavern-large-textarea"
                value={entry.content}
                onChange={(event) => updateEntry({ ...entry, content: event.target.value })}
              />
            </label>
          </div>
        </div>

        <div className="tavern-actions">
          <button className="primary-button" type="button" onClick={() => void save()}>
            <Save size={16} />
            保存世界书
          </button>
          <input value={testText} placeholder="输入一句话测试触发" onChange={(event) => setTestText(event.target.value)} />
          <button className="secondary-button" type="button" onClick={() => void runMatch()}>
            <Search size={16} />
            测试
          </button>
          <input
            value={importPath}
            placeholder="C:\\世界书.json"
            onChange={(event) => setImportPath(event.target.value)}
          />
          <button className="secondary-button" type="button" onClick={() => void onImport(importPath)}>
            <FileUp size={16} />
            导入
          </button>
          <input
            value={exportPath}
            placeholder="C:\\导出\\世界书.json"
            onChange={(event) => setExportPath(event.target.value)}
          />
          <button className="secondary-button" type="button" onClick={() => void onExport(draft.id, exportPath)}>
            <Download size={16} />
            导出
          </button>
        </div>
        {matches.length > 0 && (
          <div className="match-strip">
            {matches.map((match) => (
              <span key={`${match.worldbookId}-${match.entryId}`}>{match.title}</span>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
