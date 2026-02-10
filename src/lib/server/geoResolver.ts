import { timed, debug } from '@/lib/server/debug'
import { withCacheJSON } from '@/lib/server/cache'
import type { LatLon } from '@/lib/shared/types'

type NominatimReverseResponse = {
  display_name?: string
  name?: string
  lat?: string
  lon?: string
  address?: {
    city?: string
    town?: string
    village?: string
    county?: string
    state?: string
    country?: string
    country_code?: string
  }
}

export type GeoResult = {
  displayName: string
  shortName: string
  countryCode?: string
  country?: string
  region?: string
}

function shortNameFromAddress(addr?: NominatimReverseResponse['address']) {
  const place = addr?.city || addr?.town || addr?.village || addr?.county || 'Unknown place'
  const region = addr?.state ? `, ${addr.state}` : ''
  return `${place}${region}`
}

export async function reverseGeocode(
  point: LatLon,
): Promise<{ geo: GeoResult; cacheHit: boolean }> {
  // round coords so cache keys are stable for nearby clicks
  const lat = Number(point.lat.toFixed(5))
  const lon = Number(point.lon.toFixed(5))

  const key = `geo:v1:rev:${lat},${lon}`
  const ttlSeconds = 60 * 60 * 24 * 7 // 7 days

  return await timed('nominatim.reverse', async () => {
    const { value, cacheHit } = await withCacheJSON<GeoResult>(key, ttlSeconds, async () => {
      const url = new URL('https://nominatim.openstreetmap.org/reverse')
      url.searchParams.set('format', 'jsonv2')
      url.searchParams.set('lat', String(lat))
      url.searchParams.set('lon', String(lon))

      // Nominatim is picky about UA contact. Set a descriptive UA if possible.
      const res = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
          // Many deployments ignore UA, but no harm to set it.
          // NOTE: On some platforms we can't set User-Agent; this header might be dropped.
          'User-Agent': 'map-llm-narrator-demo/1.0 (github demo)',
        },
      })

      if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`)

      const data = (await res.json()) as NominatimReverseResponse

      const displayName = data.display_name || data.name || shortNameFromAddress(data.address)
      const shortName = shortNameFromAddress(data.address)

      const geo: GeoResult = {
        displayName,
        shortName,
        countryCode: data.address?.country_code?.toUpperCase(),
        country: data.address?.country,
        region: data.address?.state || data.address?.county,
      }

      return geo
    })

    debug('geoResolver', `cacheHit=${cacheHit}`, value)
    return { geo: value, cacheHit }
  })
}
