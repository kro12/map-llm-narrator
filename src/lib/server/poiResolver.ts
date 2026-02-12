import type { LatLon, Poi } from '@/lib/shared/types'
import { withCacheJSON } from '@/lib/server/cache'
import { debug, timed } from '@/lib/server/debug'

type OverpassElement = {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

type OverpassResponse = {
  elements: OverpassElement[]
}

export type PoisResult = {
  attractions: Poi[]
  food: Poi[]
  errors: string[]
  warnings?: string[] // shown when we return partial POIs due to time budget
}

/**
 * OPTIMIZATION 1: Use public Overpass instances that are more stable.
 * Note: these vary day-to-day; failover makes this tolerable.
 */
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter', // often fast
  'https://z.overpass-api.de/api/interpreter', // "official cluster" mirror
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter', // main (often most loaded)
]

function kmBetween(a: LatLon, b: LatLon) {
  const R = 6371
  const dLat = deg2rad(b.lat - a.lat)
  const dLon = deg2rad(b.lon - a.lon)
  const lat1 = deg2rad(a.lat)
  const lat2 = deg2rad(b.lat)

  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function deg2rad(d: number) {
  return (d * Math.PI) / 180
}

function getElementCoords(el: OverpassElement): LatLon | null {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') return { lat: el.lat, lon: el.lon }
  if (el.center && typeof el.center.lat === 'number' && typeof el.center.lon === 'number')
    return { lat: el.center.lat, lon: el.center.lon }
  return null
}

function osmUrl(el: OverpassElement) {
  const base = 'https://www.openstreetmap.org'
  if (el.type === 'node') return `${base}/node/${el.id}`
  if (el.type === 'way') return `${base}/way/${el.id}`
  return `${base}/relation/${el.id}`
}

function normalizeName(tags?: Record<string, string>) {
  if (!tags) return null
  return tags.name || tags['name:en'] || null
}

/**
 * Narration-quality update:
 * Derive deterministic fields used for ranking and prompt diversity.
 */
function deriveAttractionMeta(tags?: Record<string, string>) {
  const t = tags ?? {}
  const tourism = t.tourism
  const historic = t.historic
  const natural = t.natural
  const manMade = t.man_made
  const leisure = t.leisure

  let bucket: Poi['bucket'] = 'landmark'
  let hint = ''
  let score = 0

  // Strong signals that correlate with better narration quality
  if (t.wikipedia || t.wikidata) score += 6
  if (t.website) score += 3

  if (tourism) {
    if (tourism === 'museum') {
      bucket = 'culture'
      hint = 'museum'
      score += 6
    } else if (tourism === 'gallery') {
      bucket = 'culture'
      hint = 'gallery'
      score += 5
    } else if (tourism === 'viewpoint') {
      bucket = 'scenic'
      hint = 'viewpoint'
      score += 5
    } else {
      bucket = 'landmark'
      hint = tourism
      score += 4
    }
  }

  if (historic) {
    bucket = 'history'
    if (historic === 'castle') {
      hint = 'castle'
      score += 7
    } else if (historic === 'ruins') {
      hint = 'ruins'
      score += 6
    } else {
      hint = historic
      score += 5
    }
  }

  if (manMade && !hint) {
    bucket = 'landmark'
    hint = manMade === 'lighthouse' ? 'lighthouse' : manMade
    score += 3
  }

  if (natural && !hint) {
    bucket = 'scenic'
    hint = natural === 'beach' ? 'beach' : natural
    score += 4
  }

  if (leisure && (leisure === 'park' || leisure === 'garden' || leisure === 'nature_reserve')) {
    bucket = 'park'
    if (!hint) hint = leisure
    // only boost parks when they have strong supporting signals
    score += t.wikipedia || t.wikidata ? 3 : 0
  }

  return { bucket, hint, score }
}

/**
 * Narration-quality update for food:
 * - bucket is always 'food'
 * - foodKind provides subtyping used by prompt diversity
 */
function deriveFoodMeta(tags?: Record<string, string>) {
  const t = tags ?? {}
  const amenity = t.amenity

  let foodKind: NonNullable<Poi['foodKind']> = 'other'
  const hint = amenity || 'food & drink'
  let score = 0

  if (amenity === 'pub') {
    foodKind = 'pub'
    score += 5
  } else if (amenity === 'cafe') {
    foodKind = 'cafe'
    score += 4
  } else if (amenity === 'restaurant') {
    foodKind = 'restaurant'
    score += 3
  } else if (amenity === 'bar') {
    foodKind = 'bar'
    score += 4
  } else {
    score += 1
  }

  if (t.website) score += 2
  if (t.wikipedia || t.wikidata) score += 3

  return { bucket: 'food' as const, foodKind, hint, score }
}

/**
 * Fallback attractions query: nodes-only + fewer tag groups.
 * Intended for dense areas where the main attractions query may overload / time out.
 */
function buildAttractionQueryNodesOnly(point: LatLon, radiusMeters: number) {
  const { lat, lon } = point

  return `
[out:json][timeout:12];
(
  node(around:${radiusMeters},${lat},${lon})["tourism"~"attraction|museum|gallery|viewpoint|artwork"];
  node(around:${radiusMeters},${lat},${lon})["historic"~"castle|ruins|monument|memorial|archaeological_site"];
  node(around:${radiusMeters},${lat},${lon})["man_made"~"lighthouse|tower|bridge"];
);
out tags center;
`
}

/**
 * OPTIMIZATION 2: Reduce query complexity (avoid mega queries).
 *
 * Key idea: in dense cities, `way(...)` queries are the most likely to time out / 504.
 * We bias toward high-signal *nodes* (tourism/historic/natural/man_made/leisure).
 */
function buildAttractionQuery(point: LatLon, radiusMeters: number) {
  const { lat, lon } = point

  return `
[out:json][timeout:15];
(
  // High-signal tourism POIs (nodes only)
  node(around:${radiusMeters},${lat},${lon})["tourism"~"attraction|museum|gallery|viewpoint|zoo|theme_park|artwork"];

  // Historic POIs (nodes only; more selective)
  node(around:${radiusMeters},${lat},${lon})["historic"~"castle|ruins|monument|memorial|fort|archaeological_site"];

  // Scenic / notable structures (nodes only)
  node(around:${radiusMeters},${lat},${lon})["man_made"~"lighthouse|tower|bridge"];
  node(around:${radiusMeters},${lat},${lon})["natural"~"beach|peak|cliff|waterfall|bay"];

  // Leisure areas (nodes only)
  node(around:${radiusMeters},${lat},${lon})["leisure"~"park|garden|nature_reserve"];
);
out tags center;
`
}

function buildFoodQuery(point: LatLon, radiusMeters: number) {
  const { lat, lon } = point
  return `
[out:json][timeout:15];
(
  node(around:${radiusMeters},${lat},${lon})["amenity"~"restaurant|cafe|fast_food|pub|bar"];
);
out tags center;
`
}

/**
 * Merge two abort signals so either can cancel the request.
 * If either is already aborted, abort immediately.
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

  // Clean up listeners once we abort to avoid tiny listener leaks
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
 * OPTIMIZATION 3: Early abort via timeout + optional external signal (budget).
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
 * OPTIMIZATION 4: Overpass failover.
 * `timeoutMs` is per-endpoint; `signal` is the shared budget abort.
 */
async function fetchOverpassWithFailover(query: string, timeoutMs: number, signal?: AbortSignal) {
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
      // If budget abort fired, stop failover immediately (don’t waste time)
      if (signal?.aborted) throw e

      lastErr = e
      const errMsg = e instanceof Error ? e.message : 'Unknown error'
      debug('overpass', 'endpoint failed', endpoint, errMsg)

      // Courtesy delay, but don’t waste time if we’re near the end of budget.
      if (attempt < OVERPASS_ENDPOINTS.length && timeoutMs > 1500) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('Overpass failed on all endpoints')
}

/**
 * Convert raw Overpass elements -> POIs with ranking metadata.
 * Branch on `kind` to satisfy Poi discriminated union typing.
 */
function elementsToPois(point: LatLon, kind: 'attraction' | 'food', elements: OverpassElement[]) {
  const out: Poi[] = []

  for (const el of elements) {
    const coords = getElementCoords(el)
    if (!coords) continue

    const name = normalizeName(el.tags)
    if (!name) continue

    // Cheap filter for obvious low-signal attraction names.
    const n = name.toLowerCase()
    if (kind === 'attraction') {
      if (n === 'park' || n === 'playground' || n.includes('playing fields')) continue
    }

    const d = kmBetween(point, coords)

    if (kind === 'attraction') {
      const meta = deriveAttractionMeta(el.tags)
      out.push({
        name,
        category: 'attraction',
        lat: coords.lat,
        lon: coords.lon,
        distanceKm: d,
        osmUrl: osmUrl(el),
        score: meta.score,
        bucket: meta.bucket,
        hint: meta.hint,
      })
    } else {
      const meta = deriveFoodMeta(el.tags)
      out.push({
        name,
        category: 'food',
        lat: coords.lat,
        lon: coords.lon,
        distanceKm: d,
        osmUrl: osmUrl(el),
        score: meta.score,
        bucket: 'food',
        foodKind: meta.foodKind,
        hint: meta.hint,
      })
    }
  }

  // De-dupe by name + approximate location + category
  const seen = new Set<string>()
  const deduped: Poi[] = []
  for (const p of out) {
    const key = `${p.name.toLowerCase()}|${p.lat.toFixed(4)}|${p.lon.toFixed(4)}|${p.category}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(p)
  }

  // Rank by narratability first, then distance
  deduped.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.distanceKm - b.distanceKm)

  return deduped
}

/**
 * Safe wrapper: never throw POI errors to the caller.
 * Adds a warning when we return partial results due to time budget.
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
  // v3 rounding: ~100m to increase cache hits while still being narratively relevant.
  const lat = Number(point.lat.toFixed(3))
  const lon = Number(point.lon.toFixed(3))
  const rounded: LatLon = { lat, lon }

  const key = `pois:v3:${lat},${lon}`
  const ttlSeconds = 60 * 60 * 24 // 24h

  return await timed('overpass.pois.total', async () => {
    // Track budget exhaustion OUTSIDE cached value (don’t cache transient timeouts)
    let budgetExceeded = false

    const { value, cacheHit } = await withCacheJSON<{ attractions: Poi[]; food: Poi[] }>(
      key,
      ttlSeconds,
      async () => {
        const strategies = [
          { name: 'normal', attractionRadius: 5000, foodRadius: 2000 },
          { name: 'fallback', attractionRadius: 2000, foodRadius: 1000 },
          { name: 'minimal', attractionRadius: 500, foodRadius: 500 },
        ] as const

        let lastError: Error | null = null

        // Global wall-clock budget for POIs (env var).
        // Example: POIS_BUDGET_MS=15000
        const POIS_BUDGET_MS = (() => {
          const raw = process.env.POIS_BUDGET_MS
          const n = raw ? Number(raw) : NaN
          return Number.isFinite(n) ? n : 10_000
        })()

        const budgetStart = Date.now()

        // Abort everything once budget is hit (kills in-flight fetches)
        const budgetAbort = new AbortController()
        const budgetTimer = setTimeout(() => budgetAbort.abort(), POIS_BUDGET_MS)

        let bestAttractions: Poi[] = []
        let bestFood: Poi[] = []

        try {
          for (const strategy of strategies) {
            const elapsed = Date.now() - budgetStart
            if (elapsed >= POIS_BUDGET_MS) {
              budgetExceeded = true
              debug('overpass', 'POIs budget exceeded, returning best partial results', {
                elapsedMs: elapsed,
                bestAttractions: bestAttractions.length,
                bestFood: bestFood.length,
                lastStrategyTried: strategy.name,
              })
              return { attractions: bestAttractions, food: bestFood }
            }

            try {
              debug('overpass', `trying ${strategy.name} strategy`, strategy)

              const attractionsQuery = buildAttractionQuery(rounded, strategy.attractionRadius)
              const foodQuery = buildFoodQuery(rounded, strategy.foodRadius)

              const remaining = Math.max(1000, POIS_BUDGET_MS - (Date.now() - budgetStart))

              // Allow one side to succeed even if the other fails.
              const [attRes, foodRes] = await Promise.allSettled([
                timed('overpass.attractions', () =>
                  fetchOverpassWithFailover(attractionsQuery, remaining, budgetAbort.signal),
                ),
                timed('overpass.food', () =>
                  fetchOverpassWithFailover(foodQuery, remaining, budgetAbort.signal),
                ),
              ])

              if (attRes.status === 'rejected') {
                debug('overpass', 'attractions rejected', {
                  reason: String(attRes.reason),
                  remainingMs: remaining,
                })
              }
              if (foodRes.status === 'rejected') {
                debug('overpass', 'food rejected', {
                  reason: String(foodRes.reason),
                  remainingMs: remaining,
                })
              }

              let attractions =
                attRes.status === 'fulfilled'
                  ? elementsToPois(rounded, 'attraction', attRes.value.elements).slice(0, 25)
                  : []

              const food =
                foodRes.status === 'fulfilled'
                  ? elementsToPois(rounded, 'food', foodRes.value.elements).slice(0, 25)
                  : []

              debug('overpass', 'post-transform counts', {
                rawAttractionElements:
                  attRes.status === 'fulfilled' ? attRes.value.elements.length : 0,
                rawFoodElements: foodRes.status === 'fulfilled' ? foodRes.value.elements.length : 0,
                attractionsAfterFilter: attractions.length,
                foodAfterFilter: food.length,
              })

              /**
               * NEW: attractions-only fallback
               *
               * If food succeeded but attractions are empty AND attractions request failed/rejected,
               * try a cheaper attractions query (nodes-only, smaller radius) to avoid “all food” results.
               *
               * This specifically addresses the “big city” failure mode where the attractions query
               * is more likely to overload while food still works.
               */
              if (attractions.length === 0 && food.length > 0 && attRes.status === 'rejected') {
                const elapsed3 = Date.now() - budgetStart
                const remaining3 = Math.max(800, POIS_BUDGET_MS - elapsed3)

                // Only try if we have enough time left to realistically get a response.
                if (remaining3 > 1500 && !budgetAbort.signal.aborted) {
                  try {
                    const fallbackRadius = Math.min(1500, strategy.attractionRadius)

                    debug('overpass', 'attractions fallback (nodes-only) starting', {
                      fallbackRadius,
                      remainingMs: remaining3,
                    })

                    const fallbackQuery = buildAttractionQueryNodesOnly(rounded, fallbackRadius)

                    const fallbackResp = await timed('overpass.attractions.fallback', () =>
                      fetchOverpassWithFailover(
                        fallbackQuery,
                        Math.min(remaining3, 4000), // hard cap so fallback can’t dominate budget
                        budgetAbort.signal,
                      ),
                    )

                    const fallbackAttractions = elementsToPois(
                      rounded,
                      'attraction',
                      fallbackResp.elements,
                    ).slice(0, 25)

                    if (fallbackAttractions.length > 0) {
                      attractions = fallbackAttractions
                      debug('overpass', 'attractions fallback succeeded', {
                        rawFallbackElements: fallbackResp.elements.length,
                        attractionsAfterFilter: attractions.length,
                      })
                    } else {
                      debug('overpass', 'attractions fallback returned no usable POIs', {
                        rawFallbackElements: fallbackResp.elements.length,
                      })
                    }
                  } catch (e) {
                    debug('overpass', 'attractions fallback failed', {
                      reason: e instanceof Error ? e.message : String(e),
                    })
                  }
                }
              }

              if (attractions.length > bestAttractions.length) bestAttractions = attractions
              if (food.length > bestFood.length) bestFood = food

              if (attractions.length || food.length) {
                debug('overpass', `${strategy.name} strategy partial/complete success`, {
                  attractions: attractions.length,
                  food: food.length,
                  attractionsOk: attRes.status === 'fulfilled',
                  foodOk: foodRes.status === 'fulfilled',
                })
                return { attractions, food }
              }
            } catch (error) {
              // If we aborted due to budget, return best partials immediately.
              if (budgetAbort.signal.aborted) {
                budgetExceeded = true
                debug('overpass', 'POIs budget abort fired, returning best partial results', {
                  elapsedMs: Date.now() - budgetStart,
                  bestAttractions: bestAttractions.length,
                  bestFood: bestFood.length,
                  lastStrategyTried: strategy.name,
                })
                return { attractions: bestAttractions, food: bestFood }
              }

              lastError = error instanceof Error ? error : new Error(String(error))
              debug('overpass', `${strategy.name} strategy failed, trying next`, lastError.message)

              // Courtesy delay, but skip if we’re already running out of budget.
              const elapsed2 = Date.now() - budgetStart
              if (strategy.name !== 'minimal' && elapsed2 < POIS_BUDGET_MS * 0.5) {
                await new Promise((resolve) => setTimeout(resolve, 1000))
              }
            }
          }

          throw lastError ?? new Error('All Overpass strategies failed')
        } finally {
          clearTimeout(budgetTimer)
        }
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
