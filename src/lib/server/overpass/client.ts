import { debug } from '@/lib/server/debug'

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

const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]

/**
 * Merge two abort signals so either can cancel the request.
 */
function mergeSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (!a) return b
  if (!b) return a

  if (a.aborted || b.aborted) {
    const ac = new AbortController()
    ac.abort()
    return ac.signal
  }

  const ac = new AbortController()
  const onAbort = () => ac.abort()

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

/**
 * Fetch with timeout wrapper.
 */
async function fetchWithTimeout(url: string, init: RequestInit, ms: number, signal?: AbortSignal) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  try {
    const merged = mergeSignals(signal, ac.signal)
    return await fetch(url, { ...init, signal: merged })
  } finally {
    clearTimeout(t)
  }
}

/**
 * Fetch Overpass data with automatic failover across multiple endpoints.
 */
export async function fetchOverpass(
  query: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<OverpassResponse> {
  let lastErr: unknown = null
  let attempt = 0

  for (const endpoint of OVERPASS_ENDPOINTS) {
    attempt++
    try {
      debug('overpass', `attempt ${attempt}/${OVERPASS_ENDPOINTS.length}`, endpoint)

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

      // Retry server overload errors on next endpoint
      if (res.status === 504 || res.status === 503 || res.status === 429) {
        debug('overpass', `${res.status} (server overloaded), trying next endpoint`)
        lastErr = new Error(`Overpass HTTP ${res.status} (overloaded)`)
        continue
      }

      if (!res.ok) throw new Error(`Overpass HTTP ${res.status} @ ${endpoint}`)

      const data = (await res.json()) as OverpassResponse
      debug('overpass', `success on attempt ${attempt}`, {
        endpoint,
        elements: data.elements.length,
      })
      return data
    } catch (e) {
      // If budget abort fired, stop immediately
      if (signal?.aborted) throw e

      lastErr = e
      const errMsg = e instanceof Error ? e.message : 'Unknown error'
      debug('overpass', 'endpoint failed', endpoint, errMsg)

      // Brief delay before trying next endpoint
      if (attempt < OVERPASS_ENDPOINTS.length && timeoutMs > 1500) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('Overpass failed on all endpoints')
}
