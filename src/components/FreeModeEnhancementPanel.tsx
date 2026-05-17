import { Eye, Plus, Radar, Save, Server, Trash2, X, Wrench } from 'lucide-react'
import type { AppSettings, FreeModeEnhancementSettings, FreeModeHttpToolConfig } from '../types/tauri'
import { testFreeModeVision, updateSettings } from '../lib/tauri'

interface FreeModeEnhancementPanelProps {
  open: boolean
  settings: AppSettings
  onClose: () => void
  onSettingsChange: (settings: AppSettings) => void
  onStatus: (message: string) => void
}

function makeTool(): FreeModeHttpToolConfig {
  return {
    id: crypto.randomUUID?.() ?? `tool-${Date.now()}`,
    name: '外部工具',
    enabled: false,
    url: 'http://127.0.0.1:8765/tool',
    timeoutMs: 8000,
    includeScreenContext: true,
  }
}

function isLocalUrl(url: string) {
  const value = url.trim().toLowerCase()
  return value.startsWith('http://127.0.0.1') || value.startsWith('http://localhost') || value.startsWith('http://[::1]')
}

function splitServers(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function FreeModeEnhancementPanel({
  open,
  settings,
  onClose,
  onSettingsChange,
  onStatus,
}: FreeModeEnhancementPanelProps) {
  if (!open) return null

  const enhancement = settings.freeModeEnhancement
  const updateEnhancement = (next: FreeModeEnhancementSettings) => {
    onSettingsChange({ ...settings, freeModeEnhancement: next })
  }
  const saveEnhancement = async (next = enhancement) => {
    const saved = await updateSettings({ ...settings, freeModeEnhancement: next })
    onSettingsChange(saved)
    onStatus('自由模式增强已保存')
  }
  const updateTool = (toolId: string, patch: Partial<FreeModeHttpToolConfig>) => {
    updateEnhancement({
      ...enhancement,
      httpTools: enhancement.httpTools.map((tool) => (tool.id === toolId ? { ...tool, ...patch } : tool)),
    })
  }
  const removeTool = (toolId: string) => {
    updateEnhancement({
      ...enhancement,
      httpTools: enhancement.httpTools.filter((tool) => tool.id !== toolId),
    })
  }
  const hasRemoteVisionUrl = enhancement.vision.serviceUrl.trim() && !isLocalUrl(enhancement.vision.serviceUrl)
  const isLmStudio = enhancement.vision.provider === 'lm-studio'
  const isMoondream = enhancement.vision.provider === 'moondream-station'
  const isQwen = enhancement.vision.provider === 'qwen3-vl'

  return (
    <aside className="free-mode-enhancement-panel" data-no-window-drag="true">
      <header>
        <div>
          <strong>自由模式增强</strong>
          <span>截图 OCR / 外部视觉 HTTP / 工具调用 / MCP 预留</span>
        </div>
        <button type="button" title="关闭增强设置" onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      <section>
        <h3>
          <Eye size={14} />
          看屏幕
        </h3>
        <label>
          <span>启用 OCR</span>
          <input
            type="checkbox"
            checked={enhancement.screen.ocrEnabled}
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                screen: { ...enhancement.screen, ocrEnabled: event.target.checked },
              })
            }
          />
        </label>
        <label>
          <span>注入窗口/UI 文本</span>
          <input
            type="checkbox"
            checked={enhancement.screen.uiReadEnabled}
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                screen: { ...enhancement.screen, uiReadEnabled: event.target.checked },
              })
            }
          />
        </label>
        <label>
          <span>默认区域</span>
          <select
            value={enhancement.screen.defaultRegion}
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                screen: { ...enhancement.screen, defaultRegion: event.target.value },
              })
            }
          >
            <option value="full">整个屏幕</option>
            <option value="active-window">当前窗口</option>
            <option value="center">屏幕中间</option>
            <option value="top-left">左上角</option>
            <option value="top-right">右上角</option>
            <option value="bottom-left">左下角</option>
            <option value="bottom-right">右下角</option>
            <option value="mouse">鼠标附近</option>
          </select>
        </label>
        <label>
          <span>超时 ms</span>
          <input
            type="number"
            min={1000}
            max={60000}
            step={500}
            value={enhancement.screen.timeoutMs}
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                screen: { ...enhancement.screen, timeoutMs: Number(event.target.value) },
              })
            }
          />
        </label>
      </section>

      <section>
        <h3>
          <Server size={14} />
          外部视觉服务
        </h3>
        <label>
          <span>启用视觉 HTTP</span>
          <input
            type="checkbox"
            checked={enhancement.vision.enabled}
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                vision: { ...enhancement.vision, enabled: event.target.checked },
              })
            }
          />
        </label>
        <label>
          <span>视觉后端</span>
          <select
            value={enhancement.vision.provider}
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                vision: { ...enhancement.vision, provider: event.target.value as FreeModeEnhancementSettings['vision']['provider'] },
              })
            }
          >
            <option value="lm-studio">LM Studio / Qwen2.5-VL</option>
            <option value="moondream-station">Moondream Station</option>
            <option value="qwen3-vl">Qwen3-VL 预留</option>
            <option value="custom-http">自定义 HTTP</option>
          </select>
        </label>
        <label className="free-mode-enhancement-panel__wide">
          <span>服务地址</span>
          <input
            value={enhancement.vision.serviceUrl}
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                vision: { ...enhancement.vision, serviceUrl: event.target.value },
              })
            }
          />
        </label>
        <label className="free-mode-enhancement-panel__wide">
          <span>Moondream Station URL</span>
          <input
            value={enhancement.vision.stationUrl}
            placeholder="http://127.0.0.1:2020/v1"
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                vision: { ...enhancement.vision, stationUrl: event.target.value },
              })
            }
          />
        </label>
        <label className="free-mode-enhancement-panel__wide">
          <span>{isLmStudio ? 'LM Studio URL' : 'Qwen3-VL URL'}</span>
          <input
            value={enhancement.vision.qwenUrl}
            placeholder={isLmStudio ? 'http://127.0.0.1:1234/v1/chat/completions' : '留空；后续精读视觉服务地址'}
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                vision: { ...enhancement.vision, qwenUrl: event.target.value },
              })
            }
          />
        </label>
        <label>
          <span>模型名</span>
          <input
            value={enhancement.vision.model}
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                vision: { ...enhancement.vision, model: event.target.value },
              })
            }
          />
        </label>
        <label>
          <span>发送截图 base64</span>
          <input
            type="checkbox"
            checked={enhancement.vision.sendImageBase64}
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                vision: { ...enhancement.vision, sendImageBase64: event.target.checked },
              })
            }
          />
        </label>
        <label>
          <span>超时 ms</span>
          <input
            type="number"
            min={1000}
            max={60000}
            step={500}
            value={enhancement.vision.timeoutMs}
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                vision: { ...enhancement.vision, timeoutMs: Number(event.target.value) },
              })
            }
          />
        </label>
        {isMoondream && (
          <p className="free-mode-enhancement-panel__note">
            先在终端运行 <code>pip install moondream-station</code>，再运行 <code>moondream-station</code>，Station 里输入 <code>start 2020</code>。
            本项目只启动 bridge：<code>npm run vision:bridge</code>。
          </p>
        )}
        {isLmStudio && (
          <p className="free-mode-enhancement-panel__note">
            推荐使用你已下载的 <code>Qwen2.5-VL-3B-Instruct-GGUF</code>：在 LM Studio 加载模型和 <code>mmproj-model-f16.gguf</code>，
            开启 Local Server 后保持 URL 为 <code>http://127.0.0.1:1234/v1/chat/completions</code>。本项目会自动启动 bridge。
          </p>
        )}
        {isQwen && (
          <p className="free-mode-enhancement-panel__note">
            Qwen3-VL 作为慢一点但更准的视觉后端；只有填写可用 URL 并选择该后端时才会被 bridge 转发。
          </p>
        )}
        {hasRemoteVisionUrl && <p className="free-mode-enhancement-panel__warning">非本机 URL 会发送截图或 OCR 上下文，请确认服务可信。</p>}
        <button
          className="secondary-button"
          type="button"
          onClick={() =>
            void testFreeModeVision(enhancement.vision)
              .then((result) => onStatus(result.message || result.text || '视觉服务已响应'))
              .catch((error) => onStatus(String(error)))
          }
        >
          检测视觉服务
        </button>
      </section>

      <section>
        <h3>
          <Radar size={14} />
          温和主动 Watcher
        </h3>
        <label>
          <span>启用主动观察</span>
          <input
            type="checkbox"
            checked={enhancement.watcher.enabled}
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                watcher: { ...enhancement.watcher, enabled: event.target.checked },
              })
            }
          />
        </label>
        <label>
          <span>观察区域</span>
          <select
            value={enhancement.watcher.region}
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                watcher: { ...enhancement.watcher, region: event.target.value },
              })
            }
          >
            <option value="active-window">当前窗口</option>
            <option value="full">整个屏幕</option>
            <option value="mouse">鼠标附近</option>
          </select>
        </label>
        <label>
          <span>间隔 ms</span>
          <input
            type="number"
            min={3000}
            max={8000}
            step={500}
            value={enhancement.watcher.intervalMs}
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                watcher: { ...enhancement.watcher, intervalMs: Number(event.target.value) },
              })
            }
          />
        </label>
        <label>
          <span>冷却 ms</span>
          <input
            type="number"
            min={25000}
            max={60000}
            step={1000}
            value={enhancement.watcher.cooldownMs}
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                watcher: { ...enhancement.watcher, cooldownMs: Number(event.target.value) },
              })
            }
          />
        </label>
        <label>
          <span>每小时视觉上限</span>
          <input
            type="number"
            min={1}
            max={120}
            step={1}
            value={enhancement.watcher.maxVisionCallsPerHour}
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                watcher: { ...enhancement.watcher, maxVisionCallsPerHour: Number(event.target.value) },
              })
            }
          />
        </label>
        <p className="free-mode-enhancement-panel__note">
          默认温和模式：自由模式空闲、输入框为空、冷却满足时才观察。主动回应只显示角色发言，不显示伪用户消息。
        </p>
      </section>

      <section>
        <h3>
          <Wrench size={14} />
          HTTP 工具
        </h3>
        {enhancement.httpTools.map((tool) => (
          <div className="free-mode-http-tool" key={tool.id}>
            <label>
              <span>启用</span>
              <input type="checkbox" checked={tool.enabled} onChange={(event) => updateTool(tool.id, { enabled: event.target.checked })} />
            </label>
            <label>
              <span>名称</span>
              <input value={tool.name} onChange={(event) => updateTool(tool.id, { name: event.target.value })} />
            </label>
            <label className="free-mode-enhancement-panel__wide">
              <span>POST URL</span>
              <input value={tool.url} onChange={(event) => updateTool(tool.id, { url: event.target.value })} />
            </label>
            <label>
              <span>带屏幕上下文</span>
              <input
                type="checkbox"
                checked={tool.includeScreenContext}
                onChange={(event) => updateTool(tool.id, { includeScreenContext: event.target.checked })}
              />
            </label>
            <button type="button" title="移除工具" onClick={() => removeTool(tool.id)}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          className="secondary-button"
          type="button"
          onClick={() =>
            updateEnhancement({
              ...enhancement,
              httpTools: [...enhancement.httpTools, makeTool()],
            })
          }
        >
          <Plus size={14} />
          添加 HTTP 工具
        </button>
      </section>

      <section>
        <h3>MCP 预留</h3>
        <label>
          <span>启用占位</span>
          <input
            type="checkbox"
            checked={enhancement.mcp.enabled}
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                mcp: { ...enhancement.mcp, enabled: event.target.checked },
              })
            }
          />
        </label>
        <label>
          <span>默认超时 ms</span>
          <input
            type="number"
            min={1000}
            max={120000}
            step={1000}
            value={enhancement.mcp.defaultTimeoutMs}
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                mcp: { ...enhancement.mcp, defaultTimeoutMs: Number(event.target.value) },
              })
            }
          />
        </label>
        <label className="free-mode-enhancement-panel__wide">
          <span>MCP 服务器占位（一行一个）</span>
          <textarea
            value={enhancement.mcp.servers.join('\n')}
            onChange={(event) =>
              updateEnhancement({
                ...enhancement,
                mcp: { ...enhancement.mcp, servers: splitServers(event.target.value) },
              })
            }
            placeholder="stdio: python server.py&#10;sse: http://127.0.0.1:3001/sse"
          />
        </label>
        <p>第一版只保存配置占位，不执行 stdio/SSE MCP。后续可在这里接 Shinsekai 那种 MCP 工具列表。</p>
      </section>

      <footer>
        <button className="secondary-button" type="button" onClick={onClose}>
          关闭
        </button>
        <button className="free-mode-primary" type="button" onClick={() => void saveEnhancement()}>
          <Save size={14} />
          保存增强
        </button>
      </footer>
    </aside>
  )
}
