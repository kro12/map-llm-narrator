import type { LatLon, Poi } from '@/lib/shared/types'
import { kmBetween } from '@/lib/shared/geo'

type OverpassElement = {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

/**
 * Build Overpass query for attractions (nodes only for performance).
 */
export function buildAttractionQuery(point: LatLon, radiusMeters: number) {
  const { lat, lon } = point

  return `
[out:json][timeout:15];
(
  node(around:${radiusMeters},${lat},${lon})["tourism"~"attraction|museum|gallery|viewpoint|zoo|theme_park|artwork"];
  node(around:${radiusMeters},${lat},${lon})["historic"~"castle|ruins|monument|memorial|fort|archaeological_site"];
  node(around:${radiusMeters},${lat},${lon})["man_made"~"lighthouse|tower|bridge"];
  node(around:${radiusMeters},${lat},${lon})["natural"~"beach|peak|cliff|waterfall|bay"];
  node(around:${radiusMeters},${lat},${lon})["leisure"~"park|garden|nature_reserve"];
);
out tags center;
`
}

/**
 * Build Overpass query for food & drink.
 */
export function buildFoodQuery(point: LatLon, radiusMeters: number) {
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
 * Convert raw Overpass elements to typed POIs with ranking metadata.
 */
export function elementsToPois(
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

    // Filter low-signal attraction names
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

  // De-duplicate by name + location + category
  const seen = new Set<string>()
  const deduped: Poi[] = []
  for (const p of out) {
    const key = `${p.name.toLowerCase()}|${p.lat.toFixed(4)}|${p.lon.toFixed(4)}|${p.category}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(p)
  }

  // Rank by narratability score, then distance
  deduped.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.distanceKm - b.distanceKm)

  return deduped
}

// ============================================================================
// Helper functions
// ============================================================================

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
 * Derive ranking metadata for attractions.
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

  // Wikipedia/Wikidata indicate well-documented places
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
    // Only boost parks when they have strong supporting signals
    score += t.wikipedia || t.wikidata ? 3 : 0
  }

  return { bucket, hint, score }
}

/**
 * Derive ranking metadata for food establishments.
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
