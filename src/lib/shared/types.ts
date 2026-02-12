export type LatLon = { lat: number; lon: number }

/**
 * Poi (Point of Interest)
 *
 * Represents either an attraction or a food/drink venue returned from Overpass.
 *
 * Notes:
 * - `category` is the primary discriminator ('attraction' | 'food').
 * - `bucket` is a coarse narrative grouping used for ranking/diversity selection
 *   (e.g. history, culture, scenic, park, landmark, food).
 * - `foodKind` is only meaningful when `category === 'food'`
 *   and allows further diversity (pub, cafe, restaurant, bar, etc).
 * - `score` is a lightweight "narratability" weight derived from OSM tags
 *   (wiki/heritage/website signals increase it).
 * - `hint` is a small derived label (e.g. "museum", "castle", "viewpoint")
 *   used to improve prompt quality without adding significant token overhead.
 *
 * All ranking and hinting fields are deterministic and derived server-side.
 * The LLM never invents them — they only guide prompt construction.
 */

export type PoiBucket = 'food' | 'history' | 'culture' | 'scenic' | 'park' | 'landmark'
export type FoodKind = 'pub' | 'cafe' | 'restaurant' | 'bar' | 'other'

type PoiBase = {
  name: string
  lat: number
  lon: number
  distanceKm: number
  osmUrl?: string
  score?: number
  bucket?: PoiBucket
  hint?: string
}

export type Poi =
  | (PoiBase & {
      category: 'attraction'
      foodKind?: never
    })
  | (PoiBase & {
      category: 'food'
      bucket?: 'food'
      foodKind?: FoodKind
    })
