import type { LatLon } from '@/lib/shared/types'

/**
 * Calculate distance between two coordinates in kilometers using Haversine formula.
 */
export function kmBetween(a: LatLon, b: LatLon): number {
  const R = 6371 // Earth's radius in km
  const dLat = deg2rad(b.lat - a.lat)
  const dLon = deg2rad(b.lon - a.lon)
  const lat1 = deg2rad(a.lat)
  const lat2 = deg2rad(b.lat)

  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function deg2rad(d: number): number {
  return (d * Math.PI) / 180
}
