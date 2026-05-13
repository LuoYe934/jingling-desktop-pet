import { useEffect, useState } from 'react'
import './App.css'
import { ChatWindow } from './components/ChatWindow'
import { FreeModeWindow } from './components/FreeModeWindow'
import { PetWindow } from './components/PetWindow'
import { StoryModeWindow } from './components/StoryModeWindow'
import { TavernWindow } from './components/TavernWindow'
import { getWindowLabel, runningInTauri } from './lib/tauri'
import { MobileApp } from './mobile/MobileApp'

type DesktopWindowLabel = 'pet' | 'chat' | 'tavern' | 'free-mode' | 'story-mode'
type AppView = DesktopWindowLabel | 'mobile'

function isDesktopWindowLabel(label: string | null | undefined): label is DesktopWindowLabel {
  return label === 'pet' || label === 'chat' || label === 'tavern' || label === 'free-mode' || label === 'story-mode'
}

function shouldUseMobilePreview(params: URLSearchParams) {
  return params.get('mobile') === '1' || params.get('view') === 'mobile'
}

function readPreviewAppView(): AppView {
  const params = new URLSearchParams(window.location.search)
  if (shouldUseMobilePreview(params)) return 'mobile'

  const view = params.get('view')
  return isDesktopWindowLabel(view) ? view : 'chat'
}

function normalizeWindowLabel(label: string | null | undefined): DesktopWindowLabel {
  return isDesktopWindowLabel(label) ? label : 'chat'
}

function isAndroidRuntime() {
  const userAgent = navigator.userAgent.toLowerCase()
  const platform = navigator.platform.toLowerCase()
  return userAgent.includes('android') || platform.includes('android')
}

function resolveTauriAppView(label: string | null | undefined): AppView {
  if (label === 'main' || label === 'mobile' || isAndroidRuntime()) return 'mobile'
  return normalizeWindowLabel(label)
}

function App() {
  const [appView, setAppView] = useState<AppView | null>(() =>
    runningInTauri() ? null : readPreviewAppView(),
  )

  useEffect(() => {
    if (!runningInTauri()) return

    let mounted = true
    getWindowLabel()
      .then((label) => {
        if (mounted) setAppView(resolveTauriAppView(label))
      })
      .catch(() => {
        if (mounted) setAppView(isAndroidRuntime() ? 'mobile' : 'chat')
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (runningInTauri()) return

    const syncPreviewView = () => setAppView(readPreviewAppView())
    const onPreviewViewChanged = (event: Event) => {
      const view = (event as CustomEvent<AppView>).detail
      setAppView(isDesktopWindowLabel(view) || view === 'mobile' ? view : 'chat')
    }

    syncPreviewView()
    window.addEventListener('popstate', syncPreviewView)
    window.addEventListener('preview:view-changed', onPreviewViewChanged)
    return () => {
      window.removeEventListener('popstate', syncPreviewView)
      window.removeEventListener('preview:view-changed', onPreviewViewChanged)
    }
  }, [])

  if (!appView) return null

  return (
    <main className={`app-shell app-shell--${appView}`}>
      {appView === 'mobile' ? (
        <MobileApp />
      ) : appView === 'pet' ? (
        <PetWindow />
      ) : appView === 'tavern' ? (
        <TavernWindow />
      ) : appView === 'free-mode' ? (
        <FreeModeWindow />
      ) : appView === 'story-mode' ? (
        <StoryModeWindow />
      ) : (
        <ChatWindow />
      )}
    </main>
  )
}

export default App
