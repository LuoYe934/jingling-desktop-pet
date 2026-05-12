import {
  BookOpen,
  Bot,
  Braces,
  Brain,
  DatabaseZap,
  HeartHandshake,
  KeyRound,
  MessageSquareText,
  Minus,
  PackageOpen,
  Save,
  Sparkles,
  UserRound,
  WandSparkles,
  RefreshCw,
  Send,
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
  installBuiltinAssets,
  listenToRelationshipChanges,
  listenToChatListChanges,
  listenToMemoryChanges,
  listBuiltinAssets,
  listCharacters,
  listChats,
  listMemoryCards,
  listPersonas,
  listPresets,
  listProviders,
  listRelationships,
  listWorldbooks,
  resetRelationship,
  archiveMemoryCard,
  confirmMemoryCard,
  deleteProvider,
  deleteMemoryCard,
  resetProvider,
  saveCharacter,
  saveMemoryCard,
  savePersona,
  savePreset,
  saveProvider,
  saveProviderKey,
  saveWorldbook,
  showChatWindow,
  getDeepSeekWebBridgeState,
  startDeepSeekWebBridge,
  startWindowDrag,
  testProviderConnection,
} from '../lib/tauri'
import type {
  BuiltinAssetSummary,
  Persona,
  CharacterRelationship,
  MemoryCard,
  PromptPreset,
  ProviderConfig,
  WebBridgeStateSnapshot,
  TavernCharacter,
  TavernChatListItem,
  Worldbook,
} from '../types/tauri'
import { CharacterEditor } from './tavern/CharacterEditor'
import { ChatLibrary } from './tavern/ChatLibrary'
import { BuiltinLibraryPanel } from './tavern/BuiltinLibraryPanel'
import { PersonaEditor } from './tavern/PersonaEditor'
import { PresetEditor } from './tavern/PresetEditor'
import { PromptPreview } from './tavern/PromptPreview'
import { RelationshipPanel } from './tavern/RelationshipPanel'
import { MemoryPanel } from './tavern/MemoryPanel'
import { WorldbookEditor } from './tavern/WorldbookEditor'

type TabId =
  | 'characters'
  | 'personas'
  | 'chats'
  | 'worldbooks'
  | 'presets'
  | 'builtins'
  | 'relationships'
  | 'memory'
  | 'preview'
  | 'extensions'

const tabs: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: 'characters', label: '角色', icon: Bot },
  { id: 'personas', label: 'Persona', icon: UserRound },
  { id: 'chats', label: '聊天库', icon: MessageSquareText },
  { id: 'worldbooks', label: '世界书', icon: BookOpen },
  { id: 'presets', label: '预设', icon: DatabaseZap },
  { id: 'builtins', label: '内容库', icon: PackageOpen },
  { id: 'relationships', label: '关系', icon: HeartHandshake },
  { id: 'memory', label: '记忆', icon: Brain },
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
  const [builtinAssets, setBuiltinAssets] = useState<BuiltinAssetSummary[]>([])
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [relationships, setRelationships] = useState<CharacterRelationship[]>([])
  const [memoryCards, setMemoryCards] = useState<MemoryCard[]>([])
  const [status, setStatus] = useState('就绪')

  async function refresh() {
    const [
      nextCharacters,
      nextPersonas,
      nextChats,
      nextWorldbooks,
      nextPresets,
      nextBuiltinAssets,
      nextProviders,
      nextRelationships,
      nextMemoryCards,
    ] = await Promise.all([
      listCharacters(),
      listPersonas(),
      listChats(),
      listWorldbooks(),
      listPresets(),
      listBuiltinAssets(),
      listProviders(),
      listRelationships(),
      listMemoryCards(),
    ])
    setCharacters(nextCharacters)
    setPersonas(nextPersonas)
    setChats(nextChats)
    setWorldbooks(nextWorldbooks)
    setPresets(nextPresets)
    setBuiltinAssets(nextBuiltinAssets)
    setProviders(nextProviders)
    setRelationships(nextRelationships)
    setMemoryCards(nextMemoryCards)
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

  useEffect(() => {
    let cleanup = () => {}
    listenToMemoryChanges((payload) => setMemoryCards(payload.cards)).then((unlisten) => {
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

  async function saveAndRefresh<T>(work: () => Promise<T>, done = '已保存') {
    try {
      const saved = await work()
      await refresh()
      setStatus(done)
      return saved
    } catch (error) {
      setStatus(String(error))
      return undefined
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

  async function installBuiltinAndRefresh(ids: string[]) {
    try {
      const result = await installBuiltinAssets(ids)
      await refresh()
      if (!result.installed.length && result.skipped) {
        setStatus(`这些内容已经安装过了，跳过 ${result.skipped} 个`)
        return
      }
      const skipped = result.skipped ? `，跳过 ${result.skipped} 个已安装` : ''
      setStatus(
        `已导入 ${result.installedCharacters} 个角色 / ${result.installedWorldbooks} 本世界书 / ${result.installedPresets} 个预设${skipped}`,
      )
    } catch (error) {
      setStatus(String(error))
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
                providers={providers}
                relationships={relationships}
                onSave={(character) => saveAndRefresh(() => saveCharacter(character), '角色已保存')}
                onImport={(path) => run(() => importCharacterCard(path), '角色卡已导入')}
                onExport={(characterId, path) => run(() => exportCharacterCard(characterId, path), '角色卡已导出')}
              />
            )}
            {tab === 'personas' && (
              <PersonaEditor
                personas={personas}
                onSave={(persona) => saveAndRefresh(() => savePersona(persona), 'Persona 已保存')}
                onImport={(path) => run(() => importPersona(path), 'Persona 已导入')}
                onExport={(personaId, path) => run(() => exportPersona(personaId, path), 'Persona 已导出')}
              />
            )}
            {tab === 'chats' && <ChatLibrary chats={chats} onRefresh={refresh} />}
            {tab === 'worldbooks' && (
              <WorldbookEditor
                worldbooks={worldbooks}
                onSave={(worldbook) => saveAndRefresh(() => saveWorldbook(worldbook), '世界书已保存')}
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
            {tab === 'builtins' && (
              <BuiltinLibraryPanel assets={builtinAssets} onInstall={installBuiltinAndRefresh} />
            )}
            {tab === 'relationships' && (
              <RelationshipPanel
                characters={characters}
                relationships={relationships}
                onReset={(characterId) => run(() => resetRelationship(characterId), '关系已重置')}
              />
            )}
            {tab === 'memory' && (
              <MemoryPanel
                cards={memoryCards}
                characters={characters}
                chats={chats}
                onSave={(card) => saveAndRefresh(() => saveMemoryCard(card), '记忆已保存')}
                onDelete={(cardId) => run(() => deleteMemoryCard(cardId), '记忆已删除')}
                onArchive={(cardId) => run(() => archiveMemoryCard(cardId), '记忆已停用')}
                onConfirm={(cardId) => run(() => confirmMemoryCard(cardId), '记忆已确认')}
              />
            )}
            {tab === 'preview' && <PromptPreview characters={characters} chats={chats} presets={presets} />}
            {tab === 'extensions' && (
              <ExtensionPanel
                providers={providers}
                onSaved={() => void refresh()}
                onSaveProvider={(provider) => saveAndRefresh(() => saveProvider(provider), 'Provider 已保存')}
                onDeleteProvider={(providerId) => run(() => deleteProvider(providerId), 'Provider 已删除')}
                onResetProvider={(providerId) => run(() => resetProvider(providerId), 'Provider 已重置')}
                setStatus={setStatus}
              />
            )}
          </main>
        </div>
      </div>
    </section>
  )
}

function ExtensionPanel({
  providers,
  onSaved,
  onSaveProvider,
  onDeleteProvider,
  onResetProvider,
  setStatus,
}: {
  providers: ProviderConfig[]
  onSaved: () => void
  onSaveProvider: (provider: ProviderConfig) => Promise<ProviderConfig | undefined>
  onDeleteProvider: (providerId: string) => Promise<void>
  onResetProvider: (providerId: string) => Promise<void>
  setStatus: (status: string) => void
}) {
  const [providerId, setProviderId] = useState('deepseek')
  const [apiKey, setApiKey] = useState('')
  const selectedProvider = providers.find((provider) => provider.id === providerId) || providers[0]
  const [providerDraft, setProviderDraft] = useState<ProviderConfig | null>(selectedProvider || null)
  const [bridgeState, setBridgeState] = useState<WebBridgeStateSnapshot | null>(null)
  const isWebBridge = providerDraft?.providerType === 'web-bridge'

  useEffect(() => {
    if (!selectedProvider) return
    setProviderDraft(selectedProvider)
  }, [selectedProvider])

  useEffect(() => {
    if (!isWebBridge) return
    let cancelled = false
    async function refresh() {
      const state = await getDeepSeekWebBridgeState()
      if (!cancelled) setBridgeState(state)
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [isWebBridge])

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
    if (isWebBridge) {
      setStatus('DeepSeek 网页桥不需要 API Key')
      return
    }
    await saveProviderKey(providerId, apiKey)
    setApiKey('')
    setStatus('Provider Key 已保存')
    onSaved()
  }

  async function saveProviderDraft() {
    if (!providerDraft) return
    if (isWebBridge) {
      setStatus('DeepSeek 网页桥是 QA 内置 Provider，不需要保存配置')
      return
    }
    await onSaveProvider(providerDraft)
  }

  function createProvider() {
    const id = `custom-${Date.now()}`
    const next: ProviderConfig = {
      id,
      name: '自定义 Provider',
      providerType: 'openai-compatible',
      baseUrl: '',
      defaultModel: '',
      authType: 'bearer',
      maxTokensField: 'max_tokens',
      builtIn: false,
      editable: true,
      enabled: true,
      keySaved: false,
    }
    setProviderId(id)
    setProviderDraft(next)
  }

  async function testProvider() {
    if (isWebBridge) {
      await startBridge()
      return
    }
    const target = providerDraft?.id || providerId
    if (providerDraft && !providers.some((provider) => provider.id === providerDraft.id)) {
      setStatus('请先保存自定义 Provider，再测试连接')
      return
    }
    const result = await testProviderConnection(target)
    setStatus(`${providerDraft?.name || selectedProvider?.name || 'Provider'}：${result.message}`)
  }

  async function startBridge() {
    try {
      const result = await startDeepSeekWebBridge()
      setBridgeState(result.state)
      setStatus(result.message)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function refreshBridge() {
    const state = await getDeepSeekWebBridgeState()
    setBridgeState(state)
    setStatus(state.bridge.connected ? 'DeepSeek 网页桥已连接' : 'DeepSeek 网页桥未连接网页脚本')
  }

  const bridgeConnected = Boolean(bridgeState?.bridge.connected)
  const bridgeLastJob = bridgeState?.jobs[0]
  const providerStatusText = isWebBridge
    ? bridgeConnected
      ? '已连接 DeepSeek 网页端'
      : bridgeState?.serviceRunning
        ? '已启动，等待网页脚本'
        : '未启动'
    : providerDraft?.keySaved
      ? 'Key 已保存'
      : providerDraft?.authType === 'none'
        ? '无需 Key'
        : '未保存 Key'

  return (
    <div className="extensions-panel">
      <section className="provider-panel">
        <div className="provider-panel__head">
          <h3>Provider</h3>
          <span className={isWebBridge && bridgeConnected ? 'provider-status provider-status--ready' : 'provider-status'}>
            {providerStatusText}
          </span>
        </div>
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
            名称
            <input
              value={providerDraft?.name || ''}
              onChange={(event) =>
                setProviderDraft((current) => (current ? { ...current, name: event.target.value } : current))
              }
            />
          </label>
          <label>
            {isWebBridge ? '网页端当前模式' : '模型'}
            <input
              value={providerDraft?.defaultModel || ''}
              disabled={isWebBridge}
              onChange={(event) =>
                setProviderDraft((current) => (current ? { ...current, defaultModel: event.target.value } : current))
              }
            />
          </label>
          <label>
            {isWebBridge ? '本地 bridge 地址' : '接口地址'}
            <input
              value={providerDraft?.baseUrl || ''}
              disabled={isWebBridge}
              onChange={(event) =>
                setProviderDraft((current) => (current ? { ...current, baseUrl: event.target.value } : current))
              }
            />
          </label>
          <label>
            鉴权
            <select
              value={providerDraft?.authType || 'bearer'}
              disabled={isWebBridge}
              onChange={(event) =>
                setProviderDraft((current) =>
                  current ? { ...current, authType: event.target.value as ProviderConfig['authType'] } : current,
                )
              }
            >
              <option value="bearer">Bearer</option>
              <option value="api-key">api-key</option>
              <option value="none">无</option>
            </select>
          </label>
          <label>
            输出字段
            <select
              value={providerDraft?.maxTokensField || 'max_tokens'}
              disabled={isWebBridge}
              onChange={(event) =>
                setProviderDraft((current) =>
                  current
                    ? { ...current, maxTokensField: event.target.value as ProviderConfig['maxTokensField'] }
                    : current,
                )
              }
            >
              <option value="max_tokens">max_tokens</option>
              <option value="max_completion_tokens">max_completion_tokens</option>
            </select>
          </label>
          <label>
            API Key
            <input
              type="password"
              value={isWebBridge ? '不需要 API Key，仅本机访问' : apiKey}
              disabled={isWebBridge}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <button className="secondary-button provider-save" type="button" onClick={createProvider}>
            <Sparkles size={16} />
            新增
          </button>
          <button className="secondary-button provider-save" type="button" onClick={() => void saveProviderDraft()}>
            <Save size={16} />
            保存配置
          </button>
          <button className="primary-button provider-save" type="button" disabled={isWebBridge} onClick={() => void saveKey()}>
            <KeyRound size={16} />
            保存 Key
          </button>
          <button className="secondary-button provider-save" type="button" onClick={() => void testProvider()}>
            {isWebBridge ? <Send size={16} /> : <Bot size={16} />}
            {isWebBridge ? '启动网页桥' : '测试'}
          </button>
          {providerDraft?.builtIn ? (
            <button className="secondary-button provider-save" type="button" onClick={() => void onResetProvider(providerDraft.id)}>
              <WandSparkles size={16} />
              重置
            </button>
          ) : (
            <button className="secondary-button provider-save" type="button" onClick={() => providerDraft && void onDeleteProvider(providerDraft.id)}>
              <Minus size={16} />
              删除
            </button>
          )}
        </div>
        {isWebBridge ? (
          <div className="web-bridge-panel">
            <div className="web-bridge-cards">
              <div className="web-bridge-card">
                <strong>本地 bridge 服务</strong>
                <span>{bridgeState?.serviceRunning ? '已启动：127.0.0.1:8787' : '未启动，等待 QA 唤起。'}</span>
              </div>
              <div className="web-bridge-card">
                <strong>Edge / DeepSeek</strong>
                <span>{bridgeState?.bridge.pageUrl || '尚未收到 DeepSeek 网页端心跳。'}</span>
              </div>
              <div className="web-bridge-card">
                <strong>脚本心跳</strong>
                <span>{bridgeConnected ? 'Tampermonkey 脚本在线' : '未连接或超过 10 秒未心跳'}</span>
              </div>
            </div>
            <div className="web-bridge-actions">
              <button className="primary-button provider-save" type="button" onClick={() => void startBridge()}>
                <Send size={16} />
                启动网页桥并打开 Edge
              </button>
              <button className="secondary-button provider-save" type="button" onClick={() => void refreshBridge()}>
                <RefreshCw size={16} />
                检测状态
              </button>
            </div>
            <div className="web-bridge-risks">
              <span>仅本机自用</span>
              <span>不读取 Cookie / token</span>
              <span>单任务队列</span>
              <span>验证码或登录失效时暂停</span>
            </div>
            <div className="web-bridge-log">
              <strong>最近任务</strong>
              <span>
                {bridgeLastJob
                  ? `${bridgeLastJob.status}：${bridgeLastJob.error || bridgeLastJob.answerText || '等待 DeepSeek 网页端回复'}`
                  : '暂无任务。聊天窗口选择 DeepSeek 网页桥后发送，会进入这里。'}
              </span>
            </div>
          </div>
        ) : null}
        <div className="provider-grid">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className={provider.id === providerId ? 'provider-row provider-row--active' : 'provider-row'}
              onClick={() => setProviderId(provider.id)}
            >
              <strong>{provider.name}</strong>
              <span>{provider.defaultModel}</span>
              <em>{provider.providerType === 'web-bridge' ? 'local bridge' : `${provider.authType} / ${provider.maxTokensField}`}</em>
              <small>
                {provider.providerType === 'web-bridge'
                  ? 'QA 网页桥'
                  : provider.keySaved
                    ? 'Key 已保存'
                    : provider.authType === 'none'
                      ? '无需 Key'
                      : '未保存 Key'}
              </small>
              <small>{provider.baseUrl}</small>
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
