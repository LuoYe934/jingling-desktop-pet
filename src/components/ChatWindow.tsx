import { BookOpen, Heart, Minus, Volume2, VolumeX, Waves } from 'lucide-react'
import { ChatPanel } from './ChatPanel'
import { stopSpeech } from '../lib/speech'
import { hideCurrentWindow, showTavernWindow, startWindowDrag } from '../lib/tauri'
import { formatLocalDateTime } from '../lib/time'
import { usePetStore } from '../stores/petStore'
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { CharacterRelationship } from '../types/tauri'
import { GenieVoiceSelect } from './GenieVoiceSelect'

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

function CurrentClock() {
  const [now, setNow] = useState(() => formatLocalDateTime())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(formatLocalDateTime()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return <span className="current-clock">{now}</span>
}

function affectionFill(affection: number) {
  return Math.min(100, Math.max(0, affection))
}

function RelationshipStatus({ relationship }: { relationship: CharacterRelationship }) {
  const fill = affectionFill(relationship.affection)

  return (
    <p className="relationship-line" title={`好感度 ${relationship.affection} / 100`}>
      <span className="affection-heart-meter" style={{ '--heart-fill': `${fill}%` } as CSSProperties}>
        <Heart className="affection-heart-meter__outline" size={16} />
        <Heart className="affection-heart-meter__fill" size={16} />
      </span>
      <span className="relationship-line__text">
        <strong>{relationship.affection}</strong>
        <span>{relationship.stageLabel} · {relationship.moodLabel}</span>
      </span>
    </p>
  )
}

export function ChatWindow() {
  const ttsSettings = usePetStore((state) => state.ttsSettings)
  const activeRelationship = usePetStore((state) => state.activeRelationship)
  const relationshipNotice = usePetStore((state) => state.relationshipNotice)
  const setTtsSettings = usePetStore((state) => state.setTtsSettings)
  const VoiceIcon = ttsSettings.enabled ? Volume2 : VolumeX

  function toggleTts() {
    if (ttsSettings.enabled) {
      stopSpeech()
    }
    setTtsSettings({ ...ttsSettings, enabled: !ttsSettings.enabled })
  }

  return (
    <section className="chat-window">
      <div
        className="chat-panel"
        onPointerDown={(event) => {
          if (event.button !== 0 || isInteractiveTarget(event.target)) return
          void startWindowDrag()
        }}
      >
        <header className="chat-titlebar">
          <div className="brand">
            <div className="brand-mark">
              <Waves size={19} />
            </div>
            <div>
              <h1>鲸灵</h1>
              {activeRelationship ? <RelationshipStatus relationship={activeRelationship} /> : <p>治愈系 DeepSeek 桌面助手</p>}
              <CurrentClock />
              {relationshipNotice && <span className="relationship-notice">{relationshipNotice}</span>}
            </div>
          </div>
          <div
            className="window-actions"
            data-no-window-drag="true"
            onPointerDownCapture={stopWindowDrag}
            onMouseDownCapture={stopWindowDrag}
            onPointerDown={stopWindowDrag}
            onMouseDown={stopWindowDrag}
          >
            <button
              className={`icon-button voice-button ${ttsSettings.enabled ? 'voice-button--on' : ''}`}
              title={ttsSettings.enabled ? '关闭引号对白朗读' : '开启引号对白朗读'}
              type="button"
              onClick={toggleTts}
            >
              <VoiceIcon size={15} />
            </button>
            <GenieVoiceSelect settings={ttsSettings} onChange={setTtsSettings} compact />
            <button className="icon-button" title="打开酒馆" type="button" onClick={() => void showTavernWindow()}>
              <BookOpen size={15} />
            </button>
            <button className="icon-button" title="隐藏" type="button" onClick={() => void hideCurrentWindow()}>
              <Minus size={15} />
            </button>
          </div>
        </header>
        <ChatPanel />
      </div>
    </section>
  )
}
