import { Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getRelationshipPreferences, saveRelationshipPreferences } from '../../lib/tauri'
import { formatLocalDateTime } from '../../lib/time'
import { relationshipStageLabels } from '../../types/tauri'
import type {
  CharacterRelationship,
  HolidayRule,
  RelationshipIdleLine,
  RelationshipKeywordRule,
  RelationshipPreferences,
  RelationshipRulePreferences,
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

function keywordRule(id: string, keyword: string, weight: number, note: string): RelationshipKeywordRule {
  return {
    id,
    keyword,
    weight,
    enabled: true,
    note,
  }
}

function defaultRulePreferences(characterId: string): RelationshipRulePreferences {
  if (characterId === 'builtin-character-kaelenyssa-arumorael') {
    return {
      initialized: true,
      enabled: true,
      positiveKeywords: [
        keywordRule('kaele-positive-common-sense', '人类常识', 1, '温柔解释人类常识'),
        keywordRule('kaele-positive-boundary', '慢慢跟你解释', 1, '耐心教她边界'),
        keywordRule('kaele-positive-consent-touch', '可以摸', 1, '同意后观察或触碰物品'),
        keywordRule('kaele-positive-warm-clothes', '暖和', 1, '分享温暖衣物或食物'),
        keywordRule('kaele-positive-nickname', '凯蕾', 1, '使用她接受的昵称'),
        keywordRule('kaele-positive-lonely', '你会孤单吗', 1, '关心她是否孤单'),
      ],
      negativeKeywords: [
        keywordRule('kaele-negative-monster', '怪物', 1, '把她当怪物'),
        keywordRule('kaele-negative-stop-learning', '别学', 1, '粗暴阻止她学习'),
        keywordRule('kaele-negative-scare', '吓你', 1, '恶意吓她'),
        keywordRule('kaele-negative-abandon', '丢下你', 1, '威胁抛下她'),
        keywordRule('kaele-negative-use', '利用你', 1, '利用她缺乏常识'),
        keywordRule('kaele-negative-shame', '羞辱你', 1, '未经解释直接羞辱她'),
      ],
    }
  }
  return {
    initialized: true,
    enabled: false,
    positiveKeywords: [],
    negativeKeywords: [],
  }
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
    rulePreferences: defaultRulePreferences(characterId),
    updatedAt: '0',
  }
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    local: '本地规则',
    model: 'AI评分',
    recovery: '连续恢复',
    system: '系统',
  }
  if (source.startsWith('本地规则') || source.startsWith('角色偏好')) return source
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

function emptyKeywordRule(kind: 'positive' | 'negative'): RelationshipKeywordRule {
  return {
    id: `rel-rule-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    keyword: kind === 'positive' ? '新加分关键词' : '新雷区关键词',
    weight: 1,
    enabled: false,
    note: '改成自己的关键词后勾选启用，再保存设置。',
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
  const rulePreferences =
    preferences?.rulePreferences ?? relationship.rulePreferences ?? defaultRulePreferences(selectedCharacter.id)
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
      rulePreferences,
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
      rulePreferences,
      holidays,
    }
    const saved = await saveRelationshipPreferences(selectedCharacter.id, payload)
    setPreferences(saved)
    setStatus('关系设置已保存')
  }

  function updateRule(kind: 'positive' | 'negative', index: number, patch: Partial<RelationshipKeywordRule>) {
    const key = kind === 'positive' ? 'positiveKeywords' : 'negativeKeywords'
    const nextRules = [...rulePreferences[key]]
    nextRules[index] = { ...nextRules[index], ...patch }
    patchPreferences({
      rulePreferences: {
        ...rulePreferences,
        initialized: true,
        [key]: nextRules,
      },
    })
  }

  function addRule(kind: 'positive' | 'negative') {
    const key = kind === 'positive' ? 'positiveKeywords' : 'negativeKeywords'
    const nextRule = emptyKeywordRule(kind)
    patchPreferences({
      rulePreferences: {
        ...rulePreferences,
        initialized: true,
        [key]: [...rulePreferences[key], nextRule],
      },
    })
    setStatus('已添加一条未启用规则，修改关键词后勾选启用，再点“保存设置”。')
  }

  function deleteRule(kind: 'positive' | 'negative', id: string) {
    const key = kind === 'positive' ? 'positiveKeywords' : 'negativeKeywords'
    patchPreferences({
      rulePreferences: {
        ...rulePreferences,
        initialized: true,
        [key]: rulePreferences[key].filter((rule) => rule.id !== id),
      },
    })
  }

  function resetRulePreferences() {
    patchPreferences({ rulePreferences: defaultRulePreferences(selectedCharacter.id) })
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
        <details className="relationship-rules">
          <summary>评分说明</summary>
          <p>本地规则按强度分层：轻度 ±1、中度 ±2、强烈 ±4、极强 ±6。±6 是单轮上限，不是默认值。</p>
          <p>感谢、普通关心、抱抱、想你通常是中度 +2；稳定承诺、尊重边界、深层信任、强烈保护通常是 +4。</p>
          <p>命中下方角色偏好会把强度上调 1 到 3 档；权重 1 往往从 +2 变 +4，权重 2/3 才更容易到 +6。</p>
          <p>AI评分：只有复杂情绪、关系暗示、开心/难过/失望/生气但语义不明确时才后台请求模型 JSON。</p>
          <p>冲突语境：剧情玩梗、开玩笑威胁、先骂后道歉、反话撒娇等会交给 AI 判断。</p>
          <p>普通中性聊天不改好感；模型评分失败不会影响聊天。</p>
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
          <div className="relationship-section-title">
            <div>
              <h3>角色偏好规则</h3>
              <p className="relationship-subtle">命中喜欢的互动会提高正向强度，命中雷区会提高负向强度。</p>
            </div>
            <button className="secondary-button" type="button" onClick={resetRulePreferences}>
              <RotateCcw size={15} />
              重置默认
            </button>
          </div>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={rulePreferences.enabled}
              onChange={(event) =>
                patchPreferences({
                  rulePreferences: {
                    ...rulePreferences,
                    initialized: true,
                    enabled: event.target.checked,
                  },
                })
              }
            />
            启用当前角色的专属加减分关键词
          </label>
          <div className="relationship-rule-columns">
            {(['positive', 'negative'] as const).map((kind) => {
              const rules = kind === 'positive' ? rulePreferences.positiveKeywords : rulePreferences.negativeKeywords
              return (
                <section key={kind} className="relationship-rule-column">
                  <div className="relationship-section-title">
                    <h4>{kind === 'positive' ? '喜欢的互动关键词' : '雷区关键词'}</h4>
                    <button className="secondary-button" type="button" onClick={() => addRule(kind)}>
                      <Plus size={15} />
                      添加
                    </button>
                  </div>
                  <div className="relationship-edit-list">
                    {rules.map((rule, index) => (
                      <article key={rule.id || index} className="relationship-edit-card relationship-edit-card--rule">
                        <label className="checkbox-line">
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            onChange={(event) => updateRule(kind, index, { enabled: event.target.checked })}
                          />
                          启用
                        </label>
                        <label>
                          关键词
                          <input
                            value={rule.keyword}
                            onChange={(event) => updateRule(kind, index, { keyword: event.target.value })}
                            placeholder={kind === 'positive' ? '例如：不会丢下你' : '例如：怪物'}
                          />
                        </label>
                        <label>
                          权重
                          <input
                            type="number"
                            min={1}
                            max={3}
                            value={rule.weight}
                            onChange={(event) => updateRule(kind, index, { weight: Number(event.target.value) || 1 })}
                          />
                        </label>
                        <button
                          className="icon-button danger-button"
                          title="删除关键词"
                          type="button"
                          onClick={() => deleteRule(kind, rule.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                        <label className="relationship-wide-field">
                          备注
                          <input
                            value={rule.note}
                            onChange={(event) => updateRule(kind, index, { note: event.target.value })}
                          />
                        </label>
                      </article>
                    ))}
                    {!rules.length && (
                      <div className="empty-panel empty-panel--compact">
                        {kind === 'positive' ? '还没有专属加分关键词' : '还没有专属雷区关键词'}
                      </div>
                    )}
                  </div>
                </section>
              )
            })}
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
