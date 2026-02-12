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
}

/**
 * OPTIMIZATION 1: Use public Overpass instances that are more stable
 * + Add kumi.systems (often faster than main servers)
 */
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter', // Often faster, add first
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
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
 * OPTIMIZATION 2: Dramatically reduce query complexity
 *
 * - Reduce attraction radius from 12km → 5km (78x less area!)
 * - Reduce timeout from 25s → 15s (Overpass servers prefer faster queries)
 * - Focus on nodes primarily (ways/relations add exponential complexity)
 * - Split large queries into smaller, faster ones
 */
function buildAttractionQuery(point: LatLon, radiusMeters: number) {
  const { lat, lon } = point

  // OPTIMIZATION: Prioritize nodes, only include ways for tourism (most reliable)
  return `
[out:json][timeout:15];
(
  node(around:${radiusMeters},${lat},${lon})["tourism"];
  way(around:${radiusMeters},${lat},${lon})["tourism"];
  
  node(around:${radiusMeters},${lat},${lon})["historic"];
  node(around:${radiusMeters},${lat},${lon})["natural"];
  node(around:${radiusMeters},${lat},${lon})["leisure"~"park|garden|nature_reserve|beach|swimming_pool"];
);
out tags center;
`
}

function buildFoodQuery(point: LatLon, radiusMeters: number) {
  const { lat, lon } = point

  // OPTIMIZATION: Nodes only for food (restaurants are mostly nodes)
  return `
[out:json][timeout:15];
(
  node(around:${radiusMeters},${lat},${lon})["amenity"~"restaurant|cafe|fast_food|pub|bar"];
);
out tags center;
`
}

/**
 * OPTIMIZATION 3: More aggressive timeout + early abort
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
 * OPTIMIZATION 4: Fail fast on 504/503, don't wait for timeout
 */
async function fetchOverpassWithFailover(query: string) {
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
        8000, // Reduce from 6s to 8s (Overpass can be slow, but 25s was too much)
      )

      // OPTIMIZATION: Fail fast on server overload errors
      if (res.status === 504 || res.status === 503 || res.status === 429) {
        debug('overpass', `${res.status} (server overloaded), trying next endpoint`)
        lastErr = new Error(`Overpass HTTP ${res.status} (overloaded)`)
        continue // Try next endpoint immediately
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

      // Small delay before trying next endpoint (rate limiting courtesy)
      if (attempt < OVERPASS_ENDPOINTS.length) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('Overpass failed on all endpoints')
}

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

    const d = kmBetween(point, coords)
    out.push({
      name,
      category: kind,
      lat: coords.lat,
      lon: coords.lon,
      distanceKm: d,
      osmUrl: osmUrl(el),
    })
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

  // Sort by distance
  deduped.sort((a, b) => a.distanceKm - b.distanceKm)
  return deduped
}

/**
 * OPTIMIZATION 5: Graceful degradation strategy
 *
 * Try progressively smaller radii if queries fail:
 * 1. Normal radius (5km attractions, 2km food)
 * 2. Fallback to smaller radius (2km attractions, 1km food)
 * 3. Fallback to minimal radius (500m both)
 */
export async function getPoisSafe(point: LatLon): Promise<{ pois: PoisResult; cacheHit: boolean }> {
  try {
    const { pois, cacheHit } = await getPois(point)
    return { pois: { ...pois, errors: [] }, cacheHit }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown Overpass error'
    debug('poiResolver', 'falling back to minimal data', msg)

    // OPTIMIZATION: Don't fail completely - return empty with error message
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

export async function getPois(point: LatLon) {
  const lat = Number(point.lat.toFixed(5))
  const lon = Number(point.lon.toFixed(5))
  const rounded: LatLon = { lat, lon }

  const key = `pois:v2:${lat},${lon}` // v2 cache key (smaller radius)
  const ttlSeconds = 60 * 60 * 24 // 24h

  return await timed('overpass.pois.total', async () => {
    const { value, cacheHit } = await withCacheJSON<{ attractions: Poi[]; food: Poi[] }>(
      key,
      ttlSeconds,
      async () => {
        /**
         * OPTIMIZATION 6: Progressive radius strategy
         * Start with reasonable radius, fall back to smaller if needed
         */
        const strategies = [
          { name: 'normal', attractionRadius: 5000, foodRadius: 2000 },
          { name: 'fallback', attractionRadius: 2000, foodRadius: 1000 },
          { name: 'minimal', attractionRadius: 500, foodRadius: 500 },
        ]

        let lastError: Error | null = null

        for (const strategy of strategies) {
          try {
            debug('overpass', `trying ${strategy.name} strategy`, strategy)

            const attractionsQuery = buildAttractionQuery(rounded, strategy.attractionRadius)
            const foodQuery = buildFoodQuery(rounded, strategy.foodRadius)

            const [attractionsResp, foodResp] = await Promise.all([
              timed('overpass.attractions', () => fetchOverpassWithFailover(attractionsQuery)),
              timed('overpass.food', () => fetchOverpassWithFailover(foodQuery)),
            ])

            const attractions = elementsToPois(
              rounded,
              'attraction',
              attractionsResp.elements,
            ).slice(0, 25)
            const food = elementsToPois(rounded, 'food', foodResp.elements).slice(0, 25)

            debug('overpass', `${strategy.name} strategy succeeded`, {
              attractions: attractions.length,
              food: food.length,
            })

            return { attractions, food }
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error))
            debug('overpass', `${strategy.name} strategy failed, trying next`, lastError.message)

            // Small delay before trying next strategy
            if (strategy.name !== 'minimal') {
              await new Promise((resolve) => setTimeout(resolve, 1000))
            }
          }
        }

        // All strategies failed
        throw lastError ?? new Error('All Overpass strategies failed')
      },
    )

    debug('poiResolver', `cacheHit=${cacheHit}`, {
      attractions: value.attractions.length,
      food: value.food.length,
    })

    return { pois: value, cacheHit }
  })
}
