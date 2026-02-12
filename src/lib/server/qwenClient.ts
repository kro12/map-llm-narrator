import { debug, timed } from '@/lib/server/debug'
import {
  type NarrationOutput,
  validateNarrationOutput,
  validateNarrationOutputWithAllowedNames,
  extractJSON,
} from '@/lib/server/narrationSchema'

type QwenStreamLine = {
  response?: string
  done?: boolean
}

type QwenOptions = {
  url?: string
  token?: string
  model?: string
  temperature?: number
  numPredict?: number
  numCtx?: number
  stop?: string[]
  keepAlive?: string
  format?: 'json' // Force JSON output mode
}

type QwenGenerateOptions = QwenOptions & {
  allowedNames?: Set<string>
  maxRetries?: number
  retryDelayMs?: number
}

function envNumber(name: string, fallback: number) {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

/**
 * Stream text chunks from Ollama-style `/generate` endpoint
 */
export async function* streamQwen(prompt: string, opts: QwenOptions = {}) {
  const url = opts.url ?? process.env.QWEN_URL
  const token = opts.token ?? process.env.TOKEN
  const model = opts.model ?? process.env.QWEN_MODEL ?? 'qwen2.5:7b-instruct'
  const temperature = opts.temperature ?? envNumber('QWEN_TEMPERATURE', 0.6)
  const numPredict = opts.numPredict ?? envNumber('QWEN_NUM_PREDICT', 900)
  const numCtx = opts.numCtx ?? envNumber('QWEN_NUM_CTX', 4096)

  const stop = opts.stop ?? ['\nEND']
  const keepAlive = opts.keepAlive ?? '24h'

  if (!url) throw new Error('Missing QWEN_URL env var.')
  if (!token) throw new Error('Missing TOKEN env var (Bearer token).')

  const payload = {
    model,
    stream: true,
    keep_alive: keepAlive,
    format: opts.format, // 'json' for structured output
    options: { temperature, num_predict: numPredict, num_ctx: numCtx, stop },
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

  debug('qwen', 'stream start', { model, url, format: opts.format })

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line) continue

      let obj: QwenStreamLine | null = null
      try {
        obj = JSON.parse(line) as QwenStreamLine
      } catch {
        buffer = line + '\n' + buffer
        break
      }

      if (obj?.response) yield obj.response
      if (obj?.done) return
    }
  }
}

/**
 * Non-streaming generation with automatic retry and validation
 *
 * This is the "function calling emulation" - we force JSON output,
 * validate against schema, and retry on failure.
 */
export async function generateQwenValidated(
  prompt: string,
  opts: QwenGenerateOptions = {},
): Promise<NarrationOutput> {
  const maxRetries = opts.maxRetries ?? 3
  const retryDelayMs = opts.retryDelayMs ?? 1000

  let lastError: Error | null = null
  let attempt = 0

  while (attempt < maxRetries) {
    attempt++
    debug('qwen.validated', `attempt ${attempt}/${maxRetries}`)

    try {
      // Collect full response from stream
      const chunks: string[] = []
      for await (const chunk of streamQwen(prompt, { ...opts, format: 'json' })) {
        chunks.push(chunk)
      }

      const rawResponse = chunks.join('')
      debug('qwen.validated', 'raw response length', rawResponse.length)

      // Extract and parse JSON
      const parsed = extractJSON(rawResponse)

      // Validate against schema
      const validation = opts.allowedNames
        ? validateNarrationOutputWithAllowedNames(parsed, opts.allowedNames)
        : validateNarrationOutput(parsed)

      if (validation.success) {
        debug('qwen.validated', 'success', { validationData: validation.data })
        return validation.data
      }

      // Schema validation failed
      lastError = new Error(
        `Schema validation failed (attempt ${attempt}): ${validation.issues.join(', ')}`,
      )
      debug('qwen.validated', 'validation failed', validation.issues)

      // Don't retry on last attempt
      if (attempt < maxRetries) {
        debug('qwen.validated', `retrying after ${retryDelayMs}ms`)
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      debug('qwen.validated', 'error', lastError.message)

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
      }
    }
  }

  throw lastError ?? new Error('Validation failed after all retries')
}

/**
 * Type-safe wrapper for generating with explicit schema validation
 */
export async function generateNarration(
  prompt: string,
  opts?: QwenGenerateOptions,
): Promise<NarrationOutput> {
  return generateQwenValidated(prompt, opts)
}
