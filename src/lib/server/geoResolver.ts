import { timed, debug } from '@/lib/server/debug'
import { withCacheJSON } from '@/lib/server/cache'
import type { LatLon } from '@/lib/shared/types'
import { fetchNominatim, buildGeoResult } from '@/lib/server/nominatim/client'

export type GeoResult = {
  displayName: string
  shortName: string
  label: string
  fineLabel?: string
  context?: string
  countryCode?: string
  country?: string
  region?: string
}

export async function reverseGeocode(
  point: LatLon,
): Promise<{ geo: GeoResult; cacheHit: boolean }> {
  // Round coords so cache keys are stable for nearby clicks
  const lat = Number(point.lat.toFixed(5))
  const lon = Number(point.lon.toFixed(5))

  // IMPORTANT: Bump cache version when label logic changes
  const key = `geo:v2:rev:${lat},${lon}`
  const ttlSeconds = 60 * 60 * 24 * 7 // 7 days

  return await timed('nominatim.reverse', async () => {
    const { value, cacheHit } = await withCacheJSON<GeoResult>(key, ttlSeconds, async () => {
      const data = await fetchNominatim(lat, lon)
      return buildGeoResult(data)
    })

    debug('geoResolver', `cacheHit=${cacheHit}`, value)
    return { geo: value, cacheHit }
  })
}
