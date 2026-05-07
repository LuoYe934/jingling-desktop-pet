import { useEffect, useRef, useState } from 'react'
import { usePetStore } from '../stores/petStore'

const MODEL_PATH = '/models/jingling/jingling.model3.json'
const CUBISM_CORE_PATH = '/models/jingling/live2dcubismcore.min.js'
const MODEL_STATE_PATH = '/models/jingling/model-state.json'

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (window.Live2DCubismCore) {
      resolve()
      return
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Cubism runtime missing')), {
        once: true,
      })
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Cubism runtime missing'))
    document.head.appendChild(script)
  })
}

export function PetCanvas() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [mode, setMode] = useState<'loading' | 'live2d' | 'fallback'>('loading')
  const motion = usePetStore((state) => state.motion)

  useEffect(() => {
    let disposed = false
    let destroy: (() => void) | undefined

    async function bootLive2D() {
      const host = hostRef.current
      if (!host) return

      try {
        const stateResponse = await fetch(MODEL_STATE_PATH)
        const modelState = (await stateResponse.json()) as { enabled?: boolean }
        if (!modelState.enabled) {
          throw new Error('Live2D model disabled')
        }
        await loadScript(CUBISM_CORE_PATH)
        const [{ Application }, live2d] = await Promise.all([
          import('pixi.js'),
          import('untitled-pixi-live2d-engine/cubism'),
        ])
        if (disposed) return

        live2d.configureCubismSDK?.({ memorySizeMB: 16 })
        const app = new Application()
        await app.init({
          resizeTo: host,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          preference: 'webgl',
        })

        host.appendChild(app.canvas)
        const model = await live2d.Live2DModel.from(MODEL_PATH)
        model.anchor?.set?.(0.5, 0.5)
        model.position?.set?.(app.screen.width / 2, app.screen.height / 2)
        const baseScale = Math.min(app.screen.width / model.width, app.screen.height / model.height) * 0.74
        model.scale?.set?.(baseScale)
        app.stage.addChild(model)

        const resize = () => {
          model.position?.set?.(app.screen.width / 2, app.screen.height / 2)
        }
        window.addEventListener('resize', resize)
        destroy = () => {
          window.removeEventListener('resize', resize)
          app.destroy(true)
        }
        setMode('live2d')
      } catch {
        setMode('fallback')
      }
    }

    bootLive2D()
    return () => {
      disposed = true
      destroy?.()
    }
  }, [])

  return (
    <div className="pet-stage" data-motion={motion}>
      <div ref={hostRef} className="pet-canvas-host" />
      {mode !== 'live2d' && (
        <div className="pet-fallback" aria-hidden="true">
          <img src="/assets/jingling-placeholder.png" alt="" />
        </div>
      )}
    </div>
  )
}
