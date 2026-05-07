import { BookOpen, Minus, Volume2, VolumeX, Waves } from 'lucide-react'
import { ChatPanel } from './ChatPanel'
import { hideCurrentWindow, showTavernWindow, startWindowDrag } from '../lib/tauri'
import { usePetStore } from '../stores/petStore'

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

export function ChatWindow() {
  const ttsSettings = usePetStore((state) => state.ttsSettings)
  const setTtsSettings = usePetStore((state) => state.setTtsSettings)
  const VoiceIcon = ttsSettings.enabled ? Volume2 : VolumeX

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
              <p>治愈系 DeepSeek 桌面助手</p>
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
              title={ttsSettings.enabled ? '关闭语音播报' : '开启语音播报'}
              type="button"
              onClick={() => setTtsSettings({ ...ttsSettings, enabled: !ttsSettings.enabled })}
            >
              <VoiceIcon size={15} />
            </button>
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
