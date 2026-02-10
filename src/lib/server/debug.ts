const DEBUG_API = process.env.DEBUG_API === '1' && process.env.NODE_ENV !== 'production'

export function debug(scope: string, ...args: unknown[]) {
  if (!DEBUG_API) return
  console.log(`[${scope}]`, ...args)
}

/**
 * Time an async operation and log the duration when DEBUG_API=1 (non-prod).
 * Returns the original result, so it’s easy to wrap calls.
 * example: const pois = await timed("overpass.pois", () => fetchPois(lat, lon))
 */
export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    return await fn()
  } finally {
    if (DEBUG_API) {
      const ms = performance.now() - start
      console.log(`[timing] ${label}: ${ms.toFixed(1)}ms`)
    }
  }
}
