import type { LatLon, Poi } from '@/lib/shared/types'
import { withCacheJSON } from '@/lib/server/cache'
import { debug, timed } from '@/lib/server/debug'
import { buildAttractionQuery, buildFoodQuery, elementsToPois } from '@/lib/server/overpass/queries'
import { fetchOverpass } from '@/lib/server/overpass/client'

export type PoisResult = {
  attractions: Poi[]
  food: Poi[]
  errors: string[]
  warnings?: string[]
}

const POIS_BUDGET_MS = (() => {
  const raw = process.env.POIS_BUDGET_MS
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) ? n : 19_000 // Increased from 10s to 19s
})()

// Per-query timeout - much shorter than total budget
const PER_QUERY_TIMEOUT_MS = 8000 // 8 seconds per query max

/**
 * Safe wrapper: never throw POI errors to the caller.
 */
export async function getPoisSafe(point: LatLon): Promise<{ pois: PoisResult; cacheHit: boolean }> {
  try {
    const { pois, cacheHit, budgetExceeded } = await getPois(point)
    return {
      pois: {
        ...pois,
        errors: [],
        ...(budgetExceeded
          ? { warnings: ['POI lookup timed out; showing partial nearby results.'] }
          : {}),
      },
      cacheHit,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown Overpass error'
    debug('poiResolver', 'falling back to minimal data', msg)
    return {
      pois: {
        attractions: [],
        food: [],
        errors: [`Overpass API unavailable: ${msg}. Showing location info only.`],
      },
      cacheHit: false,
    }
  }
}

export async function getPois(point: LatLon): Promise<{
  pois: { attractions: Poi[]; food: Poi[] }
  cacheHit: boolean
  budgetExceeded: boolean
}> {
  // ~100m rounding to increase cache hits while remaining narratively relevant
  const lat = Number(point.lat.toFixed(3))
  const lon = Number(point.lon.toFixed(3))
  const rounded: LatLon = { lat, lon }

  const key = `pois:v3:${lat},${lon}`
  const ttlSeconds = 60 * 60 * 24 // 24h

  return await timed('overpass.pois.total', async () => {
    let budgetExceeded = false

    const { value, cacheHit } = await withCacheJSON<{ attractions: Poi[]; food: Poi[] }>(
      key,
      ttlSeconds,
      async () => {
        const strategies = [
          { name: 'normal', attractionRadius: 2500, foodRadius: 1000 },
          { name: 'fallback', attractionRadius: 1500, foodRadius: 1000 },
          { name: 'minimal', attractionRadius: 500, foodRadius: 500 },
        ] as const

        const budgetStart = Date.now()
        let lastError: Error | null = null

        for (const strategy of strategies) {
          const elapsed = Date.now() - budgetStart
          if (elapsed >= POIS_BUDGET_MS) {
            budgetExceeded = true
            debug('overpass', 'budget exceeded before trying strategy', {
              elapsedMs: elapsed,
              strategy: strategy.name,
            })
            break
          }

          try {
            debug('overpass', `trying ${strategy.name} strategy`, strategy)

            const attractionsQuery = buildAttractionQuery(rounded, strategy.attractionRadius)
            const foodQuery = buildFoodQuery(rounded, strategy.foodRadius)

            // Use fixed per-query timeout, not remaining budget
            // This ensures both queries together take max ~12s, leaving room for fallback
            const queryTimeout = PER_QUERY_TIMEOUT_MS

            // Fetch both in parallel, allow partial success
            const [attRes, foodRes] = await Promise.allSettled([
              timed('overpass.attractions', () => fetchOverpass(attractionsQuery, queryTimeout)),
              timed('overpass.food', () => fetchOverpass(foodQuery, queryTimeout)),
            ])

            const attractions =
              attRes.status === 'fulfilled'
                ? elementsToPois(rounded, 'attraction', attRes.value.elements).slice(0, 25)
                : []

            const food =
              foodRes.status === 'fulfilled'
                ? elementsToPois(rounded, 'food', foodRes.value.elements).slice(0, 25)
                : []

            const attractionsOk = attRes.status === 'fulfilled'
            const foodOk = foodRes.status === 'fulfilled'

            debug('overpass', `${strategy.name} strategy complete`, {
              attractions: attractions.length,
              food: food.length,
              attractionsOk,
              foodOk,
            })

            // Accept partial results: if we got EITHER attractions OR food, use them
            if (attractions.length > 0 || food.length > 0) {
              return { attractions, food }
            }

            // Both queries returned empty OR both failed - try next strategy
            const reasons = []
            if (!attractionsOk && attRes.status === 'rejected') {
              reasons.push(`attractions: ${attRes.reason}`)
            }
            if (!foodOk && foodRes.status === 'rejected') {
              reasons.push(`food: ${foodRes.reason}`)
            }

            lastError = new Error(
              `${strategy.name} strategy failed: ${reasons.length > 0 ? reasons.join(', ') : 'no POIs found'}`,
            )

            debug('overpass', `${strategy.name} strategy unsuccessful, trying next`, {
              reason: lastError.message,
            })

            // Brief delay before next strategy (but not after minimal)
            if (strategy.name !== 'minimal') {
              await new Promise((resolve) => setTimeout(resolve, 300))
            }
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error))
            debug('overpass', `${strategy.name} strategy error`, lastError.message)

            // Brief delay before next strategy
            if (strategy.name !== 'minimal') {
              await new Promise((resolve) => setTimeout(resolve, 300))
            }
          }
        }

        // All strategies failed
        throw lastError ?? new Error('All strategies failed to find POIs')
      },
    )

    debug('poiResolver', `cacheHit=${cacheHit}`, {
      attractions: value.attractions.length,
      food: value.food.length,
      budgetExceeded,
    })

    return { pois: value, cacheHit, budgetExceeded }
  })
}
