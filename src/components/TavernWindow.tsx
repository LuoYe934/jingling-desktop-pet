import {
  BookOpen,
  Bot,
  Braces,
  DatabaseZap,
  HeartHandshake,
  KeyRound,
  MessageSquareText,
  Minus,
  Save,
  Sparkles,
  UserRound,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  exportCharacterCard,
  exportPersona,
  exportPreset,
  exportWorldbook,
  hideCurrentWindow,
  importCharacterCard,
  importPersona,
  importPreset,
  importWorldbook,
  listenToRelationshipChanges,
  listenToChatListChanges,
  listCharacters,
  listChats,
  listPersonas,
  listPresets,
  listProviders,
  listRelationships,
  listWorldbooks,
  resetRelationship,
  saveCharacter,
  savePersona,
  savePreset,
  saveProviderKey,
  saveWorldbook,
  showChatWindow,
  startWindowDrag,
} from '../lib/tauri'
import type {
  Persona,
  CharacterRelationship,
  PromptPreset,
  ProviderConfig,
  TavernCharacter,
  TavernChatListItem,
  Worldbook,
} from '../types/tauri'
import { CharacterEditor } from './tavern/CharacterEditor'
import { ChatLibrary } from './tavern/ChatLibrary'
import { PersonaEditor } from './tavern/PersonaEditor'
import { PresetEditor } from './tavern/PresetEditor'
import { PromptPreview } from './tavern/PromptPreview'
import { RelationshipPanel } from './tavern/RelationshipPanel'
import { WorldbookEditor } from './tavern/WorldbookEditor'

type TabId = 'characters' | 'personas' | 'chats' | 'worldbooks' | 'presets' | 'relationships' | 'preview' | 'extensions'

const tabs: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: 'characters', label: '角色', icon: Bot },
  { id: 'personas', label: 'Persona', icon: UserRound },
  { id: 'chats', label: '聊天库', icon: MessageSquareText },
  { id: 'worldbooks', label: '世界书', icon: BookOpen },
  { id: 'presets', label: '预设', icon: DatabaseZap },
  { id: 'relationships', label: '关系', icon: HeartHandshake },
  { id: 'preview', label: 'Prompt', icon: Braces },
  { id: 'extensions', label: '扩展', icon: Sparkles },
]

function isInteractiveTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  if (!element) return false
  return Boolean(
    element.closest(
      'button, input, textarea, select, option, a, [role="button"], [data-no-window-drag="true"]',
    ),
  )
}

function stopWindowDrag(event: React.PointerEvent | React.MouseEvent) {
  event.stopPropagation()
}

export function TavernWindow() {
  const [tab, setTab] = useState<TabId>('characters')
  const [characters, setCharacters] = useState<TavernCharacter[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [chats, setChats] = useState<TavernChatListItem[]>([])
  const [worldbooks, setWorldbooks] = useState<Worldbook[]>([])
  const [presets, setPresets] = useState<PromptPreset[]>([])
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [relationships, setRelationships] = useState<CharacterRelationship[]>([])
  const [status, setStatus] = useState('就绪')

  async function refresh() {
    const [
      nextCharacters,
      nextPersonas,
      nextChats,
      nextWorldbooks,
      nextPresets,
      nextProviders,
      nextRelationships,
    ] = await Promise.all([
      listCharacters(),
      listPersonas(),
      listChats(),
      listWorldbooks(),
      listPresets(),
      listProviders(),
      listRelationships(),
    ])
    setCharacters(nextCharacters)
    setPersonas(nextPersonas)
    setChats(nextChats)
    setWorldbooks(nextWorldbooks)
    setPresets(nextPresets)
    setProviders(nextProviders)
    setRelationships(nextRelationships)
    return nextChats
  }

  useEffect(() => {
    refresh().catch((error) => setStatus(String(error)))
  }, [])

  useEffect(() => {
    let cleanup = () => {}
    listenToChatListChanges((payload) => setChats(payload.chats)).then((unlisten) => {
      cleanup = unlisten
    })
    return () => cleanup()
  }, [])

  useEffect(() => {
    let cleanup = () => {}
    listenToRelationshipChanges(({ relationship }) => {
      setRelationships((current) => {
        const index = current.findIndex((item) => item.characterId === relationship.characterId)
        if (index < 0) return [...current, relationship]
        const next = [...current]
        next[index] = relationship
        return next
      })
    }).then((unlisten) => {
      cleanup = unlisten
    })
    return () => cleanup()
  }, [])

  const activeTitle = useMemo(() => tabs.find((item) => item.id === tab)?.label || '酒馆', [tab])

  async function run<T>(work: () => Promise<T>, done = '已保存') {
    try {
      await work()
      await refresh()
      setStatus(done)
    } catch (error) {
      setStatus(String(error))
    }
  }

  async function savePresetAndRefresh(preset: PromptPreset) {
    try {
      const saved = await savePreset(preset)
      await refresh()
      setStatus('预设已保存')
      return saved
    } catch (error) {
      setStatus(String(error))
      return undefined
    }
  }

  return (
    <section className="tavern-window">
      <div
        className="tavern-shell"
        onPointerDown={(event) => {
          if (event.button !== 0 || isInteractiveTarget(event.target)) return
          void startWindowDrag()
        }}
      >
        <header className="tavern-titlebar">
          <div className="brand brand--tavern">
            <div className="brand-mark">
              <WandSparkles size={20} />
            </div>
            <div>
              <h1>鲸灵酒馆</h1>
              <p>角色、世界书、预设和聊天管理</p>
            </div>
          </div>
          <div className="tavern-status">{status}</div>
          <div
            className="window-actions"
            data-no-window-drag="true"
            onPointerDownCapture={stopWindowDrag}
            onMouseDownCapture={stopWindowDrag}
            onPointerDown={stopWindowDrag}
            onMouseDown={stopWindowDrag}
          >
            <button className="icon-button" title="打开聊天小窗" type="button" onClick={() => void showChatWindow()}>
              <MessageSquareText size={15} />
            </button>
            <button className="icon-button" title="隐藏酒馆" type="button" onClick={() => void hideCurrentWindow()}>
              <Minus size={15} />
            </button>
          </div>
        </header>

        <div className="tavern-body">
          <nav className="tavern-nav" data-no-window-drag="true">
            {tabs.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  className={`tavern-tab ${item.id === tab ? 'tavern-tab--active' : ''}`}
                  type="button"
                  onClick={() => setTab(item.id)}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>

          <main className="tavern-content" data-no-window-drag="true">
            <div className="tavern-section-head">
              <h2>{activeTitle}</h2>
              <span>
                {characters.length} 角色 / {chats.length} 聊天 / {worldbooks.length} 世界书
              </span>
            </div>

            {tab === 'characters' && (
              <CharacterEditor
                characters={characters}
                presets={presets}
                relationships={relationships}
                onSave={(character) => run(() => saveCharacter(character), '角色已保存')}
                onImport={(path) => run(() => importCharacterCard(path), '角色卡已导入')}
                onExport={(characterId, path) => run(() => exportCharacterCard(characterId, path), '角色卡已导出')}
              />
            )}
            {tab === 'personas' && (
              <PersonaEditor
                personas={personas}
                onSave={(persona) => run(() => savePersona(persona), 'Persona 已保存')}
                onImport={(path) => run(() => importPersona(path), 'Persona 已导入')}
                onExport={(personaId, path) => run(() => exportPersona(personaId, path), 'Persona 已导出')}
              />
            )}
            {tab === 'chats' && <ChatLibrary chats={chats} onRefresh={refresh} />}
            {tab === 'worldbooks' && (
              <WorldbookEditor
                worldbooks={worldbooks}
                onSave={(worldbook) => run(() => saveWorldbook(worldbook), '世界书已保存')}
                onImport={(path) => run(() => importWorldbook(path), '世界书已导入')}
                onExport={(worldbookId, path) => run(() => exportWorldbook(worldbookId, path), '世界书已导出')}
              />
            )}
            {tab === 'presets' && (
              <PresetEditor
                presets={presets}
                onSave={savePresetAndRefresh}
                onImport={(path) => run(() => importPreset(path), '预设已导入')}
                onExport={(presetId, path) => run(() => exportPreset(presetId, path), '预设已导出')}
              />
            )}
            {tab === 'relationships' && (
              <RelationshipPanel
                characters={characters}
                relationships={relationships}
                onReset={(characterId) => run(() => resetRelationship(characterId), '关系已重置')}
              />
            )}
            {tab === 'preview' && <PromptPreview characters={characters} chats={chats} presets={presets} />}
            {tab === 'extensions' && <ExtensionPanel providers={providers} onSaved={() => void refresh()} setStatus={setStatus} />}
          </main>
        </div>
      </div>
    </section>
  )
}

function ExtensionPanel({
  providers,
  onSaved,
  setStatus,
}: {
  providers: ProviderConfig[]
  onSaved: () => void
  setStatus: (status: string) => void
}) {
  const [providerId, setProviderId] = useState('deepseek')
  const [apiKey, setApiKey] = useState('')

  const features = [
    {
      id: 'regex',
      label: '正则替换',
      badge: '预留',
      state: 'reserved',
      detail: '消息替换规则入口，当前还没有规则编辑器。',
    },
    {
      id: 'quickReply',
      label: '快捷回复',
      badge: '预留',
      state: 'reserved',
      detail: '快捷短语入口，当前还没有接到聊天输入框。',
    },
    {
      id: 'tts',
      label: 'TTS 语音',
      badge: '已接入',
      state: 'ready',
      detail: '语音开关和音色设置已移到聊天小窗。',
    },
    {
      id: 'translate',
      label: '翻译',
      badge: '需模型',
      state: 'needs',
      detail: '需要翻译模型或通用 LLM 接口。',
    },
    {
      id: 'imageCaption',
      label: '图片描述',
      badge: '需视觉模型',
      state: 'needs',
      detail: '需要支持图片输入的视觉模型，或本地多模态模型。',
    },
    {
      id: 'vectorMemory',
      label: '向量记忆',
      badge: '需向量库',
      state: 'needs',
      detail: '需要 embedding 模型和本地/云端向量数据库。',
    },
  ]

  async function saveKey() {
    await saveProviderKey(providerId, apiKey)
    setApiKey('')
    setStatus('Provider Key 已保存')
    onSaved()
  }

  return (
    <div className="extensions-panel">
      <section className="provider-panel">
        <h3>Provider</h3>
        <div className="tavern-form-grid">
          <label>
            接口
            <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            API Key
            <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
          </label>
          <button className="primary-button provider-save" type="button" onClick={() => void saveKey()}>
            <KeyRound size={16} />
            保存 Key
          </button>
        </div>
        <div className="provider-grid">
          {providers.map((provider) => (
            <div key={provider.id} className="provider-row">
              <strong>{provider.name}</strong>
              <span>{provider.defaultModel}</span>
              <em>{provider.enabled ? '已启用' : '预留'}</em>
              <small>{provider.keySaved ? 'Key 已保存' : '未保存 Key'}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="feature-switches">
        {features.map((feature) => (
          <button
            key={feature.id}
            className={`feature-switch feature-switch--${feature.state}`}
            type="button"
            onClick={() => {
              if (feature.id === 'tts') {
                void showChatWindow()
                setStatus('TTS 已移到聊天小窗设置')
                return
              }
              setStatus(`${feature.label}：${feature.detail}`)
            }}
          >
            <Save size={15} />
            <span>
              <strong>{feature.label}</strong>
              <small>{feature.detail}</small>
            </span>
            <em>{feature.badge}</em>
          </button>
        ))}
      </section>
    </div>
  )
}
