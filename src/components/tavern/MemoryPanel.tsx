import { Archive, Check, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatLocalDateTime } from '../../lib/time'
import type {
  MemoryCard,
  MemoryCardScope,
  MemoryCardStatus,
  MemoryCardType,
  TavernCharacter,
  TavernChatListItem,
} from '../../types/tauri'

interface MemoryPanelProps {
  cards: MemoryCard[]
  characters: TavernCharacter[]
  chats: TavernChatListItem[]
  onSave: (card: MemoryCard) => Promise<MemoryCard | undefined>
  onDelete: (cardId: string) => Promise<void>
  onArchive: (cardId: string) => Promise<void>
  onConfirm: (cardId: string) => Promise<void>
}

const scopeLabels: Record<MemoryCardScope, string> = {
  global: '全局',
  character: '角色',
  chat: '聊天',
}

const typeLabels: Record<MemoryCardType, string> = {
  preference: '偏好',
  boundary: '禁忌',
  profile: '用户事实',
  promise: '承诺',
  note: '事项',
}

const statusLabels: Record<MemoryCardStatus, string> = {
  active: '生效',
  pending: '待确认',
  archived: '已停用',
}

const scopes = Object.keys(scopeLabels) as MemoryCardScope[]
const types = Object.keys(typeLabels) as MemoryCardType[]
const statuses = Object.keys(statusLabels) as MemoryCardStatus[]

type MemoryScopeFilter = '' | 'current' | MemoryCardScope

interface MemoryFilters {
  scope: MemoryScopeFilter
  type: string
  status: string
  query: string
}

function emptyCard(characterId?: string): MemoryCard {
  return {
    id: '',
    scope: characterId ? 'character' : 'global',
    characterId: characterId || null,
    chatId: null,
    type: 'note',
    content: '',
    importance: 5,
    confidence: 1,
    status: 'active',
    sourceMessageIds: [],
    createdAt: '',
    updatedAt: '',
    lastUsedAt: '',
  }
}

function compactTime(value: string) {
  return formatLocalDateTime(value) || '刚刚'
}

function characterName(characters: TavernCharacter[], characterId?: string | null) {
  if (!characterId) return '未绑定角色'
  return characters.find((character) => character.id === characterId)?.name || characterId
}

function chatTitle(chats: TavernChatListItem[], chatId?: string | null) {
  if (!chatId) return '未绑定聊天'
  return chats.find((chat) => chat.id === chatId)?.title || chatId
}

function scopeDetail(card: MemoryCard, characters: TavernCharacter[], chats: TavernChatListItem[]) {
  if (card.scope === 'global') return '全局'
  if (card.scope === 'character') return `角色：${characterName(characters, card.characterId)}`
  const chat = chats.find((item) => item.id === card.chatId)
  const characterId = card.characterId || chat?.characterId || null
  return `聊天：${chatTitle(chats, card.chatId)} / 角色：${characterName(characters, characterId)}`
}

function isCurrentCharacterRelated(card: MemoryCard, characterId: string, chats: TavernChatListItem[]) {
  if (card.scope === 'global') return true
  if (!characterId) return false
  if (card.scope === 'character') return card.characterId === characterId
  const chat = chats.find((item) => item.id === card.chatId)
  return card.characterId === characterId || chat?.characterId === characterId
}

function memoryCardTitle(card: MemoryCard, characters: TavernCharacter[], chats: TavernChatListItem[]) {
  return [
    card.content,
    `${statusLabels[card.status]} / ${typeLabels[card.type]} / ${scopeDetail(card, characters, chats)} / 重要度 ${card.importance}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function previewText(text: string, maxLength = 44) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

function matchesFilter(
  card: MemoryCard,
  filters: MemoryFilters,
  selectedCharacterId: string,
  characters: TavernCharacter[],
  chats: TavernChatListItem[],
) {
  const query = filters.query.trim().toLowerCase()
  const scopeMatches =
    !filters.scope ||
    (filters.scope === 'current'
      ? isCurrentCharacterRelated(card, selectedCharacterId, chats)
      : card.scope === filters.scope)
  return (
    scopeMatches &&
    (!filters.type || card.type === filters.type) &&
    (!filters.status || card.status === filters.status) &&
    (!query ||
      [
        card.content,
        card.characterId,
        card.chatId,
        scopeDetail(card, characters, chats),
        typeLabels[card.type],
        statusLabels[card.status],
        card.sourceMessageIds.join(' '),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query))
  )
}

export function MemoryPanel({
  cards,
  characters,
  chats,
  onSave,
  onDelete,
  onArchive,
  onConfirm,
}: MemoryPanelProps) {
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState<MemoryCard>(() => emptyCard(characters[0]?.id))
  const [isCreating, setIsCreating] = useState(false)
  const [filters, setFilters] = useState<MemoryFilters>({ scope: '', type: '', status: '', query: '' })
  const [selectedCharacterId, setSelectedCharacterId] = useState(characters[0]?.id || '')
  const filteredCards = cards.filter((card) =>
    matchesFilter(card, filters, selectedCharacterId, characters, chats),
  )
  const chatsForDraftCharacter = draft.characterId
    ? chats.filter((chat) => chat.characterId === draft.characterId)
    : chats
  const activeCards = cards.filter((card) => card.status === 'active')
  const pendingCards = cards.filter((card) => card.status === 'pending')
  const archivedCards = cards.filter((card) => card.status === 'archived')

  useEffect(() => {
    if (!selectedCharacterId && characters[0]?.id) {
      setSelectedCharacterId(characters[0].id)
    }
  }, [characters, selectedCharacterId])

  useEffect(() => {
    if (isCreating) return
    if (selectedId) {
      const selected = cards.find((card) => card.id === selectedId)
      if (selected && matchesFilter(selected, filters, selectedCharacterId, characters, chats)) {
        setDraft(selected)
        return
      }
    }
    const nextFilteredCards = cards.filter((card) =>
      matchesFilter(card, filters, selectedCharacterId, characters, chats),
    )
    if (nextFilteredCards[0]) {
      setSelectedId(nextFilteredCards[0].id)
      setDraft(nextFilteredCards[0])
      return
    }
    setSelectedId('')
    setDraft(emptyCard(characters[0]?.id))
  }, [cards, characters, chats, filters, isCreating, selectedCharacterId, selectedId])

  function patchDraft(patch: Partial<MemoryCard>) {
    setDraft((current) => {
      const next = { ...current, ...patch }
      if (patch.scope === 'global') {
        next.characterId = null
        next.chatId = null
      } else if (patch.scope === 'character') {
        next.characterId = next.characterId || characters[0]?.id || null
        next.chatId = null
      } else if (patch.scope === 'chat') {
        const chat = chats.find((item) => item.id === next.chatId) || chats[0]
        next.chatId = chat?.id || null
        next.characterId = chat?.characterId || next.characterId || characters[0]?.id || null
      } else if (patch.chatId && next.scope === 'chat') {
        const chat = chats.find((item) => item.id === patch.chatId)
        next.characterId = chat?.characterId || next.characterId || characters[0]?.id || null
      } else if (patch.characterId && next.scope === 'chat') {
        const chat = chats.find((item) => item.id === next.chatId && item.characterId === patch.characterId)
        next.chatId = chat?.id || chats.find((item) => item.characterId === patch.characterId)?.id || null
      }
      return next
    })
  }

  function newCard() {
    setIsCreating(true)
    setSelectedId('')
    setDraft(emptyCard(characters[0]?.id))
  }

  async function saveDraft() {
    const saved = await onSave({
      ...draft,
      importance: Math.min(10, Math.max(1, Number(draft.importance) || 5)),
      confidence: Math.min(1, Math.max(0, Number(draft.confidence) || 1)),
    })
    if (!saved) return
    setIsCreating(false)
    setSelectedId(saved.id)
    setDraft(saved)
  }

  return (
    <div className="tavern-grid tavern-grid--editor memory-layout">
      <aside className="tavern-list memory-list">
        <div className="tavern-list__head">
          <strong>记忆卡片</strong>
          <button className="icon-button" title="新增记忆" type="button" onClick={newCard}>
            <Plus size={15} />
          </button>
        </div>
        <div className="memory-filters">
          <input
            value={filters.query}
            placeholder="搜索内容"
            onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
          />
          <select
            value={filters.status}
            onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
          >
            <option value="">全部状态</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>
          <select
            value={filters.scope}
            onChange={(event) =>
              setFilters((current) => ({ ...current, scope: event.target.value as MemoryScopeFilter }))
            }
          >
            <option value="">全部范围</option>
            <option value="current">当前角色相关</option>
            {scopes.map((scope) => (
              <option key={scope} value={scope}>
                {scopeLabels[scope]}
              </option>
            ))}
          </select>
          {filters.scope === 'current' && (
            <select value={selectedCharacterId} onChange={(event) => setSelectedCharacterId(event.target.value)}>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
          )}
          <select
            value={filters.type}
            onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}
          >
            <option value="">全部类型</option>
            {types.map((type) => (
              <option key={type} value={type}>
                {typeLabels[type]}
              </option>
            ))}
          </select>
        </div>
        {filteredCards.length ? (
          filteredCards.map((card) => (
            <button
              key={card.id}
              className={`tavern-list-item memory-list-item ${card.id === selectedId ? 'tavern-list-item--active' : ''}`}
              type="button"
              title={memoryCardTitle(card, characters, chats)}
              onClick={() => {
                setIsCreating(false)
                setSelectedId(card.id)
                setDraft(card)
              }}
            >
              <span className="memory-list-item__title">{previewText(card.content)}</span>
              <span className="memory-list-item__meta">
                {statusLabels[card.status]} / {typeLabels[card.type]} / {scopeDetail(card, characters, chats)} / 重要度{' '}
                {card.importance}
              </span>
            </button>
          ))
        ) : (
          <div className="empty-panel empty-panel--compact">还没有符合条件的记忆卡片</div>
        )}
      </aside>

      <section className="tavern-editor memory-editor">
        <div className="relationship-head">
          <div>
            <h3>{draft.id ? '编辑记忆' : '新增记忆'}</h3>
            <p>
              {draft.id
                ? `更新于 ${compactTime(draft.updatedAt)}`
                : '明确、可控、可停用；宁可少记，也不乱记。'}
            </p>
          </div>
          <div className="relationship-head-actions">
            <button className="secondary-button" type="button" onClick={() => void saveDraft()}>
              <Save size={15} />
              保存
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!draft.id || draft.status !== 'pending'}
              onClick={() => void onConfirm(draft.id)}
            >
              <Check size={15} />
              确认
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!draft.id || draft.status === 'archived'}
              onClick={() => void onArchive(draft.id)}
            >
              <Archive size={15} />
              停用
            </button>
            <button
              className="secondary-button danger-button"
              type="button"
              disabled={!draft.id}
              onClick={() => void onDelete(draft.id)}
            >
              <Trash2 size={15} />
              删除
            </button>
          </div>
        </div>

        <div className="metric-grid">
          <div>
            <strong>{activeCards.length}</strong>
            <span>生效卡片</span>
          </div>
          <div>
            <strong>{pendingCards.length}</strong>
            <span>待确认</span>
          </div>
          <div>
            <strong>{archivedCards.length}</strong>
            <span>已停用</span>
          </div>
        </div>

        <div className="tavern-form-grid tavern-form-grid--three">
          <label>
            范围
            <select value={draft.scope} onChange={(event) => patchDraft({ scope: event.target.value as MemoryCardScope })}>
              {scopes.map((scope) => (
                <option key={scope} value={scope}>
                  {scopeLabels[scope]}
                </option>
              ))}
            </select>
          </label>
          <label>
            类型
            <select value={draft.type} onChange={(event) => patchDraft({ type: event.target.value as MemoryCardType })}>
              {types.map((type) => (
                <option key={type} value={type}>
                  {typeLabels[type]}
                </option>
              ))}
            </select>
          </label>
          <label>
            状态
            <select
              value={draft.status}
              onChange={(event) => patchDraft({ status: event.target.value as MemoryCardStatus })}
            >
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {statusLabels[status]}
                </option>
              ))}
            </select>
          </label>
          {draft.scope !== 'global' && (
            <label>
              角色
              <select
                value={draft.characterId || ''}
                onChange={(event) => patchDraft({ characterId: event.target.value || null })}
              >
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {draft.scope === 'chat' && (
            <label>
              聊天
              <select value={draft.chatId || ''} onChange={(event) => patchDraft({ chatId: event.target.value || null })}>
                {!chatsForDraftCharacter.length && <option value="">暂无聊天</option>}
                {chatsForDraftCharacter.map((chat) => (
                  <option key={chat.id} value={chat.id}>
                    {chat.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            重要度
            <input
              type="number"
              min={1}
              max={10}
              value={draft.importance}
              onChange={(event) => patchDraft({ importance: Number(event.target.value) || 5 })}
            />
          </label>
          <label>
            置信度
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={draft.confidence}
              onChange={(event) => patchDraft({ confidence: Number(event.target.value) || 0 })}
            />
          </label>
        </div>

        <label>
          记忆内容
          <textarea
            className="memory-content-textarea"
            value={draft.content}
            placeholder="例如：用户喜欢短回复。"
            onChange={(event) => patchDraft({ content: event.target.value })}
          />
        </label>

        <label>
          来源消息 ID
          <input
            value={draft.sourceMessageIds.join(', ')}
            placeholder="自动生成或手动关联，可留空"
            onChange={(event) =>
              patchDraft({
                sourceMessageIds: event.target.value
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
      </section>
    </div>
  )
}
