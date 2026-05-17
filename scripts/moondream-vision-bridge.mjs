import http from 'node:http'

const host = process.env.JINGLING_VISION_BRIDGE_HOST || '127.0.0.1'
const port = Number(process.env.JINGLING_VISION_BRIDGE_PORT || 8765)
const defaultStationUrl = (process.env.MOONDREAM_STATION_URL || 'http://127.0.0.1:2020/v1').replace(/\/+$/, '')
const defaultLmStudioChatUrl = process.env.LM_STUDIO_VISION_URL || 'http://127.0.0.1:1234/v1/chat/completions'
const requestTimeoutMs = Number(process.env.JINGLING_VISION_TIMEOUT_MS || 15000)

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  res.end(body)
}

function textFromMoondreamResponse(value) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  return String(value.answer || value.text || value.result || value.message || '').trim()
}

function errorFromMoondreamResponse(value) {
  if (!value || typeof value !== 'object') return ''
  return String(value.error || value.detail || '').trim()
}

function toolResultFromVisionResponse(value) {
  if (typeof value === 'string') {
    return { available: Boolean(value.trim()), message: value.trim() ? 'Vision service completed.' : 'Vision service returned empty text.', text: value.trim() }
  }
  if (!value || typeof value !== 'object') {
    return { available: false, message: 'Vision service returned an unsupported response.', text: '' }
  }
  const text = String(value.answer || value.text || value.result || '').trim()
  const message = String(value.message || (text ? 'Vision service completed.' : 'Vision service returned empty text.')).trim()
  const available = typeof value.available === 'boolean' ? value.available : Boolean(text)
  return { available, message, text }
}

function openAiTextFromResponse(value) {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  const content = value.choices?.[0]?.message?.content ?? value.choices?.[0]?.text ?? value.text ?? value.answer
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (!part || typeof part !== 'object') return ''
        return String(part.text || part.content || '').trim()
      })
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  return ''
}

function looksLikePlaceholderOutput(text) {
  const compact = String(text || '').replace(/\s+/g, '')
  if (compact.length < 8) return false
  const questionMarks = (compact.match(/\?/g) || []).length
  return questionMarks / compact.length > 0.75
}

function looksLikeVisionRefusal(text) {
  const compact = String(text || '').replace(/\s+/g, '')
  if (!compact) return false
  return /无法识别(?:图片|图像)?(?:中)?(?:的)?内容|无法判断图片内容|看不清(?:图片|截图)?内容|不能识别(?:图片|图像)?内容|无法从图片中获取/.test(compact)
}

function modelIdsFromOpenAiModels(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.data)) return []
  return value.data
    .map((model) => (model && typeof model === 'object' ? String(model.id || '').trim() : ''))
    .filter(Boolean)
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function postJson(url, payload, timeoutMs, maxTimeoutMs = 60000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Math.min(timeoutMs, maxTimeoutMs)))
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const text = await response.text()
    let parsed = text
    try {
      parsed = JSON.parse(text)
    } catch {
      // Plain text is accepted.
    }
    return { ok: response.ok, status: response.status, value: parsed, rawText: text }
  } finally {
    clearTimeout(timeout)
  }
}

async function getText(url, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Math.min(timeoutMs, 10000)))
  try {
    const response = await fetch(url, { signal: controller.signal })
    const text = await response.text().catch(() => '')
    let parsed = text
    try {
      parsed = JSON.parse(text)
    } catch {
      // Plain text is accepted.
    }
    return { ok: response.ok, status: response.status, value: parsed, rawText: text }
  } finally {
    clearTimeout(timeout)
  }
}

function stationRootFromApiUrl(stationUrl) {
  try {
    const url = new URL(stationUrl)
    return `${url.protocol}//${url.host}`
  } catch {
    return stationUrl.replace(/\/+$/, '').replace(/\/v1$/i, '')
  }
}

function openAiBaseUrlFromChatUrl(chatUrl) {
  try {
    const url = new URL(chatUrl)
    url.pathname = url.pathname.replace(/\/chat\/completions\/?$/i, '').replace(/\/+$/, '')
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return chatUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '')
  }
}

function normalizeChatCompletionsUrl(value) {
  const raw = String(value || '').trim() || defaultLmStudioChatUrl
  const withoutSlash = raw.replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(withoutSlash)) return withoutSlash
  if (/\/v1$/i.test(withoutSlash)) return `${withoutSlash}/chat/completions`
  return `${withoutSlash}/v1/chat/completions`
}

async function checkLmStudio(chatUrl, model) {
  const normalizedChatUrl = normalizeChatCompletionsUrl(chatUrl)
  const baseUrl = openAiBaseUrlFromChatUrl(normalizedChatUrl)
  try {
    const modelsResponse = await getText(`${baseUrl}/models`, 3000)
    if (!modelsResponse.ok) {
      return {
        available: false,
        message: `LM Studio /v1/models returned HTTP ${modelsResponse.status}: ${String(modelsResponse.rawText || '').slice(0, 300)}`,
        chatUrl: normalizedChatUrl,
      }
    }
    const ids = modelIdsFromOpenAiModels(modelsResponse.value)
    const requestedModel = String(model || '').trim()
    const modelHint = ids.length ? `Loaded models: ${ids.slice(0, 6).join(', ')}` : 'LM Studio responded, but no model id was listed.'
    const hasRequestedModel = !requestedModel || ids.length === 0 || ids.includes(requestedModel)
    return {
      available: hasRequestedModel,
      message: hasRequestedModel
        ? `LM Studio is reachable. ${modelHint}`
        : `LM Studio is reachable, but configured model "${requestedModel}" is not in /v1/models. ${modelHint}`,
      chatUrl: normalizedChatUrl,
      models: ids,
    }
  } catch (error) {
    return {
      available: false,
      message: `LM Studio is not reachable at ${baseUrl}. Open LM Studio, load the Qwen2.5-VL model, then start Local Server on port 1234.`,
      error: String(error?.message || error),
      chatUrl: normalizedChatUrl,
    }
  }
}

function summarizeStationStats(stats) {
  if (!stats || typeof stats !== 'object') return ''
  const parts = []
  if (stats.status) parts.push(`status=${stats.status}`)
  if (stats.model) parts.push(`model=${stats.model}`)
  if (typeof stats.workers !== 'undefined') parts.push(`workers=${stats.workers}`)
  if (typeof stats.queue_size !== 'undefined') parts.push(`queue=${stats.queue_size}`)
  if (typeof stats.processing !== 'undefined') parts.push(`processing=${stats.processing}`)
  if (typeof stats.timeouts !== 'undefined') parts.push(`timeouts=${stats.timeouts}`)
  return parts.join(', ')
}

async function checkStation(stationUrl) {
  const normalizedStationUrl = stationUrl.replace(/\/+$/, '')
  const stationRoot = stationRootFromApiUrl(normalizedStationUrl)
  try {
    const health = await getText(`${stationRoot}/health`, 2500)
    if (!health.ok) {
      return {
        available: false,
        message: `Moondream Station health returned HTTP ${health.status}: ${String(health.rawText || '').slice(0, 220)}`,
      }
    }
    let stats = null
    try {
      const statsResponse = await getText(`${normalizedStationUrl}/stats`, 2500)
      if (statsResponse.ok && statsResponse.value && typeof statsResponse.value === 'object') {
        stats = statsResponse.value
      }
    } catch {
      // Stats are helpful but not required for readiness.
    }
    const summary = summarizeStationStats(stats)
    const busy =
      stats &&
      ((Number(stats.queue_size || 0) > 0) ||
        (Number(stats.processing || 0) > 0) ||
        (Number(stats.timeouts || 0) > 0))
    return {
      available: true,
      message: summary
        ? `Moondream Station is running. ${summary}${busy ? '. It may still be busy processing queued requests.' : '.'}`
        : 'Moondream Station is running.',
      stats,
    }
  } catch (error) {
    return {
      available: false,
      message: `Moondream Station is not reachable at ${stationRoot}. Start Station, then run: start 2020`,
      error: String(error?.message || error),
    }
  }
}

function buildQuestion(payload) {
  const userPrompt = String(payload.prompt || payload.userInput || '').trim()
  const region = String(payload.region || '').trim()
  const title = String(payload.title || '').trim()
  const ocrText = String(payload.ocrText || '').trim()
  return [
    userPrompt || 'Describe the screenshot in concise Chinese.',
    region ? `Region: ${region}.` : '',
    title ? `Active window title: ${title}.` : '',
    ocrText ? `OCR text already detected: ${ocrText.slice(0, 1000)}` : '',
    'Answer in concise Chinese. Mention uncertainty if the image is unclear.',
  ].filter(Boolean).join('\n')
}

function buildOpenAiVisionMessages(payload, imageUrl) {
  const question = buildQuestion(payload)
  return [
    {
      role: 'system',
      content: 'You are a concise screen-vision assistant. Answer in Chinese. Only describe what is visible or inferable from the screenshot/OCR; mention uncertainty instead of guessing.',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: question },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    },
  ]
}

async function handleVision(req, res) {
  const startedAt = Date.now()
  let payload
  try {
    payload = await readJson(req)
  } catch (error) {
    jsonResponse(res, 400, { available: false, message: `Invalid JSON: ${error.message}`, text: '', provider: 'moondream-station', latencyMs: Date.now() - startedAt })
    return
  }

  const provider = payload.provider || 'moondream-station'
  if (provider === 'lm-studio') {
    const lmStudioUrl = normalizeChatCompletionsUrl(payload.qwenUrl)
    const model = String(payload.model || '').trim() || 'qwen2.5-vl-3b-instruct'
    if (payload.healthCheck) {
      const status = await checkLmStudio(lmStudioUrl, model)
      jsonResponse(res, 200, { ...status, text: status.message, provider, latencyMs: Date.now() - startedAt })
      return
    }
    const imageBase64 = String(payload.imageBase64 || '').trim()
    if (!imageBase64) {
      jsonResponse(res, 200, {
        available: false,
        message: 'No imageBase64 was provided. Enable "发送截图 base64" in Free Mode enhancement settings.',
        text: '',
        provider,
        latencyMs: Date.now() - startedAt,
      })
      return
    }
    const imageMimeType = String(payload.imageMimeType || 'image/png')
    const imageUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:${imageMimeType};base64,${imageBase64}`
    try {
      const result = await postJson(
        lmStudioUrl,
        {
          model,
          messages: buildOpenAiVisionMessages(payload, imageUrl),
          temperature: 0.1,
          max_tokens: 300,
          stream: false,
        },
        Number(payload.timeoutMs || requestTimeoutMs),
      )
      const text = openAiTextFromResponse(result.value)
      if (result.ok && looksLikePlaceholderOutput(text)) {
        jsonResponse(res, 200, {
          available: false,
          message: 'LM Studio returned placeholder question marks for the image request. Reload the model or resend after the vision model is warmed up.',
          text: '',
          provider,
          latencyMs: Date.now() - startedAt,
        })
        return
      }
      if (result.ok && looksLikeVisionRefusal(text)) {
        jsonResponse(res, 200, {
          available: false,
          message: `LM Studio could not read this screenshot: ${text}`,
          text: '',
          provider,
          latencyMs: Date.now() - startedAt,
        })
        return
      }
      jsonResponse(res, 200, {
        available: result.ok && Boolean(text),
        message: result.ok
          ? text
            ? 'LM Studio vision completed.'
            : 'LM Studio returned an empty answer.'
          : `LM Studio returned HTTP ${result.status}: ${String(result.rawText || '').slice(0, 500)}`,
        text: result.ok ? text : '',
        provider,
        latencyMs: Date.now() - startedAt,
      })
    } catch (error) {
      jsonResponse(res, 200, {
        available: false,
        message: `LM Studio vision request failed: ${error?.message || error}`,
        text: '',
        provider,
        latencyMs: Date.now() - startedAt,
      })
    }
    return
  }
  if (provider === 'qwen3-vl') {
    const qwenUrl = String(payload.qwenUrl || '').trim()
    if (!qwenUrl) {
      jsonResponse(res, 200, {
        available: false,
        message: 'Qwen3-VL URL is empty. Fill qwenUrl in Free Mode enhancement settings before choosing this provider.',
        text: '',
        provider,
        latencyMs: Date.now() - startedAt,
      })
      return
    }
    if (payload.healthCheck) {
      jsonResponse(res, 200, {
        available: true,
        message: `Qwen3-VL URL is configured: ${qwenUrl}`,
        text: `Qwen3-VL URL is configured: ${qwenUrl}`,
        provider,
        latencyMs: Date.now() - startedAt,
      })
      return
    }
    try {
      const result = await postJson(qwenUrl, payload, Number(payload.timeoutMs || requestTimeoutMs))
      const normalized = toolResultFromVisionResponse(result.value)
      jsonResponse(res, 200, {
        available: result.ok && normalized.available,
        message: result.ok ? normalized.message : `Qwen3-VL service returned HTTP ${result.status}: ${String(result.rawText || '').slice(0, 500)}`,
        text: result.ok ? normalized.text : '',
        provider,
        latencyMs: Date.now() - startedAt,
      })
    } catch (error) {
      jsonResponse(res, 200, {
        available: false,
        message: `Qwen3-VL request failed: ${error?.message || error}`,
        text: '',
        provider,
        latencyMs: Date.now() - startedAt,
      })
    }
    return
  }
  if (provider !== 'moondream-station' && provider !== 'custom-http') {
    jsonResponse(res, 200, {
      available: false,
      message: `Unsupported vision provider: ${provider}`,
      text: '',
      provider,
      latencyMs: Date.now() - startedAt,
    })
    return
  }
  const stationUrl = String(payload.stationUrl || defaultStationUrl).replace(/\/+$/, '')
  if (payload.healthCheck) {
    const status = await checkStation(stationUrl)
    jsonResponse(res, 200, { ...status, text: status.message, provider, latencyMs: Date.now() - startedAt })
    return
  }

  const imageBase64 = String(payload.imageBase64 || '').trim()
  if (!imageBase64) {
    jsonResponse(res, 200, {
      available: false,
      message: 'No imageBase64 was provided. Enable "发送截图 base64" in Free Mode enhancement settings.',
      text: '',
      provider,
      latencyMs: Date.now() - startedAt,
    })
    return
  }

  const imageMimeType = String(payload.imageMimeType || 'image/png')
  const imageUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:${imageMimeType};base64,${imageBase64}`
  const question = buildQuestion(payload)
  const timeoutMs = Number(payload.timeoutMs || requestTimeoutMs)
  const stationTimeoutSeconds = Math.max(30, Math.min(180, Math.ceil(timeoutMs / 1000)))

  try {
    const result = await postJson(
      `${stationUrl}/query`,
      { image_url: imageUrl, question, timeout: stationTimeoutSeconds },
      timeoutMs + 5000,
      185000,
    )
    const text = textFromMoondreamResponse(result.value)
    const stationError = errorFromMoondreamResponse(result.value)
    if (!result.ok) {
      jsonResponse(res, 200, {
        available: false,
        message: `Moondream Station returned HTTP ${result.status}: ${String(result.rawText || '').slice(0, 500)}`,
        text: '',
        provider,
        latencyMs: Date.now() - startedAt,
      })
      return
    }
    if (stationError) {
      jsonResponse(res, 200, {
        available: false,
        message: `Moondream Station inference failed: ${stationError}`,
        text: '',
        provider,
        latencyMs: Date.now() - startedAt,
      })
      return
    }
    jsonResponse(res, 200, {
      available: Boolean(text),
      message: text ? 'Moondream vision completed.' : 'Moondream Station returned an empty answer.',
      text,
      provider,
      latencyMs: Date.now() - startedAt,
    })
  } catch (error) {
    jsonResponse(res, 200, {
      available: false,
      message: `Moondream Station request failed: ${error?.message || error}`,
      text: '',
      provider,
      latencyMs: Date.now() - startedAt,
    })
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    jsonResponse(res, 200, { ok: true })
    return
  }
  if (req.method === 'GET' && req.url === '/health') {
    checkLmStudio(defaultLmStudioChatUrl, '')
      .then((lmStudio) => jsonResponse(res, 200, { ...lmStudio, provider: 'lm-studio', stationUrl: defaultStationUrl }))
      .catch((error) => jsonResponse(res, 200, { available: false, message: String(error?.message || error), provider: 'lm-studio', stationUrl: defaultStationUrl }))
    return
  }
  if (req.method === 'POST' && req.url === '/vision') {
    void handleVision(req, res)
    return
  }
  jsonResponse(res, 404, { available: false, message: 'Use GET /health or POST /vision.', text: '' })
})

server.listen(port, host, () => {
  console.log(`Jingling vision bridge listening on http://${host}:${port}/vision`)
  console.log(`LM Studio target: ${defaultLmStudioChatUrl}`)
  console.log(`Moondream Station target: ${defaultStationUrl}`)
  console.log('For LM Studio: load a vision model and start the Local Server on port 1234.')
  console.log('For Moondream Station: start it separately with moondream-station, then Station command: start 2020.')
})
