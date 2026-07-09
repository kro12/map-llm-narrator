import { debug } from '@/lib/server/debug'
import { resolveUrlList } from '@/lib/server/urlConfig'

type OverpassResponse = {
  elements: Array<{
    type: 'node' | 'way' | 'relation'
    id: number
    lat?: number
    lon?: number
    center?: { lat: number; lon: number }
    tags?: Record<string, string>
  }>
}

const DEFAULT_OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]

function getOverpassEndpoints() {
  return resolveUrlList('OVERPASS_ENDPOINTS', DEFAULT_OVERPASS_ENDPOINTS)
}

function mergeSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (!a) return b
  if (!b) return a

  if (a.aborted || b.aborted) {
    const ac = new AbortController()
    ac.abort(a.reason ?? b.reason ?? new Error('Aborted'))
    return ac.signal
  }

  const ac = new AbortController()
  const onAbort = () => ac.abort(a.reason ?? b.reason ?? new Error('Aborted'))

  a.addEventListener('abort', onAbort, { once: true })
  b.addEventListener('abort', onAbort, { once: true })

  ac.signal.addEventListener(
    'abort',
    () => {
      a.removeEventListener('abort', onAbort)
      b.removeEventListener('abort', onAbort)
    },
    { once: true },
  )

  return ac.signal
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number, signal?: AbortSignal) {
  const ac = new AbortController()

  const timer = setTimeout(() => {
    ac.abort(new Error(`Fetch timed out after ${ms}ms: ${url}`))
  }, ms)

  try {
    const merged = mergeSignals(signal, ac.signal)
    return await fetch(url, { ...init, signal: merged })
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchOverpass(
  query: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<OverpassResponse> {
  const endpoints = getOverpassEndpoints()

  let lastErr: unknown = null
  let attempt = 0

  for (const endpoint of endpoints) {
    attempt++

    try {
      debug('overpass', `attempt ${attempt}/${endpoints.length}`, endpoint)

      const res = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            Accept: 'application/json',
            'User-Agent': 'map-llm-narrator-demo/1.0 (github demo)',
          },
          body: new URLSearchParams({ data: query }).toString(),
        },
        timeoutMs,
        signal,
      )

      if (res.status === 504 || res.status === 503 || res.status === 429) {
        debug('overpass', `${res.status} overloaded/rate-limited, trying next endpoint`, {
          endpoint,
        })
        lastErr = new Error(`Overpass HTTP ${res.status} @ ${endpoint}`)
        continue
      }

      if (!res.ok) {
        throw new Error(`Overpass HTTP ${res.status} @ ${endpoint}`)
      }

      const data = (await res.json()) as OverpassResponse

      debug('overpass', `success on attempt ${attempt}`, {
        endpoint,
        elements: data.elements.length,
      })

      return data
    } catch (error) {
      if (signal?.aborted) throw error

      lastErr = error
      debug('overpass', 'endpoint failed', {
        endpoint,
        error: error instanceof Error ? error.message : String(error),
      })

      if (attempt < endpoints.length && timeoutMs > 1500) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('Overpass failed on all endpoints')
}
