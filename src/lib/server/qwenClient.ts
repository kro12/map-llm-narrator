import { debug, timed } from '@/lib/server/debug'

type QwenStreamLine = {
  response?: string
  done?: boolean
}

type QwenOptions = {
  url?: string // QWEN_URL
  token?: string // TOKEN (Bearer)
  model?: string // QWEN_MODEL
  temperature?: number // QWEN_TEMPERATURE
  numPredict?: number // QWEN_NUM_PREDICT
  stop?: string[] // stop tokens
  keepAlive?: string // optional, if your endpoint supports it
}

/**
 * Safely read a numeric environment variable.
 *
 * Environment variables are always strings and may be missing
 * or misconfigured. This helper:
 * - converts the value to a number
 * - falls back if the variable is unset
 * - falls back if the value is not a finite number
 */
function envNumber(name: string, fallback: number) {
  const raw = process.env[name]
  if (!raw) return fallback

  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

/**
 * Streams text chunks from your Ollama-style `/generate` endpoint:
 * expects newline-delimited JSON with { response, done }.
 */
export async function* streamQwen(prompt: string, opts: QwenOptions = {}) {
  const url = opts.url ?? process.env.QWEN_URL
  const token = opts.token ?? process.env.TOKEN
  const model = opts.model ?? process.env.QWEN_MODEL ?? 'qwen2.5:3b-instruct'
  const temperature = opts.temperature ?? envNumber('QWEN_TEMPERATURE', 0.6)
  const numPredict = opts.numPredict ?? envNumber('QWEN_NUM_PREDICT', 900)
  const stop = opts.stop ?? ['\nEND']
  const keepAlive = opts.keepAlive ?? '24h'

  if (!url) throw new Error('Missing QWEN_URL env var.')
  if (!token) throw new Error('Missing TOKEN env var (Bearer token).')

  const payload = {
    model,
    stream: true,
    keep_alive: keepAlive,
    options: { temperature, num_predict: numPredict, stop },
    prompt,
  }

  const res = await timed('qwen.fetch', async () => {
    return await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Qwen upstream error: HTTP ${res.status}\n${body.slice(0, 1200)}`)
  }
  if (!res.body) throw new Error('Qwen response has no body.')

  debug('qwen', 'stream start', { model, url })

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // NDJSON: parse line-by-line
    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line) continue

      let obj: QwenStreamLine | null = null
      try {
        obj = JSON.parse(line) as QwenStreamLine
      } catch {
        // If partial JSON landed, put it back and wait for more data
        buffer = line + '\n' + buffer
        break
      }

      if (obj?.response) yield obj.response
      if (obj?.done) return
    }
  }
}
