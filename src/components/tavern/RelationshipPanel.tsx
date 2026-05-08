import { Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getRelationshipPreferences, saveRelationshipPreferences } from '../../lib/tauri'
import { formatLocalDateTime } from '../../lib/time'
import { relationshipStageLabels } from '../../types/tauri'
import type {
  CharacterRelationship,
  HolidayRule,
  RelationshipIdleLine,
  RelationshipPreferences,
  RelationshipStage,
  TavernCharacter,
} from '../../types/tauri'

interface RelationshipPanelProps {
  characters: TavernCharacter[]
  relationships: CharacterRelationship[]
  onReset: (characterId: string) => Promise<void>
}

const stages = Object.keys(relationshipStageLabels) as RelationshipStage[]

function formatStamp(value: string) {
  return formatLocalDateTime(value) || '刚刚'
}

function defaultNicknameSettings() {
  return {
    enabled: false,
    userNickname: '',
    characterNickname: '',
    minimumStage: 'close' as RelationshipStage,
  }
}

function defaultIdleLines(): RelationshipIdleLine[] {
  return [
    {
      id: 'idle-neutral',
      text: '我在这里，慢慢来就好。',
      minimumStage: 'neutral',
      enabled: true,
      weight: 1,
      note: '普通阶段默认待机台词',
    },
    {
      id: 'idle-close',
      text: '要不要歇一小会儿？我陪你。',
      minimumStage: 'close',
      enabled: true,
      weight: 1,
      note: '亲近阶段默认待机台词',
    },
    {
      id: 'idle-trusted',
      text: '今天也在你身边，放心。',
      minimumStage: 'trusted',
      enabled: true,
      weight: 1,
      note: '信赖阶段默认待机台词',
    },
  ]
}

function defaultRelationship(characterId: string): CharacterRelationship {
  return {
    characterId,
    affection: 0,
    mood: 0,
    stage: 'neutral',
    stageLabel: '普通',
    moodLabel: '心情平稳',
    events: [],
    unlocks: {
      specialGreeting: false,
      nickname: false,
      idleLines: false,
      holidayReaction: false,
    },
    lastPassiveDecayAt: '',
    warmStreak: 0,
    lastWarmInteractionAt: '',
    nicknameSettings: defaultNicknameSettings(),
    idleLines: defaultIdleLines(),
    updatedAt: '0',
  }
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    local: '本地规则',
    model: 'AI评分',
    recovery: '连续恢复',
    timeDecay: '时间流逝',
    system: '系统',
  }
  return labels[source] ?? (source || '本地规则')
}

function emptyHoliday(): HolidayRule {
  return {
    id: `holiday-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: '自定义纪念日',
    month: 1,
    day: 1,
    enabled: true,
    scope: 'all',
    minimumStage: 'neutral',
    prompt: '今天是一个特别的纪念日，可以自然地给出温柔回应。',
    builtIn: false,
  }
}

function emptyIdleLine(): RelationshipIdleLine {
  return {
    id: `idle-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    text: '我在。',
    minimumStage: 'neutral',
    enabled: true,
    weight: 1,
    note: '',
  }
}

export function RelationshipPanel({ characters, relationships, onReset }: RelationshipPanelProps) {
  const [selectedId, setSelectedId] = useState('')
  const [preferences, setPreferences] = useState<RelationshipPreferences | null>(null)
  const [status, setStatus] = useState('')
  const selectedCharacter = useMemo(
    () => characters.find((character) => character.id === selectedId) ?? characters[0],
    [characters, selectedId],
  )
  const relationship = useMemo(() => {
    if (!selectedCharacter) return null
    return (
      relationships.find((item) => item.characterId === selectedCharacter.id) ??
      defaultRelationship(selectedCharacter.id)
    )
  }, [relationships, selectedCharacter])

  useEffect(() => {
    if (!selectedId && characters[0]) {
      setSelectedId(characters[0].id)
    }
  }, [characters, selectedId])

  useEffect(() => {
    if (!selectedCharacter) return
    let disposed = false
    getRelationshipPreferences(selectedCharacter.id)
      .then((next) => {
        if (!disposed) setPreferences(next)
      })
      .catch((error) => {
        if (!disposed) setStatus(String(error))
      })
    return () => {
      disposed = true
    }
  }, [selectedCharacter])

  if (!selectedCharacter || !relationship) {
    return <div className="empty-panel">还没有可管理的角色关系</div>
  }

  const nicknameSettings = preferences?.nicknameSettings ?? relationship.nicknameSettings ?? defaultNicknameSettings()
  const idleLines = preferences?.idleLines ?? relationship.idleLines ?? defaultIdleLines()
  const holidays = preferences?.holidays ?? []
  const unlockItems = [
    ['特殊问候', relationship.unlocks.specialGreeting],
    ['昵称倾向', relationship.unlocks.nickname],
    ['待机台词', relationship.unlocks.idleLines],
    ['节日反应入口', relationship.unlocks.holidayReaction],
  ] as const

  function patchPreferences(patch: Partial<RelationshipPreferences>) {
    setPreferences((current) => ({
      characterId: selectedCharacter.id,
      nicknameSettings,
      idleLines,
      holidays,
      ...current,
      ...patch,
    }))
  }

  async function savePreferences() {
    const payload: RelationshipPreferences = {
      characterId: selectedCharacter.id,
      nicknameSettings,
      idleLines,
      holidays,
    }
    const saved = await saveRelationshipPreferences(selectedCharacter.id, payload)
    setPreferences(saved)
    setStatus('关系设置已保存')
  }

  return (
    <div className="tavern-grid tavern-grid--editor relationship-layout">
      <aside className="tavern-list">
        <div className="tavern-list__head">
          <strong>角色关系</strong>
        </div>
        {characters.map((character) => {
          const item = relationships.find((entry) => entry.characterId === character.id)
          return (
            <button
              key={character.id}
              className={`tavern-list-item ${character.id === selectedCharacter.id ? 'tavern-list-item--active' : ''}`}
              type="button"
              onClick={() => setSelectedId(character.id)}
            >
              <span>{character.name}</span>
              <small>
                好感 {item?.affection ?? 0} / {item?.stageLabel ?? '普通'} / {item?.moodLabel ?? '心情平稳'}
              </small>
            </button>
          )
        })}
      </aside>

      <section className="tavern-editor relationship-detail">
        <div className="relationship-head">
          <div>
            <h3>{selectedCharacter.name}</h3>
            <p>
              昵称：
              {nicknameSettings.enabled
                ? `${nicknameSettings.userNickname || '未填'} / ${nicknameSettings.characterNickname || selectedCharacter.name}`
                : '未启用'}
            </p>
          </div>
          <div className="relationship-head-actions">
            <button className="secondary-button" type="button" onClick={() => void savePreferences()}>
              <Save size={15} />
              保存设置
            </button>
            <button className="secondary-button danger-button" type="button" onClick={() => void onReset(selectedCharacter.id)}>
              <RotateCcw size={15} />
              重置关系
            </button>
          </div>
        </div>
        {status && <p className="library-status">{status}</p>}

        <div className="metric-grid">
          <div>
            <strong>{relationship.affection}</strong>
            <span>好感度 / -100 到 100</span>
          </div>
          <div>
            <strong>{relationship.stageLabel}</strong>
            <span>当前阶段</span>
          </div>
          <div>
            <strong>{relationship.mood}</strong>
            <span>{relationship.moodLabel}</span>
          </div>
          <div>
            <strong>{relationship.warmStreak ?? 0}</strong>
            <span>连续温和互动</span>
          </div>
        </div>
        <p className="relationship-subtle">
          上次时间流逝扣减：{relationship.lastPassiveDecayAt ? formatStamp(relationship.lastPassiveDecayAt) : '尚未发生'}
        </p>

        <details className="relationship-rules">
          <summary>评分说明</summary>
          <p>本地规则：感谢、夸奖、关心、道歉、辱骂、威胁等明确表达会直接评分，不请求模型。</p>
          <p>AI评分：只有复杂情绪、关系暗示、开心/难过/失望/生气但语义不明确时才后台请求模型 JSON。</p>
          <p>普通中性聊天不改好感，也不走 AI；模型评分失败不会影响聊天。</p>
        </details>

        <section className="relationship-unlocks">
          <h3>解锁项</h3>
          <div className="unlock-grid">
            {unlockItems.map(([label, unlocked]) => (
              <span key={label} className={unlocked ? 'unlock-item unlock-item--on' : 'unlock-item'}>
                {label}
                <em>{unlocked ? '已解锁' : '未解锁'}</em>
              </span>
            ))}
          </div>
        </section>

        <section className="relationship-config">
          <h3>昵称管理</h3>
          <div className="tavern-form-grid">
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={nicknameSettings.enabled}
                onChange={(event) =>
                  patchPreferences({
                    nicknameSettings: { ...nicknameSettings, enabled: event.target.checked },
                  })
                }
              />
              允许自然使用昵称
            </label>
            <label>
              最低阶段
              <select
                value={nicknameSettings.minimumStage}
                onChange={(event) =>
                  patchPreferences({
                    nicknameSettings: { ...nicknameSettings, minimumStage: event.target.value as RelationshipStage },
                  })
                }
              >
                {stages.map((stage) => (
                  <option key={stage} value={stage}>
                    {relationshipStageLabels[stage]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              用户昵称
              <input
                value={nicknameSettings.userNickname}
                onChange={(event) =>
                  patchPreferences({
                    nicknameSettings: { ...nicknameSettings, userNickname: event.target.value },
                  })
                }
              />
            </label>
            <label>
              角色昵称
              <input
                value={nicknameSettings.characterNickname}
                onChange={(event) =>
                  patchPreferences({
                    nicknameSettings: { ...nicknameSettings, characterNickname: event.target.value },
                  })
                }
              />
            </label>
          </div>
        </section>

        <section className="relationship-config">
          <div className="relationship-section-title">
            <h3>待机台词库</h3>
            <button
              className="secondary-button"
              type="button"
              onClick={() => patchPreferences({ idleLines: [...idleLines, emptyIdleLine()] })}
            >
              <Plus size={15} />
              添加
            </button>
          </div>
          <div className="relationship-edit-list">
            {idleLines.map((line, index) => (
              <article key={line.id || index} className="relationship-edit-card">
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={line.enabled}
                    onChange={(event) => {
                      const next = [...idleLines]
                      next[index] = { ...line, enabled: event.target.checked }
                      patchPreferences({ idleLines: next })
                    }}
                  />
                  启用
                </label>
                <label>
                  最低阶段
                  <select
                    value={line.minimumStage}
                    onChange={(event) => {
                      const next = [...idleLines]
                      next[index] = { ...line, minimumStage: event.target.value as RelationshipStage }
                      patchPreferences({ idleLines: next })
                    }}
                  >
                    {stages.map((stage) => (
                      <option key={stage} value={stage}>
                        {relationshipStageLabels[stage]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  权重
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={line.weight}
                    onChange={(event) => {
                      const next = [...idleLines]
                      next[index] = { ...line, weight: Number(event.target.value) || 1 }
                      patchPreferences({ idleLines: next })
                    }}
                  />
                </label>
                <button
                  className="icon-button danger-button"
                  title="删除台词"
                  type="button"
                  onClick={() => patchPreferences({ idleLines: idleLines.filter((item) => item.id !== line.id) })}
                >
                  <Trash2 size={14} />
                </button>
                <label className="relationship-wide-field">
                  台词
                  <textarea
                    value={line.text}
                    onChange={(event) => {
                      const next = [...idleLines]
                      next[index] = { ...line, text: event.target.value }
                      patchPreferences({ idleLines: next })
                    }}
                  />
                </label>
                <label className="relationship-wide-field">
                  备注
                  <input
                    value={line.note}
                    onChange={(event) => {
                      const next = [...idleLines]
                      next[index] = { ...line, note: event.target.value }
                      patchPreferences({ idleLines: next })
                    }}
                  />
                </label>
              </article>
            ))}
          </div>
        </section>

        <section className="relationship-config">
          <div className="relationship-section-title">
            <h3>节日反应</h3>
            <button
              className="secondary-button"
              type="button"
              onClick={() => patchPreferences({ holidays: [...holidays, emptyHoliday()] })}
            >
              <Plus size={15} />
              添加
            </button>
          </div>
          <div className="relationship-edit-list">
            {holidays.map((holiday, index) => (
              <article key={holiday.id || index} className="relationship-edit-card relationship-edit-card--holiday">
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={holiday.enabled}
                    onChange={(event) => {
                      const next = [...holidays]
                      next[index] = { ...holiday, enabled: event.target.checked }
                      patchPreferences({ holidays: next })
                    }}
                  />
                  启用
                </label>
                <label>
                  名称
                  <input
                    value={holiday.name}
                    onChange={(event) => {
                      const next = [...holidays]
                      next[index] = { ...holiday, name: event.target.value }
                      patchPreferences({ holidays: next })
                    }}
                  />
                </label>
                <label>
                  月
                  <input
                    type="number"
                    min={0}
                    max={12}
                    value={holiday.month}
                    onChange={(event) => {
                      const next = [...holidays]
                      next[index] = { ...holiday, month: Number(event.target.value) || 0 }
                      patchPreferences({ holidays: next })
                    }}
                  />
                </label>
                <label>
                  日
                  <input
                    type="number"
                    min={0}
                    max={31}
                    value={holiday.day}
                    onChange={(event) => {
                      const next = [...holidays]
                      next[index] = { ...holiday, day: Number(event.target.value) || 0 }
                      patchPreferences({ holidays: next })
                    }}
                  />
                </label>
                <label>
                  最低阶段
                  <select
                    value={holiday.minimumStage}
                    onChange={(event) => {
                      const next = [...holidays]
                      next[index] = { ...holiday, minimumStage: event.target.value as RelationshipStage }
                      patchPreferences({ holidays: next })
                    }}
                  >
                    {stages.map((stage) => (
                      <option key={stage} value={stage}>
                        {relationshipStageLabels[stage]}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="icon-button danger-button"
                  title="删除节日"
                  type="button"
                  disabled={holiday.builtIn}
                  onClick={() => patchPreferences({ holidays: holidays.filter((item) => item.id !== holiday.id) })}
                >
                  <Trash2 size={14} />
                </button>
                <label className="relationship-wide-field">
                  节日提示词
                  <textarea
                    value={holiday.prompt}
                    onChange={(event) => {
                      const next = [...holidays]
                      next[index] = { ...holiday, prompt: event.target.value }
                      patchPreferences({ holidays: next })
                    }}
                  />
                </label>
              </article>
            ))}
          </div>
        </section>

        <section className="relationship-events">
          <h3>关系事件日志</h3>
          {relationship.events.length ? (
            relationship.events
              .slice()
              .reverse()
              .map((event) => (
                <article key={event.id} className="relationship-event">
                  <strong>
                    好感 {event.delta > 0 ? '+' : ''}
                    {event.delta} · 心情 {event.moodDelta > 0 ? '+' : ''}
                    {event.moodDelta}
                  </strong>
                  <span>{event.reason}</span>
                  <small>
                    {sourceLabel(event.source)} · 置信 {Math.round(event.confidence * 100)}% · {formatStamp(event.createdAt)}
                  </small>
                  {event.userExcerpt && <p>用户: {event.userExcerpt}</p>}
                </article>
              ))
          ) : (
            <div className="empty-panel empty-panel--compact">还没有关系事件，聊天后会自动记录最近 20 条</div>
          )}
        </section>
      </section>
    </div>
  )
}
