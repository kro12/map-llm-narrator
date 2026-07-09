import { createClient } from 'redis'
import { debug } from '@/lib/server/debug'
type RedisClient = ReturnType<typeof createClient>
let redis: RedisClient | null = null
let redisConnectPromise: Promise<RedisClient | null> | null = null

type MemEntry = { value: string; expiresAt: number }

const mem = new Map<string, MemEntry>()

function now() {
  return Date.now()
}

function cacheWarning(message: string, data?: Record<string, unknown>) {
  console.warn(
    JSON.stringify({
      scope: 'cache',
      level: 'warn',
      message,
      ...data,
    }),
  )
}

/**
 * Returns a connected Redis client when REDIS_URL is valid and reachable.
 *
 * Redis is treated as an optional optimisation. If REDIS_URL is missing,
 * malformed, or the connection fails, the app falls back to in-memory cache
 * rather than failing geo/POI/narration requests.
 */
async function getRedis(): Promise<RedisClient | null> {
  const url = process.env.REDIS_URL

  if (!url) return null
  if (redis?.isOpen) return redis
  if (redisConnectPromise) return redisConnectPromise

  redisConnectPromise = (async () => {
    try {
      const client = createClient({ url })

      client.on('error', (err) => {
        debug('redis', 'error', err)
        cacheWarning('redis client error', {
          error: err instanceof Error ? err.message : String(err),
        })
      })

      await client.connect()

      redis = client
      debug('redis', 'connected')

      return client
    } catch (error) {
      redis = null

      cacheWarning('redis unavailable; falling back to memory cache', {
        error: error instanceof Error ? error.message : String(error),
      })

      return null
    } finally {
      redisConnectPromise = null
    }
  })()

  return redisConnectPromise
}

export async function cacheGet(key: string): Promise<string | null> {
  const r = await getRedis()

  if (r) {
    try {
      return await r.get(key)
    } catch (error) {
      cacheWarning('redis read failed; falling back to memory cache', {
        key,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const entry = mem.get(key)

  if (!entry) return null

  if (entry.expiresAt <= now()) {
    mem.delete(key)
    return null
  }

  return entry.value
}

export async function cacheSet(key: string, value: string, ttlSeconds: number) {
  const r = await getRedis()

  if (r) {
    try {
      await r.set(key, value, { EX: ttlSeconds })
      return
    } catch (error) {
      cacheWarning('redis write failed; falling back to memory cache', {
        key,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  mem.set(key, {
    value,
    expiresAt: now() + ttlSeconds * 1000,
  })
}

export async function cacheGetJSON<T>(key: string): Promise<T | null> {
  const raw = await cacheGet(key)

  if (!raw) return null

  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function cacheSetJSON(key: string, value: unknown, ttlSeconds: number) {
  await cacheSet(key, JSON.stringify(value), ttlSeconds)
}

/**
 * Convenience: "get or compute" with TTL.
 *
 * Cache failures are deliberately non-fatal. Redis should speed up repeated
 * lookups, but it should never prevent reverse geocoding, POI lookup, or LLM
 * narration from running.
 */
export async function withCacheJSON<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<{ value: T; cacheHit: boolean }> {
  const cached = await cacheGetJSON<T>(key)

  if (cached !== null) {
    return {
      value: cached,
      cacheHit: true,
    }
  }

  const value = await fetcher()

  await cacheSetJSON(key, value, ttlSeconds)

  return {
    value,
    cacheHit: false,
  }
}
