import { createClient } from 'redis'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Temporary Redis health check endpoint.
 *
 * This route validates that the active deployment can read REDIS_URL, connect to
 * Redis, write a short-lived test key, read it back, and delete it again.
 *
 * It is intentionally guarded by ENABLE_DEBUG_ROUTES so it can be enabled during
 * production debugging without leaving cache diagnostics publicly accessible.
 * The response only exposes safe status information and never returns the Redis
 * URL or credentials.
 */
export async function GET() {
  if (process.env.ENABLE_DEBUG_ROUTES !== '1') {
    return Response.json({ ok: false, error: 'Debug routes disabled' }, { status: 404 })
  }

  const url = process.env.REDIS_URL

  if (!url) {
    return Response.json({
      ok: false,
      redisConfigured: false,
      error: 'REDIS_URL is missing',
    })
  }

  let client: ReturnType<typeof createClient> | null = null

  try {
    client = createClient({ url })

    client.on('error', () => {
      // Avoid noisy unhandled client errors.
    })

    await client.connect()

    const key = `debug:redis:${Date.now()}`
    const value = `ok:${new Date().toISOString()}`

    await client.set(key, value, { EX: 60 })

    const readBack = await client.get(key)

    await client.del(key)
    await client.quit()

    return Response.json({
      ok: readBack === value,
      redisConfigured: true,
      connected: true,
      setGetWorked: readBack === value,
      urlScheme: url.startsWith('rediss://')
        ? 'rediss'
        : url.startsWith('redis://')
          ? 'redis'
          : 'unknown',
    })
  } catch (error) {
    try {
      await client?.disconnect()
    } catch {
      // Ignore cleanup errors.
    }

    return Response.json(
      {
        ok: false,
        redisConfigured: true,
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
