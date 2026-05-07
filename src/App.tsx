import { useEffect, useState } from 'react'
import './App.css'
import { ChatWindow } from './components/ChatWindow'
import { PetWindow } from './components/PetWindow'
import { TavernWindow } from './components/TavernWindow'
import { getWindowLabel, runningInTauri } from './lib/tauri'

type WindowLabel = 'pet' | 'chat' | 'tavern'

function readPreviewWindowLabel(): WindowLabel {
  const view = new URLSearchParams(window.location.search).get('view')
  return view === 'pet' || view === 'tavern' ? view : 'chat'
}

function normalizeWindowLabel(label: string | null | undefined): WindowLabel {
  return label === 'pet' || label === 'tavern' ? label : 'chat'
}

function App() {
  const [windowLabel, setWindowLabel] = useState<WindowLabel | null>(() =>
    runningInTauri() ? null : readPreviewWindowLabel(),
  )

  useEffect(() => {
    if (!runningInTauri()) return

    let mounted = true
    getWindowLabel()
      .then((label) => {
        if (mounted) setWindowLabel(normalizeWindowLabel(label))
      })
      .catch(() => {
        if (mounted) setWindowLabel('chat')
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (runningInTauri()) return

    const syncPreviewView = () => setWindowLabel(readPreviewWindowLabel())
    const onPreviewViewChanged = (event: Event) => {
      const view = (event as CustomEvent<WindowLabel>).detail
      setWindowLabel(view === 'pet' || view === 'tavern' ? view : 'chat')
    }

    syncPreviewView()
    window.addEventListener('popstate', syncPreviewView)
    window.addEventListener('preview:view-changed', onPreviewViewChanged)
    return () => {
      window.removeEventListener('popstate', syncPreviewView)
      window.removeEventListener('preview:view-changed', onPreviewViewChanged)
    }
  }, [])

  if (!windowLabel) return null

  return (
    <main className={`app-shell app-shell--${windowLabel}`}>
      {windowLabel === 'pet' ? <PetWindow /> : windowLabel === 'tavern' ? <TavernWindow /> : <ChatWindow />}
    </main>
  )
}

export default App
