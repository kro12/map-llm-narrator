import { createClient, type RedisClientType } from 'redis'
import { debug } from '@/lib/server/debug'
import { httpDebug } from './httpDebug'

let redis: RedisClientType | null = null

type MemEntry = { value: string; expiresAt: number }
const mem = new Map<string, MemEntry>()

function now() {
  return Date.now()
}

async function getRedis(): Promise<RedisClientType | null> {
  const url = process.env.REDIS_URL
  console.debug('REDIS_URL:', url)
  if (!url) return null

  if (redis) return redis

  redis = createClient({ url })

  redis.on('error', (err) => debug('redis', 'error', err))

  await redis.connect()
  debug('redis', 'connected')
  return redis
}

export async function cacheGet(key: string): Promise<string | null> {
  const r = await getRedis()
  if (r) return await r.get(key)

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
    await r.set(key, value, { EX: ttlSeconds })
    return
  }
  mem.set(key, { value, expiresAt: now() + ttlSeconds * 1000 })
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
 */
export async function withCacheJSON<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<{ value: T; cacheHit: boolean }> {
  const hit = await cacheGetJSON<T>(key)
  if (hit !== null) return { value: hit, cacheHit: true }

  const value = await fn()
  await cacheSetJSON(key, value, ttlSeconds)
  return { value, cacheHit: false }
}
