import { Download, FileAudio, FileUp, Heart, ImagePlus, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { pickAvatarFile, pickStageAudioFile, pickStageImageFile } from '../../lib/tauri'
import { defaultRelationshipStagePrompts, relationshipStageLabels } from '../../types/tauri'
import type {
  CharacterRelationship,
  CharacterStageConfig,
  PromptPreset,
  ProviderConfig,
  RelationshipStage,
  TavernCharacter,
} from '../../types/tauri'
import { AvatarBadge } from '../AvatarBadge'

interface CharacterEditorProps {
  characters: TavernCharacter[]
  presets: PromptPreset[]
  providers: ProviderConfig[]
  relationships: CharacterRelationship[]
  onSave: (character: TavernCharacter) => Promise<TavernCharacter | undefined>
  onImport: (path: string) => Promise<void>
  onExport: (characterId: string, path: string) => Promise<void>
  qaEnabled?: boolean
}

function emptyStageConfig(): CharacterStageConfig {
  return {
    enabled: false,
    sprites: [],
    expressions: [],
    scenes: [],
    bgms: [],
    defaultSceneId: null,
    defaultExpressionId: null,
    outputFormat: 'multiFrameJson',
  }
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
    stageConfig: emptyStageConfig(),
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
    stageConfig: {
      ...emptyStageConfig(),
      ...character.stageConfig,
      sprites: character.stageConfig?.sprites || [],
      expressions: character.stageConfig?.expressions || [],
      scenes: character.stageConfig?.scenes || [],
      bgms: character.stageConfig?.bgms || [],
      outputFormat: character.stageConfig?.outputFormat || 'multiFrameJson',
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

function replaceByIndex<T>(items: T[], index: number, updater: (item: T) => T) {
  return items.map((item, itemIndex) => (itemIndex === index ? updater(item) : item))
}

export function CharacterEditor({ characters, presets, providers, relationships, onSave, onImport, onExport, qaEnabled = false }: CharacterEditorProps) {
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
  const selectableProviders = useMemo(() => {
    const enabled = providers.filter((provider) => provider.enabled)
    const current = providers.find((provider) => provider.id === draft.defaultProviderId)
    if (current && !enabled.some((provider) => provider.id === current.id)) {
      return [current, ...enabled]
    }
    return enabled.length ? enabled : providers
  }, [draft.defaultProviderId, providers])

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

  function updateStageConfig(updater: (config: CharacterStageConfig) => CharacterStageConfig) {
    setDraft((current) => ({
      ...current,
      stageConfig: updater({
        ...emptyStageConfig(),
        ...current.stageConfig,
        sprites: current.stageConfig?.sprites || [],
        expressions: current.stageConfig?.expressions || [],
        scenes: current.stageConfig?.scenes || [],
        bgms: current.stageConfig?.bgms || [],
      }),
    }))
  }

  function addStageItem(kind: 'sprites' | 'expressions' | 'scenes' | 'bgms') {
    const id = `${kind.slice(0, -1)}-${Date.now()}`
    updateStageConfig((config) => {
      if (kind === 'sprites') {
        return {
          ...config,
          sprites: [...config.sprites, { id, name: '新立绘', image: '', description: '' }],
        }
      }
      if (kind === 'expressions') {
        return {
          ...config,
          expressions: [
            ...config.expressions,
            { id, name: '新表情', spriteId: config.sprites[0]?.id || '', prompt: '' },
          ],
        }
      }
      if (kind === 'scenes') {
        return {
          ...config,
          scenes: [...config.scenes, { id, name: '新场景', background: '', prompt: '' }],
        }
      }
      return {
        ...config,
        bgms: [...config.bgms, { id, name: '新 BGM', audio: '', prompt: '' }],
      }
    })
  }

  function removeStageItem(kind: 'sprites' | 'expressions' | 'scenes' | 'bgms', id: string) {
    updateStageConfig((config) => {
      if (kind === 'sprites') return { ...config, sprites: config.sprites.filter((item) => item.id !== id) }
      if (kind === 'expressions') {
        return {
          ...config,
          expressions: config.expressions.filter((item) => item.id !== id),
          defaultExpressionId: config.defaultExpressionId === id ? null : config.defaultExpressionId,
        }
      }
      if (kind === 'scenes') {
        return {
          ...config,
          scenes: config.scenes.filter((item) => item.id !== id),
          defaultSceneId: config.defaultSceneId === id ? null : config.defaultSceneId,
        }
      }
      return { ...config, bgms: config.bgms.filter((item) => item.id !== id) }
    })
  }

  async function uploadStageImage(kind: 'sprite' | 'scene', id: string) {
    const path = await pickStageImageFile()
    if (!path) return
    updateStageConfig((config) => {
      if (kind === 'sprite') {
        return {
          ...config,
          sprites: config.sprites.map((item) => (item.id === id ? { ...item, image: path } : item)),
        }
      }
      return {
        ...config,
        scenes: config.scenes.map((item) => (item.id === id ? { ...item, background: path } : item)),
      }
    })
  }

  async function uploadStageAudio(id: string) {
    const path = await pickStageAudioFile()
    if (!path) return
    updateStageConfig((config) => ({
      ...config,
      bgms: config.bgms.map((item) => (item.id === id ? { ...item, audio: path } : item)),
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
      stageConfig: {
        ...emptyStageConfig(),
        ...nextDraft.stageConfig,
        outputFormat: 'multiFrameJson',
      },
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
            默认 Provider
            <select
              value={draft.defaultProviderId || ''}
              onChange={(event) => update('defaultProviderId', event.target.value || null)}
            >
              {selectableProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.enabled ? provider.name : `${provider.name}（已禁用）`}
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

        {qaEnabled && (
          <section className="stage-config-editor">
            <div className="stage-config-editor__head">
              <div>
                <strong>演出配置 QA</strong>
                <span>剧情模式读取这些资源 ID 来切换立绘、表情、背景和 BGM。</span>
              </div>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={draft.stageConfig?.enabled || false}
                  onChange={(event) => updateStageConfig((config) => ({ ...config, enabled: event.target.checked }))}
                />
                启用演出配置
              </label>
            </div>

            <div className="tavern-form-grid">
              <label>
                默认场景
                <select
                  value={draft.stageConfig?.defaultSceneId || ''}
                  onChange={(event) => updateStageConfig((config) => ({ ...config, defaultSceneId: event.target.value || null }))}
                >
                  <option value="">自动</option>
                  {(draft.stageConfig?.scenes || []).map((scene) => (
                    <option key={scene.id} value={scene.id}>
                      {scene.name || scene.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                默认表情
                <select
                  value={draft.stageConfig?.defaultExpressionId || ''}
                  onChange={(event) => updateStageConfig((config) => ({ ...config, defaultExpressionId: event.target.value || null }))}
                >
                  <option value="">自动</option>
                  {(draft.stageConfig?.expressions || []).map((expression) => (
                    <option key={expression.id} value={expression.id}>
                      {expression.name || expression.id}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="stage-resource-group">
              <div className="stage-resource-group__head">
                <strong>立绘</strong>
                <button className="secondary-button" type="button" onClick={() => addStageItem('sprites')}>
                  <Plus size={15} />
                  新增立绘
                </button>
              </div>
              {(draft.stageConfig?.sprites || []).map((sprite, index) => (
                <div className="stage-resource-row" key={`${sprite.id}-${index}`}>
                  <label>
                    ID
                    <input
                      value={sprite.id}
                      onChange={(event) =>
                        updateStageConfig((config) => ({
                          ...config,
                          sprites: replaceByIndex(config.sprites, index, (item) => ({ ...item, id: event.target.value })),
                        }))
                      }
                    />
                  </label>
                  <label>
                    名称
                    <input
                      value={sprite.name}
                      onChange={(event) =>
                        updateStageConfig((config) => ({
                          ...config,
                          sprites: replaceByIndex(config.sprites, index, (item) => ({ ...item, name: event.target.value })),
                        }))
                      }
                    />
                  </label>
                  <label className="stage-path-field">
                    图片路径
                    <input
                      value={sprite.image}
                      onChange={(event) =>
                        updateStageConfig((config) => ({
                          ...config,
                          sprites: replaceByIndex(config.sprites, index, (item) => ({ ...item, image: event.target.value })),
                        }))
                      }
                    />
                  </label>
                  <button className="secondary-button" type="button" onClick={() => void uploadStageImage('sprite', sprite.id)}>
                    <ImagePlus size={15} />
                    上传
                  </button>
                  <button className="icon-button danger-button" type="button" title="删除立绘" onClick={() => removeStageItem('sprites', sprite.id)}>
                    <Trash2 size={15} />
                  </button>
                  <label className="stage-row-wide">
                    描述
                    <input
                      value={sprite.description}
                      onChange={(event) =>
                        updateStageConfig((config) => ({
                          ...config,
                          sprites: replaceByIndex(config.sprites, index, (item) => ({ ...item, description: event.target.value })),
                        }))
                      }
                    />
                  </label>
                </div>
              ))}
            </div>

            <div className="stage-resource-group">
              <div className="stage-resource-group__head">
                <strong>表情标签</strong>
                <button className="secondary-button" type="button" onClick={() => addStageItem('expressions')}>
                  <Plus size={15} />
                  新增表情
                </button>
              </div>
              {(draft.stageConfig?.expressions || []).map((expression, index) => (
                <div className="stage-resource-row" key={`${expression.id}-${index}`}>
                  <label>
                    ID
                    <input
                      value={expression.id}
                      onChange={(event) =>
                        updateStageConfig((config) => ({
                          ...config,
                          expressions: replaceByIndex(config.expressions, index, (item) => ({ ...item, id: event.target.value })),
                        }))
                      }
                    />
                  </label>
                  <label>
                    名称
                    <input
                      value={expression.name}
                      onChange={(event) =>
                        updateStageConfig((config) => ({
                          ...config,
                          expressions: replaceByIndex(config.expressions, index, (item) => ({ ...item, name: event.target.value })),
                        }))
                      }
                    />
                  </label>
                  <label>
                    绑定立绘
                    <select
                      value={expression.spriteId}
                      onChange={(event) =>
                        updateStageConfig((config) => ({
                          ...config,
                          expressions: replaceByIndex(config.expressions, index, (item) => ({ ...item, spriteId: event.target.value })),
                        }))
                      }
                    >
                      <option value="">不指定</option>
                      {(draft.stageConfig?.sprites || []).map((sprite) => (
                        <option key={sprite.id} value={sprite.id}>
                          {sprite.name || sprite.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="icon-button danger-button" type="button" title="删除表情" onClick={() => removeStageItem('expressions', expression.id)}>
                    <Trash2 size={15} />
                  </button>
                  <label className="stage-row-wide">
                    提示词
                    <input
                      value={expression.prompt}
                      onChange={(event) =>
                        updateStageConfig((config) => ({
                          ...config,
                          expressions: replaceByIndex(config.expressions, index, (item) => ({ ...item, prompt: event.target.value })),
                        }))
                      }
                    />
                  </label>
                </div>
              ))}
            </div>

            <div className="stage-resource-group">
              <div className="stage-resource-group__head">
                <strong>背景场景</strong>
                <button className="secondary-button" type="button" onClick={() => addStageItem('scenes')}>
                  <Plus size={15} />
                  新增场景
                </button>
              </div>
              {(draft.stageConfig?.scenes || []).map((scene, index) => (
                <div className="stage-resource-row" key={`${scene.id}-${index}`}>
                  <label>
                    ID
                    <input
                      value={scene.id}
                      onChange={(event) =>
                        updateStageConfig((config) => ({
                          ...config,
                          scenes: replaceByIndex(config.scenes, index, (item) => ({ ...item, id: event.target.value })),
                        }))
                      }
                    />
                  </label>
                  <label>
                    名称
                    <input
                      value={scene.name}
                      onChange={(event) =>
                        updateStageConfig((config) => ({
                          ...config,
                          scenes: replaceByIndex(config.scenes, index, (item) => ({ ...item, name: event.target.value })),
                        }))
                      }
                    />
                  </label>
                  <label className="stage-path-field">
                    背景图片
                    <input
                      value={scene.background}
                      onChange={(event) =>
                        updateStageConfig((config) => ({
                          ...config,
                          scenes: replaceByIndex(config.scenes, index, (item) => ({ ...item, background: event.target.value })),
                        }))
                      }
                    />
                  </label>
                  <button className="secondary-button" type="button" onClick={() => void uploadStageImage('scene', scene.id)}>
                    <ImagePlus size={15} />
                    上传
                  </button>
                  <button className="icon-button danger-button" type="button" title="删除场景" onClick={() => removeStageItem('scenes', scene.id)}>
                    <Trash2 size={15} />
                  </button>
                  <label className="stage-row-wide">
                    提示词
                    <input
                      value={scene.prompt}
                      onChange={(event) =>
                        updateStageConfig((config) => ({
                          ...config,
                          scenes: replaceByIndex(config.scenes, index, (item) => ({ ...item, prompt: event.target.value })),
                        }))
                      }
                    />
                  </label>
                </div>
              ))}
            </div>

            <div className="stage-resource-group">
              <div className="stage-resource-group__head">
                <strong>BGM</strong>
                <button className="secondary-button" type="button" onClick={() => addStageItem('bgms')}>
                  <Plus size={15} />
                  新增 BGM
                </button>
              </div>
              {(draft.stageConfig?.bgms || []).map((bgm, index) => (
                <div className="stage-resource-row" key={`${bgm.id}-${index}`}>
                  <label>
                    ID
                    <input
                      value={bgm.id}
                      onChange={(event) =>
                        updateStageConfig((config) => ({
                          ...config,
                          bgms: replaceByIndex(config.bgms, index, (item) => ({ ...item, id: event.target.value })),
                        }))
                      }
                    />
                  </label>
                  <label>
                    名称
                    <input
                      value={bgm.name}
                      onChange={(event) =>
                        updateStageConfig((config) => ({
                          ...config,
                          bgms: replaceByIndex(config.bgms, index, (item) => ({ ...item, name: event.target.value })),
                        }))
                      }
                    />
                  </label>
                  <label className="stage-path-field">
                    音频路径
                    <input
                      value={bgm.audio}
                      onChange={(event) =>
                        updateStageConfig((config) => ({
                          ...config,
                          bgms: replaceByIndex(config.bgms, index, (item) => ({ ...item, audio: event.target.value })),
                        }))
                      }
                    />
                  </label>
                  <button className="secondary-button" type="button" onClick={() => void uploadStageAudio(bgm.id)}>
                    <FileAudio size={15} />
                    上传
                  </button>
                  <button className="icon-button danger-button" type="button" title="删除 BGM" onClick={() => removeStageItem('bgms', bgm.id)}>
                    <Trash2 size={15} />
                  </button>
                  <label className="stage-row-wide">
                    提示词
                    <input
                      value={bgm.prompt}
                      onChange={(event) =>
                        updateStageConfig((config) => ({
                          ...config,
                          bgms: replaceByIndex(config.bgms, index, (item) => ({ ...item, prompt: event.target.value })),
                        }))
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
          </section>
        )}

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
