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

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
]

function kmBetween(a: LatLon, b: LatLon) {
  // Haversine
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
 * Build a compact Overpass QL query using around() for a point click demo.
 */
function buildOverpassQuery(point: LatLon, radiusMeters: number, kind: 'attraction' | 'food') {
  const { lat, lon } = point

  if (kind === 'attraction') {
    // Simple but effective: tourism + historic + natural + leisure
    return `
[out:json][timeout:25];
(
  node(around:${radiusMeters},${lat},${lon})["tourism"];
  way(around:${radiusMeters},${lat},${lon})["tourism"];
  relation(around:${radiusMeters},${lat},${lon})["tourism"];

  node(around:${radiusMeters},${lat},${lon})["historic"];
  way(around:${radiusMeters},${lat},${lon})["historic"];
  relation(around:${radiusMeters},${lat},${lon})["historic"];

  node(around:${radiusMeters},${lat},${lon})["natural"];
  way(around:${radiusMeters},${lat},${lon})["natural"];
  relation(around:${radiusMeters},${lat},${lon})["natural"];

  node(around:${radiusMeters},${lat},${lon})["leisure"];
  way(around:${radiusMeters},${lat},${lon})["leisure"];
  relation(around:${radiusMeters},${lat},${lon})["leisure"];
);
out tags center;
`
  }

  // food: amenity=restaurant/cafe/fast_food/pub/bar + tourism=hotel maybe later
  return `
[out:json][timeout:25];
(
  node(around:${radiusMeters},${lat},${lon})["amenity"~"restaurant|cafe|fast_food|pub|bar"];
  way(around:${radiusMeters},${lat},${lon})["amenity"~"restaurant|cafe|fast_food|pub|bar"];
  relation(around:${radiusMeters},${lat},${lon})["amenity"~"restaurant|cafe|fast_food|pub|bar"];
);
out tags center;
`
}

async function fetchOverpassWithFailover(query: string) {
  let lastErr: unknown = null

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ data: query }).toString(),
      })

      if (!res.ok) throw new Error(`Overpass HTTP ${res.status} @ ${endpoint}`)

      return (await res.json()) as OverpassResponse
    } catch (e) {
      lastErr = e
      debug('overpass', 'endpoint failed', endpoint, e)
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

export async function getPois(point: LatLon) {
  // Cache keys: round coords to reduce fragmentation
  const lat = Number(point.lat.toFixed(5))
  const lon = Number(point.lon.toFixed(5))
  const rounded: LatLon = { lat, lon }

  const key = `pois:v1:${lat},${lon}`
  const ttlSeconds = 60 * 60 * 24 // 24h

  return await timed('overpass.pois.total', async () => {
    const { value, cacheHit } = await withCacheJSON<{ attractions: Poi[]; food: Poi[] }>(
      key,
      ttlSeconds,
      async () => {
        const attractionsQuery = buildOverpassQuery(rounded, 12000, 'attraction')
        const foodQuery = buildOverpassQuery(rounded, 1800, 'food')

        const [attractionsResp, foodResp] = await Promise.all([
          timed('overpass.attractions', () => fetchOverpassWithFailover(attractionsQuery)),
          timed('overpass.food', () => fetchOverpassWithFailover(foodQuery)),
        ])

        const attractions = elementsToPois(rounded, 'attraction', attractionsResp.elements).slice(
          0,
          25,
        )
        const food = elementsToPois(rounded, 'food', foodResp.elements).slice(0, 25)

        return { attractions, food }
      },
    )

    debug('poiResolver', `cacheHit=${cacheHit}`, {
      attractions: value.attractions.length,
      food: value.food.length,
    })

    return { pois: value, cacheHit }
  })
}
