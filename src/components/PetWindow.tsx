import { useEffect, useRef } from 'react'
import { usePetStore } from '../stores/petStore'
import { listenToSettingsChanges, setPetScale, startWindowDrag, toggleChatWindow, toggleTavernWindow } from '../lib/tauri'
import { PetCanvas } from './PetCanvas'

export function PetWindow() {
  const setMotion = usePetStore((state) => state.setMotion)
  const settings = usePetStore((state) => state.settings)
  const setSettings = usePetStore((state) => state.setSettings)
  const dragStart = useRef<{
    x: number
    y: number
    dragging: boolean
    moved: boolean
  } | null>(null)
  const hoverRef = useRef(false)
  const motionTimerRef = useRef<number | undefined>(undefined)
  const scaleRef = useRef(settings.scale)

  useEffect(() => {
    scaleRef.current = settings.scale
  }, [settings.scale])

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    listenToSettingsChanges((nextSettings) => {
      scaleRef.current = nextSettings.scale
      setSettings(nextSettings)
    }).then((unlisten) => {
      if (disposed) {
        unlisten()
        return
      }
      cleanup = unlisten
    }).catch(() => undefined)
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [setSettings])

  useEffect(
    () => () => {
      if (motionTimerRef.current !== undefined) {
        window.clearTimeout(motionTimerRef.current)
      }
    },
    [],
  )

  function setTemporaryMotion(motion: 'tap' | 'rightTap', duration = 700) {
    if (motionTimerRef.current !== undefined) {
      window.clearTimeout(motionTimerRef.current)
    }
    setMotion(motion)
    motionTimerRef.current = window.setTimeout(() => {
      motionTimerRef.current = undefined
      setMotion(hoverRef.current ? 'hover' : 'idle')
    }, duration)
  }

  function resetDrag() {
    dragStart.current = null
    setMotion(hoverRef.current ? 'hover' : 'idle')
  }

  function beginWindowDrag() {
    const state = dragStart.current
    if (!state || state.dragging) return

    state.dragging = true
    state.moved = true
    setMotion('drag')
    void startWindowDrag().finally(resetDrag)
  }

  function zoomByWheel(deltaY: number) {
    const step = deltaY < 0 ? 0.05 : -0.05
    const nextScale = Math.min(3.2, Math.max(0.35, Number((scaleRef.current + step).toFixed(2))))
    if (nextScale === scaleRef.current) return
    scaleRef.current = nextScale
    const optimisticSettings = { ...usePetStore.getState().settings, scale: nextScale }
    setSettings(optimisticSettings)
    void setPetScale(nextScale)
      .then((savedScale) => {
        const currentSettings = usePetStore.getState().settings
        scaleRef.current = savedScale
        setSettings({ ...currentSettings, scale: savedScale })
      })
      .catch(() => undefined)
  }

  return (
    <section className="pet-window">
      <div
        role="button"
        tabIndex={0}
        className="pet-hitbox"
        onPointerEnter={() => {
          hoverRef.current = true
          if (!dragStart.current?.dragging) {
            setMotion('hover')
          }
        }}
        onPointerLeave={() => {
          hoverRef.current = false
          if (!dragStart.current?.dragging) {
            setMotion('idle')
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          setTemporaryMotion('rightTap')
          void toggleTavernWindow()
        }}
        onWheel={(event) => {
          event.preventDefault()
          zoomByWheel(event.deltaY)
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          dragStart.current = {
            x: event.clientX,
            y: event.clientY,
            dragging: false,
            moved: false,
          }
          setMotion('tap')
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const state = dragStart.current
          if (!state || state.dragging) return
          const dx = Math.abs(event.clientX - state.x)
          const dy = Math.abs(event.clientY - state.y)
          if (dx > 4 || dy > 4) {
            beginWindowDrag()
          }
        }}
        onPointerUp={() => {
          const state = dragStart.current
          if (!state) return
          const shouldOpenChat = !state.moved && !state.dragging
          resetDrag()
          if (shouldOpenChat) {
            setTemporaryMotion('tap')
            void toggleChatWindow()
          }
        }}
        onPointerCancel={resetDrag}
        onLostPointerCapture={() => {
          if (dragStart.current?.dragging) return
          resetDrag()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            setTemporaryMotion('tap')
            void toggleChatWindow()
          }
        }}
      />
      <PetCanvas />
    </section>
  )
}
