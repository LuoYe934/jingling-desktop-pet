import { Download, FileUp, Heart, ImagePlus, Plus, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { pickAvatarFile } from '../../lib/tauri'
import { defaultRelationshipStagePrompts, relationshipStageLabels } from '../../types/tauri'
import type { CharacterRelationship, PromptPreset, RelationshipStage, TavernCharacter } from '../../types/tauri'
import { AvatarBadge } from '../AvatarBadge'

interface CharacterEditorProps {
  characters: TavernCharacter[]
  presets: PromptPreset[]
  relationships: CharacterRelationship[]
  onSave: (character: TavernCharacter) => Promise<TavernCharacter | undefined>
  onImport: (path: string) => Promise<void>
  onExport: (characterId: string, path: string) => Promise<void>
}

function emptyCharacter(): TavernCharacter {
  return {
    id: '',
    name: '新角色',
    enabled: true,
    avatar: null,
    description: '',
    personality: '',
    scenario: '',
    firstMes: '',
    mesExample: '',
    tags: [],
    defaultPresetId: 'healing-short-chat',
    defaultProviderId: 'deepseek',
    useCustomRelationshipPrompts: false,
    relationshipStagePrompts: defaultRelationshipStagePrompts,
    createdAt: '',
    updatedAt: '',
  }
}

function normalizeCharacterDraft(character: TavernCharacter): TavernCharacter {
  return {
    ...character,
    useCustomRelationshipPrompts: Boolean(character.useCustomRelationshipPrompts),
    relationshipStagePrompts: {
      ...defaultRelationshipStagePrompts,
      ...character.relationshipStagePrompts,
    },
  }
}

const relationshipStages = Object.keys(relationshipStageLabels) as RelationshipStage[]

function relationshipForCharacter(relationships: CharacterRelationship[], characterId: string) {
  return relationships.find((relationship) => relationship.characterId === characterId)
}

function affectionTone(affection: number) {
  if (affection >= 75) return 'trusted'
  if (affection >= 35) return 'close'
  if (affection <= -50) return 'guarded'
  if (affection <= -15) return 'distant'
  return 'neutral'
}

export function CharacterEditor({ characters, presets, relationships, onSave, onImport, onExport }: CharacterEditorProps) {
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState<TavernCharacter>(emptyCharacter())
  const [isCreating, setIsCreating] = useState(false)
  const [tagsText, setTagsText] = useState('')
  const [importPath, setImportPath] = useState('')
  const [exportPath, setExportPath] = useState('')
  const selected = useMemo(() => characters.find((item) => item.id === selectedId), [characters, selectedId])
  const selectablePresets = useMemo(() => {
    const enabled = presets.filter((preset) => preset.enabled)
    const current = presets.find((preset) => preset.id === draft.defaultPresetId)
    if (current && !enabled.some((preset) => preset.id === current.id)) {
      return [current, ...enabled]
    }
    return enabled.length ? enabled : presets
  }, [draft.defaultPresetId, presets])

  useEffect(() => {
    if (isCreating) return
    const next = selected || characters[0]
    if (!next) {
      setSelectedId('')
      setDraft(emptyCharacter())
      setTagsText('')
      return
    }
    setSelectedId(next.id)
    setDraft(normalizeCharacterDraft(next))
    setTagsText(next.tags.join(', '))
  }, [characters, isCreating, selected])

  function update<K extends keyof TavernCharacter>(key: K, value: TavernCharacter[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function updateRelationshipPrompt(stage: RelationshipStage, value: string) {
    setDraft((current) => ({
      ...current,
      relationshipStagePrompts: {
        ...defaultRelationshipStagePrompts,
        ...current.relationshipStagePrompts,
        [stage]: value,
      },
    }))
  }

  function characterPayload(nextDraft = draft) {
    return {
      ...nextDraft,
      relationshipStagePrompts: {
        ...defaultRelationshipStagePrompts,
        ...nextDraft.relationshipStagePrompts,
      },
      tags: tagsText
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    }
  }

  async function save() {
    const saved = await onSave(characterPayload())
    if (!saved) return
    setIsCreating(false)
    setSelectedId(saved.id)
    setDraft(normalizeCharacterDraft(saved))
    setTagsText(saved.tags.join(', '))
  }

  async function uploadAvatar() {
    const path = await pickAvatarFile()
    if (!path) return
    const nextDraft = { ...draft, avatar: path }
    setDraft(nextDraft)
    if (nextDraft.id) {
      const saved = await onSave(characterPayload(nextDraft))
      if (saved) setDraft(normalizeCharacterDraft(saved))
    }
  }

  function createCharacter() {
    setIsCreating(true)
    setSelectedId('')
    setDraft(emptyCharacter())
    setTagsText('')
  }

  return (
    <div className="tavern-grid tavern-grid--editor">
      <aside className="tavern-list">
        <div className="tavern-list__head">
          <strong>角色库</strong>
          <button
            className="icon-button"
            title="新角色"
            type="button"
            onClick={createCharacter}
          >
            <Plus size={15} />
          </button>
        </div>
        {characters.map((character) => {
          const relationship = relationshipForCharacter(relationships, character.id)
          const affection = relationship?.affection ?? 0
          const stageLabel = relationship?.stageLabel ?? relationshipStageLabels.neutral
          const tone = affectionTone(affection)

          return (
            <button
              key={character.id}
              className={`tavern-list-item character-list-item ${
                character.id === draft.id ? 'tavern-list-item--active' : ''
              }`}
              type="button"
              onClick={() => {
                setIsCreating(false)
                setSelectedId(character.id)
                setDraft(normalizeCharacterDraft(character))
                setTagsText(character.tags.join(', '))
              }}
            >
              <span className="character-list-item__text">
                <span>{character.name}</span>
                <small>
                  {character.enabled ? (character.tags.join(' / ') || '未标记') : `已禁用 / ${character.tags.join(' / ') || '未标记'}`}
                </small>
              </span>
              <span className={`character-affection-badge character-affection-badge--${tone}`} title={`好感度 ${affection} / ${stageLabel}`}>
                <Heart size={13} />
                <strong>{affection}</strong>
                <small>{stageLabel}</small>
              </span>
            </button>
          )
        })}
      </aside>

      <section className="tavern-editor">
        <div className="tavern-form-grid">
          <label>
            名字
            <input value={draft.name} onChange={(event) => update('name', event.target.value)} />
          </label>
          <label>
            默认预设
            <select
              value={draft.defaultPresetId || ''}
              onChange={(event) => update('defaultPresetId', event.target.value || null)}
            >
              {selectablePresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.enabled ? preset.name : `${preset.name}（已禁用）`}
                </option>
              ))}
            </select>
          </label>
          <label>
            标签
            <input value={tagsText} onChange={(event) => setTagsText(event.target.value)} />
          </label>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => update('enabled', event.target.checked)}
            />
            启用角色
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
          描述
          <textarea value={draft.description} onChange={(event) => update('description', event.target.value)} />
        </label>
        <label>
          性格
          <textarea value={draft.personality} onChange={(event) => update('personality', event.target.value)} />
        </label>
        <label>
          场景
          <textarea value={draft.scenario} onChange={(event) => update('scenario', event.target.value)} />
        </label>
        <label>
          开场白
          <textarea value={draft.firstMes} onChange={(event) => update('firstMes', event.target.value)} />
        </label>
        <label>
          示例对话
          <textarea value={draft.mesExample} onChange={(event) => update('mesExample', event.target.value)} />
        </label>

        <section className="relationship-prompt-editor">
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={draft.useCustomRelationshipPrompts}
              onChange={(event) => update('useCustomRelationshipPrompts', event.target.checked)}
            />
            自定义好感阶段提示词
          </label>
          {draft.useCustomRelationshipPrompts && (
            <div className="relationship-stage-grid">
              {relationshipStages.map((stage) => (
                <label key={stage}>
                  {relationshipStageLabels[stage]}
                  <textarea
                    value={draft.relationshipStagePrompts[stage] || defaultRelationshipStagePrompts[stage]}
                    onChange={(event) => updateRelationshipPrompt(stage, event.target.value)}
                  />
                </label>
              ))}
            </div>
          )}
        </section>

        <div className="tavern-actions">
          <button className="primary-button" type="button" onClick={() => void save()}>
            <Save size={16} />
            保存角色
          </button>
          <input
            value={importPath}
            placeholder="C:\\角色卡.json 或 .png"
            onChange={(event) => setImportPath(event.target.value)}
          />
          <button className="secondary-button" type="button" onClick={() => void onImport(importPath)}>
            <FileUp size={16} />
            导入
          </button>
          <input
            value={exportPath}
            placeholder="C:\\导出\\角色卡.json"
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
