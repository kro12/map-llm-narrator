import { debug, timed } from '@/lib/server/debug'
import {
  type NarrationOutput,
  validateNarrationOutput,
  validateNarrationOutputWithAllowedNames,
  extractJSON,
} from '@/lib/server/narrationSchema'

type LlmStreamLine = {
  response?: string
  done?: boolean
}

/**
 * LLM Options (passed to Ollama /generate endpoint)
 *
 * url: Ollama endpoint (default: LLM_URL)
 * token: Bearer auth (default: TOKEN)
 * model: Ollama model tag (default: LLM_MODEL or 'qwen2.5:7b-instruct')
 *
 * temperature: randomness - low=more predictable/factual/deterministic. Higher=more creative/varied [0.0-2.0]
 * numPredict: maximum tokens to generate in response (~4 chars/token)
 * numCtx: context length (prompt + response; larger=slower, more coherent)
 * stop: list of stop sequences - generation halts if model outputs any
 * keepAlive: model unload timer ('5m', '30s', '0' = immediate)
 * topP: nucleus sampling - lower=more conservative/focused. Higher=more adventurous/diverse [0.0-1.0]
 * repeatPenalty: discourages repetition of phrases/words (>1.0) [1.0-2.0]
 * format: 'json' forces JSON-mode structured output (your schema validation)
 */
type LlmOptions = {
  url?: string
  token?: string
  model?: string
  temperature?: number
  numPredict?: number
  numCtx?: number
  stop?: string[]
  keepAlive?: string
  topP?: number
  repeatPenalty?: number
  format?: 'json'
}

type LlmGenerateOptions = LlmOptions & {
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
export async function* streamLlm(prompt: string, opts: LlmOptions = {}) {
  const url = opts.url ?? process.env.LLM_URL
  const token = opts.token ?? process.env.TOKEN
  const model = opts.model ?? process.env.LLM_MODEL ?? 'qwen2.5:7b-instruct'
  const temperature = opts.temperature ?? envNumber('LLM_TEMPERATURE', 0.2)
  const numPredict = opts.numPredict ?? envNumber('LLM_NUM_PREDICT', 350)
  const numCtx = opts.numCtx ?? envNumber('LLM_NUM_CTX', 4096)

  const stop = opts.stop ?? ['\nEND']
  const keepAlive = opts.keepAlive ?? '30s'

  const topP = opts.topP ?? envNumber('LLM_TOP_P', 0.9)
  const repeatPenalty = opts.repeatPenalty ?? envNumber('LLM_REPEAT_PENALTY', 1.05)

  if (!url) throw new Error('Missing LLM_URL env var.')
  if (!token) throw new Error('Missing TOKEN env var (Bearer token).')

  const payload = {
    model,
    stream: true,
    keep_alive: keepAlive,
    format: opts.format, // 'json' for structured output
    options: {
      stop,
      temperature,
      num_predict: numPredict,
      num_ctx: numCtx,
      top_p: topP,
      repeat_penalty: repeatPenalty,
    },
    prompt,
  }

  const res = await timed('llm.fetch', async () => {
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
    throw new Error(`Llm upstream error: HTTP ${res.status}\n${body.slice(0, 1200)}`)
  }
  if (!res.body) throw new Error('Llm response has no body.')

  debug('llm', 'stream start', { model, url, format: opts.format })

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

      let obj: LlmStreamLine | null = null
      try {
        obj = JSON.parse(line) as LlmStreamLine
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
export async function generateLlmValidated(
  prompt: string,
  opts: LlmGenerateOptions = {},
): Promise<NarrationOutput> {
  const maxRetries = opts.maxRetries ?? 3
  const retryDelayMs = opts.retryDelayMs ?? 1000

  let lastError: Error | null = null
  let attempt = 0

  while (attempt < maxRetries) {
    attempt++
    debug('llm.validated', `attempt ${attempt}/${maxRetries}`)

    try {
      // Collect full response from stream
      const chunks: string[] = []
      for await (const chunk of streamLlm(prompt, { ...opts, format: 'json' })) {
        chunks.push(chunk)
      }

      const rawResponse = chunks.join('')
      debug('llm.validated', 'raw response length', rawResponse.length)

      // Extract and parse JSON
      const parsed = extractJSON(rawResponse)

      // Validate against schema
      const validation = opts.allowedNames
        ? validateNarrationOutputWithAllowedNames(parsed, opts.allowedNames)
        : validateNarrationOutput(parsed)

      if (validation.success) {
        debug('llm.validated', 'success', { validationData: validation.data })
        return validation.data
      }

      // Schema validation failed
      lastError = new Error(
        `Schema validation failed (attempt ${attempt}): ${validation.issues.join(', ')}`,
      )
      debug('llm.validated', 'validation failed', validation.issues)

      // Don't retry on last attempt
      if (attempt < maxRetries) {
        debug('llm.validated', `retrying after ${retryDelayMs}ms`)
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      debug('llm.validated', 'error', lastError.message)

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
  opts?: LlmGenerateOptions,
): Promise<NarrationOutput> {
  return generateLlmValidated(prompt, opts)
}
