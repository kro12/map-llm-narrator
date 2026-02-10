export type LatLon = { lat: number; lon: number }

export type Poi = {
  name: string
  category: 'attraction' | 'food'
  lat: number
  lon: number
  distanceKm: number
  osmUrl?: string
}
