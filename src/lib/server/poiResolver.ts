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
 * OPTIMIZATION 1: Use public Overpass instances that are more stable
 * + Add kumi.systems (often faster than main servers)
 */
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter', // keep first as often faster,
  'https://z.overpass-api.de/api/interpreter', // solid 'official cluster'
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter', // Main server last (most loaded)
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
 * We derive three cheap, deterministic fields from OSM tags:
 * - score: "narratability" weight (wiki/heritage > generic)
 * - bucket: coarse category used for diversity selection in promptBuilder
 * - hint: a tiny label (museum/castle/viewpoint/etc.) to help the LLM write something meaningful
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

  // Strong signals that correlate with "interesting" / well-described places
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
    // Parks are often low-narrative unless they have strong signals (wiki/heritage).
    // We still allow them, but their score will usually be lower unless supported.
    bucket = 'park'
    if (!hint) hint = leisure
    score += t.wikipedia || t.wikidata ? 3 : 0
  }

  return { bucket, hint, score }
}

/**
 * Narration-quality update for food:
 * - bucket is always 'food' (fits PoiBucket)
 * - foodKind provides food diversity (pub/cafe/restaurant/bar/other)
 * - hint stays short and cheap to keep prompt size down
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
 * OPTIMIZATION 2: Reduce query complexity.
 * Keep queries relatively focused so Overpass responds faster.
 */
function buildAttractionQuery(point: LatLon, radiusMeters: number) {
  const { lat, lon } = point

  return `
[out:json][timeout:15];
(
  node(around:${radiusMeters},${lat},${lon})["tourism"~"attraction|museum|gallery|viewpoint|zoo|theme_park|artwork"];
  way(around:${radiusMeters},${lat},${lon})["tourism"~"attraction|museum|gallery|viewpoint|zoo|theme_park|artwork"];

  node(around:${radiusMeters},${lat},${lon})["historic"~"castle|ruins|monument|memorial|fort|archaeological_site"];
  node(around:${radiusMeters},${lat},${lon})["man_made"~"lighthouse|tower|bridge"];
  node(around:${radiusMeters},${lat},${lon})["natural"~"beach|peak|cliff|waterfall|bay"];
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
 * OPTIMIZATION 3: Early abort (timeout) for fetch calls.
 */
async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } finally {
    clearTimeout(t)
  }
}

/**
 * OPTIMIZATION 4: Overpass failover.
 * `timeoutMs` is a per-endpoint timeout; we pass the *remaining wall-clock budget*
 * from getPois(), so a single slow request can't blow the overall POI budget.
 */
async function fetchOverpassWithFailover(query: string, timeoutMs: number) {
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
        timeoutMs, // ✅ IMPORTANT: use remaining budget, not a fixed 8s
      )

      if (res.status === 504 || res.status === 503 || res.status === 429) {
        debug('overpass', `${res.status} (server overloaded), trying next endpoint`)
        lastErr = new Error(`Overpass HTTP ${res.status} (overloaded)`)
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
    } catch (e) {
      lastErr = e
      const errMsg = e instanceof Error ? e.message : 'Unknown error'
      debug('overpass', 'endpoint failed', endpoint, errMsg)

      // Courtesy delay, but don't waste time if the budget is nearly gone.
      if (attempt < OVERPASS_ENDPOINTS.length && timeoutMs > 1500) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('Overpass failed on all endpoints')
}

/**
 * Convert raw Overpass elements -> POIs:
 * - normalize name
 * - filter obvious low-signal attraction names
 * - derive score/bucket/hint for ranking and prompt diversity
 *
 * Note: We branch on `kind` to satisfy discriminated union typing of Poi.
 */
function elementsToPois(
  point: LatLon,
  kind: 'attraction' | 'food',
  elements: OverpassElement[],
): Poi[] {
  const out: Poi[] = []

  for (const el of elements) {
    const coords = getElementCoords(el)
    if (!coords) continue

    const name = normalizeName(el.tags)
    if (!name) continue

    const n = name.toLowerCase()
    if (kind === 'attraction') {
      // Cheap filter for obvious low-signal attraction names.
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

  // De-dupe by name + rough location bucket
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
 * Safe wrapper: never throw POI errors to the caller; return empty data + message instead.
 * Also surfaces a warning if we had to cut off POI lookup due to our time budget.
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
  // v3 rounding: 5 -> 3 decimals (~100m) to increase cache hits while still being relevant.
  const lat = Number(point.lat.toFixed(3))
  const lon = Number(point.lon.toFixed(3))
  const rounded: LatLon = { lat, lon }

  const key = `pois:v3:${lat},${lon}`
  const ttlSeconds = 60 * 60 * 24 // 24h

  return await timed('overpass.pois.total', async () => {
    // Track budget exhaustion OUTSIDE cached value to avoid caching transient timeouts.
    let budgetExceeded = false

    const { value, cacheHit } = await withCacheJSON<{ attractions: Poi[]; food: Poi[] }>(
      key,
      ttlSeconds,
      async () => {
        const strategies = [
          { name: 'normal', attractionRadius: 5000, foodRadius: 2000 },
          { name: 'fallback', attractionRadius: 2000, foodRadius: 1000 },
          { name: 'minimal', attractionRadius: 500, foodRadius: 500 },
        ]

        let lastError: Error | null = null

        // Global wall-clock budget for POIs. Keeps the UI responsive.
        const POIS_BUDGET_MS = 10_000
        const budgetStart = Date.now()

        let bestAttractions: Poi[] = []
        let bestFood: Poi[] = []

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

            // Remaining budget becomes the per-endpoint timeout (true total-time cap).
            const remaining = Math.max(1000, POIS_BUDGET_MS - (Date.now() - budgetStart))

            const [attractionsResp, foodResp] = await Promise.all([
              timed('overpass.attractions', () =>
                fetchOverpassWithFailover(attractionsQuery, remaining),
              ),
              timed('overpass.food', () => fetchOverpassWithFailover(foodQuery, remaining)),
            ])

            const attractions = elementsToPois(
              rounded,
              'attraction',
              attractionsResp.elements,
            ).slice(0, 25)
            const food = elementsToPois(rounded, 'food', foodResp.elements).slice(0, 25)

            if (attractions.length > bestAttractions.length) bestAttractions = attractions
            if (food.length > bestFood.length) bestFood = food

            debug('overpass', `${strategy.name} strategy succeeded`, {
              attractions: attractions.length,
              food: food.length,
            })

            return { attractions, food }
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error))
            debug('overpass', `${strategy.name} strategy failed, trying next`, lastError.message)

            // Courtesy delay, but skip if we're already running out of budget.
            const elapsed2 = Date.now() - budgetStart
            if (strategy.name !== 'minimal' && elapsed2 < POIS_BUDGET_MS * 0.5) {
              await new Promise((resolve) => setTimeout(resolve, 1000))
            }
          }
        }

        throw lastError ?? new Error('All Overpass strategies failed')
      },
    )

    debug('poiResolver', `cacheHit=${cacheHit}`, {
      attractions: value.attractions.length,
      food: value.food.length,
      budgetExceeded,
    })

    // for UI to actually display the warning, make sure /api/narrate handler includes pois.warnings
    return { pois: value, cacheHit, budgetExceeded }
  })
}
